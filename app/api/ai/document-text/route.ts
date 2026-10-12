import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { denyUnlessPortalWriter } from "@/lib/api/import-route-auth"
import { extractPdfText } from "@/lib/ai/pdf-text-helper"
import { ocrPdfBuffer } from "@/lib/ai/ocr-pdf"

const MAX_BYTES = 25 * 1024 * 1024
const PDF_PARSE_PAGE_SEPARATOR = /--\s*\d+\s+of\s+\d+\s*--/
const OCR_PAGE_HEADER = /^--- page \d+ ---$/m

function toFormFeedPages(parts: string[]): string {
  return parts.map((p) => p.trim()).filter((p) => p.length > 0).join("\f")
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const denied = await denyUnlessPortalWriter(session.user.id, "facility")
  if (denied) return denied

  const { success, retryAfterMs } = rateLimit(`ai-document-text:${session.user.id}`, 10, 60_000)
  if (!success) {
    return Response.json(
      { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
      { status: 429 },
    )
  }

  const contentLength = request.headers.get("content-length")
  if (contentLength && parseInt(contentLength) > MAX_BYTES) {
    return Response.json({ error: "File too large. Maximum size is 25MB." }, { status: 413 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: "File too large. Maximum size is 25MB." }, { status: 413 })
    }
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
    if (!isPdf) {
      return Response.json({ error: "Only PDF files can be read here" }, { status: 415 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const layer = await extractPdfText(bytes)
    if (layer.hasTextLayer) {
      return Response.json({
        text: toFormFeedPages(layer.text.split(PDF_PARSE_PAGE_SEPARATOR)),
        pageCount: layer.pageCount,
        ocr: false,
      })
    }

    const ocrText = await ocrPdfBuffer(bytes, {
      maxPages: Math.max(1, layer.pageCount || 10),
      signal: request.signal,
      logPrefix: "[document-text]",
    })
    if (!ocrText) {
      return Response.json(
        { error: "Document text extraction failed: no readable text was found in this PDF." },
        { status: 422 },
      )
    }
    return Response.json({
      text: toFormFeedPages(ocrText.split(OCR_PAGE_HEADER)),
      pageCount: layer.pageCount,
      ocr: true,
    })
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return new Response(null, { status: 499 })
    }
    console.error("[document-text]", err, { userId: session.user.id })
    return Response.json(
      { error: "Document text extraction failed. Try again, or paste the text manually." },
      { status: 500 },
    )
  }
}
