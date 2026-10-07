import { describe, expect, it, vi, beforeEach } from "vitest"
import { buildCsv, buildLegacyXls, buildXlsx, type Cell } from "../support/upload-fixtures"
import { MB, XLSX_TYPE, fileFor, forbidden, postForm, postOversized } from "../support/import-route-harness"
import { CsvLimitError } from "@/lib/csv/parse-csv-bounded"

const { getSession, denyUnlessPortalWriter, ingestPricingFile } = vi.hoisted(() => ({
  getSession: vi.fn(),
  denyUnlessPortalWriter: vi.fn(),
  ingestPricingFile: vi.fn(),
}))

vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: (args: unknown) => getSession(args) } },
}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("@/lib/api/import-route-auth", () => ({ denyUnlessPortalWriter }))
vi.mock("@/lib/actions/imports/pricing-import", () => ({ ingestPricingFile }))

import { POST } from "@/app/api/import-pricing/route"

const URL = "http://localhost/api/import-pricing"
const IMPORT_RESULT = { imported: 3, failed: 1, vendorUsed: "Stryker" }

const PRICING_HEADER: Cell[] = ["Vendor Item No", "Description", "Contract Price", "UOM", "Effective Date"]

function pricingMatrix(count: number): Cell[][] {
  const rows: Cell[][] = [PRICING_HEADER]
  for (let i = 0; i < count; i++) {
    rows.push([`SKU-${1000 + i}`, `Tibial Insert ${i}`, 125.5 + i, i % 2 === 0 ? "EA" : "BX", new Date(Date.UTC(2026, 0, 1 + i))])
  }
  return rows
}

function pricingRecord(i: number, dateText: string): Record<string, string> {
  return {
    "Vendor Item No": `SKU-${1000 + i}`,
    Description: `Tibial Insert ${i}`,
    "Contract Price": String(125.5 + i),
    UOM: i % 2 === 0 ? "EA" : "BX",
    "Effective Date": dateText,
  }
}

let userSeq = 0
let userId = ""
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  userSeq += 1
  userId = `pricing-user-${userSeq}`
  getSession.mockResolvedValue({ user: { id: userId } })
  denyUnlessPortalWriter.mockResolvedValue(null)
  ingestPricingFile.mockResolvedValue(IMPORT_RESULT)
})

function upload(file: File, extra: Record<string, string> = {}) {
  return postForm(POST, URL, { file, ...extra })
}

describe("POST /api/import-pricing", () => {
  it("returns 401 when there is no session", async () => {
    getSession.mockResolvedValue(null)
    const { status, body } = await upload(fileFor("p.csv", buildCsv(pricingMatrix(1))))
    expect(status).toBe(401)
    expect(body).toEqual({ error: "Unauthorized" })
    expect(denyUnlessPortalWriter).not.toHaveBeenCalled()
  })

  it("gates on the facility portal and returns the gate's 403", async () => {
    denyUnlessPortalWriter.mockImplementation(async () => forbidden("Your access is read-only"))
    const { status, body } = await upload(fileFor("p.csv", buildCsv(pricingMatrix(1))))
    expect(denyUnlessPortalWriter).toHaveBeenCalledWith(userId, "facility")
    expect(status).toBe(403)
    expect(body).toEqual({ error: "Your access is read-only" })
    expect(ingestPricingFile).not.toHaveBeenCalled()
  })

  it("returns 400 when the form carries no file", async () => {
    const { status, body } = await postForm(POST, URL, { vendorHint: "Stryker" })
    expect(status).toBe(400)
    expect(body).toEqual({ error: "No file provided" })
  })

  it("rejects a legacy .xls workbook with 400", async () => {
    const { status, body } = await upload(fileFor("price.xls", buildLegacyXls(pricingMatrix(2)), "application/vnd.ms-excel"))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
    expect(ingestPricingFile).not.toHaveBeenCalled()
  })

  it("rejects a .pdf with 400", async () => {
    const { status, body } = await upload(fileFor("price.pdf", "%PDF-1.7", "application/pdf"))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
  })

  it("rejects a file over 100 MB with the size in the message", async () => {
    const { status, body } = await postOversized(POST, URL, "huge.xlsx", 150 * MB)
    expect(status).toBe(400)
    expect(body.error).toBe(
      "File is 150.0MB; max is 100MB. Split the workbook into multiple sheets/files, or export each tab as a separate .csv.",
    )
    expect(ingestPricingFile).not.toHaveBeenCalled()
  })

  it("lets a file of exactly 100 MB through the size gate", async () => {
    const { body } = await postOversized(POST, URL, "edge.pdf", 100 * MB)
    expect(body).toEqual({ error: "Only .xlsx and .csv files are supported" })
  })

  it("passes .xlsx rows, the file name, and the vendor hint to ingestPricingFile", async () => {
    const { status, body } = await upload(fileFor("Stryker Pricing.xlsx", await buildXlsx(pricingMatrix(4)), XLSX_TYPE), {
      vendorHint: "Stryker",
    })
    expect(status).toBe(200)
    expect(body).toEqual(IMPORT_RESULT)
    expect(ingestPricingFile).toHaveBeenCalledTimes(1)
    expect(ingestPricingFile).toHaveBeenCalledWith({
      rows: [0, 1, 2, 3].map((i) => pricingRecord(i, new Date(Date.UTC(2026, 0, 1 + i)).toISOString())),
      fileName: "Stryker Pricing.xlsx",
      vendorHint: "Stryker",
    })
  })

  it("passes .csv rows and a null vendor hint when none was sent", async () => {
    const { status, body } = await upload(fileFor("pricing.csv", buildCsv(pricingMatrix(3)), "text/csv"))
    expect(status).toBe(200)
    expect(body).toEqual(IMPORT_RESULT)
    expect(ingestPricingFile).toHaveBeenCalledWith({
      rows: [0, 1, 2].map((i) => pricingRecord(i, `2026-01-0${1 + i}`)),
      fileName: "pricing.csv",
      vendorHint: null,
    })
  })

  it("trims a phantom tail from an .xlsx before ingest", async () => {
    await upload(
      fileFor("phantom.xlsx", await buildXlsx(pricingMatrix(5), { phantomTailRows: 3_000, phantomTailColumn: 0 }), XLSX_TYPE),
    )
    const input = ingestPricingFile.mock.calls[0]![0] as { rows: Record<string, string>[] }
    expect(input.rows).toHaveLength(5)
    expect(input.rows[4]!["Vendor Item No"]).toBe("SKU-1004")
  })

  it(
    "finds the real header row below report title rows in an .xlsx", async () => {
    const { status } = await upload(
      fileFor("titled.xlsx", await buildXlsx(pricingMatrix(3), { titleRows: ["Stryker Price File", "Effective 2026"] }), XLSX_TYPE),
    )
    expect(status).toBe(200)
    const input = ingestPricingFile.mock.calls[0]![0] as { rows: Record<string, string>[] }
    expect(Object.keys(input.rows[0]!)).toEqual(PRICING_HEADER)
  })

  it("returns 400 'File contains no data rows' for a header-only .xlsx", async () => {
    const { status, body } = await upload(fileFor("h.xlsx", await buildXlsx([PRICING_HEADER]), XLSX_TYPE))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "File contains no data rows" })
  })

  it("returns 400 'CSV has no data rows' for a header-only .csv", async () => {
    const { status, body } = await upload(fileFor("h.csv", buildCsv([PRICING_HEADER])))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "CSV has no data rows" })
  })

  it("explains a CSV that was renamed to .xlsx", async () => {
    const { status, body } = await upload(fileFor("renamed.xlsx", buildCsv(pricingMatrix(2)), XLSX_TYPE))
    expect(status).toBe(400)
    expect(body.error).toBe(
      "This file doesn't look like a valid .xlsx workbook. If it's a CSV, rename the extension to .csv and re-upload.",
    )
  })

  it("maps a CsvLimitError from ingest to 400 with its message", async () => {
    ingestPricingFile.mockRejectedValue(new CsvLimitError("CSV has more than 10 rows"))
    const { status, body } = await upload(fileFor("p.csv", buildCsv(pricingMatrix(1))))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "CSV has more than 10 rows" })
  })

  it("hides an unexpected ingest failure behind a generic 500", async () => {
    ingestPricingFile.mockRejectedValue(new Error("Vendor lookup exploded: secret detail"))
    const { status, body } = await upload(fileFor("p.csv", buildCsv(pricingMatrix(1))))
    expect(status).toBe(500)
    expect(body).toEqual({ error: "Import failed" })
    expect(console.error).toHaveBeenCalledWith("[/api/import-pricing]", expect.any(Error))
  })

  it("rate-limits a single user at 10 imports per minute", async () => {
    const bytes = buildCsv(pricingMatrix(1))
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await upload(fileFor("r.csv", bytes))).status)
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200))
    expect(statuses[10]).toBe(429)
  })
})
