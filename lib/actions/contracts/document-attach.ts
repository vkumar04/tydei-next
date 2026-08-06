"use server"

// Split from lib/actions/contracts.ts (subsystem F5 decomposition,
// 2026-08-05). No barrel at the old path — Next.js disallows
// non-async-function re-exports from "use server" modules.
//
// Named document-attach.ts because lib/actions/contracts/documents.ts
// ALREADY exports a DIFFERENT createContractDocument (different input
// shape, DocumentType coercion, revalidatePath calls; used by
// contract-detail-client.tsx). This behavior-preserving split keeps both
// verbatim — consolidating them is a follow-up ticket, not this pass.

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { toSafeResult, type SafeResult } from "@/lib/actions/safe-result"
import { logAudit } from "@/lib/audit"
import { deleteFile as deleteObjectFromStorage } from "@/lib/storage"
import { keyBelongsToTenant } from "@/lib/uploads/key-policy"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"

// ─── Create Contract Document ───────────────────────────────────

export async function createContractDocument(input: {
  contractId: string
  name: string
  type?: string
  url?: string
}) {
  // Charles audit round-7 BLOCKER: verify the contract belongs to
  // this facility before attaching a document. Pre-fix any facility
  // user could attach a document to any other facility's contract
  // (deleteContractDocument already verified — pattern was right
  // there to copy).
  const { facility, user } = await requireFacility()
  await requireCanMutate()
  // Storage keys only — a stored absolute URL would become a navigation
  // target on the Documents tab (planted-phishing vector).
  if (input.url && /^[a-z][a-z0-9+.-]*:/i.test(input.url)) {
    throw new Error("Document url must be a storage key, not a URL")
  }
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(input.contractId, facility.id),
    select: { id: true },
  })
  // The key must be caller-minted (tenant-provenance prefix) — otherwise a
  // ContractDocument row is a self-authorization vector: attach any key you
  // once saw and assertKeyVisibleToUser presigns it forever (review
  // 2026-08-05). Keys already on THIS contract carry over (re-attach flows
  // and pre-provenance rows).
  if (input.url) {
    const alreadyOnContract = await prisma.contractDocument.findFirst({
      where: { contractId: input.contractId, url: input.url },
      select: { id: true },
    })
    if (!alreadyOnContract && !keyBelongsToTenant(input.url, [facility.id, user.id])) {
      throw new Error(
        "Attached document key was not uploaded by this account — re-upload the file and try again.",
      )
    }
  }
  return prisma.contractDocument.create({
    data: {
      contractId: input.contractId,
      name: input.name,
      type: (input.type as any) ?? "main",
      url: input.url,
    },
  })
}

/**
 * Error-as-value variant of createContractDocument — returns the failure
 * reason as a serializable value so it survives Next.js 16's production
 * Server Action error redaction. See lib/actions/safe-result.ts.
 */
export async function createContractDocumentSafe(input: {
  contractId: string
  name: string
  type?: string
  url?: string
}): Promise<SafeResult<Awaited<ReturnType<typeof createContractDocument>>>> {
  return toSafeResult(
    "createContractDocument",
    { contractId: input.contractId, name: input.name },
    () => createContractDocument(input),
  )
}

// ─── Delete Contract Document ───────────────────────────────────

export async function deleteContractDocument(id: string) {
  const session = await requireFacility()
  const { facility } = session
  await requireCanMutate()

  // Verify the document belongs to a contract owned by this facility.
  // auth-scope-scanner-skip: read-only identity probe; the ownership decision is
  // the explicit `owned` comparison below, which throws before the delete.
  const doc = await prisma.contractDocument.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      contractId: true,
      url: true,
      contract: {
        select: {
          facilityId: true,
          contractFacilities: { select: { facilityId: true } },
        },
      },
    },
  })
  const owned =
    doc.contract.facilityId === facility.id ||
    doc.contract.contractFacilities.some((cf) => cf.facilityId === facility.id)
  if (!owned) {
    throw new Error("Not authorized to delete this document")
  }

  // auth-scope-scanner-skip: unreachable unless the `owned` check above passed,
  // which proves the document's contract belongs to this facility.
  await prisma.contractDocument.delete({ where: { id } })

  // Best-effort S3 cleanup (review 2026-08-05: deleting the row used to
  // orphan the object, which stayed fetchable forever). Only when no OTHER
  // document row still references the same key — duplicate uploads sharing
  // one key exist in prod — and never blocking the user-facing delete.
  if (doc.url && !/^[a-z][a-z0-9+.-]*:/i.test(doc.url)) {
    try {
      // Keys also live in PendingContract.documents JSON — the vendor
      // multi-facility flow deliberately fans ONE key out to many pending
      // rows, so count both homes before destroying the object.
      const [otherRefs, pendingRefs] = await Promise.all([
        prisma.contractDocument.count({ where: { url: doc.url } }),
        prisma.pendingContract.count({
          where: { documents: { array_contains: [{ url: doc.url }] } },
        }),
      ])
      if (otherRefs === 0 && pendingRefs === 0) {
        await deleteObjectFromStorage(doc.url)
      }
    } catch (err) {
      console.error("[deleteContractDocument] S3 cleanup failed", err, {
        contractId: doc.contractId,
        key: doc.url,
      })
    }
  }

  await logAudit({
    userId: session.user.id,
    action: "contract_document.deleted",
    entityType: "contractDocument",
    entityId: id,
    metadata: { contractId: doc.contractId },
  })
}
