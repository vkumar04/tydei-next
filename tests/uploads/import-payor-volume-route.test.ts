import { ImportValidationError } from "@/lib/imports/import-validation-error"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { buildCsv, buildLegacyXls, buildXlsx, type Cell } from "../support/upload-fixtures"
import { MB, XLSX_TYPE, fileFor, forbidden, postForm, postOversized } from "../support/import-route-harness"
import { ingestPayorVolumeMetaSchema } from "@/lib/validators/dividend-proposals"

const { getSession, denyUnlessPortalWriter, ingestPayorVolumeRows } = vi.hoisted(() => ({
  getSession: vi.fn(),
  denyUnlessPortalWriter: vi.fn(),
  ingestPayorVolumeRows: vi.fn(),
}))

vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: (args: unknown) => getSession(args) } },
}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("@/lib/api/import-route-auth", () => ({ denyUnlessPortalWriter }))
vi.mock("@/lib/actions/payor-volume", () => ({ ingestPayorVolumeRows }))

import { POST } from "@/app/api/import-payor-volume/route"

const URL = "http://localhost/api/import-payor-volume"
const RESULT = { facilityKey: "adhoc:northside asc", facilityLabel: "Northside ASC", groupCount: 2, totalAnnualizedVolume: 124 }
const HEADER: Cell[] = ["Procedure Group", "Year", "Quarter", "Volume"]

function volumeMatrix(): Cell[][] {
  return [HEADER, ["Total Knee", 2025, "Q1", 10], ["Total Knee", 2025, "Q2", 20], ["Hip Arthroscopy", 2025, "Q1", 5]]
}

const EXPECTED_ROWS = [
  { "Procedure Group": "Total Knee", Year: "2025", Quarter: "Q1", Volume: "10" },
  { "Procedure Group": "Total Knee", Year: "2025", Quarter: "Q2", Volume: "20" },
  { "Procedure Group": "Hip Arthroscopy", Year: "2025", Quarter: "Q1", Volume: "5" },
]

function bulkCsv(dataRows: number, columns = 4): string {
  const header = Array.from({ length: columns }, (_, i) => (i < 4 ? String(HEADER[i]) : `Extra ${i}`)).join(",")
  const line = Array.from({ length: columns }, (_, i) => (i === 0 ? "Knee" : i === 1 ? "2025" : i === 2 ? "1" : "1")).join(",")
  return `${header}\n${`${line}\n`.repeat(dataRows)}`
}

let userSeq = 0
let userId = ""
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  userSeq += 1
  userId = `payor-user-${userSeq}`
  getSession.mockResolvedValue({ user: { id: userId } })
  denyUnlessPortalWriter.mockResolvedValue(null)
  ingestPayorVolumeRows.mockResolvedValue(RESULT)
})

function upload(file: File, extra: Record<string, string> = { adhocName: "Northside ASC" }) {
  return postForm(POST, URL, { file, ...extra })
}

describe("POST /api/import-payor-volume", () => {
  it("returns 401 when there is no session", async () => {
    getSession.mockResolvedValue(null)
    const { status, body } = await upload(fileFor("v.csv", buildCsv(volumeMatrix())))
    expect(status).toBe(401)
    expect(body).toEqual({ error: "Unauthorized" })
    expect(denyUnlessPortalWriter).not.toHaveBeenCalled()
  })

  it("gates on the vendor portal and returns the gate's 403", async () => {
    denyUnlessPortalWriter.mockImplementation(async () => forbidden())
    const { status, body } = await upload(fileFor("v.csv", buildCsv(volumeMatrix())))
    expect(denyUnlessPortalWriter).toHaveBeenCalledWith(userId, "vendor")
    expect(status).toBe(403)
    expect(body).toEqual({ error: "Not authorized" })
    expect(ingestPayorVolumeRows).not.toHaveBeenCalled()
  })

  it("returns 400 when the form carries no file", async () => {
    const { status, body } = await postForm(POST, URL, { adhocName: "Northside ASC" })
    expect(status).toBe(400)
    expect(body).toEqual({ error: "No file provided" })
  })

  it("rejects a legacy .xls workbook with 400", async () => {
    const { status, body } = await upload(fileFor("v.xls", buildLegacyXls(volumeMatrix()), "application/vnd.ms-excel"))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
    expect(ingestPayorVolumeRows).not.toHaveBeenCalled()
  })

  it("rejects a .pdf with 400", async () => {
    const { status, body } = await upload(fileFor("v.pdf", "%PDF-1.7", "application/pdf"))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
  })

  it("rejects a file over 20 MB", async () => {
    const { status, body } = await postOversized(POST, URL, "v.xlsx", 20 * MB + 1, { adhocName: "Northside ASC" })
    expect(status).toBe(400)
    expect(body).toEqual({ error: "File is too large; payor volume files should be under 20MB." })
    expect(ingestPayorVolumeRows).not.toHaveBeenCalled()
  })

  it("lets a file of exactly 20 MB through the size gate", async () => {
    const { body } = await postOversized(POST, URL, "v.pdf", 20 * MB)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
  })

  it("passes .xlsx rows and the facility id to ingestPayorVolumeRows", async () => {
    const { status, body } = await upload(fileFor("Payor Q1.xlsx", await buildXlsx(volumeMatrix()), XLSX_TYPE), {
      facilityId: "fac-123",
    })
    expect(status).toBe(200)
    expect(body).toEqual(RESULT)
    expect(ingestPayorVolumeRows).toHaveBeenCalledTimes(1)
    expect(ingestPayorVolumeRows).toHaveBeenCalledWith(EXPECTED_ROWS, {
      fileName: "Payor Q1.xlsx",
      facilityId: "fac-123",
      adhocName: undefined,
    })
  })

  it("passes .csv rows with a trimmed ad-hoc name and drops an empty facility id", async () => {
    const { status } = await upload(fileFor("payor.csv", buildCsv(volumeMatrix()), "text/csv"), {
      facilityId: "",
      adhocName: "  Northside ASC  ",
    })
    expect(status).toBe(200)
    expect(ingestPayorVolumeRows).toHaveBeenCalledWith(EXPECTED_ROWS, {
      fileName: "payor.csv",
      facilityId: undefined,
      adhocName: "Northside ASC",
    })
  })

  it("forwards neither facility id nor a whitespace-only ad-hoc name", async () => {
    await upload(fileFor("payor.csv", buildCsv(volumeMatrix())), { adhocName: "   " })
    expect(ingestPayorVolumeRows).toHaveBeenCalledWith(EXPECTED_ROWS, {
      fileName: "payor.csv",
      facilityId: undefined,
      adhocName: undefined,
    })
  })

  it("trims a phantom tail from an .xlsx before ingest", async () => {
    await upload(fileFor("v.xlsx", await buildXlsx(volumeMatrix(), { phantomTailRows: 2_000, phantomTailColumn: 0 }), XLSX_TYPE))
    expect(ingestPayorVolumeRows.mock.calls[0]![0]).toEqual(EXPECTED_ROWS)
  })

  it(
    "finds the real header row below report title rows in an .xlsx", async () => {
    const { status } = await upload(
      fileFor("titled.xlsx", await buildXlsx(volumeMatrix(), { titleRows: ["Aetna Payor Volume Report"] }), XLSX_TYPE),
    )
    expect(status).toBe(200)
    expect(ingestPayorVolumeRows.mock.calls[0]![0]).toEqual(EXPECTED_ROWS)
  })

  it("accepts a .csv of exactly 50,000 data rows", async () => {
    const { status } = await upload(fileFor("max.csv", bulkCsv(50_000)))
    expect(status).toBe(200)
    expect(ingestPayorVolumeRows.mock.calls[0]![0]).toHaveLength(50_000)
  })

  it("rejects a .csv of 50,001 data rows before ingest", async () => {
    const { status, body } = await upload(fileFor("over.csv", bulkCsv(50_001)))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "CSV has more than 50,000 rows; max is 50,000. Split it into smaller files." })
    expect(ingestPayorVolumeRows).not.toHaveBeenCalled()
  })

  it("accepts a .csv of exactly 64 columns", async () => {
    const { status } = await upload(fileFor("wide.csv", bulkCsv(2, 64)))
    expect(status).toBe(200)
  })

  it("rejects a .csv whose header has 65 columns", async () => {
    const { status, body } = await upload(fileFor("wide.csv", bulkCsv(2, 65)))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "CSV header has 65 fields; max is 64. This does not look like a tabular export." })
    expect(ingestPayorVolumeRows).not.toHaveBeenCalled()
  })

  it("rejects a .csv data row with 65 fields under a normal header", async () => {
    const text = `${HEADER.join(",")}\nKnee,2025,1,4\n${Array(65).fill("x").join(",")}\n`
    const { status, body } = await upload(fileFor("ragged.csv", text))
    expect(status).toBe(400)
    expect(body.error).toBe("CSV row 2 has 65 fields; max is 64. This does not look like a tabular export.")
  })

  it("returns 400 'CSV has no data rows' for a header-only .csv", async () => {
    const { status, body } = await upload(fileFor("h.csv", buildCsv([HEADER])))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "CSV has no data rows" })
  })

  it("returns 400 'File contains no data rows' for a header-only .xlsx", async () => {
    const { status, body } = await upload(fileFor("h.xlsx", await buildXlsx([HEADER]), XLSX_TYPE))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "File contains no data rows" })
  })

  it("surfaces 'Facility not found' from the action as a 400", async () => {
    ingestPayorVolumeRows.mockRejectedValue(new ImportValidationError("Facility not found"))
    const { status, body } = await upload(fileFor("v.csv", buildCsv(volumeMatrix())), { facilityId: "fac-other-vendor" })
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Facility not found" })
  })

  it("surfaces the action's xlsx row cap as a 400", async () => {
    ingestPayorVolumeRows.mockRejectedValue(new ImportValidationError("The file has 50,001 rows; max is 50,000"))
    const { status, body } = await upload(fileFor("v.csv", buildCsv(volumeMatrix())))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "The file has 50,001 rows; max is 50,000" })
  })

  it("surfaces the meta schema's exactly-one refinement as a 400", async () => {
    const parsed = ingestPayorVolumeMetaSchema.safeParse({ fileName: "v.csv" })
    if (parsed.success) throw new Error("expected the meta schema to reject")
    ingestPayorVolumeRows.mockRejectedValue(parsed.error)
    const { status, body } = await upload(fileFor("v.csv", buildCsv(volumeMatrix())), {})
    expect(status).toBe(400)
    expect(String(body.error)).toContain("Provide exactly one of facilityId or adhocName")
  })

  it("surfaces 'No procedure groups found' as a 400", async () => {
    const message = "No procedure groups found. Expected columns: Procedure Group, Year, Quarter, Volume."
    ingestPayorVolumeRows.mockRejectedValue(new ImportValidationError(message))
    const { status, body } = await upload(fileFor("v.csv", buildCsv(volumeMatrix())))
    expect(status).toBe(400)
    expect(body).toEqual({ error: message })
  })

  it("surfaces the action's out-of-range volume error as a 400", async () => {
    const message = "The file contains out-of-range values (volumes must be non-negative numbers)."
    ingestPayorVolumeRows.mockRejectedValue(new ImportValidationError(message))
    const { status, body } = await upload(fileFor("v.csv", buildCsv(volumeMatrix())))
    expect(status).toBe(400)
    expect(body).toEqual({ error: message })
  })

  it("hides an unknown action failure behind a generic 500", async () => {
    ingestPayorVolumeRows.mockRejectedValue(new Error("Failed to save the payor volume dataset"))
    const { status, body } = await upload(fileFor("v.csv", buildCsv(volumeMatrix())))
    expect(status).toBe(500)
    expect(body).toEqual({ error: "Import failed" })
    expect(console.error).toHaveBeenCalledWith("[/api/import-payor-volume]", expect.any(Error))
  })

  it("rate-limits a single user at 10 imports per minute", async () => {
    const bytes = buildCsv(volumeMatrix())
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await upload(fileFor("r.csv", bytes))).status)
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200))
    expect(statuses[10]).toBe(429)
  })
})
