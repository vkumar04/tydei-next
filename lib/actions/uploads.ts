"use server"

import { requireAuth } from "@/lib/actions/auth"
import { uploadRequestSchema, type UploadRequest } from "@/lib/validators/uploads"
import { generatePresignedUploadUrl, generatePresignedDownloadUrl, deleteObject } from "@/lib/s3"

export async function getUploadUrl(input: UploadRequest) {
  await requireAuth()
  const data = uploadRequestSchema.parse(input)

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
