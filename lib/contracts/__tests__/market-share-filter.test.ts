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

  describe("confirmedCategoryMap (Charles 2026-06-07 remap honoring)", () => {
    // The user mapped "Ortho-Upper Extremity" -> "Ortho-Extremity" via the
    // Map Categories dialog (a confirmed CategoryMapping). Market share must
    // collapse the source into the target. The map is keyed by the same
    // normalization the import path uses: trim/lowercase/collapse-whitespace.
    const confirmedCategoryMap = new Map<string, string>([
      ["ortho-upper extremity", "Ortho-Extremity"],
    ])

    it("collapses a remapped source category into its target (single vendor)", () => {
      const result = computeCategoryMarketShare({
        rows: [
          { vendorId: VENDOR, category: "Ortho-Upper Extremity", extendedPrice: 60, contractId: null },
          { vendorId: VENDOR, category: "Ortho-Extremity", extendedPrice: 40, contractId: null },
        ],
        contractCategoryMap: new Map(),
        vendorId: VENDOR,
        confirmedCategoryMap,
      })
      // ONE row, summing both sources.
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({
        category: "Ortho-Extremity",
        vendorSpend: 100,
        categoryTotal: 100,
        sharePct: 100,
      })
    })

    it("applies the remap to BOTH numerator and denominator", () => {
      const result = computeCategoryMarketShare({
        rows: [
          // Vendor under the source label, competitor under the target label.
          { vendorId: VENDOR, category: "Ortho-Upper Extremity", extendedPrice: 80, contractId: null },
          { vendorId: OTHER, category: "Ortho-Extremity", extendedPrice: 20, contractId: null },
        ],
        contractCategoryMap: new Map(),
        vendorId: VENDOR,
        confirmedCategoryMap,
      })
      expect(result.rows).toHaveLength(1)
      // Numerator includes the remapped vendor row (80); denominator includes
      // both, so share is 80/100 — not two separate rows at 100% each.
      expect(result.rows[0]).toMatchObject({
        category: "Ortho-Extremity",
        vendorSpend: 80,
        categoryTotal: 100,
        sharePct: 80,
        competingVendors: 2,
      })
    })

    it("applies the remap through the contract-category fallback too", () => {
      const result = computeCategoryMarketShare({
        rows: [
          { vendorId: VENDOR, category: null, extendedPrice: 50, contractId: "c1" },
          { vendorId: VENDOR, category: "Ortho-Extremity", extendedPrice: 50, contractId: null },
        ],
        contractCategoryMap: new Map([["c1", "Ortho-Upper Extremity"]]),
        vendorId: VENDOR,
        confirmedCategoryMap,
      })
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({
        category: "Ortho-Extremity",
        vendorSpend: 100,
        categoryTotal: 100,
      })
    })

    it("is a no-op when no map is supplied (back-compat)", () => {
      const result = computeCategoryMarketShare({
        rows: [
          { vendorId: VENDOR, category: "Ortho-Upper Extremity", extendedPrice: 60, contractId: null },
          { vendorId: VENDOR, category: "Ortho-Extremity", extendedPrice: 40, contractId: null },
        ],
        contractCategoryMap: new Map(),
        vendorId: VENDOR,
      })
      // Without the map these are two distinct canonical categories.
      expect(result.rows.map((r) => r.category).sort()).toEqual([
        "Ortho-Extremity",
        "Ortho-Upper Extremity",
      ])
    })
  })
})
