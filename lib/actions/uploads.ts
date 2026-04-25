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

  // Pending-contract documents JSON blob — best-effort string contains.
  // Restricted to the requester's vendor scope on submit, or facility
  // scope when reviewing.
  const pending = await prisma.pendingContract.findFirst({
    where: {
      AND: [
        { documents: { string_contains: key } as never },
        facilityId
          ? { facilityId }
          : vendorId
            ? { vendorId }
            : { id: "__none__" },
      ],
    },
    select: { id: true },
  })
  if (pending) return

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
