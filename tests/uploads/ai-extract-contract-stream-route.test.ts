import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { createHash } from "node:crypto"
import type { OcrPdfOptions } from "@/lib/ai/ocr-pdf"
import type { ModelCall } from "../support/ai-route-helpers"

const ai = vi.hoisted(() => ({
  generateObject: vi.fn<(opts: ModelCall) => Promise<unknown>>(),
  generateText: vi.fn<(opts: ModelCall) => Promise<unknown>>(),
  streamObject: vi.fn<(opts: ModelCall) => unknown>(),
}))
const ocr = vi.hoisted(() => vi.fn<(pdf: Uint8Array, opts?: OcrPdfOptions) => Promise<string>>())
const db = vi.hoisted(() => ({
  contractExtractionCache: { findUnique: vi.fn(), upsert: vi.fn() },
  member: { findFirst: vi.fn() },
}))
const uploadFile = vi.hoisted(() => vi.fn<(key: string, body: Uint8Array, type: string) => Promise<void>>())
const recordClaudeUsage = vi.hoisted(() => vi.fn())
const getSession = vi.hoisted(() => vi.fn())

vi.mock("ai", async (importActual) => ({
  ...(await importActual<typeof import("ai")>()),
  generateObject: ai.generateObject,
  generateText: ai.generateText,
  streamObject: ai.streamObject,
}))
vi.mock("@/lib/ai/ocr-pdf", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/ai/ocr-pdf")>()),
  ocrPdfBuffer: ocr,
}))
vi.mock("@/lib/db", () => ({ prisma: db }))
vi.mock("@/lib/storage", () => ({ uploadFile }))
vi.mock("@/lib/ai/record-usage", () => ({ recordClaudeUsage }))
vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: (args: unknown) => getSession(args) } },
}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))

import { POST } from "@/app/api/ai/extract-contract/stream/route"
import {
  CONTRACT_FIXTURE,
  buildTextPdf,
  contractPdfLines,
  rasterizeToScannedPdf,
} from "../support/upload-fixtures"
import {
  MB,
  fakeChunk,
  fakeContract,
  fakeObjectResult,
  fakeTextResult,
  fileOf,
  fileParts,
  multiPagePdf,
  multipartRequest,
  noObjectError,
  oversizeContentLengthRequest,
  oversizeFileRequest,
  promptText,
  readBody,
} from "../support/ai-route-helpers"

const URL = "http://localhost/api/ai/extract-contract/stream"

let textPdf: Uint8Array
let scannedPdf: Uint8Array
let twelvePagePdf: Uint8Array
let userId: string
let seq = 0
let consoleError: MockInstance<typeof console.error>

beforeAll(async () => {
  textPdf = await buildTextPdf(contractPdfLines())
  scannedPdf = await rasterizeToScannedPdf(textPdf)
  twelvePagePdf = await multiPagePdf(12)
})

beforeEach(() => {
  seq += 1
  userId = `stream-user-${seq}`
  getSession.mockReset().mockResolvedValue({
    user: { id: userId, name: "Dana Buyer", email: "dana@lighthouse.test" },
  })
  ai.generateText.mockReset()
  ai.generateObject.mockReset()
  ai.streamObject.mockReset()
  ocr.mockReset().mockResolvedValue("")
  db.contractExtractionCache.findUnique.mockReset().mockResolvedValue(null)
  db.contractExtractionCache.upsert.mockReset().mockResolvedValue({})
  db.member.findFirst.mockReset().mockResolvedValue({
    organization: { facility: { id: "fac-lighthouse" }, vendor: null },
  })
  uploadFile.mockReset().mockResolvedValue(undefined)
  recordClaudeUsage.mockReset().mockResolvedValue({ recorded: true, creditsUsed: 25, remaining: null })
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function scriptSingle(script: { object?: unknown; text?: string; error?: unknown }) {
  if (script.error) {
    ai.generateText.mockRejectedValue(script.error)
    return
  }
  ai.generateText.mockResolvedValue(fakeTextResult(script.object, script.text ?? JSON.stringify(script.object)))
}

async function uploadPdf(bytes: Uint8Array, name = "omx-agreement.pdf", extra: Record<string, string> = {}) {
  const res = await POST(multipartRequest(URL, { file: fileOf(bytes, name, "application/pdf"), ...extra }))
  return { res, status: res.status, text: await readBody(res) }
}

function chunkRanges(): string[] {
  return ai.generateObject.mock.calls
    .map(([c]) => promptText(c).match(/This is chunk (\d+-\d+) of/)?.[1] ?? "?")
    .sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]))
}

describe("POST /api/ai/extract-contract/stream — guards", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    getSession.mockResolvedValue(null)
    const { status } = await uploadPdf(textPdf)
    expect(status).toBe(401)
    expect(ai.streamObject).not.toHaveBeenCalled()
  })

  it("rate-limits a single user to 10 streamed extractions per minute", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await POST(new Request(URL, { method: "POST", body: new FormData() }))).status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it("returns 413 from the declared content-length", async () => {
    expect((await POST(oversizeContentLengthRequest(URL))).status).toBe(413)
  })

  it("returns 413 with the size when the PDF itself is over 25 MB", async () => {
    const res = await POST(oversizeFileRequest(URL, "huge.pdf", "application/pdf", 30 * MB))
    expect(res.status).toBe(413)
    expect(((await res.json()) as { details: string }).details).toBe("30.0MB; max 25MB.")
  })

  it("returns 415 for a non-PDF filename before archiving or calling the model", async () => {
    const res = await POST(multipartRequest(URL, { file: fileOf("x", "agreement.docx", "application/octet-stream") }))
    expect(res.status).toBe(415)
    expect(uploadFile).not.toHaveBeenCalled()
    expect(ai.streamObject).not.toHaveBeenCalled()
  })
})

describe("POST /api/ai/extract-contract/stream — cache", () => {
  it("streams a cached extract keyed by userId + versioned sha256 as one done envelope", async () => {
    db.contractExtractionCache.findUnique.mockResolvedValue({
      extracted: fakeContract({ contractName: "Cached Agreement" }),
      confidence: null,
      s3Key: `contracts/${userId}/1-aaaa0000-omx.pdf`,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const { status, text } = await uploadPdf(textPdf)
    expect(status).toBe(200)
    expect(JSON.parse(text)).toMatchObject({
      extracted: { contractName: "Cached Agreement" },
      confidence: 0.9,
      s3Key: `contracts/${userId}/1-aaaa0000-omx.pdf`,
      cached: true,
      done: true,
    })
    const fileHash = createHash("sha256").update(textPdf).update("v3").digest("hex")
    expect(db.contractExtractionCache.findUnique).toHaveBeenCalledWith({
      where: { userId_fileHash: { userId, fileHash } },
    })
    expect(recordClaudeUsage).not.toHaveBeenCalled()
    expect(ai.streamObject).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
  })
})

describe("POST /api/ai/extract-contract/stream — single call", () => {
  it("returns one done envelope, exposes X-S3-Key, includes the text layer hint, and caches", async () => {
    const extracted = fakeContract()
    scriptSingle({ object: extracted })
    const { res, status, text } = await uploadPdf(textPdf, "OMX Agreement.pdf", { userInstructions: "Robot is capital." })

    expect(status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8")
    const s3Key = res.headers.get("X-S3-Key")
    expect(s3Key).toMatch(new RegExp(`^contracts/${userId}/\\d+-[0-9a-f]{8}-OMX_Agreement\\.pdf$`))
    expect(uploadFile).toHaveBeenCalledWith(s3Key, expect.any(Uint8Array), "application/pdf")
    expect(JSON.parse(text)).toEqual({ extracted: JSON.parse(JSON.stringify(extracted)), s3Key, reviewWarnings: [], done: true })

    expect(ai.generateText).toHaveBeenCalledTimes(1)
    expect(ai.generateObject).not.toHaveBeenCalled()
    const call = ai.generateText.mock.calls[0]![0]
    const prompt = promptText(call)
    expect(prompt).toContain("here is the extracted text layer of the PDF")
    expect(prompt).toContain(CONTRACT_FIXTURE.contractNumber)
    expect(prompt).toContain("Additional user instructions:\nRobot is capital.")
    expect(call.instructions).toContain("no markdown fences")
    expect(call.output).toBeUndefined()
    expect(fileParts(call)[0]).toMatchObject({ mediaType: "application/pdf", filename: "OMX Agreement.pdf" })

    expect(db.contractExtractionCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId, filename: "OMX Agreement.pdf", extracted, s3Key }),
      }),
    )
  })

  it("accepts JSON the model wrapped in markdown fences or prose", async () => {
    const extracted = fakeContract({ contractName: "Fenced Agreement" })
    scriptSingle({ object: extracted, text: `Here is the extraction:\n\n\`\`\`json\n${JSON.stringify(extracted)}\n\`\`\`` })
    const { text } = await uploadPdf(textPdf)
    expect(JSON.parse(text).extracted).toMatchObject({ contractName: "Fenced Agreement" })
  })

  it("surfaces a streamError envelope naming the provider failure instead of an empty body", async () => {
    scriptSingle({ error: new Error("invalid x-api-key") })
    const { status, text } = await uploadPdf(textPdf)
    expect(status).toBe(200)
    expect(JSON.parse(text)).toEqual({ streamError: "invalid x-api-key" })
    expect(consoleError).toHaveBeenCalledWith(
      "[extract-contract/stream]",
      expect.any(Error),
      expect.objectContaining({ userId, file: "omx-agreement.pdf" }),
    )
    expect(db.contractExtractionCache.upsert).not.toHaveBeenCalled()
  })

  it("omits X-S3-Key when archival fails but still returns the extraction", async () => {
    uploadFile.mockRejectedValue(new Error("NoSuchBucket"))
    const extracted = fakeContract()
    scriptSingle({ object: extracted })
    const { res, text } = await uploadPdf(textPdf)
    expect(res.headers.get("X-S3-Key")).toBeNull()
    expect(JSON.parse(text).extracted.vendorName).toBe(CONTRACT_FIXTURE.vendor)
  })

  it("records AI usage for a successful extraction", async () => {
    scriptSingle({ object: fakeContract() })
    await uploadPdf(textPdf)
    expect(recordClaudeUsage).toHaveBeenCalledTimes(1)
  })
})

describe("POST /api/ai/extract-contract/stream — chunked path", () => {
  it("routes a scanned PDF to chunked OCR extraction and returns one done envelope with X-S3-Key", async () => {
    ocr.mockResolvedValue(`--- page 2 ---\nAmount Financed: ${CONTRACT_FIXTURE.capitalValue}`)
    ai.generateObject.mockResolvedValue(fakeObjectResult(fakeChunk({ vendorName: CONTRACT_FIXTURE.vendor, capitalCost: 785_195 })))
    const { res, text } = await uploadPdf(scannedPdf, "scan.pdf")
    expect(ai.streamObject).not.toHaveBeenCalled()
    expect(ocr).toHaveBeenCalledWith(expect.any(Uint8Array), expect.objectContaining({ logPrefix: "[extract-contract/stream]" }))
    expect(promptText(ai.generateObject.mock.calls[0]![0])).toContain(CONTRACT_FIXTURE.capitalValue)
    const s3Key = res.headers.get("X-S3-Key")
    expect(s3Key).toMatch(new RegExp(`^contracts/${userId}/`))
    expect(JSON.parse(text)).toMatchObject({
      extracted: { vendorName: CONTRACT_FIXTURE.vendor, capitalCost: 785_195 },
      confidence: 0.9,
      s3Key,
      chunked: { chunks: 1, pages: 2 },
      done: true,
    })
    expect(recordClaudeUsage).toHaveBeenCalledTimes(1)
    expect(db.contractExtractionCache.upsert).toHaveBeenCalledTimes(1)
  })

  it("chunks a 12-page text PDF into 10 + 2 pages", async () => {
    ai.generateObject.mockResolvedValue(fakeObjectResult(fakeChunk({ vendorName: CONTRACT_FIXTURE.vendor })))
    const { text } = await uploadPdf(twelvePagePdf, "twelve.pdf")
    expect(chunkRanges()).toEqual(["1-10", "11-12"])
    expect(JSON.parse(text).chunked).toEqual({ chunks: 2, pages: 12 })
    expect(ai.streamObject).not.toHaveBeenCalled()
  })

  it("falls back to 4-page chunks when neither model returns parseable JSON", async () => {
    scriptSingle({ object: undefined, text: "Sorry, I cannot read this document." })
    ai.generateObject.mockResolvedValue(fakeObjectResult(fakeChunk({ contractName: "Recovered via chunks" })))
    const { text } = await uploadPdf(textPdf)
    expect(ai.generateText).toHaveBeenCalledTimes(2)
    expect(chunkRanges()).toEqual(["1-2"])
    expect(JSON.parse(text).extracted).toMatchObject({ contractName: "Recovered via chunks" })
    expect(db.contractExtractionCache.upsert).toHaveBeenCalledTimes(1)
  })

  it("explains the schema mismatch when the single call and the chunk fallback both fail", async () => {
    scriptSingle({ object: undefined, text: "{}" })
    ai.generateObject.mockRejectedValue(noObjectError())
    const { text } = await uploadPdf(textPdf)
    expect(JSON.parse(text).streamError).toMatch(/did not match the contract schema/)
    expect(consoleError).toHaveBeenCalledWith(
      "[extract-contract/stream] chunked fallback also failed:",
      expect.any(Error),
      expect.objectContaining({ userId }),
    )
  })

  it("returns 500 naming contract extraction when every chunk of a text PDF fails", async () => {
    ai.generateObject.mockRejectedValue(new Error("429 rate_limit_error"))
    const { status, text } = await uploadPdf(twelvePagePdf, "twelve.pdf")
    expect(status).toBe(500)
    expect(JSON.parse(text).error).toBe(
      "Contract extraction failed while reading this PDF in sections. Try again, or use Manual Entry.",
    )
    expect(consoleError).toHaveBeenCalledWith(
      "[extract-contract/stream] chunked extract error:",
      expect.any(Error),
      expect.objectContaining({ userId, pageCount: 12, hasTextLayer: true }),
    )
  })

  it("tells the user a failed scan was read by OCR, with its page count", async () => {
    ai.generateObject.mockRejectedValue(new Error("overloaded"))
    const { status, text } = await uploadPdf(scannedPdf, "Rosa scan.pdf")
    expect(status).toBe(500)
    expect(JSON.parse(text).error).toMatch(/^Contract extraction failed\. "Rosa scan\.pdf" looks like a scan .*\(2 pages\)/)
  })
})
