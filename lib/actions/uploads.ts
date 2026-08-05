"use server"

import { requireAuth } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { prisma } from "@/lib/db"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { contractsOwnedByVendor } from "@/lib/actions/contracts-vendor-auth"
import { uploadRequestSchema, type UploadRequest } from "@/lib/validators/uploads"
import { toSafeResult, type SafeResult } from "@/lib/actions/safe-result"
import { generatePresignedUploadUrl, generatePresignedDownloadUrl, deleteObject } from "@/lib/s3"

/**
 * Charles audit round-7 CONCERN: scope S3 key access to keys that
 * appear in tables the authenticated user can reasonably reach. Pre-fix
 * any authenticated user could download or delete any object whose key
 * they could guess (and keys are predictable: `folder/timestamp-name`).
 * Now: a key must appear in ContractDocument or PendingContract.documents
 * for the user's facility/vendor scope.
 */
async function assertKeyVisibleToUser(key: string): Promise<void> {
  const session = await requireAuth()
  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { facility: true, vendor: true } } },
  })
  const facilityId = member?.organization?.facility?.id
  const vendorId = member?.organization?.vendor?.id

  // Direct attachment via ContractDocument scoped by contract owner. Uses the
  // canonical ownership predicates: a bare `{ facilityId }` / `{ vendorId }`
  // check drops multi-facility (contractFacilities join) and grouped-vendor
  // (additionalVendorIds) contracts, denying downloads to rightful owners.
  const doc = await prisma.contractDocument.findFirst({
    where: {
      url: key,
      ...(facilityId
        ? { contract: contractsOwnedByFacility(facilityId) }
        : vendorId
          ? { contract: contractsOwnedByVendor(vendorId) }
          : { id: "__none__" }),
    },
    select: { id: true },
  })
  if (doc) return

  // Pending-contract documents JSON blob — fetch the row's documents
  // and exact-match the key against `url`/`key` fields. Avoids the
  // substring-collision risk with predictable filenames. The display
  // `name` field deliberately does NOT authorize: it is free text a
  // counterparty controls, so matching it would let a forged name claim
  // another tenant's object key.
  const pendingRows = await prisma.pendingContract.findMany({
    where: facilityId
      ? { facilityId }
      : vendorId
        ? { vendorId }
        : { id: "__none__" },
    select: { documents: true },
  })
  for (const row of pendingRows) {
    const docs = row.documents
    if (!Array.isArray(docs)) continue
    for (const d of docs) {
      if (d === null || typeof d !== "object") continue
      const r = d as { url?: unknown; key?: unknown }
      if (r.url === key || r.key === key) return
    }
  }

  throw new Error("File not found or not accessible")
}

const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
]

export async function getUploadUrl(input: UploadRequest) {
  await requireAuth()
  const data = uploadRequestSchema.parse(input)

  if (!ALLOWED_CONTENT_TYPES.includes(data.contentType)) {
    throw new Error("File type not allowed")
  }

  const key = `${data.folder}/${Date.now()}-${data.fileName}`
  const uploadUrl = await generatePresignedUploadUrl(key, data.contentType)
  const publicUrl = key

  return { uploadUrl, key, publicUrl }
}

export async function getDownloadUrl(key: string, downloadName?: string) {
  await assertKeyVisibleToUser(key)
  return generatePresignedDownloadUrl(key, downloadName)
}

/**
 * Error-as-value variant of getDownloadUrl — Next 16 prod builds redact
 * thrown Server Action errors, so the toast would otherwise show a useless
 * digest message (see lib/actions/safe-result.ts).
 */
export async function getDownloadUrlSafe(
  key: string,
  downloadName?: string,
): Promise<SafeResult<string>> {
  return toSafeResult("getDownloadUrl", { key }, () =>
    getDownloadUrl(key, downloadName),
  )
}

export async function deleteFile(key: string) {
  // Read-only (`user`) tier must not delete files. The write goes to S3
  // (deleteObject), not prisma, so the inline-prisma scanner can't see it.
  await requireCanMutate()
  await assertKeyVisibleToUser(key)
  await deleteObject(key)
}
