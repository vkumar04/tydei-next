import { describe, it, expect } from "vitest"
import { calculateTierProgress } from "@/lib/contracts/tier-progress"
import type { TierLike } from "@/lib/rebates/calculate"

const TIERS: TierLike[] = [
  { tierNumber: 1, spendMin: 0, spendMax: 50_000, rebateValue: 2, tierName: "Bronze" },
  { tierNumber: 2, spendMin: 50_000, spendMax: 100_000, rebateValue: 3, tierName: "Silver" },
  { tierNumber: 3, spendMin: 100_000, spendMax: null, rebateValue: 4, tierName: "Gold" },
]

describe("calculateTierProgress (cumulative)", () => {
  it("spec example — $75K spend at Silver, $25K to Gold, +$750 projected rebate", () => {
    // Currently earning: $75K × 3% = $2,250
    // After hitting Gold ($100K): $100K × 4% = $4,000
    // Projected additional at the moment of promotion: $4,000 − $2,250 = $1,750
    // But the "projectedAdditionalRebate" uses the NEXT tier's rate on the gap only,
    // reported as (amountToNextTier × nextRate). Spec section 3 clarifies both;
    // we report the clearer "you'd earn X more on the next dollar bracket at the
    // new rate": $25,000 × 4% = $1,000 extra just on the new bracket, plus
    // the whole-spend recalc. Tests below pin both.
    const result = calculateTierProgress(75_000, TIERS, "cumulative")
    expect(result.currentTier?.tierNumber).toBe(2)
    expect(result.nextTier?.tierNumber).toBe(3)
    expect(result.amountToNextTier).toBe(25_000)
    // Progress through the current bracket: (75K - 50K) / (100K - 50K) = 50%
    expect(result.progressPercent).toBe(50)
  })

  it("at top tier: nextTier is null, progressPercent = 100, amountToNextTier = 0", () => {
    const result = calculateTierProgress(120_000, TIERS, "cumulative")
    expect(result.currentTier?.tierNumber).toBe(3)
    expect(result.nextTier).toBeNull()
    expect(result.amountToNextTier).toBe(0)
    expect(result.progressPercent).toBe(100)
  })

  it("at $0 spend: currentTier = tier 1, nextTier = tier 2, full bracket remaining", () => {
    const result = calculateTierProgress(0, TIERS, "cumulative")
    expect(result.currentTier?.tierNumber).toBe(1)
    expect(result.nextTier?.tierNumber).toBe(2)
    expect(result.amountToNextTier).toBe(50_000)
    expect(result.progressPercent).toBe(0)
  })

  it("spend exactly at tier boundary promotes and resets progress", () => {
    const result = calculateTierProgress(50_000, TIERS, "cumulative")
    expect(result.currentTier?.tierNumber).toBe(2)
    expect(result.nextTier?.tierNumber).toBe(3)
    expect(result.amountToNextTier).toBe(50_000)
    expect(result.progressPercent).toBe(0)
  })

  it("projectedAdditionalRebate at $75K spend to hit $100K Gold tier", () => {
    // Cumulative method: at $100K cumulative spend, rebate = $100K × 4% = $4,000
    // At current $75K, rebate = $75K × 3% = $2,250
    // Projected additional = $4,000 − $2,250 = $1,750
    const result = calculateTierProgress(75_000, TIERS, "cumulative")
    expect(result.projectedAdditionalRebate).toBeCloseTo(1_750, 2)
  })

  it("empty tiers returns null tiers and zero values", () => {
    const result = calculateTierProgress(10_000, [], "cumulative")
    expect(result.currentTier).toBeNull()
    expect(result.nextTier).toBeNull()
    expect(result.progressPercent).toBe(0)
    expect(result.amountToNextTier).toBe(0)
    expect(result.projectedAdditionalRebate).toBe(0)
  })

  it("preserves tierName on currentTier and nextTier", () => {
    const result = calculateTierProgress(75_000, TIERS, "cumulative")
    expect(result.currentTier?.tierName).toBe("Silver")
    expect(result.nextTier?.tierName).toBe("Gold")
  })
})

describe("calculateTierProgress (marginal)", () => {
  it("projectedAdditionalRebate for marginal — only the bracket gap earns at new rate", () => {
    // Marginal at $75K: $50K × 2% + $25K × 3% = $1,750
    // Marginal at $100K: $50K × 2% + $50K × 3% = $2,500
    // Projected additional (at promotion moment) = $2,500 − $1,750 = $750
    const result = calculateTierProgress(75_000, TIERS, "marginal")
    expect(result.projectedAdditionalRebate).toBeCloseTo(750, 2)
    expect(result.currentTier?.tierNumber).toBe(2)
    expect(result.nextTier?.tierNumber).toBe(3)
    expect(result.amountToNextTier).toBe(25_000)
  })
})
