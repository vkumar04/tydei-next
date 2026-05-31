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

import { generateObject, streamObject, NoObjectGeneratedError } from "ai"
import { headers } from "next/headers"
import { createHash } from "node:crypto"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/db"
import { uploadFile } from "@/lib/storage"
import { claudeModel, claudeHaiku } from "@/lib/ai/config"
import { extractedContractSchema, type ExtractedContractData } from "@/lib/ai/schemas"
import { extractPdfText } from "@/lib/ai/pdf-text-helper"
import { splitPdfByPages } from "@/lib/ai/pdf-chunker"
import {
  chunkExtractSchema,
  mergeExtractedContracts,
  type ChunkExtractData,
} from "@/lib/ai/contract-extract-merger"
import { getActiveContractExtractPrompt } from "@/lib/ai/prompts/contract-extract"

// 261-page Mako PDF chunks into ~33 parallel Anthropic calls; even
// rate-limit-safe with parallel queuing, the whole pipeline can
// take 60-180s depending on Anthropic queue depth. Bump to 5 min.
export const maxDuration = 300

// Anthropic rate-limit at our current tier accepts a small burst
// but rejects the rest with 429s. The first all-parallel run on a
// 33-chunk PDF saw 26/33 chunks fail to that burst. 5 concurrent
// keeps Anthropic's queue happy while only adding ~5s per batch
// vs full parallel — net latency on the 261-page Mako file stays
// ~30-90s with success rate close to 100%.
const CHUNK_CONCURRENCY = 5

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      try {
        const value = await fn(items[i]!, i)
        results[i] = { status: "fulfilled", value }
      } catch (reason) {
        results[i] = { status: "rejected", reason }
      }
    }
  }
  const workerCount = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}

// Bug A 2026-05-25: bumped from 10MB → 25MB to match the non-streaming
// /api/ai/extract-contract route. See that file for the rationale.
const MAX_BYTES = 25 * 1024 * 1024

// Bug 2026-05-25 (Vick): vision-only on a 30-page scanned Mako PDF
// produced a 1.1M-token prompt and Anthropic 400'd with "prompt is too
// long". Anything longer than this gets split into N-page sub-PDFs,
// extracted per-chunk via generateObject, then merged via
// mergeExtractedContracts. 10 pages × ~80K vision tokens ≈ 800K — under
// the 1M cap with ~200K headroom for the system prompt + text hint.
// Bumped from 8 → 10 after the Haiku switch made cost-per-call cheap
// enough that fewer/bigger chunks beats more/smaller ones for wall
// time without breaking the budget.
const MAX_PAGES_PER_CHUNK = 10

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
      const chunks = await splitPdfByPages(fileData, {
        maxPagesPerChunk: MAX_PAGES_PER_CHUNK,
      })
      console.info(
        `[extract-contract/stream] chunking ${file.name} (${pdfText.pageCount} pages) into ${chunks.length} sub-PDFs of ≤${MAX_PAGES_PER_CHUNK} pages`,
      )

      // Chunked-path prompt deliberately OMITS the whole-PDF text
      // hint that the single-call path includes — chunks send their
      // own per-chunk text (cheaper, more focused) so duplicating
      // the entire PDF text into every chunk's prompt just burned
      // cache-write tokens without helping accuracy.
      const chunkPromptText =
        getActiveContractExtractPrompt().prompt + userInstructionsHint

      // Bounded concurrency keeps Anthropic from 429'ing on the
      // burst. One-shot retry on AI_NoObjectGeneratedError handles
      // transient schema-parse hiccups. Text-first per chunk: if
      // the chunk has an extractable text layer we send the text
      // and skip the vision-heavy `file` block (~70-90% cheaper
      // on born-digital contracts). Vision-only fallback when the
      // chunk is scanned. maxOutputTokens caps the response.
      const callChunk = async (
        chunk: (typeof chunks)[number],
        chunkIndex: number,
      ): Promise<ChunkExtractData> => {
        const chunkText = await extractPdfText(chunk.pdf)
        // Vick 2026-05-27 bug-doc: every PDF was coming back with
        // contractName / vendorName / effectiveDate / totalValue
        // empty ("Not detected") even though contractType + terms
        // extracted fine. Root cause: the text-first optimization
        // (commit 24d24ca) sent ONLY the chunk's extracted text
        // layer to Haiku and skipped the vision file. Cover pages
        // typically render the contract title + vendor as styled
        // text inside a layout that the text-layer extractor
        // garbles (or alongside logos that aren't text at all), so
        // the model literally couldn't see those fields and
        // returned null — which the merger then propagated as "".
        //
        // Fix: force vision on the FIRST chunk (page 1 always has
        // the cover page). The cost delta on a single chunk is
        // small (~1 extra image), and identity recovery is what
        // makes the whole extract usable downstream. Body chunks
        // stay text-first — the savings on long PDFs (Mako 261p)
        // come from those, not from chunk 1.
        const isFirstChunk = chunkIndex === 0
        const useVision = !chunkText.hasTextLayer || isFirstChunk

        const sourceBlock = useVision
          ? ({
              type: "file" as const,
              data: chunk.pdf,
              mediaType: "application/pdf",
              filename: `${file.name} (pages ${chunk.pageStart}-${chunk.pageEnd})`,
            })
          : ({
              type: "text" as const,
              text: `Extracted text layer (pages ${chunk.pageStart}-${chunk.pageEnd}):\n\n${chunkText.text}`,
            })

        const request = () =>
          generateObject({
            // Haiku 4.5 for the chunked per-page extraction — ~90%
            // cheaper than Opus per token. Mechanical structured
            // extraction (terms, tiers, categories) doesn't need
            // Opus reasoning. The single-call path below still
            // uses claudeModel (Opus) for small PDFs where one
            // cover-page-aware pass beats N narrower ones.
            model: claudeHaiku,
            schema: chunkExtractSchema,
            abortSignal: req.signal,
            // Cap response so a runaway model can't spend more than
            // ~$0.02 on output per chunk. Real chunk outputs are
            // small JSON (a few hundred tokens), 4k gives 10× safety.
            maxOutputTokens: 4000,
            providerOptions: {
              anthropic: { structuredOutputMode: "jsonTool" as const },
            },
            messages: [
              {
                role: "user",
                content: [
                  // Shared prefix — identical across all chunks of
                  // this upload. cacheControl breakpoint here means
                  // chunks 2..N hit Anthropic's prompt cache for
                  // ~90% off the prompt tokens. Splitting the
                  // chunk-specific suffix into its own block keeps
                  // it OUTSIDE the cached prefix — required for the
                  // cache key to match across calls.
                  {
                    type: "text",
                    text: chunkPromptText,
                    providerOptions: {
                      anthropic: {
                        cacheControl: { type: "ephemeral" as const },
                      },
                    },
                  },
                  {
                    type: "text",
                    text: `This is chunk ${chunk.pageStart}-${chunk.pageEnd} of a ${pdfText.pageCount}-page PDF (${useVision ? "scanned, sent as image" : "text layer included"}). Extract only what's visible in these pages — if header fields (contract name, vendor, type) are not on these pages, return null for them. Per-chunk results are merged downstream.`,
                  },
                  sourceBlock,
                ],
              },
            ],
          }).then((r) => r.object as ChunkExtractData)
        try {
          return await request()
        } catch (err) {
          if (NoObjectGeneratedError.isInstance(err)) {
            console.info(
              `[extract-contract/stream] retry chunk pages ${chunk.pageStart}-${chunk.pageEnd} after NoObjectGeneratedError`,
            )
            return await request()
          }
          throw err
        }
      }

      const settled = await mapWithConcurrency(
        chunks,
        CHUNK_CONCURRENCY,
        callChunk,
      )

      const successful: ChunkExtractData[] = []
      const failed: { chunk: string; error: string }[] = []
      settled.forEach((res, i) => {
        const c = chunks[i]!
        const label = `pages ${c.pageStart}-${c.pageEnd}`
        if (res.status === "fulfilled") {
          successful.push(res.value)
        } else {
          failed.push({
            chunk: label,
            error:
              res.reason instanceof Error
                ? res.reason.message
                : String(res.reason),
          })
        }
      })

      if (failed.length > 0) {
        console.warn(
          `[extract-contract/stream] ${failed.length}/${chunks.length} chunks failed — merging the rest`,
          { failed },
        )
      }
      if (successful.length === 0) {
        throw new Error(
          `All ${chunks.length} chunks failed; first failure: ${failed[0]?.error ?? "unknown"}`,
        )
      }

      const merged = mergeExtractedContracts(successful)

      try {
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + 30)
        await prisma.contractExtractionCache.upsert({
          where: { userId_fileHash: { userId, fileHash } },
          create: {
            userId,
            fileHash,
            filename: file.name,
            extracted: merged as object,
            confidence: 0.9,
            s3Key,
            expiresAt,
          },
          update: {
            extracted: merged as object,
            confidence: 0.9,
            s3Key,
            expiresAt,
          },
        })
      } catch (err) {
        console.warn(
          "[extract-contract/stream] chunked cache write skipped:",
          err,
        )
      }

      const encoder = new TextEncoder()
      const body = new ReadableStream({
        start(controller) {
          const payload = {
            extracted: merged,
            confidence: 0.9,
            s3Key,
            chunked: { chunks: chunks.length, pages: pdfText.pageCount },
            done: true,
          }
          controller.enqueue(encoder.encode(JSON.stringify(payload)))
          controller.close()
        },
      })
      const response = new Response(body, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
      if (s3Key) response.headers.set("X-S3-Key", s3Key)
      return response
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
        try {
          const expiresAt = new Date()
          expiresAt.setDate(expiresAt.getDate() + 30)
          await prisma.contractExtractionCache.upsert({
            where: { userId_fileHash: { userId, fileHash } },
            create: {
              userId,
              fileHash,
              filename: file.name,
              extracted: object as object,
              confidence: 0.9,
              s3Key,
              expiresAt,
            },
            update: {
              extracted: object as object,
              confidence: 0.9,
              s3Key,
              expiresAt,
            },
          })
        } catch (err) {
          console.warn("[extract-contract/stream] cache write skipped:", err)
        }
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
        try {
          for await (const chunk of result.textStream) {
            emittedAnyChunk = true
            controller.enqueue(encoder.encode(chunk))
          }
        } catch (err) {
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
            if (!capturedStreamError) {
              capturedStreamError =
                err instanceof Error ? err.message : String(err)
            }
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
