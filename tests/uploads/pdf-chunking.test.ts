import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { PDFDocument } from "pdf-lib"
import type { ModelCall } from "../support/ai-route-helpers"

const ai = vi.hoisted(() => ({
  generateObject: vi.fn<(opts: ModelCall) => Promise<unknown>>(),
  generateText: vi.fn<(opts: ModelCall) => Promise<unknown>>(),
  streamObject: vi.fn<(opts: ModelCall) => unknown>(),
}))

vi.mock("ai", async (importActual) => ({
  ...(await importActual<typeof import("ai")>()),
  generateObject: ai.generateObject,
  generateText: ai.generateText,
  streamObject: ai.streamObject,
}))

import { splitPdfByPages } from "@/lib/ai/pdf-chunker"
import { extractPdfText } from "@/lib/ai/pdf-text-helper"
import {
  CHUNK_CONCURRENCY,
  runChunkedExtraction,
} from "@/lib/ai/contract-extract-chunked"
import {
  fakeChunk,
  fakeObjectResult,
  fileParts,
  multiPagePdf,
  noObjectError,
  promptText,
} from "../support/ai-route-helpers"

let pdf23: Uint8Array

beforeAll(async () => {
  pdf23 = await multiPagePdf(23)
})

beforeEach(() => {
  ai.generateObject.mockReset()
  ai.generateText.mockReset()
  ai.streamObject.mockReset()
})

function chunkRange(call: ModelCall | undefined): string {
  const m = promptText(call).match(/This is chunk (\d+)-(\d+) of/)
  return m ? `${m[1]}-${m[2]}` : "?"
}

describe("splitPdfByPages", () => {
  it("splits a 23-page PDF into 10/10/3-page chunks with correct page ranges", async () => {
    const chunks = await splitPdfByPages(pdf23, { maxPagesPerChunk: 10 })
    expect(chunks.map((c) => [c.pageStart, c.pageEnd])).toEqual([
      [1, 10],
      [11, 20],
      [21, 23],
    ])
    const counts = await Promise.all(
      chunks.map(async (c) => (await PDFDocument.load(c.pdf)).getPageCount()),
    )
    expect(counts).toEqual([10, 10, 3])
  })

  it("produces 4-page fallback chunks (4×5 + 3) whose text matches their page range", async () => {
    const chunks = await splitPdfByPages(pdf23, { maxPagesPerChunk: 4 })
    expect(chunks).toHaveLength(6)
    expect(chunks.map((c) => c.pageEnd - c.pageStart + 1)).toEqual([4, 4, 4, 4, 4, 3])
    const second = await extractPdfText(chunks[1]!.pdf)
    expect(second.pageCount).toBe(4)
    expect(second.hasTextLayer).toBe(true)
    for (const p of [5, 6, 7, 8]) expect(second.text).toMatch(new RegExp(`MARKER-P${p}\\b`))
    expect(second.text).not.toMatch(/MARKER-P4\b/)
    expect(second.text).not.toMatch(/MARKER-P9\b/)
  })

  it("keeps every page's text across the chunks with no gaps or duplicates", async () => {
    const chunks = await splitPdfByPages(pdf23, { maxPagesPerChunk: 10 })
    const texts = await Promise.all(chunks.map(async (c) => (await extractPdfText(c.pdf)).text))
    const all = texts.join("\n")
    for (let p = 1; p <= 23; p++) {
      expect(all.match(new RegExp(`MARKER-P${p}\\b`, "g"))).toHaveLength(1)
    }
    expect(texts[2]).toMatch(/MARKER-P21\b/)
    expect(texts[2]).toMatch(/MARKER-P23\b/)
  })

  it("returns the original bytes as one chunk when the PDF fits", async () => {
    const small = await multiPagePdf(3)
    const chunks = await splitPdfByPages(small, { maxPagesPerChunk: 10 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ pageStart: 1, pageEnd: 3 })
    expect(chunks[0]!.pdf.byteLength).toBe(small.byteLength)
  })

  it("does not detach the caller's buffer", async () => {
    const bytes = new Uint8Array(pdf23)
    await splitPdfByPages(bytes, { maxPagesPerChunk: 10 })
    expect(bytes.byteLength).toBe(pdf23.byteLength)
  })

  it("rejects a non-positive chunk size", async () => {
    await expect(splitPdfByPages(pdf23, { maxPagesPerChunk: 0 })).rejects.toThrow(/must be > 0/)
  })
})

function run(maxPagesPerChunk: number, fileData = pdf23) {
  return runChunkedExtraction({
    fileData,
    fileName: "omx-master.pdf",
    pageCount: 23,
    maxPagesPerChunk,
    userInstructionsHint: "",
    abortSignal: new AbortController().signal,
    logPrefix: "[pdf-chunking-test]",
  })
}

describe("runChunkedExtraction", () => {
  it("extracts each chunk once and merges header from chunk 1 with terms from later chunks", async () => {
    ai.generateObject.mockImplementation(async (call) => {
      const range = chunkRange(call)
      if (range === "1-10") {
        return fakeObjectResult(
          fakeChunk({
            contractName: "Supply and Rebate Agreement",
            vendorName: "Orthomedix Surgical",
            contractType: "tie_in",
            contractNumber: "OMX-2026-0417",
            productCategories: ["Spine"],
          }),
        )
      }
      if (range === "11-20") {
        return fakeObjectResult(
          fakeChunk({
            vendorName: "Some Other Vendor",
            totalValue: 1_250_000,
            productCategories: ["spine", "Joint Replacement"],
            terms: [{ termName: "Spend Rebate", termType: "spend_rebate", tiers: [] }],
          }),
        )
      }
      return fakeObjectResult(
        fakeChunk({
          capitalCost: 785_195,
          terms: [{ termName: "Capital Paydown", termType: "capital", tiers: [] }],
        }),
      )
    })

    const result = await run(10)
    expect(ai.generateObject).toHaveBeenCalledTimes(3)
    expect(result.chunkCount).toBe(3)
    expect(result.failedCount).toBe(0)
    expect(result.merged).toMatchObject({
      contractName: "Supply and Rebate Agreement",
      vendorName: "Orthomedix Surgical",
      contractType: "tie_in",
      contractNumber: "OMX-2026-0417",
      totalValue: 1_250_000,
      capitalCost: 785_195,
      productCategories: ["Spine", "Joint Replacement"],
    })
    expect(result.merged.terms.map((t) => t.termName)).toEqual(["Spend Rebate", "Capital Paydown"])
  })

  it("sends chunk 1 as a vision file part and later text-layer chunks as text", async () => {
    ai.generateObject.mockResolvedValue(fakeObjectResult(fakeChunk()))
    await run(10)
    const calls = ai.generateObject.mock.calls.map(([c]) => c)
    const first = calls.find((c) => chunkRange(c) === "1-10")
    const second = calls.find((c) => chunkRange(c) === "11-20")
    expect(fileParts(first)).toHaveLength(1)
    expect(fileParts(first)[0]!.filename).toBe("omx-master.pdf (pages 1-10)")
    expect(fileParts(second)).toHaveLength(0)
    expect(promptText(second)).toMatch(/Extracted text layer \(pages 11-20\)/)
    expect(promptText(second)).toMatch(/MARKER-P15\b/)
    expect(promptText(second)).not.toMatch(/MARKER-P5\b/)
  })

  it(`never runs more than ${CHUNK_CONCURRENCY} chunk calls at once`, async () => {
    let inFlight = 0
    let peak = 0
    ai.generateObject.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 15))
      inFlight -= 1
      return fakeObjectResult(fakeChunk())
    })
    const result = await run(2)
    expect(result.chunkCount).toBe(12)
    expect(ai.generateObject).toHaveBeenCalledTimes(12)
    expect(peak).toBe(CHUNK_CONCURRENCY)
  })

  it("retries a chunk exactly once after NoObjectGeneratedError and keeps its result", async () => {
    let failedOnce = false
    ai.generateObject.mockImplementation(async (call) => {
      if (chunkRange(call) === "11-20" && !failedOnce) {
        failedOnce = true
        throw noObjectError()
      }
      return fakeObjectResult(fakeChunk({ contractNumber: `from-${chunkRange(call)}` }))
    })
    const result = await run(10)
    expect(ai.generateObject).toHaveBeenCalledTimes(4)
    expect(ai.generateObject.mock.calls.filter(([c]) => chunkRange(c) === "11-20")).toHaveLength(2)
    expect(result.failedCount).toBe(0)
  })

  it("does not retry a non-schema error and merges the surviving chunks", async () => {
    ai.generateObject.mockImplementation(async (call) => {
      if (chunkRange(call) === "21-23") throw new Error("529 overloaded")
      return fakeObjectResult(fakeChunk({ vendorName: "Orthomedix Surgical" }))
    })
    const result = await run(10)
    expect(ai.generateObject).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ chunkCount: 3, failedCount: 1 })
    expect(result.merged.vendorName).toBe("Orthomedix Surgical")
  })

  it("gives up on a chunk whose retry also returns no object", async () => {
    ai.generateObject.mockImplementation(async (call) => {
      if (chunkRange(call) === "1-10") throw noObjectError()
      return fakeObjectResult(fakeChunk())
    })
    const result = await run(10)
    expect(ai.generateObject.mock.calls.filter(([c]) => chunkRange(c) === "1-10")).toHaveLength(2)
    expect(result.failedCount).toBe(1)
  })

  it("throws naming the chunk count and first failure only when every chunk fails", async () => {
    ai.generateObject.mockRejectedValue(new Error("prompt is too long"))
    await expect(run(10)).rejects.toThrow("All 3 chunks failed; first failure: prompt is too long")
  })
})
