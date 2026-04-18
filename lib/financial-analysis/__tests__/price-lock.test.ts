import { describe, expect, it } from "vitest"

import { computePriceLockCost } from "@/lib/financial-analysis/price-lock"

describe("computePriceLockCost", () => {
  it("$100K annual, 5 years, 2% decline → year-1 ≈ $2K, year-2 ≈ $3.96K", () => {
    const { yearlyCost, totalOpportunityCost } = computePriceLockCost({
      annualSpend: 100_000,
      years: 5,
      marketDeclineRate: 0.02,
    })
    expect(yearlyCost).toHaveLength(5)
    expect(yearlyCost[0]).toBeCloseTo(2_000, 4)
    expect(yearlyCost[1]).toBeCloseTo(3_960, 2)
    expect(yearlyCost[2]).toBeCloseTo(5_880.8, 2)
    expect(totalOpportunityCost).toBeCloseTo(
      yearlyCost.reduce((a, b) => a + b, 0),
      6,
    )
  })

  it("zero market decline → zero opportunity cost across all years", () => {
    const { yearlyCost, totalOpportunityCost } = computePriceLockCost({
      annualSpend: 100_000,
      years: 5,
      marketDeclineRate: 0,
    })
    expect(yearlyCost).toEqual([0, 0, 0, 0, 0])
    expect(totalOpportunityCost).toBe(0)
  })

  it("zero years → empty yearly array and zero total", () => {
    const { yearlyCost, totalOpportunityCost } = computePriceLockCost({
      annualSpend: 100_000,
      years: 0,
      marketDeclineRate: 0.02,
    })
    expect(yearlyCost).toEqual([])
    expect(totalOpportunityCost).toBe(0)
  })

  it("zero annual spend → zero cost regardless of decline", () => {
    const { totalOpportunityCost } = computePriceLockCost({
      annualSpend: 0,
      years: 5,
      marketDeclineRate: 0.05,
    })
    expect(totalOpportunityCost).toBe(0)
  })

  it("opportunity cost grows monotonically year over year with positive decline", () => {
    const { yearlyCost } = computePriceLockCost({
      annualSpend: 100_000,
      years: 10,
      marketDeclineRate: 0.02,
    })
    for (let i = 1; i < yearlyCost.length; i++) {
      expect(yearlyCost[i]!).toBeGreaterThan(yearlyCost[i - 1]!)
    }
  })
})
