import { ImportValidationError } from "@/lib/imports/import-validation-error"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { buildCsv, buildLegacyXls, buildXlsx, type Cell } from "../support/upload-fixtures"
import { MB, XLSX_TYPE, fileFor, forbidden, postForm, postOversized } from "../support/import-route-harness"
import { ingestMedicareRatesMetaSchema } from "@/lib/validators/dividend-proposals"

const { getSession, denyUnlessPortalWriter, ingestMedicareRateRows } = vi.hoisted(() => ({
  getSession: vi.fn(),
  denyUnlessPortalWriter: vi.fn(),
  ingestMedicareRateRows: vi.fn(),
}))

vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: (args: unknown) => getSession(args) } },
}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("@/lib/api/import-route-auth", () => ({ denyUnlessPortalWriter }))
vi.mock("@/lib/actions/medicare-rate-sets", () => ({ ingestMedicareRateRows }))

import { POST } from "@/app/api/import-medicare-rates/route"

const URL = "http://localhost/api/import-medicare-rates"
const RESULT = { id: "rs-1", name: "CY2026 National", rateCount: 2, skipped: 0 }
const HEADER: Cell[] = ["Procedure Group", "CPT Code", "Medicare Rate"]

function rateMatrix(): Cell[][] {
  return [HEADER, ["Total Knee Arthroplasty", "27447", 9876.54], ["Knee Arthroscopy", "29881", "$2,101.10"]]
}

const EXPECTED_ROWS = [
  { "Procedure Group": "Total Knee Arthroplasty", "CPT Code": "27447", "Medicare Rate": "9876.54" },
  { "Procedure Group": "Knee Arthroscopy", "CPT Code": "29881", "Medicare Rate": "$2,101.10" },
]

function bulkCsv(dataRows: number, columns = 3): string {
  const header = Array.from({ length: columns }, (_, i) => (i < 3 ? String(HEADER[i]) : `Extra ${i}`)).join(",")
  const line = Array.from({ length: columns }, (_, i) => (i === 0 ? "Knee" : i === 1 ? "27447" : "100")).join(",")
  return `${header}\n${`${line}\n`.repeat(dataRows)}`
}

let userSeq = 0
let userId = ""
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  userSeq += 1
  userId = `medicare-user-${userSeq}`
  getSession.mockResolvedValue({ user: { id: userId } })
  denyUnlessPortalWriter.mockResolvedValue(null)
  ingestMedicareRateRows.mockResolvedValue(RESULT)
})

function upload(file: File, extra: Record<string, string> = { name: "CY2026 National" }) {
  return postForm(POST, URL, { file, ...extra })
}

describe("POST /api/import-medicare-rates", () => {
  it("returns 401 when there is no session", async () => {
    getSession.mockResolvedValue(null)
    const { status, body } = await upload(fileFor("r.csv", buildCsv(rateMatrix())))
    expect(status).toBe(401)
    expect(body).toEqual({ error: "Unauthorized" })
    expect(denyUnlessPortalWriter).not.toHaveBeenCalled()
  })

  it("gates on the vendor portal and returns the gate's 403", async () => {
    denyUnlessPortalWriter.mockImplementation(async () => forbidden())
    const { status, body } = await upload(fileFor("r.csv", buildCsv(rateMatrix())))
    expect(denyUnlessPortalWriter).toHaveBeenCalledWith(userId, "vendor")
    expect(status).toBe(403)
    expect(body).toEqual({ error: "Not authorized" })
    expect(ingestMedicareRateRows).not.toHaveBeenCalled()
  })

  it("returns 400 when the form carries no file", async () => {
    const { status, body } = await postForm(POST, URL, { name: "CY2026 National" })
    expect(status).toBe(400)
    expect(body).toEqual({ error: "No file provided" })
  })

  it("returns 400 when the rate set has no name", async () => {
    const { status, body } = await upload(fileFor("r.csv", buildCsv(rateMatrix())), {})
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Give the rate set a name, e.g. "CY2026 National"' })
  })

  it("returns 400 when the rate set name is only whitespace", async () => {
    const { status, body } = await upload(fileFor("r.csv", buildCsv(rateMatrix())), { name: "   " })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Give the rate set a name, e.g. "CY2026 National"' })
    expect(ingestMedicareRateRows).not.toHaveBeenCalled()
  })

  it("rejects a legacy .xls workbook with 400", async () => {
    const { status, body } = await upload(fileFor("r.xls", buildLegacyXls(rateMatrix()), "application/vnd.ms-excel"))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
  })

  it("rejects a .pdf with 400", async () => {
    const { status, body } = await upload(fileFor("r.pdf", "%PDF-1.7", "application/pdf"))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
  })

  it("rejects a file over 20 MB", async () => {
    const { status, body } = await postOversized(POST, URL, "r.xlsx", 20 * MB + 1, { name: "CY2026 National" })
    expect(status).toBe(400)
    expect(body).toEqual({ error: "File is too large; rate tables should be under 20MB." })
    expect(ingestMedicareRateRows).not.toHaveBeenCalled()
  })

  it("lets a file of exactly 20 MB through the size gate", async () => {
    const { body } = await postOversized(POST, URL, "r.pdf", 20 * MB, { name: "CY2026 National" })
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
  })

  it("passes .xlsx rows, the file name, and the trimmed set name to ingestMedicareRateRows", async () => {
    const { status, body } = await upload(fileFor("CMS ASC 2026.xlsx", await buildXlsx(rateMatrix()), XLSX_TYPE), {
      name: "  CY2026 National  ",
    })
    expect(status).toBe(200)
    expect(body).toEqual(RESULT)
    expect(ingestMedicareRateRows).toHaveBeenCalledTimes(1)
    expect(ingestMedicareRateRows).toHaveBeenCalledWith(EXPECTED_ROWS, { fileName: "CMS ASC 2026.xlsx", name: "CY2026 National" })
  })

  it("passes .csv rows to ingestMedicareRateRows", async () => {
    const { status } = await upload(fileFor("rates.csv", buildCsv(rateMatrix()), "text/csv"))
    expect(status).toBe(200)
    expect(ingestMedicareRateRows).toHaveBeenCalledWith(EXPECTED_ROWS, { fileName: "rates.csv", name: "CY2026 National" })
  })

  it("trims a phantom tail from an .xlsx before ingest", async () => {
    await upload(fileFor("r.xlsx", await buildXlsx(rateMatrix(), { phantomTailRows: 2_000, phantomTailColumn: 0 }), XLSX_TYPE))
    expect(ingestMedicareRateRows.mock.calls[0]![0]).toEqual(EXPECTED_ROWS)
  })

  it(
    "finds the real header row below report title rows in an .xlsx", async () => {
    const { status } = await upload(
      fileFor("titled.xlsx", await buildXlsx(rateMatrix(), { titleRows: ["CMS ASC Addendum AA - CY2026"] }), XLSX_TYPE),
    )
    expect(status).toBe(200)
    expect(ingestMedicareRateRows.mock.calls[0]![0]).toEqual(EXPECTED_ROWS)
  })

  it("accepts a .csv of exactly 2,000 data rows", async () => {
    const { status } = await upload(fileFor("max.csv", bulkCsv(2_000)))
    expect(status).toBe(200)
    expect(ingestMedicareRateRows.mock.calls[0]![0]).toHaveLength(2_000)
  })

  it("rejects a .csv of 2,001 data rows before ingest", async () => {
    const { status, body } = await upload(fileFor("over.csv", bulkCsv(2_001)))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "CSV has more than 2,000 rows; max is 2,000. Split it into smaller files." })
    expect(ingestMedicareRateRows).not.toHaveBeenCalled()
  })

  it("accepts a .csv of exactly 32 columns", async () => {
    const { status } = await upload(fileFor("wide.csv", bulkCsv(1, 32)))
    expect(status).toBe(200)
  })

  it("rejects a .csv whose header has 33 columns", async () => {
    const { status, body } = await upload(fileFor("wide.csv", bulkCsv(1, 33)))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "CSV header has 33 fields; max is 32. This does not look like a tabular export." })
    expect(ingestMedicareRateRows).not.toHaveBeenCalled()
  })

  it("returns 400 'CSV has no data rows' for a header-only .csv", async () => {
    const { status, body } = await upload(fileFor("h.csv", buildCsv([HEADER])))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "CSV has no data rows" })
  })

  it("surfaces 'No rates were recognized' from the action as a 400", async () => {
    const message = "No rates were recognized. Expected columns: Procedure Group, CPT/HCPCS code, Rate."
    ingestMedicareRateRows.mockRejectedValue(new ImportValidationError(message))
    const { status, body } = await upload(fileFor("r.csv", buildCsv(rateMatrix())))
    expect(status).toBe(400)
    expect(body).toEqual({ error: message })
  })

  it("surfaces out-of-range rate values as a 400", async () => {
    ingestMedicareRateRows.mockRejectedValue(new ImportValidationError("The file contains out-of-range rate values."))
    const { status, body } = await upload(fileFor("r.csv", buildCsv(rateMatrix())))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "The file contains out-of-range rate values." })
  })

  it("surfaces the action's row cap as a 400", async () => {
    ingestMedicareRateRows.mockRejectedValue(new ImportValidationError("The file has 2,001 rows; max is 2,000"))
    const { status, body } = await upload(fileFor("r.csv", buildCsv(rateMatrix())))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "The file has 2,001 rows; max is 2,000" })
  })

  it(
    "rejects a rate-set name over 120 characters with a 400", async () => {
    const parsed = ingestMedicareRatesMetaSchema.safeParse({ fileName: "r.csv", name: "N".repeat(121) })
    if (parsed.success) throw new Error("expected the meta schema to reject")
    ingestMedicareRateRows.mockRejectedValue(parsed.error)
    const { status } = await upload(fileFor("r.csv", buildCsv(rateMatrix())), { name: "N".repeat(121) })
    expect(status).toBe(400)
  })

  it("hides an unknown action failure behind a generic 500", async () => {
    ingestMedicareRateRows.mockRejectedValue(new Error("Failed to save the Medicare rate set"))
    const { status, body } = await upload(fileFor("r.csv", buildCsv(rateMatrix())))
    expect(status).toBe(500)
    expect(body).toEqual({ error: "Import failed" })
    expect(console.error).toHaveBeenCalledWith("[/api/import-medicare-rates]", expect.any(Error))
  })

  it("rate-limits a single user at 10 imports per minute", async () => {
    const bytes = buildCsv(rateMatrix())
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await upload(fileFor("r.csv", bytes))).status)
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200))
    expect(statuses[10]).toBe(429)
  })
})
