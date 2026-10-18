/**
 * Streaming variant of /api/ai/extract-contract.
 *
 * Implementation per AI SDK 6 docs (context7 /vercel/ai 6.0.0-beta.128):
 *   const result = streamObject({ schema, ... })
 *   return result.toTextStreamResponse()
 *
 * Why streamObject (not streamText + Output.object): with Anthropic's
 * structuredOutputMode='jsonTool' the structured payload comes back via
 * a tool call, so streamText's `textStream` is empty and
 * toTextStreamResponse() produces an empty body — that's the silent
 * failure that bit the previous incarnation of this route. streamObject
 * is the purpose-built API; its textStream emits incrementally-valid
 * JSON chunks the client can JSON.parse() as they arrive.
 *
 * Cache hits return the full extract immediately as a single chunk and
 * close — same envelope shape as the non-stream route's JSON body so
 * the client dialog reads either response identically.
 */

import { recordContractExtractionUsage } from "@/lib/ai/record-extract-usage"
import { NoObjectGeneratedError } from "ai"
import { headers } from "next/headers"
import { createHash } from "node:crypto"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/db"
import { uploadFile } from "@/lib/storage"
import type { ExtractedContractData } from "@/lib/ai/schemas"
import { extractContractSingle } from "@/lib/ai/contract-extract-single"
import { checkContractExtractWithJev } from "@/lib/ai/jev-contract-check"
import { extractPdfText } from "@/lib/ai/pdf-text-helper"
import {
  runChunkedExtraction,
  MAX_PAGES_PER_CHUNK,
  FALLBACK_PAGES_PER_CHUNK,
} from "@/lib/ai/contract-extract-chunked"
import { denyUnlessWriter } from "@/lib/api/import-route-auth"

// 261-page Mako PDF chunks into ~33 parallel Anthropic calls; even
// rate-limit-safe with parallel queuing, the whole pipeline can
// take 60-180s depending on Anthropic queue depth. Bump to 5 min.
export const maxDuration = 300

// Bug A 2026-05-25: bumped from 10MB → 25MB to match the non-streaming
// /api/ai/extract-contract route. See that file for the rationale.
const MAX_BYTES = 25 * 1024 * 1024

// Chunking machinery (runChunkedExtraction, MAX_PAGES_PER_CHUNK,
// FALLBACK_PAGES_PER_CHUNK) lives in lib/ai/contract-extract-chunked.ts
// — shared with the non-stream route since 2026-06-09 ("Analysis is
// still broken": the Analysis upload tab posts to the NON-stream route,
// which lacked the chunked path + scanned-small-PDF fallback).

/** Persist a finished extraction to the 30-day cache. Best-effort. */
async function cacheExtraction(opts: {
  userId: string
  fileHash: string
  filename: string
  extracted: object
  s3Key: string | undefined
}): Promise<void> {
  try {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)
    await prisma.contractExtractionCache.upsert({
      where: { userId_fileHash: { userId: opts.userId, fileHash: opts.fileHash } },
      create: {
        userId: opts.userId,
        fileHash: opts.fileHash,
        filename: opts.filename,
        extracted: opts.extracted,
        confidence: 0.9,
        s3Key: opts.s3Key,
        expiresAt,
      },
      update: {
        extracted: opts.extracted,
        confidence: 0.9,
        s3Key: opts.s3Key,
        expiresAt,
      },
    })
  } catch (err) {
    console.warn("[extract-contract/stream] cache write skipped:", err)
  }
}

/** Build the single-chunk JSON response used by the cache-hit and
 * chunked paths (the client dialog reads this envelope identically). */
function buildExtractedResponse(payload: object, s3Key: string | undefined): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify(payload)))
      controller.close()
    },
  })
  const response = new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
  if (s3Key) response.headers.set("X-S3-Key", s3Key)
  return response
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessWriter(session.user.id)
  if (denied) return denied

  const { success } = rateLimit(`ai-extract-stream:${session.user.id}`, 10, 60_000)
  if (!success) {
    return Response.json({ error: "Too many requests" }, { status: 429 })
  }

  const contentLength = req.headers.get("content-length")
  if (contentLength && parseInt(contentLength) > MAX_BYTES) {
    return Response.json(
      { error: "File too large", details: "Maximum size is 25MB." },
      { status: 413 },
    )
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  const userInstructions =
    (formData.get("userInstructions") as string | null)?.trim() || ""
  if (!file) return Response.json({ error: "No file provided" }, { status: 400 })
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json(
      { error: "Contract uploads must be PDF" },
      { status: 415 },
    )
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      {
        error: "File too large",
        details: `${(file.size / (1024 * 1024)).toFixed(1)}MB; max 25MB.`,
      },
      { status: 413 },
    )
  }

  const fileData = new Uint8Array(await file.arrayBuffer())
  const userId = session.user.id
  const userName = session.user.name ?? session.user.email ?? "Unknown"
  const persistExtraction = async (opts: Parameters<typeof cacheExtraction>[0]) => {
    await cacheExtraction(opts)
    await recordContractExtractionUsage(
      userId,
      userName,
      `Extracted contract from ${file.name.slice(0, 40)}`,
      "[extract-contract/stream]",
    )
  }
  // Bumped 2026-05-27: forces all cached extracts to re-run after
  // the chunked-path text-first regression that left
  // contractName/vendorName empty on every cover page. Without this,
  // users who tried the broken version keep getting the broken
  // result back from cache instead of the fixed Opus+vision retry.
  const EXTRACT_SCHEMA_VERSION = "v3"
  const fileHash = createHash("sha256")
    .update(fileData)
    .update(EXTRACT_SCHEMA_VERSION)
    .digest("hex")

  const cached = await prisma.contractExtractionCache.findUnique({
    where: { userId_fileHash: { userId, fileHash } },
  })
  if (cached && cached.expiresAt > new Date()) {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        const payload = {
          extracted: cached.extracted,
          confidence: cached.confidence ?? 0.9,
          s3Key: cached.s3Key,
          cached: true,
          done: true,
        }
        controller.enqueue(encoder.encode(JSON.stringify(payload)))
        controller.close()
      },
    })
    return new Response(body, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }

  let s3Key: string | undefined
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  const candidateKey = `contracts/${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`
  try {
    await uploadFile(candidateKey, fileData, file.type || "application/pdf")
    s3Key = candidateKey
  } catch (err) {
    console.warn("[extract-contract/stream] S3 archival skipped:", err)
  }

  const pdfText = await extractPdfText(fileData)
  const textHint = pdfText.hasTextLayer
    ? `\n\nFor reference, here is the extracted text layer of the PDF (may help with tabular data):\n\n${pdfText.text}`
    : ""
  if (!pdfText.hasTextLayer) {
    console.warn(
      `[extract-contract/stream] no text layer in ${file.name} (likely scanned, ${pdfText.pageCount} pages) — vision-only`,
    )
  }
  const userInstructionsHint = userInstructions
    ? `\n\nAdditional user instructions:\n${userInstructions}`
    : ""

  // ─── Chunked path: large PDFs ──────────────────────────────────
  //
  // Splits into N-page sub-PDFs, extracts each via generateObject in
  // parallel, merges into one final ExtractedContractData, and emits
  // it as a single-chunk response (same envelope as the cache-hit
  // path so the client dialog doesn't need a separate code path).
  // 2026-06-15 (Vick "still can't get the AI to see the capital"): route
  // SCANNED PDFs (no text layer) through the chunked path even when small,
  // because that's the ONLY path that runs the Tesseract OCR pass. The
  // single-call path below is vision-only — fine for prose, but it drops
  // the numbers in scanned financing/Truth-in-Lending tables (tie-in
  // capital), and since the single call usually "succeeds" it never falls
  // back to OCR. A scanned ≤10-page tie-in then imports with empty capital.
  if (pdfText.pageCount > MAX_PAGES_PER_CHUNK || !pdfText.hasTextLayer) {
    try {
      const { merged, chunkCount } = await runChunkedExtraction({
        fileData,
        fileName: file.name,
        pageCount: pdfText.pageCount,
        maxPagesPerChunk: MAX_PAGES_PER_CHUNK,
        userInstructionsHint,
        abortSignal: req.signal,
        logPrefix: "[extract-contract/stream]",
      })
      const reviewWarnings = await checkContractExtractWithJev({
        extracted: merged,
        text: pdfText.hasTextLayer ? pdfText.text : null,
        fileData,
        pageCount: pdfText.pageCount,
        signal: req.signal,
        logPrefix: "[extract-contract/stream]",
      })

      await persistExtraction({
        userId,
        fileHash,
        filename: file.name,
        extracted: merged as object,
        s3Key,
      })

      return buildExtractedResponse(
        {
          extracted: merged,
          confidence: 0.9,
          s3Key,
          reviewWarnings,
          chunked: { chunks: chunkCount, pages: pdfText.pageCount },
          done: true,
        },
        s3Key,
      )
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return new Response(null, { status: 499 })
      }
      console.error(
        "[extract-contract/stream] chunked extract error:",
        error,
        {
          userId,
          file: file.name,
          pageCount: pdfText.pageCount,
          hasTextLayer: pdfText.hasTextLayer,
          meaningfulChars: pdfText.meaningfulChars,
        },
      )
      // Name the action AND the failure kind (AGENTS.md "AI actions"). A
      // scanned PDF is by far the most common cause here and the user can act
      // on it, so say so rather than emitting a bare "extraction failed".
      return Response.json(
        {
          error: pdfText.hasTextLayer
            ? "Contract extraction failed while reading this PDF in sections. Try again, or use Manual Entry."
            : `Contract extraction failed. "${file.name}" looks like a scan with no selectable text (${pdfText.pageCount} page${pdfText.pageCount === 1 ? "" : "s"}), so it was read by OCR. Try a text-based PDF export if you have one, or use Manual Entry.`,
        },
        { status: 500 },
      )
    }
  }

  try {
    let extracted: ExtractedContractData
    try {
      extracted = (
        await extractContractSingle({
          fileData,
          fileName: file.name,
          textHint,
          userInstructionsHint,
          abortSignal: req.signal,
          actionName: "extract-contract/stream",
        })
      ).extracted
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return new Response(null, { status: 499 })
      }
      console.error("[extract-contract/stream]", err, {
        userId,
        file: file.name,
        size: file.size,
      })
      if (!NoObjectGeneratedError.isInstance(err)) {
        return buildExtractedResponse(
          { streamError: err instanceof Error ? err.message : String(err) },
          s3Key,
        )
      }
      try {
        console.info(
          `[extract-contract/stream] single call returned no object for ${file.name} — falling back to chunked extraction`,
        )
        const { merged } = await runChunkedExtraction({
          fileData,
          fileName: file.name,
          pageCount: pdfText.pageCount,
          maxPagesPerChunk: FALLBACK_PAGES_PER_CHUNK,
          userInstructionsHint,
          abortSignal: req.signal,
          logPrefix: "[extract-contract/stream]",
        })
        extracted = merged
      } catch (fallbackErr) {
        console.error(
          "[extract-contract/stream] chunked fallback also failed:",
          fallbackErr,
          { userId, file: file.name, pageCount: pdfText.pageCount },
        )
        return buildExtractedResponse(
          {
            streamError:
              "the AI returned a response that did not match the contract schema, and the per-page retry could not recover it. Try re-uploading, or use Manual Entry.",
          },
          s3Key,
        )
      }
    }

    const reviewWarnings = await checkContractExtractWithJev({
      extracted,
      text: pdfText.text,
      fileData,
      pageCount: pdfText.pageCount,
      signal: req.signal,
      logPrefix: "[extract-contract/stream]",
    })
    await persistExtraction({
      userId,
      fileHash,
      filename: file.name,
      extracted: extracted as object,
      s3Key,
    })
    return buildExtractedResponse({ extracted, s3Key, reviewWarnings, done: true }, s3Key)
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return new Response(null, { status: 499 })
    }
    console.error("[extract-contract/stream] extraction error:", error, {
      userId,
      file: file.name,
    })
    return Response.json({ error: "Extraction failed" }, { status: 500 })
  }
}
