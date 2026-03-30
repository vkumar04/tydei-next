import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { getUploadPresignedUrl } from "@/lib/storage"

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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

    const userId = session.user.id
    const timestamp = Date.now()
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
    const key = `${folder}/${userId}/${timestamp}-${safeName}`

    const { uploadUrl } = await getUploadPresignedUrl(key, contentType)

    return NextResponse.json({ uploadUrl, key })
  } catch (error) {
    console.error("Presign error:", error)
    const message = error instanceof Error ? error.message : "Presign failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
