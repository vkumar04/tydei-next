import { describe, it, expect } from "vitest"
import { calculateMarketShareRebate } from "../market-share-rebate"
import type {
  MarketShareRebateConfig,
  PeriodData,
  RebateTier,
} from "../types"

// ─── Fixtures ──────────────────────────────────────────────────
// Share-% ladder: 0-20% @ 1%, 20-40% @ 2%, 40%+ @ 3%.
// Thresholds expressed as share % (not dollars).
const SHARE_TIERS: RebateTier[] = [
  { tierNumber: 1, tierName: "Low", thresholdMin: 0, thresholdMax: 20, rebateValue: 1 },
  { tierNumber: 2, tierName: "Mid", thresholdMin: 20, thresholdMax: 40, rebateValue: 2 },
  { tierNumber: 3, tierName: "High", thresholdMin: 40, thresholdMax: null, rebateValue: 3 },
]

function emptyPurchases(): PeriodData["purchases"] {
  return []
}

describe("calculateMarketShareRebate — cumulative tier math [A6]", () => {
  it("45% share → top tier × full vendorCategorySpend (3% × $100K = $3,000)", () => {
    // [A6] 45% share lands in tier 3 (40%+); rebate = 100K × 3% on VENDOR spend (not share %).
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 200_000,
      vendorCategorySpend: 90_000, // 90k/200k = 45%
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.type).toBe("MARKET_SHARE_REBATE")
    expect(result.tierResult?.tier.tierNumber).toBe(3)
    expect(result.tierResult?.thresholdReached).toBe(45)
    // $90K × 3% = $2,700 (NOT 45 × 3%, which would be a nonsense $1.35)
    expect(result.rebateEarned).toBe(2_700)
    expect(result.eligibleSpend).toBe(90_000)
    expect(result.errors).toEqual([])
  })

  it("spec example: 45% share + $100K vendorSpend + top tier 3% → $3,000", () => {
    // Matches the spec deliverables example verbatim.
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    // Use denominator that yields exactly 45%: 100k / x = 0.45 → x ≈ 222_222.22
    // Cleaner: set vendorCategorySpend = 45, totalCategorySpend = 100 for share %
    // but then vendor spend = $45. We want $100K vendor spend with 45% share,
    // so totalCategorySpend = 100K / 0.45 = 222_222.222...
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 100_000 / 0.45,
      vendorCategorySpend: 100_000,
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.tierResult?.tier.tierNumber).toBe(3)
    // 100K × 3% = 3000
    expect(result.rebateEarned).toBeCloseTo(3_000, 6)
  })

  it("25% share → tier 2 (20-40% bracket) × $100K × 2% = $2,000", () => {
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 400_000,
      vendorCategorySpend: 100_000, // 100k/400k = 25%
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.tierResult?.tier.tierNumber).toBe(2)
    expect(result.tierResult?.thresholdReached).toBe(25)
    expect(result.rebateEarned).toBe(2_000)
  })

  it("cumulative honors fixed rebate amount on achieved tier", () => {
    const tiers: RebateTier[] = [
      { tierNumber: 1, thresholdMin: 0, thresholdMax: 50, rebateValue: 0, fixedRebateAmount: 500 },
      { tierNumber: 2, thresholdMin: 50, thresholdMax: null, rebateValue: 0, fixedRebateAmount: 1_500 },
    ]
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 100_000,
      vendorCategorySpend: 60_000, // 60% → tier 2
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.rebateEarned).toBe(1_500)
  })
})

describe("calculateMarketShareRebate — marginal bucketed math [A6]", () => {
  it("45% marginal: 20%×1% + 20%×2% + 5%×3% on $100K vendor spend → $750", () => {
    // [A6] Proportional spend bucketing across share % brackets:
    //   tier 1 (0-20%):  20pp / 100 × $100K = $20K × 1% = $200
    //   tier 2 (20-40%): 20pp / 100 × $100K = $20K × 2% = $400
    //   tier 3 (40%+):   5pp  / 100 × $100K = $5K  × 3% = $150
    //   total = $750
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "MARGINAL",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 100_000 / 0.45,
      vendorCategorySpend: 100_000, // 45% share
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.rebateEarned).toBeCloseTo(750, 6)
    expect(result.tierResult?.tier.tierNumber).toBe(3)
    const breakdown = result.tierResult?.bracketBreakdown
    expect(breakdown).toBeDefined()
    expect(breakdown).toHaveLength(3)
    expect(breakdown?.[0]).toMatchObject({
      tierNumber: 1,
      bracketRate: 1,
    })
    expect(breakdown?.[0]?.bracketSpend).toBeCloseTo(20_000, 6)
    expect(breakdown?.[0]?.bracketRebate).toBeCloseTo(200, 6)
    expect(breakdown?.[1]?.bracketRebate).toBeCloseTo(400, 6)
    expect(breakdown?.[2]?.bracketRebate).toBeCloseTo(150, 6)
  })

  it("marginal at 25% share only activates first two brackets", () => {
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "MARGINAL",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 400_000,
      vendorCategorySpend: 100_000, // 25%
    }
    const result = calculateMarketShareRebate(config, periodData)
    // tier 1: 20/100 × 100k × 1% = 200
    // tier 2: 5/100  × 100k × 2% = 100
    // total = 300
    expect(result.rebateEarned).toBeCloseTo(300, 6)
    expect(result.tierResult?.bracketBreakdown).toHaveLength(2)
  })
})

describe("calculateMarketShareRebate — error paths", () => {
  it("missing totalCategorySpend → errors array populated, zero rebate", () => {
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      // totalCategorySpend deliberately omitted
      vendorCategorySpend: 10_000,
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.rebateEarned).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("totalCategorySpend")
  })

  it("zero totalCategorySpend → errors array populated", () => {
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 0,
      vendorCategorySpend: 100_000,
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.errors[0]).toContain("totalCategorySpend")
  })

  it("missing vendorCategorySpend → errors array populated, zero rebate", () => {
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 500_000,
      // vendorCategorySpend deliberately omitted
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.rebateEarned).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("vendorCategorySpend")
  })

  it("zero vendorCategorySpend → errors populated (documented decision: treat 0 as fatal)", () => {
    // DECISION: vendorCategorySpend === 0 is treated the same as missing
    // because a zero numerator means no in-category activity to rebate
    // against — any dollar calc is definitionally zero. Surface as ERROR so
    // callers notice the data gap rather than silently returning $0.
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 500_000,
      vendorCategorySpend: 0,
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.rebateEarned).toBe(0)
    expect(result.errors[0]).toContain("vendorCategorySpend")
  })
})

describe("calculateMarketShareRebate — edge cases", () => {
  it("empty tiers → warning + zero rebate, no errors", () => {
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: [],
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 100_000,
      vendorCategorySpend: 40_000,
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.rebateEarned).toBe(0)
    expect(result.errors).toEqual([])
    expect(result.warnings[0]).toContain("no tiers configured")
  })

  it("market share > 100% (vendor > total; data error) → WARNING not error; math continues", () => {
    // DECISION: We do NOT clamp silently, nor do we bail with an error.
    // Spec doesn't prescribe; choice is to (a) surface a loud WARNING so
    // downstream operators notice the data inconsistency, (b) keep dollar
    // math against raw vendorCategorySpend for cumulative (accurate), and
    // (c) clamp the marginal bracketing ceiling to 100% to avoid
    // brackets summing to more than the vendor spend. Tier lookup uses the
    // raw share % (so >100% lands in the top tier as expected).
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 50_000,
      vendorCategorySpend: 100_000, // 200% — data error
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.errors).toEqual([])
    expect(result.warnings.some((w) => w.includes(">100%"))).toBe(true)
    // 200% lands in tier 3 (40%+); cumulative = 100K × 3% = 3000
    expect(result.tierResult?.tier.tierNumber).toBe(3)
    expect(result.rebateEarned).toBe(3_000)
  })

  it("market share > 100% under MARGINAL clamps bucket sum to ≤ vendorCategorySpend", () => {
    // At 200% share, marginal brackets must not sum to more than 100% of
    // vendorCategorySpend. With SHARE_TIERS rates 1/2/3%, clamped to 100%:
    //   tier 1: 20/100 × 100K × 1% = 200
    //   tier 2: 20/100 × 100K × 2% = 400
    //   tier 3: (100-40)/100 × 100K × 3% = 1800
    //   total  = 2400
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "MARGINAL",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 50_000,
      vendorCategorySpend: 100_000,
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.warnings.some((w) => w.includes(">100%"))).toBe(true)
    expect(result.rebateEarned).toBeCloseTo(2_400, 6)
  })

  it("echoes periodLabel from options when provided", () => {
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 100_000,
      vendorCategorySpend: 40_000,
    }
    const result = calculateMarketShareRebate(config, periodData, { periodLabel: "2026-Q3" })
    expect(result.periodLabel).toBe("2026-Q3")
  })

  it("trueUpAdjustment is always 0 at the base engine layer", () => {
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 100_000,
      vendorCategorySpend: 60_000,
      priorAccruals: 999,
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.trueUpAdjustment).toBe(0)
  })

  it("priceReductionValue is always 0 for MARKET_SHARE_REBATE", () => {
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "MARGINAL",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 100_000,
      vendorCategorySpend: 60_000,
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.priceReductionValue).toBe(0)
  })

  it("amountToNextTier uses share-percent distance (not dollars)", () => {
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 400_000,
      vendorCategorySpend: 100_000, // 25% → tier 2; next tier at 40%
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.tierResult?.amountToNextTier).toBe(15) // 40 - 25
  })

  it("top tier achieved → amountToNextTier is null", () => {
    const config: MarketShareRebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: SHARE_TIERS,
    }
    const periodData: PeriodData = {
      purchases: emptyPurchases(),
      totalSpend: 0,
      totalCategorySpend: 100_000,
      vendorCategorySpend: 80_000, // 80%
    }
    const result = calculateMarketShareRebate(config, periodData)
    expect(result.tierResult?.tier.tierNumber).toBe(3)
    expect(result.tierResult?.amountToNextTier).toBeNull()
  })
})
