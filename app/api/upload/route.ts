import { NextResponse } from "next/server"
import { getUploadUrl } from "@/lib/actions/uploads"
import { uploadRequestSchema } from "@/lib/validators/uploads"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const data = uploadRequestSchema.parse(body)
    const result = await getUploadUrl(data)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
