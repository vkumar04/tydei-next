import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  buildCsv,
  buildLegacyXls,
  buildXlsx,
  cogFixtureRows,
  cogMatrix,
  COG_HEADER,
  type CogFixtureRow,
} from "../support/upload-fixtures"
import { MB, XLSX_TYPE, fileFor, forbidden, postForm, postOversized } from "../support/import-route-harness"
import { XlsxLimitError } from "@/lib/xlsx/parse-xlsx-bounded"

const { getSession, denyUnlessPortalWriter, ingestCOGRecordsRows } = vi.hoisted(() => ({
  getSession: vi.fn(),
  denyUnlessPortalWriter: vi.fn(),
  ingestCOGRecordsRows: vi.fn(),
}))

vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: (args: unknown) => getSession(args) } },
}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("@/lib/api/import-route-auth", () => ({ denyUnlessPortalWriter }))
vi.mock("@/lib/actions/imports/cog-csv-import", () => ({ ingestCOGRecordsRows }))

import { POST } from "@/app/api/import-cog/route"

const URL = "http://localhost/api/import-cog"
const IMPORT_RESULT = {
  imported: 5,
  overwritten: 0,
  skipped: 0,
  errors: 0,
  matched: 3,
  unmatched: 2,
  onContractRate: 60,
}

let userSeq = 0
let userId = ""
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  userSeq += 1
  userId = `cog-user-${userSeq}`
  getSession.mockResolvedValue({ user: { id: userId } })
  denyUnlessPortalWriter.mockResolvedValue(null)
  ingestCOGRecordsRows.mockResolvedValue(IMPORT_RESULT)
})

function extended(r: CogFixtureRow): number {
  return Math.round(r.quantity * r.unitCost * 100) / 100
}

function xlsxRecord(r: CogFixtureRow): Record<string, string> {
  return {
    "PO Number": r.po,
    "Transaction Date": r.date.toISOString(),
    "Vendor Item No": r.vendorItemNo,
    Description: r.description,
    Vendor: r.vendor,
    Category: r.category,
    Quantity: String(r.quantity),
    "Unit Cost": String(r.unitCost),
    "Extended Price": String(extended(r)),
  }
}

function csvRecord(r: CogFixtureRow): Record<string, string> {
  return { ...xlsxRecord(r), "Transaction Date": r.date.toISOString().slice(0, 10) }
}

function upload(file: File) {
  return postForm(POST, URL, { file })
}

function ingestedRows(): Record<string, string>[] {
  const call = ingestCOGRecordsRows.mock.calls[0]
  if (!call) throw new Error("ingestCOGRecordsRows was not called")
  return call[0] as Record<string, string>[]
}

describe("POST /api/import-cog", () => {
  it("returns 401 and never consults the portal gate when there is no session", async () => {
    getSession.mockResolvedValue(null)
    const { status, body } = await upload(fileFor("cog.csv", buildCsv(cogMatrix(cogFixtureRows(2)))))
    expect(status).toBe(401)
    expect(body).toEqual({ error: "Unauthorized" })
    expect(denyUnlessPortalWriter).not.toHaveBeenCalled()
    expect(ingestCOGRecordsRows).not.toHaveBeenCalled()
  })

  it("gates on the facility portal and returns the gate's 403 untouched", async () => {
    denyUnlessPortalWriter.mockImplementation(async () => forbidden())
    const { status, body } = await upload(fileFor("cog.csv", buildCsv(cogMatrix(cogFixtureRows(2)))))
    expect(denyUnlessPortalWriter).toHaveBeenCalledWith(userId, "facility")
    expect(status).toBe(403)
    expect(body).toEqual({ error: "Not authorized" })
    expect(ingestCOGRecordsRows).not.toHaveBeenCalled()
  })

  it("returns 400 when the form carries no file", async () => {
    const { status, body } = await postForm(POST, URL, {})
    expect(status).toBe(400)
    expect(body).toEqual({ error: "No file provided" })
  })

  it("rejects a legacy .xls workbook with 400 instead of parsing it", async () => {
    const { status, body } = await upload(
      fileFor("legacy.xls", buildLegacyXls(cogMatrix(cogFixtureRows(3))), "application/vnd.ms-excel"),
    )
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
    expect(ingestCOGRecordsRows).not.toHaveBeenCalled()
  })

  it("rejects a .pdf with 400", async () => {
    const { status, body } = await upload(fileFor("invoice.pdf", "%PDF-1.7", "application/pdf"))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
  })

  it("rejects a file over 100 MB with the size in the message before parsing", async () => {
    const { status, body } = await postOversized(POST, URL, "huge.xlsx", 100 * MB + 1)
    expect(status).toBe(400)
    expect(body.error).toBe(
      "File is 100.0MB; max is 100MB. Split the workbook into multiple sheets/files, or export each tab as a separate .csv.",
    )
    expect(ingestCOGRecordsRows).not.toHaveBeenCalled()
  })

  it("lets a file of exactly 100 MB through the size gate to the extension check", async () => {
    const { status, body } = await postOversized(POST, URL, "edge.pdf", 100 * MB)
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
  })

  it("parses an .xlsx and hands every row to ingestCOGRecordsRows with the file name", async () => {
    const rows = cogFixtureRows(25)
    const { status, body } = await upload(fileFor("Primary COG.xlsx", await buildXlsx(cogMatrix(rows)), XLSX_TYPE))
    expect(status).toBe(200)
    expect(body).toEqual(IMPORT_RESULT)
    expect(ingestCOGRecordsRows).toHaveBeenCalledTimes(1)
    expect(ingestCOGRecordsRows.mock.calls[0]![1]).toBe("Primary COG.xlsx")
    expect(ingestedRows()).toEqual(rows.map(xlsxRecord))
  })

  it("parses a .csv into header-keyed rows with ISO dates and string numbers", async () => {
    const rows = cogFixtureRows(12, 3)
    const { status, body } = await upload(fileFor("cog.csv", buildCsv(cogMatrix(rows)), "text/csv"))
    expect(status).toBe(200)
    expect(body).toEqual(IMPORT_RESULT)
    expect(ingestCOGRecordsRows.mock.calls[0]![1]).toBe("cog.csv")
    expect(ingestedRows()).toEqual(rows.map(csvRecord))
  })

  it("matches the extension case-insensitively", async () => {
    const rows = cogFixtureRows(2)
    const { status } = await upload(fileFor("COG.CSV", buildCsv(cogMatrix(rows))))
    expect(status).toBe(200)
    expect(ingestedRows()).toEqual(rows.map(csvRecord))
  })

  it("keeps quoted commas, strips a BOM, and tolerates CRLF line endings in a .csv", async () => {
    const text = "﻿Vendor,Description,Unit Cost\r\n\"Smith & Nephew, Inc.\",\"Screw, 4.5mm \"\"cortical\"\"\",\"$1,204.50\"\r\n\r\nArthrex,Anchor,99\r\n"
    const { status } = await upload(fileFor("quoted.csv", text, "text/csv"))
    expect(status).toBe(200)
    expect(ingestedRows()).toEqual([
      { Vendor: "Smith & Nephew, Inc.", Description: 'Screw, 4.5mm "cortical"', "Unit Cost": "$1,204.50" },
      { Vendor: "Arthrex", Description: "Anchor", "Unit Cost": "99" },
    ])
  })

  it("drops a phantom tail of thousands of near-empty .xlsx rows", async () => {
    const rows = cogFixtureRows(40)
    const { status } = await upload(
      fileFor("phantom.xlsx", await buildXlsx(cogMatrix(rows), { phantomTailRows: 5_000, phantomTailColumn: 0 }), XLSX_TYPE),
    )
    expect(status).toBe(200)
    expect(ingestedRows()).toEqual(rows.map(xlsxRecord))
  })

  it("flattens rich-text, hyperlink, and formula cells before ingest", async () => {
    const rows = cogFixtureRows(6)
    await upload(
      fileFor(
        "styled.xlsx",
        await buildXlsx(cogMatrix(rows), {
          richTextColumn: 3,
          hyperlinkColumn: 2,
          formulaColumn: { index: 8, sourceA: 6, sourceB: 7 },
        }),
        XLSX_TYPE,
      ),
    )
    const ingested = ingestedRows()
    expect(JSON.stringify(ingested)).not.toContain("[object Object]")
    ingested.forEach((row, i) => {
      expect(row.Description).toBe(rows[i]!.description)
      expect(row["Vendor Item No"]).toBe(rows[i]!.vendorItemNo)
      expect(Number(row["Extended Price"])).toBeCloseTo(rows[i]!.quantity * rows[i]!.unitCost, 6)
    })
  })

  it(
    "finds the real header row below report title rows in an .xlsx", async () => {
    const rows = cogFixtureRows(10)
    const { status } = await upload(
      fileFor(
        "titled.xlsx",
        await buildXlsx(cogMatrix(rows), { titleRows: ["Lighthouse Surgical Center", "COG Export - Q3 2026"] }),
        XLSX_TYPE,
      ),
    )
    expect(status).toBe(200)
    expect(Object.keys(ingestedRows()[0]!)).toEqual(COG_HEADER)
  })

  it("returns 400 'File contains no data rows' for an .xlsx with only a header row", async () => {
    const { status, body } = await upload(fileFor("header-only.xlsx", await buildXlsx([COG_HEADER]), XLSX_TYPE))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "File contains no data rows" })
  })

  it("returns 400 'No sheets found in file' for an .xlsx with an empty first sheet", async () => {
    const { status, body } = await upload(fileFor("empty.xlsx", await buildXlsx([]), XLSX_TYPE))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "No sheets found in file" })
  })

  it("returns 400 'CSV has no data rows' for a header-only .csv", async () => {
    const { status, body } = await upload(fileFor("header-only.csv", buildCsv([COG_HEADER])))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "CSV has no data rows" })
  })

  it("explains a CSV that was renamed to .xlsx", async () => {
    const { status, body } = await upload(fileFor("renamed.xlsx", buildCsv(cogMatrix(cogFixtureRows(3))), XLSX_TYPE))
    expect(status).toBe(400)
    expect(body.error).toMatch(/rename the extension to \.csv/i)
  })

  it("maps a CSV over the 256-column default cap to 400 with the limit message", async () => {
    const header = Array.from({ length: 257 }, (_, i) => `c${i}`).join(",")
    const { status, body } = await upload(fileFor("wide.csv", `${header}\n1,2\n`))
    expect(status).toBe(400)
    expect(body).toEqual({
      error: "CSV header has 257 fields; max is 256. This does not look like a tabular export.",
    })
    expect(ingestCOGRecordsRows).not.toHaveBeenCalled()
  })

  it("maps an XlsxLimitError thrown during ingest to 400 with its message", async () => {
    ingestCOGRecordsRows.mockRejectedValue(new XlsxLimitError("Spreadsheet exceeds the 10-row limit."))
    const { status, body } = await upload(fileFor("cog.csv", buildCsv(cogMatrix(cogFixtureRows(2)))))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Spreadsheet exceeds the 10-row limit." })
  })

  it("hides an unexpected ingest failure behind a generic 500 and logs it", async () => {
    ingestCOGRecordsRows.mockRejectedValue(new Error("connection reset by peer"))
    const { status, body } = await upload(fileFor("cog.csv", buildCsv(cogMatrix(cogFixtureRows(2)))))
    expect(status).toBe(500)
    expect(body).toEqual({ error: "Import failed" })
    expect(console.error).toHaveBeenCalledWith("[/api/import-cog]", expect.any(Error))
  })

  it("rate-limits a single user at 10 imports per minute with a retryAfter hint", async () => {
    const bytes = buildCsv(cogMatrix(cogFixtureRows(1)))
    const statuses: number[] = []
    let last: Record<string, unknown> = {}
    for (let i = 0; i < 11; i++) {
      const res = await upload(fileFor("r.csv", bytes))
      statuses.push(res.status)
      last = res.body
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200))
    expect(statuses[10]).toBe(429)
    expect(last.error).toBe("Too many requests")
    expect(last.retryAfter).toBeGreaterThanOrEqual(1)
    expect(ingestCOGRecordsRows).toHaveBeenCalledTimes(10)
  })

  it("does not spend rate-limit budget on callers the portal gate rejects", async () => {
    denyUnlessPortalWriter.mockImplementation(async () => forbidden())
    for (let i = 0; i < 12; i++) await upload(fileFor("r.csv", "a,b\n1,2\n"))
    denyUnlessPortalWriter.mockResolvedValue(null)
    const { status } = await upload(fileFor("r.csv", "a,b\n1,2\n"))
    expect(status).toBe(200)
  })
})
