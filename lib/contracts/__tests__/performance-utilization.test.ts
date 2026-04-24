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
