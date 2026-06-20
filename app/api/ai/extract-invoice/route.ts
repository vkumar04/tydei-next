/**
 * AI invoice extraction (OCR path of the invoice import dialog).
 *
 * 2026-06-10 invoices batch: replaces the dialog's "OCR Scan — coming
 * soon" stub. Upload a PDF invoice → Claude vision extracts header +
 * line items via the established `generateStructured` pattern → the
 * dialog prefills the manual-entry form for user review before import.
 *
 * Conventions mirror `app/api/ai/extract-contract/route.ts`:
 * auth → rate limit → 25MB cap → PDF-only → CLAUDE.md AI-action error
 * path (console.error with context server-side; named, sanitized error
 * client-side). Multi-page PDFs over MAX_PAGES_PER_CHUNK are split via
 * the same pdf-chunker and merged (header from first chunk that has it,
 * line items concatenated).
 */
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import {
  generateStructured,
  withCacheControl,
} from "@/lib/ai/generate-structured"
import { claudeSonnet, claudeHaiku } from "@/lib/ai/config"
import {
  extractedInvoiceSchema,
  mergeExtractedInvoiceChunks,
  type ExtractedInvoiceData,
} from "@/lib/ai/invoice-extract-schema"
import { extractPdfText } from "@/lib/ai/pdf-text-helper"
import { splitPdfByPages } from "@/lib/ai/pdf-chunker"
import { MAX_PAGES_PER_CHUNK } from "@/lib/ai/contract-extract-chunked"
import { recordClaudeUsage } from "@/lib/ai/record-usage"
import { prisma } from "@/lib/db"

export const maxDuration = 300

// Same cap as extract-contract — comfortably under Anthropic's 32MB
// PDF limit while rejecting truly oversize uploads.
const MAX_BYTES = 25 * 1024 * 1024

const EXTRACT_PROMPT = `Extract structured data from this vendor invoice (medical/surgical supply invoice).

Return:
- invoiceNumber: the invoice number as printed (e.g. "INV-12345").
- vendorName: the SELLER/vendor company name (not the bill-to facility).
- invoiceDate: the invoice date in ISO format (yyyy-mm-dd).
- poNumber: the purchase order number referenced on the invoice, if any.
- lineItems: one entry per billed line:
  - vendorItemNo: the vendor's catalog/item/SKU number.
  - description: the item description.
  - quantity: billed quantity (number).
  - unitPrice: per-unit price in dollars (number). If only an extended
    line total is shown, divide by quantity.
- tax: total tax amount in DOLLARS (not a percentage), if shown.
- shipping: shipping/freight/handling amount in dollars, if shown.
- discount: total discount amount in dollars as a POSITIVE number, if shown.

Use null for anything not present. Do not invent line items. Be precise
with numbers — never round prices.`

async function extractChunk(
  fileData: Uint8Array,
  fileName: string,
  abortSignal: AbortSignal,
  hint?: string
): Promise<ExtractedInvoiceData> {
  const { output } = await generateStructured({
    schema: extractedInvoiceSchema,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: EXTRACT_PROMPT + (hint ? `\n\n${hint}` : "") },
          {
            type: "file",
            data: fileData,
            mediaType: "application/pdf",
            filename: fileName,
            ...withCacheControl(),
          },
        ],
      },
    ],
    actionName: "extract-invoice",
    // Invoices are mechanical extraction — start at Sonnet, fall back
    // to Haiku (cheaper than the contract route's Opus default).
    primary: claudeSonnet,
    fallback: claudeHaiku,
    abortSignal,
  })
  return output
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success, retryAfterMs } = rateLimit(
      `ai-extract-invoice:${session.user.id}`,
      10,
      60_000
    )
    if (!success) {
      return Response.json(
        { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
        { status: 429 }
      )
    }

    const contentLength = request.headers.get("content-length")
    if (contentLength && parseInt(contentLength) > MAX_BYTES) {
      return Response.json(
        { error: "File too large. Maximum size is 25MB." },
        { status: 413 }
      )
    }

    let formData: FormData
    try {
      formData = await request.formData()
    } catch (err) {
      console.error("[extract-invoice] FormData parsing error:", err)
      return Response.json(
        { error: "Failed to read uploaded file" },
        { status: 400 }
      )
    }

    const file = formData.get("file") as File | null
    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return Response.json(
        {
          error: "File too large",
          details: `File is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Maximum size is 25MB.`,
        },
        { status: 413 }
      )
    }

    const lowerName = file.name.toLowerCase()
    const isPdf = lowerName.endsWith(".pdf") || file.type === "application/pdf"
    if (!isPdf) {
      return Response.json(
        {
          error: "Invoice uploads must be PDF",
          details:
            "Only PDF files are supported for OCR invoice extraction. EDI 810 files go through the EDI Import tile.",
        },
        { status: 415 }
      )
    }

    const fileData = new Uint8Array(await file.arrayBuffer())

    // Page count (best-effort) decides single-call vs chunked.
    let pageCount = 0
    try {
      const pdfRes = await extractPdfText(fileData)
      pageCount = pdfRes.pageCount
    } catch (pdfErr) {
      console.warn("[extract-invoice] pdf page-count probe failed:", pdfErr)
    }

    let extracted: ExtractedInvoiceData
    try {
      if (pageCount > MAX_PAGES_PER_CHUNK) {
        const chunks = await splitPdfByPages(fileData, {
          maxPagesPerChunk: MAX_PAGES_PER_CHUNK,
        })
        console.info(
          `[extract-invoice] chunking ${file.name} (${pageCount} pages) into ${chunks.length} sub-PDFs`
        )
        const results: ExtractedInvoiceData[] = []
        // Sequential — multi-chunk invoices are rare; avoids burst 429s.
        for (let i = 0; i < chunks.length; i++) {
          results.push(
            await extractChunk(
              chunks[i].pdf,
              `${file.name} (part ${i + 1}/${chunks.length})`,
              request.signal,
              i > 0
                ? "This is a continuation chunk of a longer invoice — header fields may be absent; extract the line items."
                : undefined
            )
          )
        }
        extracted = mergeExtractedInvoiceChunks(results)
      } else {
        extracted = await extractChunk(fileData, file.name, request.signal)
      }
    } catch (aiError: unknown) {
      if (aiError instanceof Error && aiError.name === "AbortError") {
        return new Response(null, { status: 499 })
      }
      // CLAUDE.md AI-action error path: full context server-side,
      // named + sanitized message client-side.
      console.error("[extract-invoice] AI extraction failed:", aiError, {
        userId: session.user.id,
        file: file.name,
        fileSize: file.size,
        pageCount,
      })
      const message =
        aiError instanceof Error ? aiError.message : "Unknown error"
      return Response.json(
        {
          error: "AI invoice extraction failed",
          details: message.substring(0, 400),
        },
        { status: 502 }
      )
    }

    await recordExtractUsage(
      session.user.id,
      session.user.name ?? session.user.email ?? "Unknown",
      `Extracted invoice from ${file.name.slice(0, 40)}`,
      Math.max(pageCount, 1)
    )

    return Response.json({ success: true, extracted })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return new Response(null, { status: 499 })
    }
    console.error("[extract-invoice] route error:", error)
    return Response.json(
      { error: "Invoice extraction failed" },
      { status: 500 }
    )
  }
}

async function recordExtractUsage(
  userId: string,
  userName: string,
  description: string,
  pages: number
): Promise<void> {
  try {
    const member = await prisma.member.findFirst({
      where: { userId },
      include: {
        organization: { include: { facility: true, vendor: true } },
      },
    })
    await recordClaudeUsage({
      facilityId: member?.organization?.facility?.id ?? null,
      vendorId: member?.organization?.vendor?.id ?? null,
      userId,
      userName,
      action: "document_extraction_per_page",
      description,
      quantity: pages,
    })
  } catch (err) {
    console.error("[extract-invoice] usage-record failed", err, { userId })
  }
}
