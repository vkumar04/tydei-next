"use server"

import { requireAuth } from "@/lib/actions/auth"
import { uploadRequestSchema, type UploadRequest } from "@/lib/validators/uploads"
import { generatePresignedUploadUrl, generatePresignedDownloadUrl, deleteObject } from "@/lib/s3"

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
  await requireAuth()
  return generatePresignedDownloadUrl(key)
}

export async function deleteFile(key: string) {
  await requireAuth()
  await deleteObject(key)
}
