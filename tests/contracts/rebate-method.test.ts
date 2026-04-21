import { describe, it, expect } from "vitest"
import {
  calculateCumulative,
  calculateMarginal,
  calculateRebate,
  type TierLike,
} from "@/lib/rebates/calculate"

// Spec example tier structure — sections 2.1.1 and 2.1.2 of
// docs/contract-calculations.md
const TIERS: TierLike[] = [
  { tierNumber: 1, spendMin: 0, spendMax: 50_000, rebateValue: 2 },
  { tierNumber: 2, spendMin: 50_000, spendMax: 100_000, rebateValue: 3 },
  { tierNumber: 3, spendMin: 100_000, spendMax: null, rebateValue: 4 },
]

describe("calculateCumulative", () => {
  it("spec example — $75K spend returns $2,250 at tier 2 (3%)", () => {
    const result = calculateCumulative(75_000, TIERS)
    expect(result.rebateEarned).toBe(2_250)
    expect(result.tierAchieved).toBe(2)
    expect(result.rebatePercent).toBe(3)
  })

  it("$125K spend returns $5,000 at tier 3 (4%) — entire spend at top rate", () => {
    const result = calculateCumulative(125_000, TIERS)
    expect(result.rebateEarned).toBe(5_000)
    expect(result.tierAchieved).toBe(3)
  })

  it("$0 spend returns 0 rebate, tier 1", () => {
    const result = calculateCumulative(0, TIERS)
    expect(result.rebateEarned).toBe(0)
    expect(result.tierAchieved).toBe(1)
  })

  it("spend exactly at tier boundary promotes to that tier", () => {
    const result = calculateCumulative(50_000, TIERS)
    expect(result.tierAchieved).toBe(2)
    expect(result.rebatePercent).toBe(3)
  })

  it("handles single-tier contract", () => {
    const oneTier: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 2.5 },
    ]
    const result = calculateCumulative(10_000, oneTier)
    expect(result.rebateEarned).toBe(250)
    expect(result.tierAchieved).toBe(1)
  })

  it("tiers supplied out of order still resolve correctly", () => {
    const scrambled: TierLike[] = [TIERS[2], TIERS[0], TIERS[1]]
    const result = calculateCumulative(75_000, scrambled)
    expect(result.tierAchieved).toBe(2)
  })
})

describe("calculateMarginal", () => {
  it("spec example — $125K spend returns $3,500 across three brackets", () => {
    // $50K × 2% = $1,000
    // $50K × 3% = $1,500
    // $25K × 4% = $1,000
    const result = calculateMarginal(125_000, TIERS)
    expect(result.rebateEarned).toBe(3_500)
    expect(result.tierAchieved).toBe(3)
  })

  it("$75K spend returns $1,750 across two brackets", () => {
    // $50K × 2% = $1,000
    // $25K × 3% = $750
    const result = calculateMarginal(75_000, TIERS)
    expect(result.rebateEarned).toBe(1_750)
    expect(result.tierAchieved).toBe(2)
  })

  it("$30K spend returns $600 within tier 1 only", () => {
    const result = calculateMarginal(30_000, TIERS)
    expect(result.rebateEarned).toBe(600)
    expect(result.tierAchieved).toBe(1)
  })

  it("$0 spend returns 0 rebate, tier 0 (no tier qualifies)", () => {
    // 2026-04-20 engine migration: legacy reported tier 1 at zero spend
    // (a default sentinel), new engine correctly reports "no tier
    // qualified" → tier 0 / 0% / \$0. Aligns with the below-baseline
    // semantics now shared across cumulative + marginal.
    const result = calculateMarginal(0, TIERS)
    expect(result.rebateEarned).toBe(0)
    expect(result.tierAchieved).toBe(0)
  })

  it("spend exactly at tier-2 boundary stays tier 1 (no spend is above it)", () => {
    const result = calculateMarginal(50_000, TIERS)
    expect(result.rebateEarned).toBe(1_000)
    expect(result.tierAchieved).toBe(1)
  })

  it("single-tier contract behaves identically to cumulative", () => {
    const oneTier: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 2.5 },
    ]
    expect(calculateMarginal(10_000, oneTier).rebateEarned).toBe(250)
  })

  it("marginal handles malformed tiers without throwing", () => {
    // 2026-04-20 engine migration: legacy threw on ambiguous-bracket
    // configurations (non-final tier with no spendMax AND no
    // meaningful nextMin). The new canonical engine does NOT throw —
    // it treats ambiguous brackets as zero-width and returns whatever
    // brackets DID accumulate. The shim's dedup also drops duplicate-
    // spendMin tiers, so the "two tiers both at spendMin=0" case now
    // collapses to a single tier rather than throwing.
    const bad: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 2 },
      { tierNumber: 2, spendMin: 50_000, spendMax: null, rebateValue: 3 },
    ]
    expect(() => calculateMarginal(60_000, bad)).not.toThrow()

    const duplicateMin: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 2 },
      { tierNumber: 2, spendMin: 0, spendMax: null, rebateValue: 3 }, // same min
    ]
    // Shim dedups to tier 1 only; engine evaluates without throwing.
    expect(() => calculateMarginal(60_000, duplicateMin)).not.toThrow()
    const r = calculateMarginal(60_000, duplicateMin)
    expect(r.tierAchieved).toBe(1) // dedup keeps lowest tierNumber
  })
})

describe("calculateRebate (dispatcher)", () => {
  it("cumulative method matches calculateCumulative", () => {
    const r = calculateRebate(75_000, TIERS, "cumulative")
    expect(r.rebateEarned).toBe(2_250)
  })

  it("marginal method matches calculateMarginal", () => {
    const r = calculateRebate(125_000, TIERS, "marginal")
    expect(r.rebateEarned).toBe(3_500)
  })

  it("defaults to cumulative when method omitted (backward compat)", () => {
    const r = calculateRebate(75_000, TIERS)
    expect(r.rebateEarned).toBe(2_250)
  })
})
