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

import { streamObject, NoObjectGeneratedError } from "ai"
import { headers } from "next/headers"
import { createHash } from "node:crypto"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/db"
import { uploadFile } from "@/lib/storage"
import { claudeModel } from "@/lib/ai/config"
import { extractedContractSchema } from "@/lib/ai/schemas"
import { extractPdfText } from "@/lib/ai/pdf-text-helper"
import {
  runChunkedExtraction,
  MAX_PAGES_PER_CHUNK,
  FALLBACK_PAGES_PER_CHUNK,
} from "@/lib/ai/contract-extract-chunked"
import { getActiveContractExtractPrompt } from "@/lib/ai/prompts/contract-extract"

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
  const candidateKey = `contracts/${userId}/${Date.now()}-${safeName}`
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
  if (pdfText.pageCount > MAX_PAGES_PER_CHUNK) {
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

      await cacheExtraction({
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
        { userId, file: file.name, pageCount: pdfText.pageCount },
      )
      return Response.json(
        { error: "Chunked extraction failed" },
        { status: 500 },
      )
    }
  }

  try {
    let capturedStreamError: string | null = null
    const result = streamObject({
      model: claudeModel,
      schema: extractedContractSchema,
      abortSignal: req.signal,
      providerOptions: {
        anthropic: { structuredOutputMode: "jsonTool" as const },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                getActiveContractExtractPrompt().prompt +
                textHint +
                userInstructionsHint,
            },
            {
              type: "file",
              data: fileData,
              mediaType: "application/pdf",
              filename: file.name,
              providerOptions: {
                anthropic: { cacheControl: { type: "ephemeral" as const } },
              },
            },
          ],
        },
      ],
      onError: ({ error }) => {
        // CLAUDE.md AI-action error path: log full context server-side
        // before the SDK surfaces the failure to the client.
        console.error("[extract-contract/stream]", error, {
          userId,
          file: file.name,
          size: file.size,
        })
        // Capture for the client envelope (see custom ReadableStream
        // below). Without this the AI SDK swallows streaming errors and
        // the client falls through to a generic "Empty response from
        // extractor" message that hides the real cause (missing
        // ANTHROPIC_API_KEY, schema mismatch, 429, etc.).
        capturedStreamError =
          error instanceof Error ? error.message : String(error)
      },
      onFinish: async ({ object }) => {
        if (!object) return
        await cacheExtraction({
          userId,
          fileHash,
          filename: file.name,
          extracted: object as object,
          s3Key,
        })
      },
    })

    // Charles 2026-04-30 bug doc — "No documents here for a faculty
    // to review". Root cause: this stream route uploaded the PDF to
    // S3 (above) AND wrote the s3Key into the cache row, but the
    // response stream itself never told the client what the key was.
    // The client (ai-extract-dialog.tsx:205) expected `lastValid.s3Key`
    // from the streamed JSON and got undefined every time, so vendor
    // submissions landed with documents:[] on the PendingContract
    // row — the facility-side review then correctly showed the "No
    // documents…" empty state.
    //
    // Fix: use the `X-S3-Key` response header to surface the archived
    // PDF location alongside the streaming JSON body. Header-based
    // metadata avoids changing the existing JSON-parse loop on the
    // client (which assembles a single progressive JSON object across
    // chunks); the client reads the header before consuming the body.
    // Wrap the AI SDK text stream so onError surfaces to the client.
    // Default toTextStreamResponse() closes silently on error → client
    // shows useless "Empty response from extractor". Here we forward
    // every chunk untouched and, if the stream closed with an error
    // and produced no extractable JSON, append a sentinel JSON envelope
    // {"streamError": "..."} the client recognizes.
    const encoder = new TextEncoder()
    const wrapped = new ReadableStream({
      async start(controller) {
        let emittedAnyChunk = false
        let noObjectGenerated = false
        try {
          for await (const chunk of result.textStream) {
            emittedAnyChunk = true
            controller.enqueue(encoder.encode(chunk))
          }
        } catch (err) {
          if (NoObjectGeneratedError.isInstance(err)) noObjectGenerated = true
          if (!capturedStreamError) {
            capturedStreamError =
              err instanceof Error ? err.message : String(err)
          }
        }
        // AI SDK 6 + Anthropic tool-mode (structuredOutputMode: "jsonTool"):
        // the structured object resolves via a tool call, so `textStream`
        // can emit nothing even though onFinish receives a complete object.
        // Forwarding only textStream then closes the body empty and the
        // client shows "Empty response from extractor" (while onFinish has
        // already cached the object — hence re-uploading the same file
        // "works" via the cache-hit path). Fall back to the resolved object
        // as a single JSON document so the client always gets the extraction.
        if (!emittedAnyChunk && !capturedStreamError) {
          try {
            const finalObject = await result.object
            if (finalObject) {
              controller.enqueue(encoder.encode(JSON.stringify(finalObject)))
              emittedAnyChunk = true
            }
          } catch (err) {
            if (NoObjectGeneratedError.isInstance(err)) noObjectGenerated = true
            if (!capturedStreamError) {
              capturedStreamError =
                err instanceof Error ? err.message : String(err)
            }
          }
        }

        // ─── Chunked fallback on NoObjectGeneratedError ──────────────
        //
        // Root cause (Vick prod report, "could not parse the response",
        // 2026-06-07): on a SCANNED small PDF (no text layer → vision-
        // only), the single Opus `jsonTool` pass is flaky — Anthropic
        // returns an empty `{}` tool input ~75% of the time, failing
        // Zod's required contractName/vendorName. Repro: the 8-page
        // Arthrex "CogsART01012024" contract failed 3/4 one-shot runs
        // but the chunked Haiku path (relaxed per-chunk identity +
        // forced vision on chunk 1) succeeded 3/3.
        //
        // So when the single call produced no object, re-slice into
        // SMALL chunks and run the chunked extractor before giving up.
        // This is the same fallback the chunked path already retries
        // internally; here we promote the WHOLE small-PDF path to it.
        if (!emittedAnyChunk && noObjectGenerated) {
          try {
            console.info(
              `[extract-contract/stream] single-call returned no object for ${file.name} — falling back to chunked extraction`,
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
            await cacheExtraction({
              userId,
              fileHash,
              filename: file.name,
              extracted: merged as object,
              s3Key,
            })
            controller.enqueue(encoder.encode(JSON.stringify(merged)))
            emittedAnyChunk = true
            capturedStreamError = null
          } catch (fallbackErr) {
            console.error(
              "[extract-contract/stream] chunked fallback also failed:",
              fallbackErr,
              { userId, file: file.name, pageCount: pdfText.pageCount },
            )
            // Keep the original single-call error as the surfaced cause,
            // but make it specific so the user knows WHY (the model
            // returned a payload that didn't match the contract schema,
            // and the per-page retry couldn't recover it either).
            capturedStreamError =
              "the AI returned a response that did not match the contract schema, and the per-page retry could not recover it. Try re-uploading, or use Manual Entry."
          }
        }

        if (capturedStreamError && !emittedAnyChunk) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ streamError: capturedStreamError }),
            ),
          )
        }
        controller.close()
      },
    })
    const response = new Response(wrapped, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
    if (s3Key) response.headers.set("X-S3-Key", s3Key)
    return response
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return new Response(null, { status: 499 })
    }
    console.error("[extract-contract/stream] streamObject error:", error, {
      userId,
      file: file.name,
    })
    return Response.json({ error: "Extraction failed" }, { status: 500 })
  }
}
