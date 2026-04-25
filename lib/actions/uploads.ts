"use server"

import { requireAuth } from "@/lib/actions/auth"
import { prisma } from "@/lib/db"
import { uploadRequestSchema, type UploadRequest } from "@/lib/validators/uploads"
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

  // Direct attachment via ContractDocument scoped by contract owner.
  const doc = await prisma.contractDocument.findFirst({
    where: {
      url: key,
      ...(facilityId
        ? { contract: { facilityId } }
        : vendorId
          ? { contract: { vendorId } }
          : { id: "__none__" }),
    },
    select: { id: true },
  })
  if (doc) return

  // Pending-contract documents JSON blob — fetch the row's documents
  // and exact-match the key against `url`/`key` fields. Avoids the
  // substring-collision risk with predictable filenames.
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
      const r = d as { url?: unknown; key?: unknown; name?: unknown }
      if (r.url === key || r.key === key || r.name === key) return
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

export async function getDownloadUrl(key: string) {
  await assertKeyVisibleToUser(key)
  return generatePresignedDownloadUrl(key)
}

export async function deleteFile(key: string) {
  await assertKeyVisibleToUser(key)
  await deleteObject(key)
}
