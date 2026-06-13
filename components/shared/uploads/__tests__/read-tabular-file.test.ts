/**
 * Tests for the canonical tabular reader (read-tabular-file.ts).
 *
 * CSV behavior must stay byte-identical to the pre-2026-06-13 reader.
 * The XLSX/XLS path moved client-side (perf, 2026-06-13): SheetJS now
 * parses the workbook in the browser instead of POSTing to
 * /api/parse-file. We generate a real workbook with SheetJS and assert
 * the reader produces the SAME { headers, rows } the route would have —
 * the header-row scan + dedup is the shared detect-headers module, so
 * the only thing under test here is the SheetJS matrix extraction.
 */

import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import { readPricingRows } from "../read-tabular-file"

/** Build a real .xlsx File from an array-of-arrays matrix. */
function xlsxFile(matrix: (string | number)[][], name = "prices.xlsx"): File {
  const ws = XLSX.utils.aoa_to_sheet(matrix)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
  return new File([buf], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

describe("readPricingRows — CSV (unchanged)", () => {
  it("parses a basic CSV with BOM + CRLF", async () => {
    const csv = "﻿Item No,Description,Price\r\nSKU-1,Widget,10.00\r\n"
    const file = new File([csv], "p.csv", { type: "text/csv" })
    const { headers, rows } = await readPricingRows(file)
    expect(headers).toEqual(["Item No", "Description", "Price"])
    expect(rows).toEqual([
      { "Item No": "SKU-1", Description: "Widget", Price: "10.00" },
    ])
  })

  it("parses .txt as CSV", async () => {
    const file = new File(["A,B\n1,2\n"], "x.txt", { type: "text/plain" })
    const { headers, rows } = await readPricingRows(file)
    expect(headers).toEqual(["A", "B"])
    expect(rows).toEqual([{ A: "1", B: "2" }])
  })
})

describe("readPricingRows — XLSX (client-side SheetJS, 2026-06-13)", () => {
  it("parses a clean .xlsx into headers + rows", async () => {
    const file = xlsxFile([
      ["ReferenceNumber", "Description", "Price"],
      ["AR-1", "Widget", "100"],
      ["AR-2", "Gadget", "200"],
    ])
    const { headers, rows } = await readPricingRows(file)
    expect(headers).toEqual(["ReferenceNumber", "Description", "Price"])
    expect(rows).toEqual([
      { ReferenceNumber: "AR-1", Description: "Widget", Price: "100" },
      { ReferenceNumber: "AR-2", Description: "Gadget", Price: "200" },
    ])
  })

  it("scans past title rows above the real header", async () => {
    const file = xlsxFile([
      ["Arthrex Price File", "", ""],
      ["", "", ""],
      ["Item No", "Description", "Price"],
      ["SKU-1", "Screw", "5.00"],
    ])
    const { headers, rows } = await readPricingRows(file)
    expect(headers).toEqual(["Item No", "Description", "Price"])
    expect(rows).toEqual([
      { "Item No": "SKU-1", Description: "Screw", Price: "5.00" },
    ])
  })

  it("dedupes duplicate headers the same way the route did", async () => {
    const file = xlsxFile([
      ["Category", "PRICE BOOK", "PRICE BOOK"],
      ["Ortho", "A", "B"],
    ])
    const { headers } = await readPricingRows(file)
    expect(headers).toEqual(["Category", "PRICE BOOK", "PRICE BOOK (2)"])
  })

  it("coerces numeric cells to formatted display strings", async () => {
    // raw:false → numbers come out as their shown string, not a JS number.
    const file = xlsxFile([
      ["Item", "Price"],
      ["SKU-1", 1234.5],
    ])
    const { rows } = await readPricingRows(file)
    expect(rows[0]).toEqual({ Item: "SKU-1", Price: "1234.5" })
  })

  it("transparently parses a renamed CSV given an .xlsx extension", async () => {
    // Behavior change vs the old server route (BENIGN, perf 2026-06-13):
    // the route's ExcelJS path threw "end of central directory" on a
    // renamed CSV and we showed a "rename to .csv" hint. SheetJS instead
    // content-sniffs and parses the CSV — strictly better UX, the file
    // just works. (The classification branch in the reader still catches
    // genuinely-corrupt workbooks; see the next test.)
    const file = new File(["Item No,Description,Price\nSKU-1,Widget,9\n"], "fake.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    const { headers, rows } = await readPricingRows(file)
    expect(headers).toEqual(["Item No", "Description", "Price"])
    expect(rows).toEqual([
      { "Item No": "SKU-1", Description: "Widget", Price: "9" },
    ])
  })

  it("throws a parse error on a genuinely-corrupt workbook (truncated zip)", async () => {
    // PK header but no central directory → SheetJS "Unsupported ZIP file".
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])], "broken.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    await expect(readPricingRows(file)).rejects.toThrow(/Failed to parse Excel file/)
  })

  it("enforces the 100MB cap with the route's message", async () => {
    // Stub a File whose reported size exceeds the cap without allocating it.
    const fake = {
      name: "huge.xlsx",
      size: 101 * 1024 * 1024,
    } as unknown as File
    await expect(readPricingRows(fake)).rejects.toThrow(/max is 100MB/)
  })

  it("surfaces the no-data-rows error for a header-only workbook", async () => {
    const file = xlsxFile([["Item No", "Description", "Price"]])
    await expect(readPricingRows(file)).rejects.toThrow(
      "File contains no data rows",
    )
  })
})
