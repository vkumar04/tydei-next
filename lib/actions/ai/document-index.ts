"use server"

/**
 * AI agent — document indexing server action.
 *
 * Per docs/superpowers/specs/2026-04-18-ai-agent-rewrite.md subsystem 2.
 *
 * Given an uploaded ContractDocument row with extracted text (raw PDF
 * text, ideally with form-feed-delimited pages), split + normalize +
 * persist ContractDocumentPage rows + flip indexStatus: processing →
 * indexed.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  splitTextIntoPages,
  normalizePageText,
} from "@/lib/ai/text-extraction"
import { searchIndexedDocuments, type IndexedPage } from "@/lib/ai/document-search"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"

/**
 * Index the uploaded document. The caller has already:
 *   1. Stored the file in object storage + created the ContractDocument row
 *   2. Extracted the raw text via an upstream OCR pipeline (not covered here)
 *
 * This action:
 *   - Verifies contract ownership
 *   - Splits raw text into pages + normalizes
 *   - Bulk-inserts ContractDocumentPage rows
 *   - Flips indexStatus to "indexed" + sets indexedAt
 */
export async function indexContractDocument(input: {
  documentId: string
  rawText: string
}) {
  const session = await requireFacility()
  const { facility } = session

  // Ownership check via the parent contract.
  const document = await prisma.contractDocument.findUniqueOrThrow({
    where: { id: input.documentId },
    include: { contract: { select: { id: true } } },
  })
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(document.contract.id, facility.id),
    select: { id: true },
  })

  // Mark as processing.
  await prisma.contractDocument.update({
    where: { id: input.documentId },
    data: { indexStatus: "processing" },
  })

  try {
    const rawPages = splitTextIntoPages(input.rawText)
    const normalized = normalizePageText(rawPages)

    // Drop existing pages (re-index replaces).
    await prisma.contractDocumentPage.deleteMany({
      where: { documentId: input.documentId },
    })

    // Bulk-insert new pages.
    if (normalized.length > 0) {
      await prisma.contractDocumentPage.createMany({
        data: normalized.map((p) => ({
          documentId: input.documentId,
          pageNumber: p.pageNumber,
          text: p.text,
        })),
      })
    }

    await prisma.contractDocument.update({
      where: { id: input.documentId },
      data: {
        indexStatus: "indexed",
        indexedAt: new Date(),
      },
    })

    await logAudit({
      userId: session.user.id,
      action: "ai.document_indexed",
      entityType: "contract_document",
      entityId: input.documentId,
      metadata: {
        pageCount: normalized.length,
        facilityId: facility.id,
      },
    })

    return { pageCount: normalized.length, status: "indexed" as const }
  } catch (err) {
    await prisma.contractDocument.update({
      where: { id: input.documentId },
      data: { indexStatus: "failed" },
    })
    throw err
  }
}

/**
 * Search indexed documents scoped to the facility. Wraps the pure
 * `searchIndexedDocuments` helper with Prisma loading.
 */
export async function searchFacilityDocuments(input: {
  query: string
  vendorFilter?: string | null
  documentTypeFilter?: string | null
  limit?: number
}) {
  const { facility } = await requireFacility()

  // Load all indexed pages for documents belonging to this facility's contracts.
  const pages = await prisma.contractDocumentPage.findMany({
    where: {
      document: {
        contract: {
          OR: [
            { facilityId: facility.id },
            { contractFacilities: { some: { facilityId: facility.id } } },
          ],
        },
      },
    },
    include: {
      document: {
        select: {
          id: true,
          name: true,
          type: true,
          contract: { select: { vendor: { select: { name: true } } } },
        },
      },
    },
  })

  const indexedPages: IndexedPage[] = pages.map((p) => ({
    documentId: p.documentId,
    pageNumber: p.pageNumber,
    text: p.text,
    vendor: p.document.contract.vendor.name,
    documentType: p.document.type,
  }))

  const hits = searchIndexedDocuments(indexedPages, input.query, {
    vendorFilter: input.vendorFilter ?? undefined,
    documentTypeFilter: input.documentTypeFilter ?? undefined,
    limit: input.limit,
  })

  return serialize(hits)
}
