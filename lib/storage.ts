import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner"

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
})

const BUCKET = process.env.S3_BUCKET ?? "embedded-envelope-qi3ly1z"

/**
 * Upload a file directly to S3.
 */
export async function uploadFile(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  })
  await s3.send(command)
  return { key }
}

/**
 * Generate a pre-signed download URL.
 *
 * With `downloadName`, the URL signs a `Content-Disposition: attachment`
 * response header, so navigating to it saves the file under that name
 * instead of rendering inline — and the browser stays on the current page,
 * which sidesteps popup blockers entirely (no `window.open` needed).
 * Without it, the object renders inline (the "View" behavior).
 */
export async function getSignedUrl(
  key: string,
  expiresIn = 900,
  downloadName?: string,
) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(downloadName
      ? {
          ResponseContentDisposition: `attachment; filename="${downloadName
            .replace(/[^\x20-\x7e]/g, "_")
            .replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        }
      : {}),
  })
  return awsGetSignedUrl(s3, command, { expiresIn })
}

/**
 * Delete a file from S3.
 */
export async function deleteFile(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

/**
 * Generate a pre-signed upload URL for client-side direct uploads.
 */
export async function getUploadPresignedUrl(
  key: string,
  contentType: string,
  expiresIn = 300,
  contentLength?: number
) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
    // When provided, ContentLength is a SIGNED header — the client must PUT
    // exactly this many bytes, so a presigned URL can't be reused to upload an
    // oversized object (storage-abuse guard; security audit 2026-06-21).
    ...(contentLength != null ? { ContentLength: contentLength } : {}),
  })
  const uploadUrl = await awsGetSignedUrl(s3, command, { expiresIn })
  return { uploadUrl, key }
}
