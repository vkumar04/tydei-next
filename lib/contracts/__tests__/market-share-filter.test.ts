// lib/contracts/__tests__/market-share-filter.test.ts
import { describe, it, expect } from "vitest"
import { computeCategoryMarketShare } from "@/lib/contracts/market-share-filter"

describe("computeCategoryMarketShare", () => {
  const VENDOR = "v_stryker"
  const OTHER = "v_other"

  it("uses explicit COG category when present", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: "Ortho-Extremity", extendedPrice: 100, contractId: null },
        { vendorId: OTHER, category: "Ortho-Extremity", extendedPrice: 100, contractId: null },
      ],
      contractCategoryMap: new Map(),
      vendorId: VENDOR,
    })
    expect(result.rows).toEqual([
      expect.objectContaining({
        category: "Ortho-Extremity",
        vendorSpend: 100,
        categoryTotal: 200,
        sharePct: 50,
        competingVendors: 2,
      }),
    ])
    expect(result.uncategorizedSpend).toBe(0)
    expect(result.totalVendorSpend).toBe(100)
  })

  it("falls back to contract.productCategory when COG.category is null", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: null, extendedPrice: 80, contractId: "c1" },
        { vendorId: OTHER, category: null, extendedPrice: 20, contractId: "c2" },
      ],
      contractCategoryMap: new Map([
        ["c1", "Ortho-Extremity"],
        ["c2", "Ortho-Extremity"],
      ]),
      vendorId: VENDOR,
    })
    expect(result.rows[0]).toMatchObject({
      category: "Ortho-Extremity",
      vendorSpend: 80,
      categoryTotal: 100,
      sharePct: 80,
    })
    expect(result.uncategorizedSpend).toBe(0)
  })

  it("counts truly-uncategorized rows separately", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: null, extendedPrice: 50, contractId: null },
        { vendorId: VENDOR, category: "Spine", extendedPrice: 50, contractId: null },
      ],
      contractCategoryMap: new Map(),
      vendorId: VENDOR,
    })
    expect(result.uncategorizedSpend).toBe(50)
    expect(result.totalVendorSpend).toBe(100)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].category).toBe("Spine")
  })

  it("skips categories where the target vendor has zero spend", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: "Spine", extendedPrice: 100, contractId: null },
        { vendorId: OTHER, category: "Joint Replacement", extendedPrice: 100, contractId: null },
      ],
      contractCategoryMap: new Map(),
      vendorId: VENDOR,
    })
    expect(result.rows.map((r) => r.category)).toEqual(["Spine"])
  })

  it("ignores zero / negative line amounts", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: "Spine", extendedPrice: 0, contractId: null },
        { vendorId: VENDOR, category: "Spine", extendedPrice: -5, contractId: null },
        { vendorId: VENDOR, category: "Spine", extendedPrice: 100, contractId: null },
      ],
      contractCategoryMap: new Map(),
      vendorId: VENDOR,
    })
    expect(result.rows[0].vendorSpend).toBe(100)
    expect(result.totalVendorSpend).toBe(100)
  })

  it("attaches commitmentPct from optional overlay", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: "Spine", extendedPrice: 100, contractId: null },
      ],
      contractCategoryMap: new Map(),
      vendorId: VENDOR,
      commitmentByCategory: new Map([["Spine", 60]]),
    })
    expect(result.rows[0].commitmentPct).toBe(60)
  })

  it("sorts result rows by category total descending", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: "Spine", extendedPrice: 50, contractId: null },
        { vendorId: VENDOR, category: "Joint Replacement", extendedPrice: 200, contractId: null },
      ],
      contractCategoryMap: new Map(),
      vendorId: VENDOR,
    })
    expect(result.rows.map((r) => r.category)).toEqual(["Joint Replacement", "Spine"])
  })
})
