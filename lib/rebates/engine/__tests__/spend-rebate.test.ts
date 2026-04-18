import { describe, it, expect } from "vitest"
import { calculateSpendRebate } from "../spend-rebate"
import type {
  PeriodData,
  PurchaseRecord,
  RebateTier,
  SpendRebateConfig,
} from "../types"

// ─── Fixtures ──────────────────────────────────────────────────
// Bronze / Silver / Gold ladder used throughout: 0-50k @ 2%, 50k-100k @ 4%, 100k+ @ 6%.
const BSG_TIERS: RebateTier[] = [
  { tierNumber: 1, tierName: "Bronze", thresholdMin: 0, thresholdMax: 50_000, rebateValue: 2 },
  { tierNumber: 2, tierName: "Silver", thresholdMin: 50_000, thresholdMax: 100_000, rebateValue: 4 },
  { tierNumber: 3, tierName: "Gold", thresholdMin: 100_000, thresholdMax: null, rebateValue: 6 },
]

function mkPurchase(overrides: Partial<PurchaseRecord>): PurchaseRecord {
  return {
    referenceNumber: "REF-DEFAULT",
    productCategory: null,
    quantity: 1,
    unitPrice: 0,
    extendedPrice: 0,
    purchaseDate: new Date("2026-01-15"),
    cptCode: null,
    caseId: null,
    ...overrides,
  }
}

describe("calculateSpendRebate — cumulative tier math", () => {
  it("$75K spend on Bronze/Silver/Gold ladder under EXCLUSIVE → Silver tier, $3K rebate", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "ALL_SPEND",
      baselineType: "NONE",
    }
    const periodData: PeriodData = {
      purchases: [],
      totalSpend: 75_000,
    }
    const result = calculateSpendRebate(config, periodData)
    expect(result.type).toBe("SPEND_REBATE")
    expect(result.rebateEarned).toBe(3_000)
    expect(result.eligibleSpend).toBe(75_000)
    expect(result.tierResult?.tier.tierNumber).toBe(2)
    expect(result.tierResult?.thresholdReached).toBe(75_000)
    expect(result.tierResult?.bracketBreakdown).toBeUndefined()
    expect(result.errors).toEqual([])
  })
})

describe("calculateSpendRebate — marginal tier math", () => {
  it("$75K marginal → $50K×2% + $25K×4% = $2K; 2 bracket entries", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "MARGINAL",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "ALL_SPEND",
      baselineType: "NONE",
    }
    const periodData: PeriodData = {
      purchases: [],
      totalSpend: 75_000,
    }
    const result = calculateSpendRebate(config, periodData)
    expect(result.rebateEarned).toBe(2_000)
    expect(result.tierResult?.bracketBreakdown).toBeDefined()
    expect(result.tierResult?.bracketBreakdown).toHaveLength(2)
    expect(result.tierResult?.bracketBreakdown?.[0]).toMatchObject({
      tierNumber: 1,
      bracketSpend: 50_000,
      bracketRate: 2,
      bracketRebate: 1_000,
    })
    expect(result.tierResult?.bracketBreakdown?.[1]).toMatchObject({
      tierNumber: 2,
      bracketSpend: 25_000,
      bracketRate: 4,
      bracketRebate: 1_000,
    })
  })
})

describe("calculateSpendRebate — spendBasis filtering", () => {
  it("ALL_SPEND basis uses periodData.totalSpend ignoring purchase filters", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "ALL_SPEND",
      baselineType: "NONE",
    }
    const periodData: PeriodData = {
      // totalSpend is the source of truth for ALL_SPEND even when the
      // purchases array is empty or inconsistent.
      purchases: [mkPurchase({ extendedPrice: 999 })],
      totalSpend: 60_000,
    }
    const result = calculateSpendRebate(config, periodData)
    expect(result.eligibleSpend).toBe(60_000)
    expect(result.tierResult?.tier.tierNumber).toBe(2)
  })

  it("REFERENCE_NUMBER basis sums only matching reference numbers", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "REFERENCE_NUMBER",
      baselineType: "NONE",
      referenceNumbers: ["REF-A", "REF-B"],
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({ referenceNumber: "REF-A", extendedPrice: 30_000 }),
        mkPurchase({ referenceNumber: "REF-B", extendedPrice: 25_000 }),
        mkPurchase({ referenceNumber: "REF-C", extendedPrice: 99_999 }),
      ],
      totalSpend: 99_999 + 55_000,
    }
    const result = calculateSpendRebate(config, periodData)
    expect(result.eligibleSpend).toBe(55_000)
    // 55k under EXCLUSIVE with tier2 starting at 50k: tier 2 achieved
    expect(result.tierResult?.tier.tierNumber).toBe(2)
    // cumulative rebate: 55k × 4% = 2200
    expect(result.rebateEarned).toBe(2_200)
  })

  it("PRODUCT_CATEGORY basis filters by productCategory exact match", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "PRODUCT_CATEGORY",
      baselineType: "NONE",
      productCategory: "ORTHOPEDICS",
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({ productCategory: "ORTHOPEDICS", extendedPrice: 40_000 }),
        mkPurchase({ productCategory: "ORTHOPEDICS", extendedPrice: 20_000 }),
        mkPurchase({ productCategory: "CARDIO", extendedPrice: 50_000 }),
      ],
      totalSpend: 110_000,
    }
    const result = calculateSpendRebate(config, periodData)
    expect(result.eligibleSpend).toBe(60_000)
    expect(result.tierResult?.tier.tierNumber).toBe(2)
  })

  it("MULTI_CATEGORY basis sums across the listed categories", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "MULTI_CATEGORY",
      baselineType: "NONE",
      categories: ["ORTHOPEDICS", "CARDIO"],
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({ productCategory: "ORTHOPEDICS", extendedPrice: 30_000 }),
        mkPurchase({ productCategory: "CARDIO", extendedPrice: 40_000 }),
        mkPurchase({ productCategory: "GI", extendedPrice: 999_999 }),
      ],
      totalSpend: 999_999 + 70_000,
    }
    const result = calculateSpendRebate(config, periodData)
    expect(result.eligibleSpend).toBe(70_000)
    expect(result.tierResult?.tier.tierNumber).toBe(2)
  })
})

describe("calculateSpendRebate — baseline / growth adjustment", () => {
  it("PRIOR_YEAR_ACTUAL: $100K current, $60K prior → tier evaluated on $40K growth", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "ALL_SPEND",
      baselineType: "PRIOR_YEAR_ACTUAL",
    }
    const periodData: PeriodData = {
      purchases: [],
      totalSpend: 100_000,
      priorYearActualSpend: 60_000,
    }
    const result = calculateSpendRebate(config, periodData)
    // growth-adjusted = 40k → Bronze (tier 1) @ 2% = $800
    expect(result.tierResult?.tier.tierNumber).toBe(1)
    expect(result.rebateEarned).toBe(800)
    // eligibleSpend is the pre-baseline figure per spec
    expect(result.eligibleSpend).toBe(100_000)
    // thresholdReached is the adjusted spend
    expect(result.tierResult?.thresholdReached).toBe(40_000)
  })

  it("NEGOTIATED_FIXED baseline subtracts from eligibleSpend", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "ALL_SPEND",
      baselineType: "NEGOTIATED_FIXED",
      negotiatedBaseline: 25_000,
    }
    const periodData: PeriodData = {
      purchases: [],
      totalSpend: 80_000,
    }
    const result = calculateSpendRebate(config, periodData)
    // adjusted = 55k → Silver @ 4% = 2200
    expect(result.tierResult?.tier.tierNumber).toBe(2)
    expect(result.rebateEarned).toBe(2_200)
  })

  it("growthOnly with missing baseline → warning pushed, full eligibleSpend used", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "ALL_SPEND",
      baselineType: "PRIOR_YEAR_ACTUAL",
      growthOnly: true,
    }
    const periodData: PeriodData = {
      purchases: [],
      totalSpend: 80_000,
      // priorYearActualSpend deliberately omitted
    }
    const result = calculateSpendRebate(config, periodData)
    expect(result.warnings).toContain(
      "Growth-only spend rebate is missing baseline; falling back to full eligible spend",
    )
    // evaluated on full 80k → Silver @ 4% = 3200
    expect(result.rebateEarned).toBe(3_200)
    expect(result.tierResult?.thresholdReached).toBe(80_000)
  })

  it("negative eligibleSpend (baseline > current) clamps to 0 rebate", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "ALL_SPEND",
      baselineType: "NEGOTIATED_FIXED",
      negotiatedBaseline: 100_000,
    }
    const periodData: PeriodData = {
      purchases: [],
      totalSpend: 40_000,
    }
    const result = calculateSpendRebate(config, periodData)
    // adjusted = max(0, 40k - 100k) = 0 → no tier qualifies (below tier1.min=0? Actually tier1 min=0 with EXCLUSIVE => value >= 0 qualifies)
    // Bronze min=0 with EXCLUSIVE → 0 >= 0 → tier 1 qualifies → rebate = 0 × 2% = 0
    expect(result.rebateEarned).toBe(0)
  })
})

describe("calculateSpendRebate — amountToNextTier [A4]", () => {
  it("uses TOTAL spend distance, not growth-adjusted, for next-tier gap", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "ALL_SPEND",
      baselineType: "PRIOR_YEAR_ACTUAL",
    }
    const periodData: PeriodData = {
      purchases: [],
      totalSpend: 75_000,
      priorYearActualSpend: 50_000,
    }
    const result = calculateSpendRebate(config, periodData)
    // adjusted = 25k → Bronze (tier 1); next tier at 50k
    // [A4] amountToNextTier = 50_000 - totalSpend(75_000) = negative → clamped to 0.
    // This proves the calc is against TOTAL, not adjusted (25k → distance would be 25k).
    expect(result.tierResult?.tier.tierNumber).toBe(1)
    expect(result.tierResult?.amountToNextTier).toBe(0)
  })

  it("top-tier achieved → amountToNextTier is null", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "ALL_SPEND",
      baselineType: "NONE",
    }
    const periodData: PeriodData = {
      purchases: [],
      totalSpend: 250_000,
    }
    const result = calculateSpendRebate(config, periodData)
    expect(result.tierResult?.tier.tierNumber).toBe(3)
    expect(result.tierResult?.amountToNextTier).toBeNull()
  })

  it("mid-tier achieved, below next threshold → distance reported", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "ALL_SPEND",
      baselineType: "NONE",
    }
    const periodData: PeriodData = {
      purchases: [],
      totalSpend: 75_000,
    }
    const result = calculateSpendRebate(config, periodData)
    // tier 2 achieved; next tier 3 at 100k; distance = 25k
    expect(result.tierResult?.amountToNextTier).toBe(25_000)
  })
})

describe("calculateSpendRebate — edge cases", () => {
  it("empty tiers → warning + zero rebate", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: [],
      spendBasis: "ALL_SPEND",
      baselineType: "NONE",
    }
    const periodData: PeriodData = {
      purchases: [],
      totalSpend: 500_000,
    }
    const result = calculateSpendRebate(config, periodData)
    expect(result.rebateEarned).toBe(0)
    expect(result.tierResult).toBeNull()
    expect(result.warnings).toContain(
      "Spend rebate has no tiers configured; returning zero rebate",
    )
    expect(result.errors).toEqual([])
  })

  it("echoes periodLabel from options when provided", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "ALL_SPEND",
      baselineType: "NONE",
    }
    const periodData: PeriodData = { purchases: [], totalSpend: 10_000 }
    const result = calculateSpendRebate(config, periodData, { periodLabel: "2026-Q2" })
    expect(result.periodLabel).toBe("2026-Q2")
  })

  it("trueUpAdjustment is always 0 at the base engine layer", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "ALL_SPEND",
      baselineType: "NONE",
    }
    const periodData: PeriodData = { purchases: [], totalSpend: 150_000, priorAccruals: 999 }
    const result = calculateSpendRebate(config, periodData)
    expect(result.trueUpAdjustment).toBe(0)
  })

  it("priceReductionValue is always 0 for SPEND_REBATE", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "MARGINAL",
      boundaryRule: "EXCLUSIVE",
      tiers: BSG_TIERS,
      spendBasis: "ALL_SPEND",
      baselineType: "NONE",
    }
    const periodData: PeriodData = { purchases: [], totalSpend: 120_000 }
    const result = calculateSpendRebate(config, periodData)
    expect(result.priceReductionValue).toBe(0)
  })
})
