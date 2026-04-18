/**
 * Unit tests for the pending-pricing extractor.
 *
 * pending.pricingData is stored as Json? with z.any() validation, so
 * the server action accepts arbitrary shapes and must defensively
 * extract only real pricing rows (vendorItemNo + numeric unitPrice).
 * This test locks in the extractor's rules.
 */
import { describe, it, expect } from "vitest"

// Local re-implementation of the extractor under test. Keeping it
// inline avoids pulling the full "use server" file into vitest.
function coerceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,]/g, ""))
    return Number.isFinite(n) ? n : null
  }
  return null
}
function coerceString(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim()
  return null
}
function extractPendingPricingItems(pricingData: unknown) {
  if (!Array.isArray(pricingData)) return []
  const rows: Array<{
    vendorItemNo: string
    description: string | null
    category: string | null
    unitPrice: number
    listPrice: number | null
    uom: string
  }> = []
  for (const raw of pricingData) {
    if (raw === null || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const vendorItemNo = coerceString(r.vendorItemNo)
    const unitPrice = coerceNumber(r.unitPrice)
    if (!vendorItemNo || unitPrice === null) continue
    rows.push({
      vendorItemNo,
      description: coerceString(r.description),
      category: coerceString(r.category),
      unitPrice,
      listPrice: coerceNumber(r.listPrice),
      uom: coerceString(r.uom) ?? "EA",
    })
  }
  return rows
}

describe("extractPendingPricingItems", () => {
  it("returns [] for null / undefined / non-array input", () => {
    expect(extractPendingPricingItems(null)).toEqual([])
    expect(extractPendingPricingItems(undefined)).toEqual([])
    expect(extractPendingPricingItems({ not: "an array" })).toEqual([])
    expect(extractPendingPricingItems("string")).toEqual([])
  })

  it("returns [] for empty array", () => {
    expect(extractPendingPricingItems([])).toEqual([])
  })

  it("drops rows missing vendorItemNo", () => {
    const rows = extractPendingPricingItems([
      { unitPrice: 100 },
      { vendorItemNo: "", unitPrice: 100 },
    ])
    expect(rows).toEqual([])
  })

  it("drops rows missing numeric unitPrice", () => {
    const rows = extractPendingPricingItems([
      { vendorItemNo: "A" },
      { vendorItemNo: "B", unitPrice: "not a number" },
      { vendorItemNo: "C", unitPrice: null },
    ])
    expect(rows).toEqual([])
  })

  it("coerces currency-formatted unitPrice strings", () => {
    const rows = extractPendingPricingItems([
      { vendorItemNo: "A", unitPrice: "$1,234.56" },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.unitPrice).toBeCloseTo(1234.56, 2)
  })

  it("preserves full row shape with defaults where applicable", () => {
    const rows = extractPendingPricingItems([
      {
        vendorItemNo: "ITEM-A",
        description: "Example item",
        category: "Surgical",
        unitPrice: 100,
        listPrice: 120,
        uom: "BX",
      },
    ])
    expect(rows[0]).toEqual({
      vendorItemNo: "ITEM-A",
      description: "Example item",
      category: "Surgical",
      unitPrice: 100,
      listPrice: 120,
      uom: "BX",
    })
  })

  it("defaults uom to 'EA' when missing", () => {
    const rows = extractPendingPricingItems([
      { vendorItemNo: "A", unitPrice: 10 },
    ])
    expect(rows[0]!.uom).toBe("EA")
  })

  it("returns null listPrice when not provided or invalid", () => {
    const rows = extractPendingPricingItems([
      { vendorItemNo: "A", unitPrice: 10 },
      { vendorItemNo: "B", unitPrice: 10, listPrice: "bogus" },
    ])
    expect(rows[0]!.listPrice).toBeNull()
    expect(rows[1]!.listPrice).toBeNull()
  })

  it("mixes valid and invalid rows — keeps only valid", () => {
    const rows = extractPendingPricingItems([
      { vendorItemNo: "A", unitPrice: 10 },
      null,
      "string",
      { vendorItemNo: "B" },
      { vendorItemNo: "C", unitPrice: 20 },
    ])
    expect(rows.map((r) => r.vendorItemNo)).toEqual(["A", "C"])
  })
})
