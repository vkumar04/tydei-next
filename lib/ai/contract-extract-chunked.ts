/**
 * Chunked PDF contract extraction — shared by BOTH extract-contract
 * routes (`/api/ai/extract-contract` and `/api/ai/extract-contract/stream`).
 *
 * History: the chunked path + NoObjectGeneratedError fallback was built
 * on the STREAM route (2026-05-25 "prompt is too long" on the 261-page
 * Mako PDF; 2026-06-07 scanned-small-PDF `{}` jsonTool flakiness). The
 * NON-stream route — which the Analysis page's Upload Proposal tab
 * posts to — never got it, so the same 12-page "mako COGS.pdf" that
 * chunked fine through AI Assist 502'd with "AI extraction unavailable"
 * on Analysis (Charles "Analysis is still broken", 2026-06-09). Hoisted
 * here so the two routes can never drift again.
 */

import { generateObject, NoObjectGeneratedError } from "ai"
import { claudeHaiku } from "@/lib/ai/config"
import type { ExtractedContractData } from "@/lib/ai/schemas"
import { extractPdfText } from "@/lib/ai/pdf-text-helper"
import { ocrPdfBuffer } from "@/lib/ai/ocr-pdf"
import { splitPdfByPages } from "@/lib/ai/pdf-chunker"
import {
  chunkExtractSchema,
  mergeExtractedContracts,
  type ChunkExtractData,
} from "@/lib/ai/contract-extract-merger"
import { getActiveContractExtractPrompt } from "@/lib/ai/prompts/contract-extract"

// Anthropic rate-limit at our current tier accepts a small burst
// but rejects the rest with 429s. The first all-parallel run on a
// 33-chunk PDF saw 26/33 chunks fail to that burst. 5 concurrent
// keeps Anthropic's queue happy while only adding ~5s per batch
// vs full parallel — net latency on the 261-page Mako file stays
// ~30-90s with success rate close to 100%.
export const CHUNK_CONCURRENCY = 5

// Vision-only on a 30-page scanned Mako PDF produced a 1.1M-token
// prompt and Anthropic 400'd with "prompt is too long". Anything
// longer than this gets split into N-page sub-PDFs, extracted
// per-chunk via generateObject, then merged. 10 pages × ~80K vision
// tokens ≈ 800K — under the 1M cap with headroom.
export const MAX_PAGES_PER_CHUNK = 10

// Fallback chunk size when the single-call (small-PDF) path fails —
// a SCANNED small PDF trips Anthropic's `jsonTool` structured-output
// flakiness (empty `{}` tool input → NoObjectGeneratedError). The
// chunked Haiku path with relaxed per-chunk identity fields + forced
// vision on chunk 1 is reliable on the same PDFs. 4 pages keeps each
// Haiku vision call focused.
export const FALLBACK_PAGES_PER_CHUNK = 4

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

export interface ChunkedExtractResult {
  merged: ExtractedContractData
  chunkCount: number
  failedCount: number
}

/**
 * Split a PDF into N-page sub-PDFs, extract each via Haiku
 * `generateObject`, and merge into one ExtractedContractData. Throws if
 * every chunk fails.
 */
export async function runChunkedExtraction(opts: {
  fileData: Uint8Array
  fileName: string
  pageCount: number
  maxPagesPerChunk: number
  userInstructionsHint: string
  abortSignal: AbortSignal
  /** Log prefix, e.g. "[extract-contract]" or "[extract-contract/stream]". */
  logPrefix: string
}): Promise<ChunkedExtractResult> {
  const {
    fileData,
    fileName,
    pageCount,
    maxPagesPerChunk,
    userInstructionsHint,
    abortSignal,
    logPrefix,
  } = opts
  const chunks = await splitPdfByPages(fileData, { maxPagesPerChunk })
  console.info(
    `${logPrefix} chunking ${fileName} (${pageCount} pages) into ${chunks.length} sub-PDFs of ≤${maxPagesPerChunk} pages`,
  )

  // Chunked-path prompt deliberately OMITS the whole-PDF text hint that
  // the single-call path includes — chunks send their own per-chunk text
  // (cheaper, more focused).
  const chunkPromptText = getActiveContractExtractPrompt().prompt + userInstructionsHint

  const callChunk = async (
    chunk: (typeof chunks)[number],
    chunkIndex: number,
  ): Promise<ChunkExtractData> => {
    const chunkText = await extractPdfText(chunk.pdf)
    // Force vision on the FIRST chunk (page 1 always has the cover page
    // with contract title + vendor, which text-layer extraction garbles).
    // Body chunks stay text-first when they have a text layer.
    const isFirstChunk = chunkIndex === 0
    const useVision = !chunkText.hasTextLayer || isFirstChunk

    const sourceBlock = useVision
      ? ({
          type: "file" as const,
          data: chunk.pdf,
          mediaType: "application/pdf",
          filename: `${fileName} (pages ${chunk.pageStart}-${chunk.pageEnd})`,
        })
      : ({
          type: "text" as const,
          text: `Extracted text layer (pages ${chunk.pageStart}-${chunk.pageEnd}):\n\n${chunkText.text}`,
        })

    // 2026-06-15: scanned chunks (no text layer) go to vision, where the
    // model reliably reads prose but drops numbers in dense financing /
    // Truth-in-Lending tables (tie-in capital). Run a local Tesseract OCR
    // pass and hand the model the OCR text ALONGSIDE the page image —
    // the image anchors layout, the OCR text anchors the dollar figures.
    // Best-effort: ocrPdfBuffer returns "" on failure → vision-only.
    // OCR the WHOLE chunk — the PDF is already split into ≤MAX_PAGES_PER_CHUNK
    // pieces, and every scanned chunk runs through here, so capping at the
    // chunk's own page count covers an arbitrarily long PDF (a 30-page scan =
    // 3 chunks, all OCR'd) without a hidden truncation if MAX_PAGES_PER_CHUNK
    // ever grows past ocrPdfBuffer's default cap.
    const ocrText = !chunkText.hasTextLayer
      ? await ocrPdfBuffer(chunk.pdf, {
          signal: abortSignal,
          logPrefix,
          maxPages: chunk.pageEnd - chunk.pageStart + 1,
        })
      : ""
    const ocrBlock = ocrText
      ? ({
          type: "text" as const,
          text: `OCR text (Tesseract, pages ${chunk.pageStart}-${chunk.pageEnd}) — use these exact figures for any financing / capital / dollar amounts:\n\n${ocrText}`,
        })
      : null

    const request = () =>
      generateObject({
        model: claudeHaiku,
        schema: chunkExtractSchema,
        abortSignal,
        // Cap response so a runaway model can't spend more than ~$0.02 on
        // output per chunk. Real chunk outputs are small JSON.
        maxOutputTokens: 4000,
        providerOptions: {
          anthropic: { structuredOutputMode: "jsonTool" as const },
        },
        messages: [
          {
            role: "user",
            content: [
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
                text: `This is chunk ${chunk.pageStart}-${chunk.pageEnd} of a ${pageCount}-page PDF (${useVision ? "sent as image" : "text layer included"}${ocrBlock ? " + OCR text" : ""}). Extract only what's visible in these pages — if header fields (contract name, vendor, type) are not on these pages, return null for them. Per-chunk results are merged downstream.`,
              },
              sourceBlock,
              ...(ocrBlock ? [ocrBlock] : []),
            ],
          },
        ],
      }).then((r) => r.object as ChunkExtractData)
    try {
      return await request()
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err)) {
        console.info(
          `${logPrefix} retry chunk pages ${chunk.pageStart}-${chunk.pageEnd} after NoObjectGeneratedError`,
        )
        return await request()
      }
      throw err
    }
  }

  const settled = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, callChunk)

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
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      })
    }
  })

  if (failed.length > 0) {
    console.warn(
      `${logPrefix} ${failed.length}/${chunks.length} chunks failed — merging the rest`,
      { failed },
    )
  }
  if (successful.length === 0) {
    throw new Error(
      `All ${chunks.length} chunks failed; first failure: ${failed[0]?.error ?? "unknown"}`,
    )
  }

  return {
    merged: mergeExtractedContracts(successful),
    chunkCount: chunks.length,
    failedCount: failed.length,
  }
}
