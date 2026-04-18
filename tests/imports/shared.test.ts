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
      "growth_rebate",
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
