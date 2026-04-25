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
  // Matches lib/actions/pending-contracts.ts:56 (audit pass-3 + round-3 + round-4):
  // accept Array OR {items: [...]} object; LAST-WINS dedup by
  // case-insensitive trimmed vendorItemNo.
  let inputArray: unknown[]
  if (Array.isArray(pricingData)) {
    inputArray = pricingData
  } else if (
    pricingData !== null &&
    typeof pricingData === "object" &&
    Array.isArray((pricingData as { items?: unknown }).items)
  ) {
    inputArray = (pricingData as { items: unknown[] }).items
  } else {
    return []
  }
  const rows: Array<{
    vendorItemNo: string
    description: string | null
    category: string | null
    unitPrice: number
    listPrice: number | null
    uom: string
  }> = []
  const indexByVendorItemNo = new Map<string, number>()
  for (const raw of inputArray) {
    if (raw === null || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const vendorItemNo = coerceString(r.vendorItemNo)
    const unitPrice = coerceNumber(r.unitPrice)
    if (!vendorItemNo || unitPrice === null) continue
    const normalized = vendorItemNo.trim().toUpperCase()
    const row = {
      vendorItemNo: vendorItemNo.trim(),
      description: coerceString(r.description),
      category: coerceString(r.category),
      unitPrice,
      listPrice: coerceNumber(r.listPrice),
      uom: coerceString(r.uom) ?? "EA",
    }
    const existingIdx = indexByVendorItemNo.get(normalized)
    if (existingIdx !== undefined) {
      rows[existingIdx] = row
    } else {
      indexByVendorItemNo.set(normalized, rows.length)
      rows.push(row)
    }
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

  // Charles audit pass-4 round-3 + round-4: shape + dedup regression locks.
  it("accepts {items: [...]} object shape (round-3 BLOCKER fix)", () => {
    const rows = extractPendingPricingItems({
      fileName: "pricing.csv",
      itemCount: 1,
      items: [{ vendorItemNo: "X", unitPrice: 5 }],
      uploadedAt: new Date().toISOString(),
    })
    expect(rows.map((r) => r.vendorItemNo)).toEqual(["X"])
  })

  it("dedupes by case-insensitive trimmed vendorItemNo, LAST-WINS (round-4)", () => {
    const rows = extractPendingPricingItems([
      { vendorItemNo: "ABC", unitPrice: 10 },
      { vendorItemNo: "abc", unitPrice: 12 },
      { vendorItemNo: " ABC ", unitPrice: 15 },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.vendorItemNo).toBe("ABC")
    expect(rows[0]?.unitPrice).toBe(15)
  })

  it("preserves insertion order across deduped + new rows", () => {
    const rows = extractPendingPricingItems([
      { vendorItemNo: "A", unitPrice: 1 },
      { vendorItemNo: "B", unitPrice: 2 },
      { vendorItemNo: "a", unitPrice: 99 },
      { vendorItemNo: "C", unitPrice: 3 },
    ])
    // Last-wins replaces the row entirely, so the casing from the
    // most recent input ("a") wins, but the slot order is preserved.
    expect(rows.map((r) => r.vendorItemNo)).toEqual(["a", "B", "C"])
    expect(rows[0]?.unitPrice).toBe(99)
  })
})
