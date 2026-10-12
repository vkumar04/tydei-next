import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ModelCall } from "../support/ai-route-helpers"

const ai = vi.hoisted(() => ({
  generateObject: vi.fn<(opts: ModelCall) => Promise<unknown>>(),
  generateText: vi.fn<(opts: ModelCall) => Promise<unknown>>(),
  streamObject: vi.fn<(opts: ModelCall) => unknown>(),
}))
const db = vi.hoisted(() => ({ member: { findFirst: vi.fn() } }))
const uploadFile = vi.hoisted(() => vi.fn<(key: string, body: Uint8Array, type: string) => Promise<void>>())
const recordClaudeUsage = vi.hoisted(() => vi.fn())
const getSession = vi.hoisted(() => vi.fn())
const denyUnlessPortalWriter = vi.hoisted(() => vi.fn<(userId: string, portal: "facility" | "vendor") => Promise<Response | null>>())

vi.mock("ai", async (importActual) => ({
  ...(await importActual<typeof import("ai")>()),
  generateObject: ai.generateObject,
  generateText: ai.generateText,
  streamObject: ai.streamObject,
}))
vi.mock("@/lib/db", () => ({ prisma: db }))
vi.mock("@/lib/storage", () => ({ uploadFile }))
vi.mock("@/lib/api/import-route-auth", () => ({ denyUnlessPortalWriter }))
vi.mock("@/lib/ai/record-usage", () => ({ recordClaudeUsage }))
vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: (args: unknown) => getSession(args) } },
}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))

import { POST } from "@/app/api/ai/extract-payor-contract/route"
import { extractedPayorContractSchema, type ExtractedPayorContractData } from "@/lib/ai/schemas"
import { buildCsv, buildTextPdf } from "../support/upload-fixtures"
import {
  MB,
  fakeTextResult,
  fileOf,
  fileParts,
  multipartRequest,
  oversizeContentLengthRequest,
  oversizeFileRequest,
  promptText,
} from "../support/ai-route-helpers"

const URL = "http://localhost/api/ai/extract-payor-contract"

let payorPdf: Uint8Array
let userId: string
let seq = 0

const READ_TEXT = [
  "Payor: Blue Harbor Health Plan. Facility: Lighthouse Surgical Center. Agreement BHHP-ASC-7781.",
  "Effective 2026-06-01, terminates 2029-05-31.",
  "CPT 27447 Total knee arthroplasty: $14,250.00 (6/1/2026-5/31/2027), $14,820.00 (6/1/2027-5/31/2028).",
  "CPT 29881 Knee arthroscopy/meniscectomy: $2,415.00.",
  "Implants paid at invoice cost plus 10%, max $8,000 per case.",
].join("\n")

const PAYOR: ExtractedPayorContractData = extractedPayorContractSchema.parse({
  payorName: "Blue Harbor Health Plan",
  facilityName: "Lighthouse Surgical Center",
  contractNumber: "BHHP-ASC-7781",
  effectiveDate: "2026-06-01",
  expirationDate: "2029-05-31",
  cptRates: [
    { cptCode: "27447", description: "Total knee arthroplasty", rate: 14250, modifier: null, effectiveDate: "2026-06-01" },
    { cptCode: "27447", description: "Total knee arthroplasty", rate: 14820, modifier: null, effectiveDate: "2027-06-01" },
    { cptCode: "29881", description: "Knee arthroscopy/meniscectomy", rate: 2415, modifier: null, effectiveDate: null },
  ],
  grouperRates: [],
  otherTerms: ["Implants paid at invoice cost plus 10%, max $8,000 per case"],
})

beforeAll(async () => {
  payorPdf = await buildTextPdf([READ_TEXT.split("\n")])
})

beforeEach(() => {
  seq += 1
  userId = `payor-user-${seq}`
  getSession.mockReset().mockResolvedValue({ user: { id: userId, name: "Rev Cycle", email: "rcm@lighthouse.test" } })
  denyUnlessPortalWriter.mockReset().mockResolvedValue(null)
  ai.generateText.mockReset()
  ai.generateObject.mockReset()
  ai.streamObject.mockReset()
  db.member.findFirst.mockReset().mockResolvedValue({
    organization: { facility: { id: "fac-lighthouse" }, vendor: null },
  })
  uploadFile.mockReset().mockResolvedValue(undefined)
  recordClaudeUsage.mockReset().mockResolvedValue({ recorded: true, creditsUsed: 25, remaining: null })
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function scriptModel(readText = READ_TEXT, parsed: ExtractedPayorContractData = PAYOR) {
  ai.generateText
    .mockResolvedValueOnce({ text: readText, usage: fakeTextResult(null).usage, finishReason: "stop" })
    .mockResolvedValueOnce(fakeTextResult(parsed))
}

type PayorResponse = { extracted?: ExtractedPayorContractData; confidence?: number; s3Key?: string; error?: string }

async function upload(file: File) {
  const res = await POST(multipartRequest(URL, { file }))
  return { status: res.status, body: (await res.json()) as PayorResponse }
}

describe("POST /api/ai/extract-payor-contract — guards", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    getSession.mockResolvedValue(null)
    expect((await upload(fileOf(payorPdf, "bhhp.pdf", "application/pdf"))).status).toBe(401)
    expect(ai.generateText).not.toHaveBeenCalled()
  })

  it("returns 413 when the file is over 25 MB without archiving or calling the model", async () => {
    const res = await POST(oversizeFileRequest(URL, "bhhp.pdf", "application/pdf", 26 * MB))
    expect(res.status).toBe(413)
    expect(uploadFile).not.toHaveBeenCalled()
    expect(ai.generateText).not.toHaveBeenCalled()
  })

  it(
    "rejects an oversize declared content-length with 413 before buffering the body", async () => {
    expect((await POST(oversizeContentLengthRequest(URL))).status).toBe(413)
  })

  it("rejects a request with no file", async () => {
    expect((await POST(new Request(URL, { method: "POST", body: new FormData() }))).status).toBe(400)
  })

  it("rejects a caller who is not a facility writer", async () => {
    denyUnlessPortalWriter.mockResolvedValue(Response.json({ error: "Not authorized" }, { status: 403 }))
    scriptModel()
    const { status } = await upload(fileOf(payorPdf, "bhhp.pdf", "application/pdf"))
    expect(status).toBe(403)
    expect(uploadFile).not.toHaveBeenCalled()
    expect(ai.generateText).not.toHaveBeenCalled()
    expect(denyUnlessPortalWriter).toHaveBeenCalledWith(userId, "facility")
  })
})

describe("POST /api/ai/extract-payor-contract — extraction", () => {
  it("reads a PDF as a PDF file part, parses it in a second call, and archives under payor-contracts/", async () => {
    scriptModel()
    const { status, body } = await upload(fileOf(payorPdf, "BHHP ASC 2026.pdf", "application/pdf"))
    expect(status).toBe(200)
    expect(body.extracted).toEqual(PAYOR)
    expect(body.s3Key).toMatch(new RegExp(`^payor-contracts/${userId}/\\d+-[0-9a-f]{8}-BHHP_ASC_2026\\.pdf$`))
    expect(uploadFile).toHaveBeenCalledWith(body.s3Key, expect.any(Uint8Array), "application/pdf")

    const [read, parse] = ai.generateText.mock.calls.map(([c]) => c)
    expect(read!.maxOutputTokens).toBe(8000)
    expect(fileParts(read)[0]!.mediaType).toBe("application/pdf")
    expect(fileParts(parse)).toHaveLength(0)
    expect(promptText(parse)).toContain(`Contract information:\n${READ_TEXT}`)

    expect(body.confidence).toBeCloseTo(0.8, 5)
    expect(recordClaudeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        facilityId: "fac-lighthouse",
        vendorId: null,
        userId,
        action: "full_contract_analysis",
        description: "Extracted payor contract from BHHP ASC 2026.pdf",
      }),
    )
  })

  it("sends a CSV rate sheet to the model as text/plain and archives it with its own MIME type", async () => {
    scriptModel()
    const csv = buildCsv([
      ["CPT Code", "Description", "Rate 2026", "Rate 2027"],
      ["27447", "Total knee arthroplasty", 14250, 14820],
      ["29881", "Knee arthroscopy/meniscectomy", 2415, 2415],
    ])
    const { status, body } = await upload(fileOf(csv, "bhhp-rates.csv", "text/csv"))
    expect(status).toBe(200)
    const part = fileParts(ai.generateText.mock.calls[0]![0])[0]!
    expect(part.mediaType).toBe("text/plain")
    expect(new TextDecoder().decode(part.data as Uint8Array)).toContain("27447,Total knee arthroplasty,14250,14820")
    expect(uploadFile).toHaveBeenCalledWith(body.s3Key, expect.any(Uint8Array), "text/csv")
    expect(body.s3Key).toMatch(/^payor-contracts\/.*-bhhp-rates\.csv$/)
  })

  it("sends a .txt contract to the model as text/plain", async () => {
    scriptModel()
    const { status } = await upload(fileOf(READ_TEXT, "bhhp.txt", "text/plain"))
    expect(status).toBe(200)
    expect(fileParts(ai.generateText.mock.calls[0]![0])[0]!.mediaType).toBe("text/plain")
  })

  it("returns 422 when the first read produces no text", async () => {
    ai.generateText.mockResolvedValueOnce({ text: "", usage: fakeTextResult(null).usage, finishReason: "stop" })
    const { status, body } = await upload(fileOf(payorPdf, "bhhp.pdf", "application/pdf"))
    expect(status).toBe(422)
    expect(body.error).toBe("Could not read document")
    expect(ai.generateText).toHaveBeenCalledTimes(1)
  })

  it("returns 500 when the parse call fails", async () => {
    ai.generateText
      .mockResolvedValueOnce({ text: READ_TEXT, usage: fakeTextResult(null).usage, finishReason: "stop" })
      .mockRejectedValueOnce(new Error("Invalid request: bad schema"))
    const { status } = await upload(fileOf(payorPdf, "bhhp.pdf", "application/pdf"))
    expect(status).toBe(500)
    expect(recordClaudeUsage).not.toHaveBeenCalled()
  })
})
