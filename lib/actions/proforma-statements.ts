"use server"

import { prisma } from "@/lib/db"
import type { Prisma } from "@/lib/generated/prisma/client"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"
import { vendorRelatedFacilityWhere } from "@/lib/vendors/related-facilities"
import { parseProformaMatrix } from "@/lib/proforma/parse-proforma-rows"
import {
  proformaLineItemsSchema,
  ingestProformaMetaSchema,
  type IngestProformaMeta,
} from "@/lib/validators/dividend-proposals"
import type { ProformaLineItems } from "@/lib/financial-analysis/proforma-pnl"

// Vendor-owned uploaded facility P&L statements for the Dividend/DCF tab.
// Every read and write is scoped to the caller's own vendor.

const MAX_MATRIX_ROWS = 5_000

export interface ProformaStatementView {
  id: string
  facilityKey: string
  facilityLabel: string
  connected: boolean
  fileName: string
  lineItems: ProformaLineItems
  matchedFields: string[]
  uploadedAt: string
}

export async function listProformaStatements(): Promise<ProformaStatementView[]> {
  const { vendor } = await requireVendor()
  const rows = await prisma.proformaStatement.findMany({
    where: { vendorId: vendor.id },
    orderBy: { facilityLabel: "asc" },
  })
  return serialize(
    rows.flatMap((row) => {
      // Tolerant read: a row whose shape drifted is dropped from the list
      // rather than crashing the tab.
      const parsed = proformaLineItemsSchema.safeParse(row.lineItems)
      if (!parsed.success) {
        console.error("[listProformaStatements] stale lineItems shape", {
          vendorId: vendor.id,
          statementId: row.id,
        })
        return []
      }
      return [
        {
          id: row.id,
          facilityKey: row.facilityKey,
          facilityLabel: row.facilityLabel,
          connected: row.facilityId !== null,
          fileName: row.fileName,
          lineItems: parsed.data,
          matchedFields: (row.matchedFields as string[]) ?? [],
          uploadedAt: row.updatedAt.toISOString(),
        },
      ]
    }),
  )
}

export interface IngestProformaResult {
  facilityKey: string
  facilityLabel: string
  matchedCount: number
  unmatchedLabels: string[]
  lineItems: ProformaLineItems
}

/**
 * Parse + persist an uploaded Steady State Proforma for one facility. The
 * matrix comes from /api/import-proforma (file bytes never cross the RSC
 * wire). Re-uploading for the same facility replaces the statement.
 */
export async function ingestProformaMatrix(
  matrix: string[][],
  meta: IngestProformaMeta,
): Promise<IngestProformaResult> {
  const { vendor, user } = await requireVendor()
  await requireCanMutate()
  const parsedMeta = ingestProformaMetaSchema.parse(meta)

  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new Error("The file contains no rows")
  }
  if (matrix.length > MAX_MATRIX_ROWS) {
    throw new Error(
      `The file has ${matrix.length.toLocaleString()} rows; a P&L statement should be well under ${MAX_MATRIX_ROWS.toLocaleString()}`,
    )
  }

  let facilityId: string | null = null
  let facilityKey: string
  let facilityLabel: string
  if (parsedMeta.facilityId) {
    const facility = await prisma.facility.findFirst({
      where: {
        id: parsedMeta.facilityId,
        status: "active",
        ...vendorRelatedFacilityWhere(vendor.id),
      },
      select: { id: true, name: true },
    })
    if (!facility) throw new Error("Facility not found")
    facilityId = facility.id
    facilityKey = `facility:${facility.id}`
    facilityLabel = facility.name
  } else {
    const name = (parsedMeta.adhocName ?? "").trim()
    facilityKey = `adhoc:${name.toLowerCase()}`
    facilityLabel = name
  }

  const parsed = parseProformaMatrix(matrix)
  // A statement REPLACES all 21 fields, so a barely-recognized file would
  // silently zero the rest and produce a confidently wrong NOI. Require the
  // lines the model actually depends on, not merely "something matched".
  const MIN_MATCHED = 5
  const required: (keyof typeof parsed.lineItems)[] = [
    "standardBillingRevenue",
    "medicalSupplies",
  ]
  const missing = required.filter((f) => !parsed.matchedFields.includes(f))
  if (parsed.matchedFields.length < MIN_MATCHED || missing.length > 0) {
    throw new Error(
      `Only ${parsed.matchedFields.length} P&L line${parsed.matchedFields.length === 1 ? "" : "s"} were recognized${
        missing.length > 0 ? ` (missing ${missing.join(", ")})` : ""
      }. The file should have one row per line item, with the label in one column and the amount in another — e.g. "Medical supplies and services | 12,316,248".`,
    )
  }

  const validLineItems = proformaLineItemsSchema.safeParse(parsed.lineItems)
  if (!validLineItems.success) {
    throw new Error(
      "The statement contains out-of-range amounts. Check for values that are not plain numbers.",
    )
  }

  try {
    const saved = await prisma.proformaStatement.upsert({
      where: { vendorId_facilityKey: { vendorId: vendor.id, facilityKey } },
      create: {
        vendorId: vendor.id,
        facilityKey,
        facilityId,
        facilityLabel,
        fileName: parsedMeta.fileName,
        lineItems: validLineItems.data as unknown as Prisma.InputJsonValue,
        matchedFields: parsed.matchedFields,
        uploadedBy: user.id,
      },
      update: {
        facilityId,
        facilityLabel,
        fileName: parsedMeta.fileName,
        lineItems: validLineItems.data as unknown as Prisma.InputJsonValue,
        matchedFields: parsed.matchedFields,
        uploadedBy: user.id,
      },
    })
    return {
      facilityKey: saved.facilityKey,
      facilityLabel: saved.facilityLabel,
      matchedCount: parsed.matchedFields.length,
      unmatchedLabels: parsed.unmatchedLabels.slice(0, 20),
      lineItems: validLineItems.data,
    }
  } catch (err) {
    console.error("[ingestProformaMatrix]", err, { vendorId: vendor.id })
    throw new Error("Failed to save the P&L statement")
  }
}

export async function deleteProformaStatement(id: string): Promise<void> {
  const { vendor } = await requireVendor()
  await requireCanMutate()
  try {
    const existing = await prisma.proformaStatement.findFirst({
      where: { id, vendorId: vendor.id },
      select: { id: true },
    })
    if (!existing) return
    // auth-scope-scanner-skip: row authorized via the vendor-scoped findFirst above
    await prisma.proformaStatement.delete({ where: { id: existing.id } })
  } catch (err) {
    console.error("[deleteProformaStatement]", err, { vendorId: vendor.id })
    throw new Error("Failed to delete the P&L statement")
  }
}
