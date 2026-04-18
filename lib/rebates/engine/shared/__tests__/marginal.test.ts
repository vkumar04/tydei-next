import { describe, it, expect } from "vitest"
import { calculateMarginalRebate } from "../marginal"
import type { RebateTier } from "../../types"

const t = (n: number, min: number, max: number | null, rate: number): RebateTier => ({
  tierNumber: n,
  thresholdMin: min,
  thresholdMax: max,
  rebateValue: rate,
})

describe("calculateMarginalRebate", () => {
  const tiers = [
    t(1, 0, 50_000, 2), // 2% for first $50K
    t(2, 50_000, 100_000, 4), // 4% for next $50K
    t(3, 100_000, null, 6), // 6% above $100K
  ]

  it("returns zero for empty tiers", () => {
    const r = calculateMarginalRebate(100_000, [], "EXCLUSIVE")
    expect(r.totalRebate).toBe(0)
    expect(r.brackets).toEqual([])
  })

  it("returns zero for zero spend", () => {
    expect(calculateMarginalRebate(0, tiers, "EXCLUSIVE").totalRebate).toBe(0)
  })

  it("$25K → only tier 1 bracket ($25K × 2% = $500)", () => {
    const r = calculateMarginalRebate(25_000, tiers, "EXCLUSIVE")
    expect(r.totalRebate).toBe(500)
    expect(r.brackets).toHaveLength(1)
    expect(r.brackets[0]).toMatchObject({
      tierNumber: 1,
      bracketSpend: 25_000,
      bracketRate: 2,
      bracketRebate: 500,
    })
  })

  it("$75K → tier 1 ($50K × 2%) + tier 2 ($25K × 4%) = $1,000 + $1,000 = $2,000", () => {
    const r = calculateMarginalRebate(75_000, tiers, "EXCLUSIVE")
    expect(r.totalRebate).toBe(2_000)
    expect(r.brackets).toHaveLength(2)
    expect(r.brackets[0].bracketSpend).toBe(50_000)
    expect(r.brackets[0].bracketRebate).toBe(1_000)
    expect(r.brackets[1].bracketSpend).toBe(25_000)
    expect(r.brackets[1].bracketRebate).toBe(1_000)
  })

  it("$150K → tier 1 ($50K × 2%) + tier 2 ($50K × 4%) + tier 3 ($50K × 6%) = $6,000", () => {
    const r = calculateMarginalRebate(150_000, tiers, "EXCLUSIVE")
    expect(r.totalRebate).toBe(6_000)
    expect(r.brackets).toHaveLength(3)
  })

  it("[A2] no cent rounding — non-round thresholds produce exact bracket sums", () => {
    const oddTiers = [t(1, 0, 33.33, 10), t(2, 33.33, null, 20)]
    // $66.67 spend: bracket 1 = $33.33 × 10% = $3.333
    //               bracket 2 = $33.34 × 20% = $6.668
    //               total = $10.001
    const r = calculateMarginalRebate(66.67, oddTiers, "EXCLUSIVE")
    // Floating-point exact arithmetic, verify with tolerance
    expect(r.totalRebate).toBeCloseTo(10.001, 5)
    expect(r.brackets[0].bracketSpend).toBeCloseTo(33.33, 10)
    // [A2] bracket 2 spend is (66.67 - 33.33) = 33.34 exactly — NOT rounded
    expect(r.brackets[1].bracketSpend).toBeCloseTo(33.34, 10)
  })

  it("[A3] INCLUSIVE boundary handled via bracket capacity (no special case)", () => {
    // Same math works for both modes at this layer — boundary semantics
    // only affect which tier a specific dollar IS IN, not how brackets stack.
    const r = calculateMarginalRebate(50_000, tiers, "INCLUSIVE")
    expect(r.totalRebate).toBe(1_000) // $50K × 2%
    expect(r.brackets).toHaveLength(1)
  })

  it("stops early when remaining spend is zero", () => {
    // $50K exactly fills bracket 1 — bracket 2 should not appear.
    const r = calculateMarginalRebate(50_000, tiers, "EXCLUSIVE")
    expect(r.brackets).toHaveLength(1)
    expect(r.totalRebate).toBe(1_000)
  })

  it("respects fixedRebateAmount on a tier (fixed dollars for that bracket)", () => {
    const mixedTiers: RebateTier[] = [
      { tierNumber: 1, thresholdMin: 0, thresholdMax: 50_000, rebateValue: 2 },
      {
        tierNumber: 2,
        thresholdMin: 50_000,
        thresholdMax: null,
        rebateValue: 4,
        fixedRebateAmount: 5_000,
      },
    ]
    const r = calculateMarginalRebate(75_000, mixedTiers, "EXCLUSIVE")
    // Bracket 1: $50K × 2% = $1,000
    // Bracket 2: fixedRebateAmount = $5,000 (flat)
    expect(r.totalRebate).toBe(6_000)
  })
})
