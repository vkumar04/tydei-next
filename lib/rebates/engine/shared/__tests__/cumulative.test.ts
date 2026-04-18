import { describe, it, expect } from "vitest"
import { calculateCumulativeRebate } from "../cumulative"
import type { RebateTier } from "../../types"

const t = (n: number, min: number, max: number | null, rate: number): RebateTier => ({
  tierNumber: n,
  thresholdMin: min,
  thresholdMax: max,
  rebateValue: rate,
})

describe("calculateCumulativeRebate", () => {
  const tiers = [
    t(1, 0, 50_000, 2), // 2% up to $50K
    t(2, 50_000, 100_000, 4), // 4% in $50K-$100K
    t(3, 100_000, null, 6), // 6% above $100K
  ]

  it("returns zero when no tier qualifies", () => {
    const result = calculateCumulativeRebate(0, [], "EXCLUSIVE")
    expect(result.rebate).toBe(0)
    expect(result.tier).toBeNull()
  })

  it("applies achieved tier's rate to the FULL amount (cumulative)", () => {
    // $75K in tier 2 (4%) → 75,000 × 0.04 = $3,000 (cumulative, not marginal)
    const result = calculateCumulativeRebate(75_000, tiers, "EXCLUSIVE")
    expect(result.rebate).toBe(3_000)
    expect(result.tier?.tierNumber).toBe(2)
  })

  it("Bronze/Silver/Gold worked example: $75K → Silver (4%) → $3000", () => {
    const result = calculateCumulativeRebate(75_000, tiers, "EXCLUSIVE")
    expect(result.tier?.tierNumber).toBe(2)
    expect(result.rebate).toBe(3_000)
  })

  it("top tier at $200K: 200,000 × 6% = $12,000", () => {
    const result = calculateCumulativeRebate(200_000, tiers, "EXCLUSIVE")
    expect(result.rebate).toBe(12_000)
  })

  it("respects fixedRebateAmount on the tier (overrides percentage math)", () => {
    const fixedTiers: RebateTier[] = [
      {
        tierNumber: 1,
        thresholdMin: 0,
        thresholdMax: null,
        rebateValue: 999, // should be ignored
        fixedRebateAmount: 2_500,
      },
    ]
    const result = calculateCumulativeRebate(100_000, fixedTiers, "EXCLUSIVE")
    expect(result.rebate).toBe(2_500)
  })
})
