import { ImportValidationError } from "@/lib/imports/import-validation-error"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { buildCsv, buildLegacyXls, buildXlsx, type Cell } from "../support/upload-fixtures"
import { MB, XLSX_TYPE, fileFor, forbidden, postForm, postOversized } from "../support/import-route-harness"
import { ingestProformaMetaSchema } from "@/lib/validators/dividend-proposals"

const { getSession, denyUnlessPortalWriter, ingestProformaMatrix } = vi.hoisted(() => ({
  getSession: vi.fn(),
  denyUnlessPortalWriter: vi.fn(),
  ingestProformaMatrix: vi.fn(),
}))

vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: (args: unknown) => getSession(args) } },
}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("@/lib/api/import-route-auth", () => ({ denyUnlessPortalWriter }))
vi.mock("@/lib/actions/proforma-statements", () => ({ ingestProformaMatrix }))

import { POST } from "@/app/api/import-proforma/route"

const URL = "http://localhost/api/import-proforma"
const RESULT = {
  facilityKey: "adhoc:northside asc",
  facilityLabel: "Northside ASC",
  matchedCount: 5,
  unmatchedLabels: [],
  lineItems: { standardBillingRevenue: 267441411 },
}

function statementRows(): Cell[][] {
  return [
    ["Steady State Proforma"],
    ["Line Item", "Amount", "Per Case"],
    ["Revenue - standard billing rate", 267441411, 22286.78],
    ["Revenue contractual adjustment", "(235,348,442)", "(19,612.37)"],
    ["Salary and benefits", 2987260, 248.94],
    ["Medical supplies and services", 12316248, 1026.35],
    ["Case volume", 12000, 1],
  ]
}

const EXPECTED_XLSX_MATRIX = [
  ["Steady State Proforma"],
  ["Line Item", "Amount", "Per Case"],
  ["Revenue - standard billing rate", "267441411", "22286.78"],
  ["Revenue contractual adjustment", "(235,348,442)", "(19,612.37)"],
  ["Salary and benefits", "2987260", "248.94"],
  ["Medical supplies and services", "12316248", "1026.35"],
  ["Case volume", "12000", "1"],
]

function csvLines(rows: number, columns = 2): string {
  const line = Array.from({ length: columns }, (_, i) => (i === 0 ? "Other line" : String(i))).join(",")
  return `${line}\n`.repeat(rows)
}

function denseXlsxRows(rows: number): Cell[][] {
  return Array.from({ length: rows }, (_, i) => [`Line ${i}`, i + 1])
}

let userSeq = 0
let userId = ""
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  userSeq += 1
  userId = `proforma-user-${userSeq}`
  getSession.mockResolvedValue({ user: { id: userId } })
  denyUnlessPortalWriter.mockResolvedValue(null)
  ingestProformaMatrix.mockResolvedValue(RESULT)
})

function upload(file: File, extra: Record<string, string> = { adhocName: "Northside ASC" }) {
  return postForm(POST, URL, { file, ...extra })
}

function ingestedMatrix(): string[][] {
  const call = ingestProformaMatrix.mock.calls[0]
  if (!call) throw new Error("ingestProformaMatrix was not called")
  return call[0] as string[][]
}

describe("POST /api/import-proforma", () => {
  it("returns 401 when there is no session", async () => {
    getSession.mockResolvedValue(null)
    const { status, body } = await upload(fileFor("p.csv", buildCsv(statementRows())))
    expect(status).toBe(401)
    expect(body).toEqual({ error: "Unauthorized" })
    expect(denyUnlessPortalWriter).not.toHaveBeenCalled()
  })

  it("gates on the vendor portal and returns the gate's 403", async () => {
    denyUnlessPortalWriter.mockImplementation(async () => forbidden())
    const { status, body } = await upload(fileFor("p.csv", buildCsv(statementRows())))
    expect(denyUnlessPortalWriter).toHaveBeenCalledWith(userId, "vendor")
    expect(status).toBe(403)
    expect(body).toEqual({ error: "Not authorized" })
    expect(ingestProformaMatrix).not.toHaveBeenCalled()
  })

  it("returns 400 when the form carries no file", async () => {
    const { status, body } = await postForm(POST, URL, { adhocName: "Northside ASC" })
    expect(status).toBe(400)
    expect(body).toEqual({ error: "No file provided" })
  })

  it("rejects a legacy .xls workbook with 400", async () => {
    const { status, body } = await upload(fileFor("p.xls", buildLegacyXls(statementRows()), "application/vnd.ms-excel"))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
    expect(ingestProformaMatrix).not.toHaveBeenCalled()
  })

  it("rejects a .pdf with 400", async () => {
    const { status, body } = await upload(fileFor("p.pdf", "%PDF-1.7", "application/pdf"))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
  })

  it("rejects a file over 10 MB", async () => {
    const { status, body } = await postOversized(POST, URL, "p.xlsx", 10 * MB + 1, { adhocName: "Northside ASC" })
    expect(status).toBe(400)
    expect(body).toEqual({ error: "File is too large; a P&L statement should be under 10MB." })
    expect(ingestProformaMatrix).not.toHaveBeenCalled()
  })

  it("lets a file of exactly 10 MB through the size gate", async () => {
    const { body } = await postOversized(POST, URL, "p.pdf", 10 * MB)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
  })

  it("hands ingestProformaMatrix the positional .xlsx cell matrix including the title row", async () => {
    const { status, body } = await upload(fileFor("Northside P&L.xlsx", await buildXlsx(statementRows()), XLSX_TYPE), {
      facilityId: "fac-9",
    })
    expect(status).toBe(200)
    expect(body).toEqual(RESULT)
    expect(ingestProformaMatrix).toHaveBeenCalledTimes(1)
    expect(ingestProformaMatrix).toHaveBeenCalledWith(EXPECTED_XLSX_MATRIX, {
      fileName: "Northside P&L.xlsx",
      facilityId: "fac-9",
      adhocName: undefined,
    })
  })

  it("keeps .csv cells positional so a blank-padded title row cannot swap the amount column", async () => {
    const rows: Cell[][] = [
      ["Steady State Proforma", null, null],
      [null, null, null],
      ["Revenue - standard billing rate", "$267,441,411", "22,286.78"],
      ["Medical supplies and services", "12,316,248", "1,026.35"],
    ]
    const { status } = await upload(fileFor("pl.csv", buildCsv(rows), "text/csv"), { adhocName: "  Northside ASC " })
    expect(status).toBe(200)
    expect(ingestProformaMatrix).toHaveBeenCalledWith(
      [
        ["Steady State Proforma", "", ""],
        ["", "", ""],
        ["Revenue - standard billing rate", "$267,441,411", "22,286.78"],
        ["Medical supplies and services", "12,316,248", "1,026.35"],
      ],
      { fileName: "pl.csv", facilityId: undefined, adhocName: "Northside ASC" },
    )
  })

  it("forwards an empty facility id and whitespace ad-hoc name as undefined", async () => {
    await upload(fileFor("pl.csv", buildCsv(statementRows())), { facilityId: "", adhocName: "  " })
    expect(ingestProformaMatrix.mock.calls[0]![1]).toEqual({ fileName: "pl.csv", facilityId: undefined, adhocName: undefined })
  })

  it("drops a phantom tail from an .xlsx statement", async () => {
    await upload(fileFor("p.xlsx", await buildXlsx(statementRows(), { phantomTailRows: 1_000, phantomTailColumn: 0 }), XLSX_TYPE))
    expect(ingestedMatrix()).toEqual(EXPECTED_XLSX_MATRIX)
  })

  it("accepts an .xlsx of exactly 5,000 rows", async () => {
    const { status } = await upload(fileFor("max.xlsx", await buildXlsx(denseXlsxRows(5_000)), XLSX_TYPE))
    expect(status).toBe(200)
    expect(ingestedMatrix()).toHaveLength(5_000)
  })

  it("rejects an .xlsx of 5,001 rows before ingest", async () => {
    const { status, body } = await upload(fileFor("over.xlsx", await buildXlsx(denseXlsxRows(5_001)), XLSX_TYPE))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Spreadsheet exceeds the 5,000-row limit. Split it into smaller files." })
    expect(ingestProformaMatrix).not.toHaveBeenCalled()
  })

  it("accepts a .csv of exactly 5,000 rows", async () => {
    const { status } = await upload(fileFor("max.csv", csvLines(5_000)))
    expect(status).toBe(200)
    expect(ingestedMatrix()).toHaveLength(5_000)
  })

  it(
    "rejects a .csv of 5,001 rows before ingest", async () => {
    const { status } = await upload(fileFor("over.csv", csvLines(5_001)))
    expect(status).toBe(400)
    expect(ingestProformaMatrix).not.toHaveBeenCalled()
  })

  it("rejects a .csv of 5,002 rows before ingest", async () => {
    const { status, body } = await upload(fileFor("over.csv", csvLines(5_002)))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "CSV has more than 5,000 rows; max is 5,000. Split it into smaller files." })
    expect(ingestProformaMatrix).not.toHaveBeenCalled()
  })

  it("accepts a .csv of exactly 32 columns", async () => {
    const { status } = await upload(fileFor("wide.csv", csvLines(3, 32)))
    expect(status).toBe(200)
  })

  it("rejects a .csv whose first row has 33 columns", async () => {
    const { status, body } = await upload(fileFor("wide.csv", csvLines(3, 33)))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "CSV header has 33 fields; max is 32. This does not look like a tabular export." })
    expect(ingestProformaMatrix).not.toHaveBeenCalled()
  })

  it("returns 400 'File contains no rows' for a blank .csv", async () => {
    const { status, body } = await upload(fileFor("blank.csv", "\n \n\n"))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "File contains no rows" })
  })

  it("returns 400 'File contains no rows' for an empty .xlsx", async () => {
    const { status, body } = await upload(fileFor("blank.xlsx", await buildXlsx([]), XLSX_TYPE))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "File contains no rows" })
  })

  it("explains a CSV that was renamed to .xlsx", async () => {
    const { status, body } = await upload(fileFor("renamed.xlsx", buildCsv(statementRows()), XLSX_TYPE))
    expect(status).toBe(400)
    expect(body.error).toMatch(/rename the extension to \.csv/i)
  })

  it("surfaces 'Facility not found' from the action as a 400", async () => {
    ingestProformaMatrix.mockRejectedValue(new ImportValidationError("Facility not found"))
    const { status, body } = await upload(fileFor("p.csv", buildCsv(statementRows())), { facilityId: "fac-x" })
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Facility not found" })
  })

  it("surfaces the meta schema's exactly-one refinement as a 400", async () => {
    const parsed = ingestProformaMetaSchema.safeParse({ fileName: "p.csv", facilityId: "fac-1", adhocName: "Both" })
    if (parsed.success) throw new Error("expected the meta schema to reject")
    ingestProformaMatrix.mockRejectedValue(parsed.error)
    const { status, body } = await upload(fileFor("p.csv", buildCsv(statementRows())), { facilityId: "fac-1", adhocName: "Both" })
    expect(status).toBe(400)
    expect(String(body.error)).toContain("Provide exactly one of facilityId or adhocName")
  })

  it("surfaces out-of-range amounts as a 400", async () => {
    const message = "The statement contains out-of-range amounts. Check for values that are not plain numbers."
    ingestProformaMatrix.mockRejectedValue(new ImportValidationError(message))
    const { status, body } = await upload(fileFor("p.csv", buildCsv(statementRows())))
    expect(status).toBe(400)
    expect(body).toEqual({ error: message })
  })

  it("surfaces the action's 'Only N P&L lines were recognized' error as a 400", async () => {
    const message =
      'Only 2 P&L lines were recognized (missing medicalSupplies). The file should have one row per line item, with the label in one column and the amount in another — e.g. "Medical supplies and services | 12,316,248".'
    ingestProformaMatrix.mockRejectedValue(new ImportValidationError(message))
    const { status, body } = await upload(fileFor("p.csv", buildCsv(statementRows())))
    expect(status).toBe(400)
    expect(body).toEqual({ error: message })
  })

  it("hides an unknown action failure behind a generic 500", async () => {
    ingestProformaMatrix.mockRejectedValue(new Error("Failed to save the P&L statement"))
    const { status, body } = await upload(fileFor("p.csv", buildCsv(statementRows())))
    expect(status).toBe(500)
    expect(body).toEqual({ error: "Import failed" })
    expect(console.error).toHaveBeenCalledWith("[/api/import-proforma]", expect.any(Error))
  })

  it("rate-limits a single user at 10 imports per minute", async () => {
    const bytes = buildCsv(statementRows())
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await upload(fileFor("r.csv", bytes))).status)
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200))
    expect(statuses[10]).toBe(429)
  })
})
