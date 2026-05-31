/**
 * #2 (Vick 2026-05-31): computeCategoryMarketShare must sum the numerator
 * across a vendor SET for grouped contracts, while a single-vendor string
 * stays exactly as before (so the parity test / vendor dashboard widget
 * are unaffected).
 */
import { describe, it, expect } from "vitest"
import {
  computeCategoryMarketShare,
  type MarketShareCogRow,
} from "@/lib/contracts/market-share-filter"

const rows: MarketShareCogRow[] = [
  { vendorId: "v1", category: "Ortho", extendedPrice: 100, contractId: null },
  { vendorId: "v2", category: "Ortho", extendedPrice: 50, contractId: null },
  { vendorId: "v3", category: "Ortho", extendedPrice: 50, contractId: null }, // competitor
]
const emptyMap = new Map<string, string | null>()

describe("computeCategoryMarketShare — grouped numerator", () => {
  it("single vendor: numerator is just that vendor (unchanged)", () => {
    const r = computeCategoryMarketShare({ rows, contractCategoryMap: emptyMap, vendorId: "v1" })
    const ortho = r.rows.find((x) => x.category === "Ortho")!
    expect(ortho.vendorSpend).toBe(100)
    expect(ortho.categoryTotal).toBe(200)
    expect(ortho.sharePct).toBe(50)
  })

  it("a single-element array equals the string form", () => {
    const r = computeCategoryMarketShare({ rows, contractCategoryMap: emptyMap, vendorId: ["v1"] })
    expect(r.rows.find((x) => x.category === "Ortho")!.vendorSpend).toBe(100)
  })

  it("grouped: numerator sums every vendor in the set; denominator unchanged", () => {
    const r = computeCategoryMarketShare({
      rows,
      contractCategoryMap: emptyMap,
      vendorId: ["v1", "v2"],
    })
    const ortho = r.rows.find((x) => x.category === "Ortho")!
    expect(ortho.vendorSpend).toBe(150) // v1 + v2
    expect(ortho.categoryTotal).toBe(200) // whole market
    expect(ortho.sharePct).toBe(75)
  })
})
