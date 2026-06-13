/**
 * Unit tests for the shared tabular header-detection module
 * (lib/utils/tabular/detect-headers.ts), extracted from
 * app/api/parse-file/route.ts so the client XLSX/XLS reader and the
 * server route share ONE implementation (perf, 2026-06-13). These cover
 * the four behaviors the route's inline logic carried: a clean header
 * row, title rows above the header, duplicate-header dedup, and the
 * no-token fallback / error paths.
 */

import { describe, expect, it } from "vitest"
import { matrixToHeadersAndRows } from "../detect-headers"

describe("matrixToHeadersAndRows", () => {
  it("parses a clean header row at row 0", () => {
    const { headers, rows, headerRowIndex } = matrixToHeadersAndRows([
      ["Item No", "Description", "Price"],
      ["SKU-1", "Widget", "10.00"],
      ["SKU-2", "Gadget", "20.00"],
    ])
    expect(headerRowIndex).toBe(0)
    expect(headers).toEqual(["Item No", "Description", "Price"])
    expect(rows).toEqual([
      { "Item No": "SKU-1", Description: "Widget", Price: "10.00" },
      { "Item No": "SKU-2", Description: "Gadget", Price: "20.00" },
    ])
  })

  it("skips title/branding rows above the real header (header not row 0)", () => {
    const { headers, rows, headerRowIndex } = matrixToHeadersAndRows([
      ["DePuy Synthes — Q3 2026 Price Book", "", ""],
      ["Confidential", "", ""],
      ["Item No", "Description", "Unit Price"],
      ["SKU-1", "Screw", "5.00"],
    ])
    expect(headerRowIndex).toBe(2)
    expect(headers).toEqual(["Item No", "Description", "Unit Price"])
    expect(rows).toEqual([
      { "Item No": "SKU-1", Description: "Screw", "Unit Price": "5.00" },
    ])
  })

  it("picks the header row with the most non-empty token cells", () => {
    // Row 0 has a single pricing token; row 1 is the fuller real header.
    const { headers, headerRowIndex } = matrixToHeadersAndRows([
      ["Price list", "", ""],
      ["Item", "Description", "Price"],
      ["A", "B", "C"],
    ])
    expect(headerRowIndex).toBe(1)
    expect(headers).toEqual(["Item", "Description", "Price"])
  })

  it("disambiguates duplicate header names with ' (2)', ' (3)'", () => {
    const { headers, rows } = matrixToHeadersAndRows([
      ["Category", "PRICE BOOK", "PRICE BOOK", "Category"],
      ["Ortho", "A", "B", "Ortho2"],
    ])
    // Case-insensitive collision: "Category"/"Category" and the two
    // "PRICE BOOK" columns each get a numbered suffix.
    expect(headers).toEqual([
      "Category",
      "PRICE BOOK",
      "PRICE BOOK (2)",
      "Category (2)",
    ])
    expect(rows[0]).toEqual({
      Category: "Ortho",
      "PRICE BOOK": "A",
      "PRICE BOOK (2)": "B",
      "Category (2)": "Ortho2",
    })
  })

  it("falls back to the first row with >=2 non-empty cells when no token matches", () => {
    const { headers, rows, headerRowIndex } = matrixToHeadersAndRows([
      ["", "", ""],
      ["Foo", "Bar"],
      ["a", "b"],
    ])
    expect(headerRowIndex).toBe(1)
    expect(headers).toEqual(["Foo", "Bar"])
    expect(rows).toEqual([{ Foo: "a", Bar: "b" }])
  })

  it("skips all-blank separator rows between data rows", () => {
    const { rows } = matrixToHeadersAndRows([
      ["Item", "Price"],
      ["SKU-1", "1"],
      ["", ""],
      ["SKU-2", "2"],
    ])
    expect(rows).toEqual([
      { Item: "SKU-1", Price: "1" },
      { Item: "SKU-2", Price: "2" },
    ])
  })

  it("drops fully-empty header columns from the headers list", () => {
    const { headers, rows } = matrixToHeadersAndRows([
      ["Item", "", "Price"],
      ["W-1", "x", "9.00"],
    ])
    expect(headers).toEqual(["Item", "Price"])
    // The blank-header column is not keyed into the row record.
    expect(rows[0]).toEqual({ Item: "W-1", Price: "9.00" })
  })

  it("throws on an empty matrix", () => {
    expect(() => matrixToHeadersAndRows([])).toThrow(
      "No data found in first sheet",
    )
  })

  it("throws when the chosen header row is all-blank", () => {
    // A single all-blank row: scan finds no token, the >=2 fallback
    // finds nothing, so headerRowIdx falls to 0 — which is all-blank.
    expect(() => matrixToHeadersAndRows([["", ""]])).toThrow(
      /No headers found in the first 15 rows/,
    )
  })

  it("throws when there are no data rows after the header", () => {
    expect(() =>
      matrixToHeadersAndRows([["Item No", "Description", "Price"]]),
    ).toThrow("File contains no data rows")
  })

  it("treats trailing blank rows after the header as no data rows", () => {
    expect(() =>
      matrixToHeadersAndRows([
        ["Item No", "Price"],
        ["", ""],
        ["", ""],
      ]),
    ).toThrow("File contains no data rows")
  })
})
