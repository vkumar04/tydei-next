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

import { POST } from "@/app/api/ai/extract-contract/route"
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
} from "../support/ai-route-helpers"

const URL = "http://localhost/api/ai/extract-contract"

type ExtractResponse = {
  success?: boolean
  extracted?: Record<string, unknown>
  confidence?: number
  s3Key?: string
  cached?: boolean
  pdfText?: string
  error?: string
  details?: string
}

let textPdf: Uint8Array
let scannedPdf: Uint8Array
let twelvePagePdf: Uint8Array
let ninePagePdf: Uint8Array
let userId: string
let seq = 0
let consoleError: MockInstance<typeof console.error>

beforeAll(async () => {
  textPdf = await buildTextPdf(contractPdfLines())
  scannedPdf = await rasterizeToScannedPdf(textPdf)
  twelvePagePdf = await multiPagePdf(12)
  ninePagePdf = await multiPagePdf(9)
})

beforeEach(() => {
  seq += 1
  userId = `extract-user-${seq}`
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
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function uploadPdf(bytes: Uint8Array, name = "omx-agreement.pdf", extra: Record<string, string> = {}) {
  const res = await POST(multipartRequest(URL, { file: fileOf(bytes, name, "application/pdf"), ...extra }))
  return { status: res.status, body: (await res.json()) as ExtractResponse }
}

function chunkRanges(): string[] {
  return ai.generateObject.mock.calls
    .map(([c]) => promptText(c).match(/This is chunk (\d+-\d+) of/)?.[1] ?? "?")
    .sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]))
}

describe("POST /api/ai/extract-contract — guards", () => {
  it("rejects an unauthenticated multipart upload with 401 before touching the model or S3", async () => {
    getSession.mockResolvedValue(null)
    const { status } = await uploadPdf(textPdf)
    expect(status).toBe(401)
    expect(ai.generateText).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it("rejects an unauthenticated JSON text extraction with 401", async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(
      new Request(URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Contract Number: OMX-2026-0417" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("rate-limits a single user to 10 extractions per minute", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await POST(new Request(URL, { method: "POST", body: new FormData() }))
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it("returns 413 from the declared content-length before parsing the body", async () => {
    const res = await POST(oversizeContentLengthRequest(URL))
    expect(res.status).toBe(413)
    expect(((await res.json()) as ExtractResponse).error).toMatch(/25MB/)
  })

  it("returns 413 with the actual size when the file itself is over 25 MB", async () => {
    const res = await POST(oversizeFileRequest(URL, "huge.pdf", "application/pdf", 26 * MB))
    expect(res.status).toBe(413)
    expect(((await res.json()) as ExtractResponse).details).toMatch(/26\.0MB/)
    expect(ai.generateText).not.toHaveBeenCalled()
  })

  it("returns 415 for a non-PDF upload without calling the model", async () => {
    const res = await POST(
      multipartRequest(URL, {
        file: fileOf("Contract Number: OMX-2026-0417", "agreement.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      }),
    )
    expect(res.status).toBe(415)
    expect(((await res.json()) as ExtractResponse).error).toBe("Contract uploads must be PDF")
    expect(ai.generateText).not.toHaveBeenCalled()
    expect(ai.generateObject).not.toHaveBeenCalled()
  })

  it.fails("does not archive a rejected non-PDF upload to S3", async () => {
    await POST(multipartRequest(URL, { file: fileOf("plain text", "agreement.txt", "text/plain") }))
    expect(uploadFile).not.toHaveBeenCalled()
  })
})

describe("POST /api/ai/extract-contract — extraction cache", () => {
  it("returns a cached extract keyed by userId + sha256 without calling the model or S3", async () => {
    const cachedExtract = fakeContract({ contractName: "Cached Agreement" })
    db.contractExtractionCache.findUnique.mockResolvedValue({
      extracted: cachedExtract,
      confidence: 0.87,
      s3Key: `contracts/${userId}/1700000000000-abcd1234-omx-agreement.pdf`,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    const { status, body } = await uploadPdf(textPdf)
    expect(status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      cached: true,
      confidence: 0.87,
      extracted: { contractName: "Cached Agreement" },
      s3Key: `contracts/${userId}/1700000000000-abcd1234-omx-agreement.pdf`,
    })
    expect(body.pdfText).toContain(CONTRACT_FIXTURE.contractNumber)
    const fileHash = createHash("sha256").update(textPdf).digest("hex")
    expect(db.contractExtractionCache.findUnique).toHaveBeenCalledWith({
      where: { userId_fileHash: { userId, fileHash } },
    })
    expect(ai.generateText).not.toHaveBeenCalled()
    expect(ai.generateObject).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
    expect(db.contractExtractionCache.upsert).not.toHaveBeenCalled()
  })

  it("ignores an expired cache row and re-extracts", async () => {
    db.contractExtractionCache.findUnique.mockResolvedValue({
      extracted: fakeContract({ contractName: "Stale" }),
      confidence: 0.9,
      s3Key: null,
      expiresAt: new Date(Date.now() - 1_000),
    })
    ai.generateText.mockResolvedValue(fakeTextResult(fakeContract()))
    const { body } = await uploadPdf(textPdf)
    expect(body.cached).toBe(false)
    expect(body.extracted?.contractName).toBe("Supply and Rebate Agreement")
    expect(ai.generateText).toHaveBeenCalledTimes(1)
  })
})

describe("POST /api/ai/extract-contract — text PDF ≤ 10 pages", () => {
  it("makes one structured model call with the PDF and instructions, archives, caches, and records usage", async () => {
    const extracted = fakeContract()
    ai.generateText.mockResolvedValue(fakeTextResult(extracted))
    const { status, body } = await uploadPdf(textPdf, "OMX Agreement (signed).pdf", {
      userInstructions: "Treat the robot as tie-in capital.",
    })

    expect(status).toBe(200)
    expect(ai.generateText).toHaveBeenCalledTimes(1)
    expect(ai.generateObject).not.toHaveBeenCalled()
    expect(ocr).not.toHaveBeenCalled()

    const call = ai.generateText.mock.calls[0]![0]
    expect(promptText(call)).toContain("Additional user instructions:\nTreat the robot as tie-in capital.")
    const files = fileParts(call)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ mediaType: "application/pdf", filename: "OMX Agreement (signed).pdf" })
    expect((files[0]!.data as Uint8Array).byteLength).toBe(textPdf.byteLength)

    expect(body).toMatchObject({ success: true, cached: false, confidence: 0.9, extracted: { ...extracted } })
    expect(body.pdfText).toContain(CONTRACT_FIXTURE.capitalValue)

    expect(body.s3Key).toMatch(new RegExp(`^contracts/${userId}/\\d+-[0-9a-f]{8}-OMX_Agreement__signed_\\.pdf$`))
    expect(uploadFile).toHaveBeenCalledWith(body.s3Key, expect.any(Uint8Array), "application/pdf")

    const fileHash = createHash("sha256").update(textPdf).digest("hex")
    const upsertArg = db.contractExtractionCache.upsert.mock.calls[0]![0] as {
      where: unknown
      create: { userId: string; fileHash: string; filename: string; extracted: unknown; s3Key: string; expiresAt: Date }
    }
    expect(upsertArg.where).toEqual({ userId_fileHash: { userId, fileHash } })
    expect(upsertArg.create).toMatchObject({
      userId,
      fileHash,
      filename: "OMX Agreement (signed).pdf",
      extracted,
      s3Key: body.s3Key,
    })
    expect(upsertArg.create.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000)

    expect(recordClaudeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        userName: "Dana Buyer",
        facilityId: "fac-lighthouse",
        vendorId: null,
        action: "full_contract_analysis",
      }),
    )
  })

  it("still returns the extraction when S3 archival fails", async () => {
    uploadFile.mockRejectedValue(new Error("AccessDenied"))
    ai.generateText.mockResolvedValue(fakeTextResult(fakeContract()))
    const { status, body } = await uploadPdf(textPdf)
    expect(status).toBe(200)
    expect(body.s3Key).toBeUndefined()
    expect(body.extracted?.vendorName).toBe(CONTRACT_FIXTURE.vendor)
  })

  it("still returns the extraction when the cache write fails", async () => {
    db.contractExtractionCache.upsert.mockRejectedValue(new Error("connection reset"))
    ai.generateText.mockResolvedValue(fakeTextResult(fakeContract()))
    const { status } = await uploadPdf(textPdf)
    expect(status).toBe(200)
  })

  it("falls back to the Sonnet model once when Opus is overloaded", async () => {
    ai.generateText
      .mockRejectedValueOnce(new Error("529 overloaded_error"))
      .mockResolvedValueOnce(fakeTextResult(fakeContract()))
    const { status } = await uploadPdf(textPdf)
    expect(status).toBe(200)
    expect(ai.generateText).toHaveBeenCalledTimes(2)
    expect(ai.generateObject).not.toHaveBeenCalled()
  })
})

describe("POST /api/ai/extract-contract — chunked path", () => {
  it("routes a scanned PDF through chunked extraction with OCR text instead of the single call", async () => {
    ocr.mockResolvedValue(`--- page 1 ---\nContract Number: ${CONTRACT_FIXTURE.contractNumber}\nAmount Financed: ${CONTRACT_FIXTURE.capitalValue}`)
    ai.generateObject.mockResolvedValue(
      fakeObjectResult(fakeChunk({ contractName: "Supply and Rebate Agreement", vendorName: CONTRACT_FIXTURE.vendor, capitalCost: 785_195 })),
    )
    const { status, body } = await uploadPdf(scannedPdf, "scan.pdf")
    expect(status).toBe(200)
    expect(ai.generateText).not.toHaveBeenCalled()
    expect(ai.generateObject).toHaveBeenCalledTimes(1)
    expect(ocr).toHaveBeenCalledTimes(1)
    expect(ocr.mock.calls[0]![1]).toMatchObject({ maxPages: 2, logPrefix: "[extract-contract]" })
    const call = ai.generateObject.mock.calls[0]![0]
    expect(fileParts(call)).toHaveLength(1)
    expect(promptText(call)).toContain(`Amount Financed: ${CONTRACT_FIXTURE.capitalValue}`)
    expect(body.extracted).toMatchObject({ vendorName: CONTRACT_FIXTURE.vendor, capitalCost: 785_195 })
    expect(db.contractExtractionCache.upsert).toHaveBeenCalledTimes(1)
  })

  it(
    "feeds real Tesseract OCR text from an image-only scan into the chunk model call",
    async () => {
      const { ocrPdfBuffer } = await vi.importActual<typeof import("@/lib/ai/ocr-pdf")>("@/lib/ai/ocr-pdf")
      ocr.mockImplementation(ocrPdfBuffer)
      ai.generateObject.mockResolvedValue(fakeObjectResult(fakeChunk({ vendorName: CONTRACT_FIXTURE.vendor })))
      const { status } = await uploadPdf(scannedPdf, "scan.pdf")
      expect(status).toBe(200)
      const text = promptText(ai.generateObject.mock.calls[0]![0]).replace(/\s+/g, " ")
      expect(text).toMatch(/OCR text \(Tesseract, pages 1-2\)/)
      expect(text).toContain(CONTRACT_FIXTURE.contractNumber)
      expect(text.replace(/\s+/g, "")).toContain(CONTRACT_FIXTURE.capitalValue)
    },
    180_000,
  )

  it("splits a 12-page text PDF into 10 + 2 page chunks and never makes the single call", async () => {
    ai.generateObject.mockResolvedValue(fakeObjectResult(fakeChunk({ vendorName: CONTRACT_FIXTURE.vendor })))
    const { status, body } = await uploadPdf(twelvePagePdf, "twelve.pdf")
    expect(status).toBe(200)
    expect(ai.generateText).not.toHaveBeenCalled()
    expect(chunkRanges()).toEqual(["1-10", "11-12"])
    expect(promptText(ai.generateObject.mock.calls[0]![0])).toContain("of a 12-page PDF")
    expect(ocr).not.toHaveBeenCalled()
    expect(body.extracted?.vendorName).toBe(CONTRACT_FIXTURE.vendor)
  })

  it("falls back to 4-page chunks when the single call fails on a small text PDF", async () => {
    ai.generateText.mockRejectedValue(new Error("Invalid request: tool input was empty"))
    ai.generateObject.mockResolvedValue(fakeObjectResult(fakeChunk({ contractName: "Recovered Agreement" })))
    const { status, body } = await uploadPdf(ninePagePdf, "nine.pdf")
    expect(status).toBe(200)
    expect(ai.generateText).toHaveBeenCalledTimes(1)
    expect(chunkRanges()).toEqual(["1-4", "5-8", "9-9"])
    expect(body.extracted?.contractName).toBe("Recovered Agreement")
    expect(consoleError).toHaveBeenCalledWith(
      "[extract-contract] AI extraction failed:",
      expect.any(Error),
      expect.objectContaining({ mediaType: "application/pdf" }),
    )
  })

  it("returns 502 with the single-call error when the 4-page fallback also fails", async () => {
    ai.generateText.mockRejectedValue(new Error("Invalid request: tool input was empty"))
    ai.generateObject.mockRejectedValue(noObjectError())
    const { status, body } = await uploadPdf(ninePagePdf, "nine.pdf")
    expect(status).toBe(502)
    expect(body.error).toBe("AI extraction unavailable")
    expect(body.details).toContain("tool input was empty")
    expect(ai.generateObject).toHaveBeenCalledTimes(6)
    expect(db.contractExtractionCache.upsert).not.toHaveBeenCalled()
    expect(recordClaudeUsage).not.toHaveBeenCalled()
  })

  it("returns 502 and logs under [extract-contract] when every chunk of a large PDF fails", async () => {
    ai.generateObject.mockRejectedValue(new Error("prompt is too long: 1204511 tokens > 1000000 maximum"))
    const { status, body } = await uploadPdf(twelvePagePdf, "twelve.pdf")
    expect(status).toBe(502)
    expect(body.error).toMatch(/extraction/i)
    expect(body.details).toContain("All 2 chunks failed")
    expect(body.s3Key).toMatch(new RegExp(`^contracts/${userId}/`))
    expect(consoleError).toHaveBeenCalledWith(
      "[extract-contract] chunked extract error:",
      expect.any(Error),
      expect.objectContaining({ userId, file: "twelve.pdf", pageCount: 12 }),
    )
    expect(recordClaudeUsage).not.toHaveBeenCalled()
  })

  it.fails("names the contract-extraction action in the client error when every chunk fails", async () => {
    ai.generateObject.mockRejectedValue(new Error("prompt is too long"))
    const { body } = await uploadPdf(twelvePagePdf, "twelve.pdf")
    expect(body.error).toMatch(/contract extraction/i)
  })
})

describe("POST /api/ai/extract-contract — JSON text branch", () => {
  function jsonRequest(payload: unknown): Request {
    return new Request(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  }

  it("parses pasted contract text with one capped model call and records usage", async () => {
    const extracted = fakeContract()
    ai.generateText.mockResolvedValue(fakeTextResult(extracted))
    const pasted = contractPdfLines().flat().join("\n")
    const res = await POST(jsonRequest({ text: `  ${pasted}  ` }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ extracted: JSON.parse(JSON.stringify(extracted)), confidence: 0.9 })
    const call = ai.generateText.mock.calls[0]![0]
    expect(call.maxOutputTokens).toBe(8000)
    expect(call.prompt).toContain(`Contract information:\n${pasted}`)
    expect(uploadFile).not.toHaveBeenCalled()
    expect(recordClaudeUsage).toHaveBeenCalledWith(
      expect.objectContaining({ action: "full_contract_analysis", description: "Extracted contract: Supply and Rebate Agreement" }),
    )
  })

  it("rejects blank text with 400 and no model call", async () => {
    const res = await POST(jsonRequest({ text: "   " }))
    expect(res.status).toBe(400)
    expect(ai.generateText).not.toHaveBeenCalled()
  })

  it("returns 422 when the model produces no usable object", async () => {
    ai.generateText.mockResolvedValue(fakeTextResult(undefined, "I could not find a contract."))
    const res = await POST(jsonRequest({ text: "hello" }))
    expect(res.status).toBe(422)
  })
})
