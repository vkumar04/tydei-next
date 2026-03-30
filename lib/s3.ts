/**
 * Re-exports storage helpers under the legacy names used by lib/actions/uploads.ts.
 * New code should import from "@/lib/storage" directly.
 */
import {
  getUploadPresignedUrl,
  getSignedUrl,
  deleteFile,
} from "@/lib/storage"

/** Returns just the URL string (legacy interface). */
export async function generatePresignedUploadUrl(key: string, contentType: string) {
  const { uploadUrl } = await getUploadPresignedUrl(key, contentType)
  return uploadUrl
}

/** Returns just the URL string (legacy interface). */
export async function generatePresignedDownloadUrl(key: string) {
  return getSignedUrl(key)
}

export { deleteFile as deleteObject }
