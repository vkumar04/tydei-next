import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { getUploadPresignedUrl } from "@/lib/storage"
import { rateLimit } from "@/lib/rate-limit"

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success, retryAfterMs } = rateLimit(`upload-presign:${session.user.id}`, 30, 60_000)
    if (!success) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
        { status: 429 }
      )
    }

    const body = await request.json()
    const { filename, contentType, folder = "uploads" } = body as {
      filename: string
      contentType: string
      folder?: string
    }

    if (!filename || !contentType) {
      return NextResponse.json(
        { error: "filename and contentType are required" },
        { status: 400 }
      )
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

    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: "File type not allowed" },
        { status: 400 }
      )
    }

    const userId = session.user.id
    const timestamp = Date.now()
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
    const key = `${folder}/${userId}/${timestamp}-${safeName}`

    const { uploadUrl } = await getUploadPresignedUrl(key, contentType)

    return NextResponse.json({ uploadUrl, key })
  } catch (error) {
    console.error("Presign error:", error)
    return NextResponse.json({ error: "Presign failed" }, { status: 500 })
  }
}
