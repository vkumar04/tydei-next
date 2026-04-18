import { describe, it, expect } from "vitest"
import { calculateMarketSharePriceReduction } from "../market-share-price-reduction"
import type {
  MarketSharePriceReductionConfig,
  PeriodData,
  PurchaseRecord,
  RebateTier,
} from "../types"

// ─── Fixtures ──────────────────────────────────────────────────
// Thresholds are in market-share percent.
const SHARE_TIERS: RebateTier[] = [
  {
    tierNumber: 1,
    thresholdMin: 25,
    thresholdMax: 50,
    rebateValue: 0,
    priceReductionPercent: 0.05,
  },
  {
    tierNumber: 2,
    thresholdMin: 50,
    thresholdMax: 75,
    rebateValue: 0,
    reducedPrice: 80,
  },
  {
    tierNumber: 3,
    thresholdMin: 75,
    thresholdMax: null,
    rebateValue: 0,
    priceReductionPercent: 0.2,
  },
]

function mkPurchase(overrides: Partial<PurchaseRecord>): PurchaseRecord {
  return {
    referenceNumber: "REF-DEFAULT",
    productCategory: null,
    quantity: 1,
    unitPrice: 100,
    extendedPrice: 100,
    purchaseDate: new Date("2026-01-15"),
    cptCode: null,
    caseId: null,
    ...overrides,
  }
}

describe("calculateMarketSharePriceReduction — tier resolution", () => {
  it("40% share lands in tier 1 (25-50%) and applies priceReductionPercent=0.05", () => {
    const config: MarketSharePriceReductionConfig = {
      type: "MARKET_SHARE_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
      trigger: "RETROACTIVE",
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({ unitPrice: 100, quantity: 10, extendedPrice: 1000 }),
        mkPurchase({
          referenceNumber: "REF-B",
          unitPrice: 200,
          quantity: 5,
          extendedPrice: 1000,
        }),
      ],
      totalSpend: 2_000,
      totalCategorySpend: 10_000,
      vendorCategorySpend: 4_000, // 40% share
    }
    const result = calculateMarketSharePriceReduction(config, periodData)
    expect(result.tierResult?.tier.tierNumber).toBe(1)
    // Per-line reductions: 100×0.05×10=50, 200×0.05×5=50 → total 100
    expect(result.priceReductionLines).toHaveLength(2)
    expect(result.priceReductionValue).toBeCloseTo(100, 10)
    expect(result.rebateEarned).toBe(0)
    expect(result.errors).toEqual([])
  })

  it("60% share lands in tier 2 (reducedPrice=80), per-line reductions apply", () => {
    const config: MarketSharePriceReductionConfig = {
      type: "MARKET_SHARE_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
      trigger: "RETROACTIVE",
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({
          referenceNumber: "REF-A",
          unitPrice: 100,
          quantity: 5,
          extendedPrice: 500,
        }),
        mkPurchase({
          referenceNumber: "REF-B",
          unitPrice: 150,
          quantity: 5,
          extendedPrice: 750,
        }),
      ],
      totalSpend: 1_250,
      totalCategorySpend: 10_000,
      vendorCategorySpend: 6_000, // 60%
    }
    const result = calculateMarketSharePriceReduction(config, periodData)
    expect(result.tierResult?.tier.tierNumber).toBe(2)
    const byRef = new Map(
      (result.priceReductionLines ?? []).map((l) => [l.referenceNumber, l]),
    )
    // REF-A: 100 -> 80, reduction 20 × 5 = 100
    expect(byRef.get("REF-A")?.totalLineReduction).toBe(100)
    // REF-B: 150 -> 80, reduction 70 × 5 = 350
    expect(byRef.get("REF-B")?.totalLineReduction).toBe(350)
    expect(result.priceReductionValue).toBe(450)
  })
})

describe("calculateMarketSharePriceReduction — error paths", () => {
  it("totalCategorySpend missing → errors[] populated, no throw", () => {
    const config: MarketSharePriceReductionConfig = {
      type: "MARKET_SHARE_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
      trigger: "RETROACTIVE",
    }
    const periodData: PeriodData = {
      purchases: [],
      totalSpend: 0,
      // totalCategorySpend deliberately omitted
      vendorCategorySpend: 1_000,
    }
    const result = calculateMarketSharePriceReduction(config, periodData)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("totalCategorySpend")
    expect(result.priceReductionValue).toBe(0)
    expect(result.rebateEarned).toBe(0)
  })

  it("totalCategorySpend === 0 → errors[] populated", () => {
    const config: MarketSharePriceReductionConfig = {
      type: "MARKET_SHARE_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
      trigger: "RETROACTIVE",
    }
    const periodData: PeriodData = {
      purchases: [],
      totalSpend: 0,
      totalCategorySpend: 0,
      vendorCategorySpend: 1_000,
    }
    const result = calculateMarketSharePriceReduction(config, periodData)
    expect(result.errors[0]).toContain("totalCategorySpend")
  })

  it("empty tiers → warning, zero reduction", () => {
    const config: MarketSharePriceReductionConfig = {
      type: "MARKET_SHARE_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: [],
      trigger: "RETROACTIVE",
    }
    const periodData: PeriodData = {
      purchases: [],
      totalSpend: 0,
      totalCategorySpend: 10_000,
      vendorCategorySpend: 5_000,
    }
    const result = calculateMarketSharePriceReduction(config, periodData)
    expect(result.priceReductionValue).toBe(0)
    expect(
      result.warnings.some((w) => w.includes("no tiers configured")),
    ).toBe(true)
  })
})

describe("calculateMarketSharePriceReduction — trigger + category scoping", () => {
  it("FORWARD_ONLY trigger emits a warning", () => {
    const config: MarketSharePriceReductionConfig = {
      type: "MARKET_SHARE_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
      trigger: "FORWARD_ONLY",
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({ unitPrice: 100, quantity: 10, extendedPrice: 1000 }),
      ],
      totalSpend: 1_000,
      totalCategorySpend: 10_000,
      vendorCategorySpend: 4_000,
    }
    const result = calculateMarketSharePriceReduction(config, periodData)
    expect(
      result.warnings.some((w) => w.includes("FORWARD_ONLY")),
    ).toBe(true)
  })

  it("marketShareCategory restricts the purchase set feeding line reductions", () => {
    const config: MarketSharePriceReductionConfig = {
      type: "MARKET_SHARE_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
      trigger: "RETROACTIVE",
      marketShareCategory: "ORTHO",
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({
          productCategory: "ORTHO",
          unitPrice: 100,
          quantity: 5,
          extendedPrice: 500,
        }),
        mkPurchase({
          productCategory: "CARDIO",
          unitPrice: 100,
          quantity: 5,
          extendedPrice: 500,
        }),
      ],
      totalSpend: 1_000,
      totalCategorySpend: 10_000,
      vendorCategorySpend: 4_000,
    }
    const result = calculateMarketSharePriceReduction(config, periodData)
    // Only the ORTHO purchase produces a line.
    expect(result.priceReductionLines).toHaveLength(1)
  })

  it("zero vendorCategorySpend → 0% share, no tier matches, zero reduction, no error", () => {
    const config: MarketSharePriceReductionConfig = {
      type: "MARKET_SHARE_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
      trigger: "RETROACTIVE",
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({ unitPrice: 100, quantity: 10, extendedPrice: 1000 }),
      ],
      totalSpend: 1_000,
      totalCategorySpend: 10_000,
      // vendorCategorySpend omitted → treated as 0
    }
    const result = calculateMarketSharePriceReduction(config, periodData)
    expect(result.errors).toEqual([])
    expect(result.tierResult).toBeNull()
    expect(result.priceReductionValue).toBe(0)
  })
})
