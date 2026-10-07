import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { PDFDocument } from "pdf-lib"
import type { ModelCall } from "../support/ai-route-helpers"

const ai = vi.hoisted(() => ({
  generateObject: vi.fn<(opts: ModelCall) => Promise<unknown>>(),
  generateText: vi.fn<(opts: ModelCall) => Promise<unknown>>(),
  streamObject: vi.fn<(opts: ModelCall) => unknown>(),
}))
const db = vi.hoisted(() => ({ member: { findFirst: vi.fn() } }))
const recordClaudeUsage = vi.hoisted(() => vi.fn())
const getSession = vi.hoisted(() => vi.fn())

vi.mock("ai", async (importActual) => ({
  ...(await importActual<typeof import("ai")>()),
  generateObject: ai.generateObject,
  generateText: ai.generateText,
  streamObject: ai.streamObject,
}))
vi.mock("@/lib/db", () => ({ prisma: db }))
vi.mock("@/lib/ai/record-usage", () => ({ recordClaudeUsage }))
vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: (args: unknown) => getSession(args) } },
}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))

import { POST } from "@/app/api/ai/extract-invoice/route"
import { claudeHaiku, claudeSonnet } from "@/lib/ai/config"
import type { ExtractedInvoiceData } from "@/lib/ai/invoice-extract-schema"
import { buildTextPdf } from "../support/upload-fixtures"
import {
  MB,
  fakeTextResult,
  fileOf,
  fileParts,
  multiPagePdf,
  multipartRequest,
  oversizeContentLengthRequest,
  oversizeFileRequest,
  promptText,
} from "../support/ai-route-helpers"

const URL = "http://localhost/api/ai/extract-invoice"

let invoicePdf: Uint8Array
let longInvoicePdf: Uint8Array
let userId: string
let seq = 0
let consoleError: MockInstance<typeof console.error>

const INVOICE: ExtractedInvoiceData = {
  invoiceNumber: "INV-88412",
  vendorName: "Orthomedix Surgical",
  invoiceDate: "2026-03-14",
  poNumber: "PO-LSC-20931",
  lineItems: [
    { vendorItemNo: "OMX-HIP-1102", description: "Acetabular Shell 54mm", quantity: 2, unitPrice: 1840.5 },
    { vendorItemNo: "OMX-SPN-0071", description: "Pedicle Screw 6.5x45", quantity: 8, unitPrice: 312.25 },
  ],
  tax: 0,
  shipping: 45,
  discount: 120,
}

beforeAll(async () => {
  invoicePdf = await buildTextPdf([
    [
      "INVOICE INV-88412",
      "Orthomedix Surgical - Remit To: PO Box 100",
      "Bill To: Lighthouse Surgical Center   PO: PO-LSC-20931   Date: 03/14/2026",
      "OMX-HIP-1102  Acetabular Shell 54mm   2  $1,840.50",
      "OMX-SPN-0071  Pedicle Screw 6.5x45    8  $312.25",
      "Shipping $45.00   Discount ($120.00)   Total $6,177.00",
    ],
  ])
  longInvoicePdf = await multiPagePdf(23, "INVOICE")
})

beforeEach(() => {
  seq += 1
  userId = `invoice-user-${seq}`
  getSession.mockReset().mockResolvedValue({ user: { id: userId, name: null, email: "ap@lighthouse.test" } })
  ai.generateText.mockReset()
  ai.generateObject.mockReset()
  ai.streamObject.mockReset()
  db.member.findFirst.mockReset().mockResolvedValue({
    organization: { facility: { id: "fac-lighthouse" }, vendor: null },
  })
  recordClaudeUsage.mockReset().mockResolvedValue({ recorded: true, creditsUsed: 2, remaining: null })
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function upload(bytes: Uint8Array, name = "INV-88412.pdf", type = "application/pdf") {
  const res = await POST(multipartRequest(URL, { file: fileOf(bytes, name, type) }))
  return { status: res.status, body: (await res.json()) as { success?: boolean; extracted?: ExtractedInvoiceData; error?: string; details?: string } }
}

describe("POST /api/ai/extract-invoice — guards", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    getSession.mockResolvedValue(null)
    expect((await upload(invoicePdf)).status).toBe(401)
    expect(ai.generateText).not.toHaveBeenCalled()
  })

  it("rate-limits a single user to 10 invoice extractions per minute", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await POST(new Request(URL, { method: "POST", body: new FormData() }))).status)
    }
    expect(statuses[9]).toBe(400)
    expect(statuses[10]).toBe(429)
  })

  it("returns 413 from the declared content-length", async () => {
    expect((await POST(oversizeContentLengthRequest(URL))).status).toBe(413)
  })

  it("returns 413 with the size when the file is over 25 MB", async () => {
    const res = await POST(oversizeFileRequest(URL, "big.pdf", "application/pdf", 25 * MB + 1))
    expect(res.status).toBe(413)
    expect(((await res.json()) as { details: string }).details).toMatch(/25\.0MB/)
  })

  it("returns 415 for an EDI or spreadsheet upload without a model call", async () => {
    const { status, body } = await upload(new TextEncoder().encode("ISA*00*"), "invoice.edi", "text/plain")
    expect(status).toBe(415)
    expect(body.error).toBe("Invoice uploads must be PDF")
    expect(ai.generateText).not.toHaveBeenCalled()
  })
})

describe("POST /api/ai/extract-invoice — extraction", () => {
  it("extracts a one-page invoice with a single Sonnet-first structured call", async () => {
    ai.generateText.mockResolvedValue(fakeTextResult(INVOICE))
    const { status, body } = await upload(invoicePdf)
    expect(status).toBe(200)
    expect(body).toEqual({ success: true, extracted: INVOICE })
    expect(ai.generateText).toHaveBeenCalledTimes(1)
    const call = ai.generateText.mock.calls[0]![0]
    expect(call.model).toBe(claudeSonnet)
    expect(promptText(call)).toMatch(/Extract structured data from this vendor invoice/)
    expect(fileParts(call)[0]).toMatchObject({ mediaType: "application/pdf", filename: "INV-88412.pdf" })
  })

  it("falls back to Haiku when Sonnet is rate limited", async () => {
    ai.generateText
      .mockRejectedValueOnce(new Error("429 rate_limit_error"))
      .mockResolvedValueOnce(fakeTextResult(INVOICE))
    const { status } = await upload(invoicePdf)
    expect(status).toBe(200)
    expect(ai.generateText.mock.calls[1]![0].model).toBe(claudeHaiku)
  })

  it("records per-page extraction usage against the caller's facility", async () => {
    ai.generateText.mockResolvedValue(fakeTextResult(INVOICE))
    await upload(invoicePdf)
    expect(recordClaudeUsage).toHaveBeenCalledWith({
      facilityId: "fac-lighthouse",
      vendorId: null,
      userId,
      userName: "ap@lighthouse.test",
      action: "document_extraction_per_page",
      description: "Extracted invoice from INV-88412.pdf",
      quantity: 1,
    })
  })

  it("splits a 23-page invoice into 10/10/3-page parts, extracts them sequentially, and merges", async () => {
    let inFlight = 0
    let peak = 0
    ai.generateText.mockImplementation(async (call) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      const part = fileParts(call)[0]!.filename ?? ""
      const n = Number(part.match(/part (\d)\//)?.[1])
      return fakeTextResult<ExtractedInvoiceData>(
        n === 1
          ? { ...INVOICE, lineItems: [INVOICE.lineItems[0]!] }
          : { invoiceNumber: null, vendorName: null, lineItems: [{ vendorItemNo: `CONT-${n}`, description: null, quantity: 1, unitPrice: 10 }] },
      )
    })
    const { status, body } = await upload(longInvoicePdf, "long.pdf")
    expect(status).toBe(200)
    expect(peak).toBe(1)
    const calls = ai.generateText.mock.calls.map(([c]) => c)
    expect(calls.map((c) => fileParts(c)[0]!.filename)).toEqual([
      "long.pdf (part 1/3)",
      "long.pdf (part 2/3)",
      "long.pdf (part 3/3)",
    ])
    const pageCounts = await Promise.all(
      calls.map(async (c) => (await PDFDocument.load(fileParts(c)[0]!.data as Uint8Array)).getPageCount()),
    )
    expect(pageCounts).toEqual([10, 10, 3])
    expect(promptText(calls[0])).not.toMatch(/continuation chunk/)
    expect(promptText(calls[1])).toMatch(/continuation chunk/)
    expect(body.extracted).toMatchObject({ invoiceNumber: "INV-88412", vendorName: "Orthomedix Surgical", shipping: 45 })
    expect(body.extracted!.lineItems.map((l) => l.vendorItemNo)).toEqual(["OMX-HIP-1102", "CONT-2", "CONT-3"])
    expect(recordClaudeUsage).toHaveBeenCalledWith(expect.objectContaining({ quantity: 23 }))
  })

  it("returns a named 502 and logs context when the model fails", async () => {
    ai.generateText.mockRejectedValue(new Error("Invalid request: credit balance too low"))
    const { status, body } = await upload(invoicePdf)
    expect(status).toBe(502)
    expect(body.error).toBe("AI invoice extraction failed")
    expect(body.details).toContain("credit balance too low")
    expect(consoleError).toHaveBeenCalledWith(
      "[extract-invoice] AI extraction failed:",
      expect.any(Error),
      expect.objectContaining({ userId, file: "INV-88412.pdf", pageCount: 1 }),
    )
    expect(recordClaudeUsage).not.toHaveBeenCalled()
  })

  it("stops after the first failing part of a multi-part invoice", async () => {
    ai.generateText
      .mockResolvedValueOnce(fakeTextResult(INVOICE))
      .mockRejectedValueOnce(new Error("Invalid request: bad pdf"))
    const { status } = await upload(longInvoicePdf, "long.pdf")
    expect(status).toBe(502)
    expect(ai.generateText).toHaveBeenCalledTimes(2)
  })
})
