import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
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

import { POST } from "@/app/api/ai/classify-document/route"
import {
  buildCsv,
  buildTextPdf,
  buildXlsx,
  cogFixtureRows,
  cogMatrix,
  contractPdfLines,
} from "../support/upload-fixtures"
import {
  MB,
  fakeTextResult,
  fileOf,
  fileParts,
  multipartRequest,
  oversizeFileRequest,
} from "../support/ai-route-helpers"

const URL = "http://localhost/api/ai/classify-document"
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

type Classified = {
  type?: string
  classification?: string
  confidence?: number
  vendorName?: string | null
  contractName?: string | null
  year?: number | null
  quarter?: number | null
  month?: number | null
  dataPeriod?: string | null
  isDuplicate?: boolean
  error?: string
}

let contractPdf: Uint8Array
let cogXlsx: Buffer
let userId: string
let seq = 0
let consoleError: MockInstance<typeof console.error>

beforeAll(async () => {
  contractPdf = await buildTextPdf(contractPdfLines())
  cogXlsx = await buildXlsx(cogMatrix(cogFixtureRows(5)))
})

beforeEach(() => {
  seq += 1
  userId = `classify-user-${seq}`
  getSession.mockReset().mockResolvedValue({ user: { id: userId, name: "Dana Buyer", email: "dana@lighthouse.test" } })
  ai.generateText.mockReset()
  ai.generateObject.mockReset()
  ai.streamObject.mockReset()
  db.member.findFirst.mockReset().mockResolvedValue({
    organization: { facility: { id: "fac-lighthouse" }, vendor: null },
  })
  recordClaudeUsage.mockReset().mockResolvedValue({ recorded: true, creditsUsed: 5, remaining: null })
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function classify(file: File, fileName?: string) {
  const fields: Record<string, string | File> = { file }
  if (fileName) fields.fileName = fileName
  const res = await POST(multipartRequest(URL, fields))
  return { status: res.status, body: (await res.json()) as Classified }
}

function expectNoModelCall() {
  expect(ai.generateText).not.toHaveBeenCalled()
  expect(ai.generateObject).not.toHaveBeenCalled()
  expect(ai.streamObject).not.toHaveBeenCalled()
  expect(recordClaudeUsage).not.toHaveBeenCalled()
}

describe("POST /api/ai/classify-document — guards", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    getSession.mockResolvedValue(null)
    expect((await classify(fileOf(contractPdf, "omx.pdf", "application/pdf"))).status).toBe(401)
    expectNoModelCall()
  })

  it("returns 413 for a file over 25 MB", async () => {
    const res = await POST(oversizeFileRequest(URL, "huge.pdf", "application/pdf", 26 * MB))
    expect(res.status).toBe(413)
    expectNoModelCall()
  })
})

describe("POST /api/ai/classify-document — CSV header heuristics (no AI)", () => {
  it("classifies a PO + vendor + unit cost CSV as COG data", async () => {
    const { status, body } = await classify(fileOf(buildCsv(cogMatrix(cogFixtureRows(3))), "cog-export.csv", "text/csv"))
    expect(status).toBe(200)
    expect(body).toMatchObject({ type: "cog_data", classification: "cog_data", confidence: 0.92, isDuplicate: false })
    expectNoModelCall()
  })

  it("classifies a Case ID + CPT Code CSV as case procedures", async () => {
    const csv = buildCsv([["Case ID", "CPT Code", "Primary"], ["C-1", "27447", "Y"]])
    const { body } = await classify(fileOf(csv, "procedures.csv", "text/csv"))
    expect(body).toMatchObject({ classification: "case_procedures", confidence: 0.95 })
    expectNoModelCall()
  })

  it("classifies an MRN + Case ID + Surgeon CSV as patient case data", async () => {
    const csv = buildCsv([["Patient MRN", "Case ID", "Surgeon", "Date of Surgery"], ["M1", "C-1", "Dr. Ruiz", "2026-03-01"]])
    expect((await classify(fileOf(csv, "cases.csv", "text/csv"))).body.classification).toBe("case_data")
    expectNoModelCall()
  })

  it("classifies a vendor item + contract price CSV as a pricing file", async () => {
    const csv = buildCsv([["Vendor Item No", "Description", "Contract Price"], ["OMX-HIP-1102", "Shell", 1840.5]])
    expect((await classify(fileOf(csv, "omx.csv", "text/csv"))).body).toMatchObject({ classification: "pricing_file", confidence: 0.92 })
    expectNoModelCall()
  })

  it("reads quoted headers", async () => {
    const csv = Buffer.from('"Invoice Number","Line Item","Amount"\n"INV-1","1","10.00"\n')
    expect((await classify(fileOf(csv, "inv.csv", "text/csv"))).body.classification).toBe("invoice")
  })

  it("falls back to unknown with zero confidence for unrecognized headers", async () => {
    const csv = buildCsv([["Alpha", "Beta"], ["1", "2"]])
    expect((await classify(fileOf(csv, "misc.csv", "text/csv"))).body).toMatchObject({ classification: "unknown", confidence: 0 })
    expectNoModelCall()
  })
})

describe("POST /api/ai/classify-document — spreadsheet filename heuristics (no AI)", () => {
  it("prefers 'price' over 'cog' in an .xlsx filename", async () => {
    const { body } = await classify(fileOf(cogXlsx, "Cogsart01012024 Price file.xlsx", XLSX_TYPE))
    expect(body).toMatchObject({ classification: "pricing_file", confidence: 0.78 })
    expectNoModelCall()
  })

  it("reads COG type and quarter/year period from an .xlsx filename", async () => {
    const { body } = await classify(fileOf(cogXlsx, "Q3 2026 COG usage.xlsx", XLSX_TYPE))
    expect(body).toMatchObject({ classification: "cog_data", confidence: 0.75, year: 2026, quarter: 3, dataPeriod: "Q3 2026" })
    expectNoModelCall()
  })

  it("reads a month period from a legacy .xls invoice filename", async () => {
    const { body } = await classify(fileOf(Buffer.from([0xd0, 0xcf]), "invoice-october-2025.xls", "application/vnd.ms-excel"))
    expect(body).toMatchObject({ classification: "invoice", month: 10, year: 2025, dataPeriod: "October 2025" })
    expectNoModelCall()
  })

  it("uses the client-supplied fileName over the uploaded blob name", async () => {
    const { body } = await classify(fileOf(cogXlsx, "blob", XLSX_TYPE), "Stryker pricing 2026.xlsx")
    expect(body.classification).toBe("pricing_file")
    expectNoModelCall()
  })

  it("returns unknown for an .xlsx with no keyword in its name", async () => {
    expect((await classify(fileOf(cogXlsx, "export.xlsx", XLSX_TYPE))).body.classification).toBe("unknown")
    expectNoModelCall()
  })

  it("does not infer March from the word 'summary' in a filename", async () => {
    const { body } = await classify(fileOf(cogXlsx, "Pricing Summary 2026.xlsx", XLSX_TYPE))
    expect(body.month).toBeNull()
    expect(body.dataPeriod).toBe("Year 2026")
  })
})

describe("POST /api/ai/classify-document — PDF (AI)", () => {
  it("classifies a PDF with one structured model call and fills period fields from the filename", async () => {
    ai.generateText.mockResolvedValue(
      fakeTextResult({
        type: "contract",
        confidence: 0.94,
        vendorName: "Orthomedix Surgical",
        documentDate: "2026-01-01",
        contractName: "Supply and Rebate Agreement",
        invoiceNumber: null,
        poNumber: null,
        suggestedCategory: "Joint Replacement",
        dataPeriod: null,
        year: null,
        quarter: null,
        month: null,
        recordCount: null,
        totalValue: 1_250_000,
        isDuplicate: false,
        duplicateOf: null,
      }),
    )
    const { status, body } = await classify(fileOf(contractPdf, "OMX agreement Q1 2026.pdf", "application/pdf"))
    expect(status).toBe(200)
    expect(ai.generateText).toHaveBeenCalledTimes(1)
    const part = fileParts(ai.generateText.mock.calls[0]![0])[0]!
    expect(part.mediaType).toBe("application/pdf")
    expect((part.data as Uint8Array).byteLength).toBe(contractPdf.byteLength)
    expect(body).toMatchObject({
      type: "contract",
      classification: "contract",
      confidence: 0.94,
      vendorName: "Orthomedix Surgical",
      year: 2026,
      quarter: 1,
      dataPeriod: "Q1 2026",
    })
    expect(recordClaudeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        facilityId: "fac-lighthouse",
        action: "contract_classification",
        description: "Classified OMX agreement Q1 2026.pdf as contract",
      }),
    )
  })

  it("degrades to an unknown classification and logs when the model fails", async () => {
    ai.generateText.mockRejectedValue(new Error("Invalid request: unsupported PDF"))
    const { status, body } = await classify(fileOf(contractPdf, "omx.pdf", "application/pdf"))
    expect(status).toBe(200)
    expect(body).toMatchObject({ classification: "unknown", confidence: 0 })
    expect(consoleError).toHaveBeenCalledWith("[classify-document] AI classification failed:", expect.any(Error))
    expect(recordClaudeUsage).not.toHaveBeenCalled()
  })

  it("returns unknown for an unsupported extension without calling the model", async () => {
    const { body } = await classify(fileOf("x", "contract.docx", "application/octet-stream"))
    expect(body.classification).toBe("unknown")
    expectNoModelCall()
  })
})
