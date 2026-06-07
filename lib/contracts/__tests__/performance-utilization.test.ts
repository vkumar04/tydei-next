import { describe, it, expect } from "vitest"
import { calculateRebateUtilization } from "@/lib/contracts/performance"

// Tiers engine expects integer-percent rebateValue (5, 10) not fractions.
const TIERS = [
  { tierNumber: 1, spendMin: 0, spendMax: 200_000, rebateValue: 5 },
  { tierNumber: 2, spendMin: 200_001, spendMax: null, rebateValue: 10 },
]

describe("calculateRebateUtilization — respects rebateMethod", () => {
  it("RETROACTIVE (cumulative): at top tier, actual == max → 100% utilization, $0 missed", () => {
    // $1,260,401 spend, tier 2 achieved → whole spend × 10% = $126,040
    const r = calculateRebateUtilization(1_260_401, TIERS, "cumulative")
    expect(r.actualRebate).toBe(126_040.1)
    expect(r.maxPossibleRebate).toBe(126_040.1)
    expect(r.utilizationPct).toBe(100)
    expect(r.missedRebate).toBe(0)
  })

  it("MARGINAL: tier 1 slice earns at lower rate → actual < max → <100% utilization", () => {
    // $1,260,401 under marginal: 200k × 5% + 1,060,401 × 10% = $10,000 + $106,040.10 = $116,040.10
    // Max at top: $1,260,401 × 10% = $126,040.10
    // Missed: $10,000
    const r = calculateRebateUtilization(1_260_401, TIERS, "marginal")
    expect(r.actualRebate).toBeCloseTo(116_040.1, 0)
    expect(r.maxPossibleRebate).toBeCloseTo(126_040.1, 0)
    expect(r.utilizationPct).toBeCloseTo((116_040.1 / 126_040.1) * 100, 0)
    expect(r.missedRebate).toBeCloseTo(10_000, 0)
  })

  it("Bug regression (Charles 2026-04-23): marginal math exposes the tier-1 gap", () => {
    // Pre-fix, utilization was hardcoded to calculateCumulative, so a
    // marginal contract that spent across tiers reported 100% util and
    // $0 missed — hiding the real tier-1 shortfall. The new method
    // parameter restores the visibility.
    const retroactive = calculateRebateUtilization(1_260_401, TIERS, "cumulative")
    const marginal = calculateRebateUtilization(1_260_401, TIERS, "marginal")
    expect(retroactive.utilizationPct).toBe(100)
    expect(marginal.utilizationPct).toBeLessThan(100)
    expect(marginal.missedRebate).toBeGreaterThan(0)
  })

  it("defaults to cumulative when method omitted (back-compat)", () => {
    const r = calculateRebateUtilization(1_260_401, TIERS)
    expect(r.utilizationPct).toBe(100)
  })

  it("fixed_rebate tiers use the flat dollar amount, NOT spend × value (Charles 2026-06-07)", () => {
    // Regression: a compliance_rebate term with fixed-dollar tiers
    // ($10,000 / $17,500) was applied as a percent rate, so on a large
    // spend "Rebate at current spend" and "Max at top tier" showed
    // $38,104,500,000. fixed_rebate tiers carry their dollars in
    // fixedRebateAmount with rebateValue forced to 0 (canonical mapping),
    // so neither the actual nor the max may be multiplied by spend.
    const FIXED_TIERS = [
      {
        tierNumber: 1,
        spendMin: 0,
        spendMax: 1_000_000,
        rebateValue: 0,
        fixedRebateAmount: 10_000,
      },
      {
        tierNumber: 2,
        spendMin: 1_000_001,
        spendMax: null,
        rebateValue: 0,
        fixedRebateAmount: 17_500,
      },
    ]
    const bigSpend = 3_810_450 // the spend that produced the absurd value
    const r = calculateRebateUtilization(bigSpend, FIXED_TIERS, "cumulative")
    // Top tier achieved → flat $17,500, never bigSpend × anything.
    expect(r.actualRebate).toBe(17_500)
    expect(r.maxPossibleRebate).toBe(17_500)
    expect(r.utilizationPct).toBe(100)
    expect(r.missedRebate).toBe(0)
    // Sanity: nowhere near the billions the percent path produced.
    expect(r.actualRebate).toBeLessThan(1_000_000)
    expect(r.maxPossibleRebate).toBeLessThan(1_000_000)
  })

  it("fixed_rebate at a lower tier → that tier's flat amount, max = top tier flat amount", () => {
    const FIXED_TIERS = [
      {
        tierNumber: 1,
        spendMin: 0,
        spendMax: 1_000_000,
        rebateValue: 0,
        fixedRebateAmount: 10_000,
      },
      {
        tierNumber: 2,
        spendMin: 1_000_001,
        spendMax: null,
        rebateValue: 0,
        fixedRebateAmount: 17_500,
      },
    ]
    // Spend only qualifies tier 1.
    const r = calculateRebateUtilization(500_000, FIXED_TIERS, "cumulative")
    expect(r.actualRebate).toBe(10_000)
    expect(r.maxPossibleRebate).toBe(17_500)
    expect(r.missedRebate).toBe(7_500)
  })

  it("returns zeros for no-tier input", () => {
    const r = calculateRebateUtilization(100_000, [])
    expect(r).toEqual({
      actualRebate: 0,
      maxPossibleRebate: 0,
      utilizationPct: 0,
      missedRebate: 0,
      additionalSpendForMaxTier: 0,
    })
  })
})
