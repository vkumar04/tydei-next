import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import type { ModelCall } from "../support/ai-route-helpers"

const ai = vi.hoisted(() => ({
  generateObject: vi.fn<(opts: ModelCall) => Promise<unknown>>(),
  generateText: vi.fn<(opts: ModelCall) => Promise<unknown>>(),
  streamObject: vi.fn<(opts: ModelCall) => unknown>(),
}))
const db = vi.hoisted(() => ({
  member: { findFirst: vi.fn() },
  contract: { findFirst: vi.fn() },
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
vi.mock("@/lib/db", () => ({ prisma: db }))
vi.mock("@/lib/storage", () => ({ uploadFile }))
vi.mock("@/lib/ai/record-usage", () => ({ recordClaudeUsage }))
vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: (args: unknown) => getSession(args) } },
}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))

import { POST, type ExtractedAmendment } from "@/app/api/ai/extract-amendment/route"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { buildTextPdf } from "../support/upload-fixtures"
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

const URL = "http://localhost/api/ai/extract-amendment"
const CONTRACT_ID = "ctr_omx_2026_0417"
const FACILITY_ID = "fac-lighthouse"

let amendmentPdf: Uint8Array
let userId: string
let seq = 0
let consoleError: MockInstance<typeof console.error>

const AMENDMENT_TEXT = [
  "Amendment No. 1 to Supply and Rebate Agreement OMX-2026-0417.",
  "Effective July 1, 2026 the Expiration Date is extended to December 31, 2029.",
  "Tier 3 rebate increases from 4% to 5%.",
].join("\n")

const DIFF: ExtractedAmendment = {
  effectiveDate: "2026-07-01",
  changes: [
    { field: "expirationDate", label: "Expiration Date", oldValue: "2028-12-31", newValue: "2029-12-31", type: "modified" },
    {
      field: "term:spend_rebate:tier_3_rebatePercent",
      label: "Spend Rebate Tier 3 Rebate %",
      oldValue: "0.04",
      newValue: "0.05",
      type: "modified",
    },
  ],
}

function ownedContract() {
  return {
    id: CONTRACT_ID,
    name: "Orthomedix Supply and Rebate Agreement",
    contractNumber: "OMX-2026-0417",
    contractType: "tie_in",
    status: "active",
    effectiveDate: new Date("2026-01-01T00:00:00Z"),
    expirationDate: new Date("2028-12-31T00:00:00Z"),
    autoRenewal: false,
    terminationNoticeDays: 90,
    totalValue: 1_250_000,
    annualValue: 416_667,
    description: null,
    gpoAffiliation: null,
    performancePeriod: "annual",
    rebatePayPeriod: "annual",
    vendor: { name: "Orthomedix Surgical" },
    productCategory: { name: "Joint Replacement" },
    terms: [
      {
        termName: "Spend Rebate",
        termType: "spend_rebate",
        baselineType: "spend_based",
        evaluationPeriod: "annual",
        paymentTiming: "annual",
        effectiveStart: new Date("2026-01-01T00:00:00Z"),
        effectiveEnd: new Date("2028-12-31T00:00:00Z"),
        spendBaseline: null,
        volumeBaseline: null,
        tiers: [
          { tierNumber: 1, spendMin: 0, spendMax: 499_999, volumeMin: null, volumeMax: null, rebateType: "percent_of_spend", rebateValue: 0.02 },
          { tierNumber: 3, spendMin: 1_000_000, spendMax: null, volumeMin: null, volumeMax: null, rebateType: "percent_of_spend", rebateValue: 0.04 },
        ],
      },
    ],
  }
}

beforeAll(async () => {
  amendmentPdf = await buildTextPdf([AMENDMENT_TEXT.split("\n")])
})

beforeEach(() => {
  seq += 1
  userId = `amend-user-${seq}`
  getSession.mockReset().mockResolvedValue({ user: { id: userId, name: "Dana Buyer", email: "dana@lighthouse.test" } })
  ai.generateText.mockReset()
  ai.generateObject.mockReset()
  ai.streamObject.mockReset()
  db.member.findFirst.mockReset().mockResolvedValue({
    organization: { facility: { id: FACILITY_ID } },
  })
  db.contract.findFirst.mockReset().mockResolvedValue(ownedContract())
  uploadFile.mockReset().mockResolvedValue(undefined)
  recordClaudeUsage.mockReset().mockResolvedValue({ recorded: true, creditsUsed: 25, remaining: null })
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function scriptModel(readText = AMENDMENT_TEXT, diff: ExtractedAmendment = DIFF) {
  ai.generateText
    .mockResolvedValueOnce({ text: readText, usage: fakeTextResult(null).usage, finishReason: "stop" })
    .mockResolvedValueOnce(fakeTextResult(diff))
}

async function upload(file: File, contractId: string | null = CONTRACT_ID) {
  const fields: Record<string, string | File> = { file }
  if (contractId !== null) fields.contractId = contractId
  const res = await POST(multipartRequest(URL, fields))
  return { status: res.status, body: (await res.json()) as Partial<ExtractedAmendment> & { s3Key?: string; error?: string } }
}

const pdfFile = () => fileOf(amendmentPdf, "Amendment 1.pdf", "application/pdf")

describe("POST /api/ai/extract-amendment — guards", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    getSession.mockResolvedValue(null)
    expect((await upload(pdfFile())).status).toBe(401)
    expect(db.contract.findFirst).not.toHaveBeenCalled()
  })

  it("returns 413 from the declared content-length", async () => {
    expect((await POST(oversizeContentLengthRequest(URL))).status).toBe(413)
  })

  it("returns 413 when the file itself is over 25 MB", async () => {
    const res = await POST(oversizeFileRequest(URL, "huge.pdf", "application/pdf", 40 * MB, { contractId: CONTRACT_ID }))
    expect(res.status).toBe(413)
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it("rejects a request with no contractId", async () => {
    expect((await upload(pdfFile(), null)).status).toBe(400)
  })
})

describe("POST /api/ai/extract-amendment — tenant isolation", () => {
  it("scopes the contract lookup to the caller's facility via contractOwnershipWhere", async () => {
    scriptModel()
    await upload(pdfFile())
    expect(db.member.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId } }))
    const where = (db.contract.findFirst.mock.calls[0]![0] as { where: unknown }).where
    expect(where).toEqual(contractOwnershipWhere(CONTRACT_ID, FACILITY_ID))
    expect(where).toEqual({
      id: CONTRACT_ID,
      OR: [{ facilityId: FACILITY_ID }, { contractFacilities: { some: { facilityId: FACILITY_ID } } }],
    })
  })

  it("returns 404 for another tenant's contract without archiving or calling the model", async () => {
    db.contract.findFirst.mockResolvedValue(null)
    const { status, body } = await upload(pdfFile(), "ctr_other_tenant")
    expect(status).toBe(404)
    expect(body.error).toBe("Contract not found")
    expect(uploadFile).not.toHaveBeenCalled()
    expect(ai.generateText).not.toHaveBeenCalled()
  })

  it("returns 403 for a caller with no facility (vendor-portal user) before any contract read", async () => {
    db.member.findFirst.mockResolvedValue({ organization: { facility: null, vendor: { id: "ven-omx" } } })
    const { status } = await upload(pdfFile())
    expect(status).toBe(403)
    expect(db.contract.findFirst).not.toHaveBeenCalled()
    expect(ai.generateText).not.toHaveBeenCalled()
  })

  it("returns 403 for a session with no organization membership", async () => {
    db.member.findFirst.mockResolvedValue(null)
    expect((await upload(pdfFile())).status).toBe(403)
  })
})

describe("POST /api/ai/extract-amendment — extraction", () => {
  it("reads a PDF amendment, diffs it against the current contract, and archives under amendments/", async () => {
    scriptModel()
    const { status, body } = await upload(pdfFile())
    expect(status).toBe(200)
    expect(body.changes).toEqual(DIFF.changes)
    expect(body.effectiveDate).toBe("2026-07-01")
    expect(body.s3Key).toMatch(new RegExp(`^amendments/${userId}/\\d+-[0-9a-f]{8}-Amendment_1\\.pdf$`))
    expect(uploadFile).toHaveBeenCalledWith(body.s3Key, expect.any(Uint8Array), "application/pdf")

    expect(ai.generateText).toHaveBeenCalledTimes(2)
    const [read, compare] = ai.generateText.mock.calls.map(([c]) => c)
    expect(read!.maxOutputTokens).toBe(4000)
    expect(fileParts(read)).toHaveLength(1)
    expect(fileParts(read)[0]!.mediaType).toBe("application/pdf")
    expect((fileParts(read)[0]!.data as Uint8Array).byteLength).toBe(amendmentPdf.byteLength)

    const comparePrompt = promptText(compare)
    expect(fileParts(compare)).toHaveLength(0)
    expect(comparePrompt).toContain("Contract Number: OMX-2026-0417")
    expect(comparePrompt).toContain("Expiration Date: 2028-12-31")
    expect(comparePrompt).toContain("Tier 3: Spend 1000000-unlimited")
    expect(comparePrompt).toContain(`AMENDMENT CONTENT:\n${AMENDMENT_TEXT}`)

    expect(recordClaudeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        facilityId: FACILITY_ID,
        vendorId: null,
        userId,
        action: "full_contract_analysis",
        description: "Extracted amendment for Orthomedix Supply and Rebate Agreement",
      }),
    )
  })

  it("sends a .txt amendment to the model as text/plain", async () => {
    scriptModel()
    const { status, body } = await upload(fileOf(AMENDMENT_TEXT, "amendment-1.txt", "text/plain"))
    expect(status).toBe(200)
    expect(fileParts(ai.generateText.mock.calls[0]![0])[0]!.mediaType).toBe("text/plain")
    expect(body.s3Key).toMatch(/-amendment-1\.txt$/)
    expect(uploadFile).toHaveBeenCalledWith(body.s3Key, expect.any(Uint8Array), "text/plain")
  })

  it("sends an uppercase .PDF upload with no MIME type to the model as a PDF", async () => {
    scriptModel()
    await upload(fileOf(amendmentPdf, "AMENDMENT-1.PDF", ""))
    expect(fileParts(ai.generateText.mock.calls[0]![0])[0]!.mediaType).toBe("application/pdf")
  })

  it("returns 422 without a second model call when the document reads as empty", async () => {
    ai.generateText.mockResolvedValueOnce({ text: "", usage: fakeTextResult(null).usage, finishReason: "stop" })
    const { status, body } = await upload(pdfFile())
    expect(status).toBe(422)
    expect(body.error).toBe("Could not read amendment document")
    expect(ai.generateText).toHaveBeenCalledTimes(1)
    expect(recordClaudeUsage).not.toHaveBeenCalled()
  })

  it("returns 500 and logs when the comparison call fails", async () => {
    ai.generateText
      .mockResolvedValueOnce({ text: AMENDMENT_TEXT, usage: fakeTextResult(null).usage, finishReason: "stop" })
      .mockRejectedValueOnce(new Error("Invalid request: context window exceeded"))
    const { status } = await upload(pdfFile())
    expect(status).toBe(500)
    expect(consoleError).toHaveBeenCalled()
    expect(recordClaudeUsage).not.toHaveBeenCalled()
  })

  it("names the amendment action in the client error and server log when the model fails", async () => {
    ai.generateText.mockRejectedValueOnce(new Error("Invalid request: context window exceeded"))
    const { body } = await upload(pdfFile())
    expect(body.error).toMatch(/amendment/i)
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("[extract-amendment]"), expect.anything(), expect.anything())
  })
})
