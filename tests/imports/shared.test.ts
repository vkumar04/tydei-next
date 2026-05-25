/**
 * Unit tests for lib/actions/imports/shared.ts — the parsers + enum
 * coercers + fuzzy column mapper that every upload pipeline depends on.
 *
 * These are pure functions (no DB, no network). Table-driven to cover
 * the file formats users actually upload.
 */
import { describe, it, expect } from "vitest"
import {
  parseCSV,
  parseMoney,
  parseDate,
  toSafeDate,
  localFallbackMap,
  get,
  toContractType,
  toPerfPeriod,
  toTermType,
  toRebateType,
  excelCellToString,
  parseXlsxBufferToRows,
  type TargetField,
} from "@/lib/actions/imports/shared"

// ─── parseCSV ────────────────────────────────────────────────────

describe("parseCSV", () => {
  it("returns empty array for empty input", () => {
    expect(parseCSV("")).toEqual([])
    expect(parseCSV("\n\n\n")).toEqual([])
  })

  it("parses a simple 2-row CSV with LF line endings", () => {
    const rows = parseCSV("a,b,c\n1,2,3\n4,5,6")
    expect(rows).toEqual([
      { a: "1", b: "2", c: "3" },
      { a: "4", b: "5", c: "6" },
    ])
  })

  it("handles CRLF line endings", () => {
    const rows = parseCSV("a,b\r\n1,2\r\n3,4")
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ])
  })

  it("strips a UTF-8 BOM from the first header", () => {
    const rows = parseCSV("\uFEFFa,b\n1,2")
    expect(rows[0]).toEqual({ a: "1", b: "2" })
    // The BOM should not leak into the header name
    expect(Object.keys(rows[0])).toEqual(["a", "b"])
  })

  it("handles quoted fields containing commas", () => {
    const rows = parseCSV('name,desc\n"Smith, John","red, big"')
    expect(rows[0]).toEqual({ name: "Smith, John", desc: "red, big" })
  })

  it("handles quoted fields containing escaped quotes", () => {
    const rows = parseCSV('name,notes\nAcme,"they said ""hi"""')
    expect(rows[0]).toEqual({ name: "Acme", notes: 'they said "hi"' })
  })

  it("trims cell whitespace but preserves content", () => {
    const rows = parseCSV("a,b\n  foo  ,  bar  ")
    expect(rows[0]).toEqual({ a: "foo", b: "bar" })
  })

  it("pads missing trailing cells with empty string", () => {
    const rows = parseCSV("a,b,c\n1,2")
    expect(rows[0]).toEqual({ a: "1", b: "2", c: "" })
  })

  it("skips empty lines", () => {
    const rows = parseCSV("a,b\n1,2\n\n3,4\n\n")
    expect(rows).toHaveLength(2)
  })
})

// ─── parseMoney ─────────────────────────────────────────────────

describe("parseMoney", () => {
  it.each([
    ["", 0],
    [undefined, 0],
    ["-", 0],
    ["0", 0],
    ["100", 100],
    ["100.50", 100.5],
    ["$100", 100],
    ["$ 100", 100],
    ["$100.50", 100.5],
    ["$1,234.56", 1234.56],
    ["$ 1,234.56", 1234.56],
    ["(100)", 100], // accounting style — bare number after stripping parens
    ["not a number", 0],
    ["12abc", 0], // mixed strings return 0
  ])("parseMoney(%s) → %s", (input, expected) => {
    expect(parseMoney(input as string | undefined)).toBe(expected)
  })
})

// ─── parseDate ──────────────────────────────────────────────────

describe("parseDate", () => {
  it("parses MM/DD/YYYY in UTC", () => {
    const d = parseDate("03/15/2026")
    expect(d).not.toBeNull()
    expect(d!.toISOString()).toBe("2026-03-15T00:00:00.000Z")
  })

  it("parses YYYY-MM-DD in UTC", () => {
    const d = parseDate("2026-03-15")
    expect(d!.toISOString()).toBe("2026-03-15T00:00:00.000Z")
  })

  it("parses MM/DD/YYYY with trailing time, ignoring the time component", () => {
    const d = parseDate("03/15/2026 10:30")
    expect(d!.toISOString()).toBe("2026-03-15T00:00:00.000Z")
  })

  it("returns null for empty / dash / bogus input", () => {
    expect(parseDate("")).toBeNull()
    expect(parseDate("-")).toBeNull()
    expect(parseDate(undefined)).toBeNull()
    expect(parseDate("not a date")).toBeNull()
  })

  it("falls back to new Date() parse for other ISO-like strings", () => {
    const d = parseDate("2026-03-15T12:00:00Z")
    expect(d).not.toBeNull()
    expect(d!.getUTCFullYear()).toBe(2026)
  })

  it("handles single-digit month/day in MM/DD/YYYY", () => {
    const d = parseDate("3/5/2026")
    expect(d!.toISOString()).toBe("2026-03-05T00:00:00.000Z")
  })
})

// ─── toSafeDate ─────────────────────────────────────────────────

describe("toSafeDate", () => {
  const fallback = new Date("2100-01-01")

  it("returns fallback for null/undefined", () => {
    expect(toSafeDate(null, fallback)).toBe(fallback)
    expect(toSafeDate(undefined, fallback)).toBe(fallback)
  })

  it("returns fallback for bogus input", () => {
    expect(toSafeDate("not a date", fallback)).toBe(fallback)
  })

  it("parses valid ISO strings", () => {
    const d = toSafeDate("2026-06-15T00:00:00Z", fallback)
    expect(d.getUTCFullYear()).toBe(2026)
  })
})

// ─── localFallbackMap ──────────────────────────────────────────

describe("localFallbackMap", () => {
  const targets: TargetField[] = [
    { key: "vendorItemNo", label: "Vendor Item Number", required: true },
    { key: "unitCost", label: "Unit Cost", required: true },
    { key: "quantity", label: "Quantity", required: false },
  ]

  it("matches exact normalized keys", () => {
    const mapping = localFallbackMap(
      ["Vendor Item Number", "Unit Cost", "Quantity"],
      targets,
    )
    expect(mapping).toEqual({
      vendorItemNo: "Vendor Item Number",
      unitCost: "Unit Cost",
      quantity: "Quantity",
    })
  })

  it("matches despite case + punctuation + spacing differences", () => {
    const mapping = localFallbackMap(
      ["vendor_item_no", "unit-cost", "QTY"],
      targets,
    )
    expect(mapping.vendorItemNo).toBe("vendor_item_no")
    expect(mapping.unitCost).toBe("unit-cost")
    // QTY doesn't normalize to "quantity" — should NOT match
    expect(mapping.quantity).toBeUndefined()
  })

  it("matches substring headers", () => {
    const mapping = localFallbackMap(
      ["Vendor Item Number (catalog)", "Unit Cost USD"],
      targets,
    )
    expect(mapping.vendorItemNo).toContain("Vendor Item Number")
    expect(mapping.unitCost).toContain("Unit Cost")
  })

  it("omits keys with no match", () => {
    const mapping = localFallbackMap(["Foo", "Bar"], targets)
    expect(Object.keys(mapping)).toEqual([])
  })

  // Charles Bugs.rtfd 2026-05-25 (verification round): the SYK Carve out
  // workbook ships a header typo "Reference numer" (missing 'b'). The
  // pre-fix mapper scored that 0 against the vendorItemNo target because
  // the full header didn't appear as a contiguous substring of the
  // concatenated label, AND landed it on the "Vendor" column instead
  // (where "vendor" IS substring of the label). Result on /api/import-
  // pricing: 3/15548 rows imported, the rest dropped silently.
  it("matches the typo'd 'Reference numer' header against vendorItemNo", () => {
    const target: TargetField[] = [
      {
        key: "vendorItemNo",
        label:
          "Vendor Item Number / Catalog Number / Reference / Reference Number / Reference Numer / Ref No / SKU / Item No / Part No",
        required: true,
      },
      // The decoy that previously stole the column.
      { key: "vendorName", label: "Vendor / Supplier Name", required: true },
    ]
    const mapping = localFallbackMap(
      ["Reference numer", "Description", "Price", "Vendor"],
      target,
    )
    expect(mapping.vendorItemNo).toBe("Reference numer")
    expect(mapping.vendorName).toBe("Vendor")
  })

  it("matches 'Catalog Item' via the token-level fallback", () => {
    // joint pricing COG.xlsx ships with "Catalog Item" — pre-fix that
    // wasn't a substring of any label (the label had "catalog number"
    // and "item number" as separate fragments). New token-level
    // matching: any label token >= 4 chars that appears as substring
    // of the header scores 1.
    const target: TargetField[] = [
      {
        key: "vendorItemNo",
        label: "Vendor Item Number / Catalog Number / Reference",
        required: true,
      },
    ]
    const mapping = localFallbackMap(["Catalog Item", "Price"], target)
    expect(mapping.vendorItemNo).toBe("Catalog Item")
  })
})

// ─── get ────────────────────────────────────────────────────────

describe("get", () => {
  it("returns the trimmed value from row using mapping", () => {
    const row = { "Unit Cost": "  100.50  ", Other: "x" }
    const mapping = { unitCost: "Unit Cost" }
    expect(get(row, mapping, "unitCost")).toBe("100.50")
  })

  it("returns empty string when key not in mapping", () => {
    expect(get({ a: "1" }, {}, "unitCost")).toBe("")
  })

  it("returns empty string when mapped column missing from row", () => {
    const row = { b: "1" }
    const mapping = { unitCost: "Unit Cost" } // column not present
    expect(get(row, mapping, "unitCost")).toBe("")
  })
})

// ─── AI → enum coercers ────────────────────────────────────────

describe("toContractType", () => {
  it.each([
    ["usage", "usage"],
    ["capital", "capital"],
    ["service", "service"],
    ["tie_in", "tie_in"],
    ["grouped", "grouped"],
    ["pricing_only", "pricing_only"],
  ])("valid %s → %s", (input, expected) => {
    expect(toContractType(input as never)).toBe(expected)
  })

  it("falls back to 'usage' for unknown values", () => {
    expect(toContractType("exotic" as never)).toBe("usage")
    expect(toContractType(null as never)).toBe("usage")
    expect(toContractType(undefined as never)).toBe("usage")
  })
})

describe("toPerfPeriod", () => {
  it.each([
    ["monthly", "monthly"],
    ["quarterly", "quarterly"],
    ["semi_annual", "semi_annual"],
    ["annual", "annual"],
  ])("valid %s → %s", (input, expected) => {
    expect(toPerfPeriod(input)).toBe(expected)
  })

  it("returns null for null/undefined/unknown (caller supplies own default)", () => {
    expect(toPerfPeriod(null)).toBeNull()
    expect(toPerfPeriod(undefined)).toBeNull()
    expect(toPerfPeriod("daily")).toBeNull()
    expect(toPerfPeriod("")).toBeNull()
  })
})

describe("toTermType", () => {
  it("accepts every whitelisted term type", () => {
    // `growth_rebate` retired 2026-05-25 — growth is now expressed via
    // growthOnly on a spend_rebate.
    const allowed = [
      "spend_rebate",
      "volume_rebate",
      "price_reduction",
      "po_rebate",
      "carve_out",
      "market_share",
      "market_share_price_reduction",
      "capitated_price_reduction",
      "capitated_pricing_rebate",
      "payment_rebate",
      "compliance_rebate",
      "fixed_fee",
      "locked_pricing",
      "rebate_per_use",
    ]
    for (const v of allowed) {
      expect(toTermType(v)).toBe(v)
    }
  })

  it("falls back to 'spend_rebate' for unknown values", () => {
    expect(toTermType(null)).toBe("spend_rebate")
    expect(toTermType("invented")).toBe("spend_rebate")
  })
})

describe("toRebateType", () => {
  it("accepts every whitelisted rebate type", () => {
    const allowed = [
      "percent_of_spend",
      "fixed_rebate",
      "fixed_rebate_per_unit",
      "per_procedure_rebate",
    ]
    for (const v of allowed) {
      expect(toRebateType(v)).toBe(v)
    }
  })

  it("falls back to 'percent_of_spend' for null/unknown", () => {
    expect(toRebateType(null)).toBe("percent_of_spend")
    expect(toRebateType("per_use")).toBe("percent_of_spend")
  })
})

// ─── excelCellToString ──────────────────────────────────────────
// Bug 2026-05-25: rich-text headers in "SYK Carve out.xlsx" came
// through as the literal string "[object Object]" because the route
// handler used String(cellValue) on ExcelJS's non-primitive shapes.

describe("excelCellToString", () => {
  it("returns empty string for null/undefined", () => {
    expect(excelCellToString(null)).toBe("")
    expect(excelCellToString(undefined)).toBe("")
  })

  it("passes primitives through", () => {
    expect(excelCellToString("CAT01386")).toBe("CAT01386")
    expect(excelCellToString(330.65)).toBe("330.65")
    expect(excelCellToString(0)).toBe("0")
    expect(excelCellToString(true)).toBe("true")
  })

  it("unwraps rich-text into concatenated plain text", () => {
    // This is the literal shape ExcelJS returned for the SYK Carve out
    // workbook's "Description" header and catalog-ID cells.
    expect(
      excelCellToString({
        richText: [
          { font: { bold: true, name: "Cambria" }, text: "Carve out " },
          { font: { bold: true, name: "Cambria" }, text: "%" },
        ],
      }),
    ).toBe("Carve out %")
    expect(
      excelCellToString({
        richText: [{ font: { size: 8 }, text: "Nanotack Suture Anchor" }],
      }),
    ).toBe("Nanotack Suture Anchor")
  })

  it("uses .result for formula cells (recursing through richText)", () => {
    expect(excelCellToString({ formula: "A1*2", result: 42 })).toBe("42")
    expect(
      excelCellToString({
        formula: "CONCAT(A1,B1)",
        result: { richText: [{ text: "Hello" }, { text: " world" }] },
      }),
    ).toBe("Hello world")
    expect(excelCellToString({ sharedFormula: "A1", result: 7 })).toBe("7")
  })

  it("uses .text for hyperlink cells", () => {
    expect(
      excelCellToString({ text: "PO-123", hyperlink: "https://x.test/po/123" }),
    ).toBe("PO-123")
  })

  it("returns empty string for error cells", () => {
    expect(excelCellToString({ error: "#REF!" })).toBe("")
  })

  it("converts Date to ISO 8601 (parseDate can read it)", () => {
    const d = new Date("2026-05-25T00:00:00.000Z")
    const s = excelCellToString(d)
    expect(s).toBe("2026-05-25T00:00:00.000Z")
    expect(parseDate(s)).toBeInstanceOf(Date)
  })
})

// ─── parseXlsxBufferToRows ─────────────────────────────────────
// Regression coverage for the SYK Carve out / joint pricing import
// bug 2026-05-25:
//   • Rich-text cells must come through as plain text.
//   • Phantom trailing rows (fill-down to row 1,048,576 with only one
//     column populated) must not flood the importer.

import ExcelJS from "exceljs"

async function buildXlsxBuffer(
  fill: (sheet: ExcelJS.Worksheet) => void,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet("Sheet1")
  fill(sheet)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Buffer.from((await wb.xlsx.writeBuffer()) as any)
}

describe("parseXlsxBufferToRows", () => {
  it("unwraps rich-text headers AND data cells (SYK Carve out case)", async () => {
    const buf = await buildXlsxBuffer((sheet) => {
      // Mimic the SYK Carve out shape: "Description" + "Carve out %"
      // headers are rich text; catalog ID cells in column 1 are rich text.
      // ExcelJS `row.values = [...]` is 1-indexed in the WRITE direction,
      // so the array elements are column 1, 2, 3, ... in order.
      sheet.getRow(1).values = [
        "Reference numer",
        { richText: [{ text: "Description" }] },
        "Price",
        {
          richText: [
            { font: { bold: true }, text: "Carve out " },
            { font: { bold: true }, text: "%" },
          ],
        },
      ]
      sheet.getRow(2).values = [
        { richText: [{ text: "CAT01386" }] },
        { richText: [{ text: "Nanotack Suture Anchor" }] },
        330.65,
        0.12,
      ]
      sheet.getRow(3).values = [
        { richText: [{ text: "CAT01373" }] },
        { richText: [{ text: "Nanotack Drill Bit" }] },
        160.65,
        0.12,
      ]
    })
    const { headers, rows } = await parseXlsxBufferToRows(buf)
    expect(headers).toEqual([
      "Reference numer",
      "Description",
      "Price",
      "Carve out %",
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      "Reference numer": "CAT01386",
      Description: "Nanotack Suture Anchor",
      Price: "330.65",
      "Carve out %": "0.12",
    })
    // The hallmark of the pre-fix bug — must never appear.
    for (const r of rows) {
      for (const v of Object.values(r)) {
        expect(v).not.toContain("[object Object]")
      }
    }
  })

  it("trims trailing phantom rows from accidental fill-down (joint-pricing case)", async () => {
    const buf = await buildXlsxBuffer((sheet) => {
      sheet.getRow(1).values = [
        "Catalog Item",
        "Description",
        "Price",
        "Contract ID",
      ]
      sheet.getRow(2).values = ["H1", "Femoral Stem", 7000, "C1"]
      sheet.getRow(3).values = ["H2", "HA Cup", 3900, "C1"]
      // Simulate 500 phantom rows where only Contract ID is filled —
      // user accidentally fill-dragged the column.
      for (let i = 4; i < 504; i++) {
        sheet.getRow(i).values = [null, null, null, "C1"]
      }
    })
    const { rows } = await parseXlsxBufferToRows(buf)
    expect(rows).toHaveLength(2)
    expect(rows[0]["Catalog Item"]).toBe("H1")
    expect(rows[1]["Catalog Item"]).toBe("H2")
  })

  it("preserves a single sparse row interleaved in real data (no early stop)", async () => {
    const buf = await buildXlsxBuffer((sheet) => {
      sheet.getRow(1).values = ["A", "B", "C"]
      sheet.getRow(2).values = ["1", "2", "3"]
      // A sparse row in the middle — must NOT trigger phantom-row trim.
      sheet.getRow(3).values = [null, "only-b", null]
      sheet.getRow(4).values = ["4", "5", "6"]
    })
    const { rows } = await parseXlsxBufferToRows(buf)
    // The middle sparse row gets recorded (it has content); only fully-
    // empty rows are dropped. Phantom-row trim only kicks in for the
    // trailing edge.
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows[0]).toEqual({ A: "1", B: "2", C: "3" })
    expect(rows[rows.length - 1]).toEqual({ A: "4", B: "5", C: "6" })
  })

  it("returns empty headers/rows for a workbook with no sheets", async () => {
    const wb = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = Buffer.from((await wb.xlsx.writeBuffer()) as any)
    const out = await parseXlsxBufferToRows(buf)
    expect(out.headers).toEqual([])
    expect(out.rows).toEqual([])
  })
})
