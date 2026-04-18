import { describe, expect, it } from "vitest"

import { projectRebates } from "@/lib/financial-analysis/rebate-projection"

describe("projectRebates", () => {
  it("$100K spend, 4% rebate, 3 yrs, 0% growth → [$4K, $4K, $4K], total $12K", () => {
    const { yearlyRebates, totalRebate } = projectRebates({
      annualSpend: 100_000,
      rebateRate: 0.04,
      years: 3,
      growthRatePerYear: 0,
    })
    expect(yearlyRebates).toHaveLength(3)
    expect(yearlyRebates[0]).toBeCloseTo(4_000, 6)
    expect(yearlyRebates[1]).toBeCloseTo(4_000, 6)
    expect(yearlyRebates[2]).toBeCloseTo(4_000, 6)
    expect(totalRebate).toBeCloseTo(12_000, 6)
  })

  it("$100K spend, 4% rebate, 3 yrs, 5% growth → [$4K, $4.2K, $4.41K], total ≈ $12.61K", () => {
    const { yearlyRebates, totalRebate } = projectRebates({
      annualSpend: 100_000,
      rebateRate: 0.04,
      years: 3,
      growthRatePerYear: 0.05,
    })
    expect(yearlyRebates[0]).toBeCloseTo(4_000, 4)
    expect(yearlyRebates[1]).toBeCloseTo(4_200, 2)
    expect(yearlyRebates[2]).toBeCloseTo(4_410, 2)
    expect(totalRebate).toBeCloseTo(12_610, 1)
  })

  it("zero years → empty array + zero total", () => {
    const { yearlyRebates, totalRebate } = projectRebates({
      annualSpend: 100_000,
      rebateRate: 0.04,
      years: 0,
      growthRatePerYear: 0.05,
    })
    expect(yearlyRebates).toEqual([])
    expect(totalRebate).toBe(0)
  })

  it("zero rebate rate → zero rebate regardless of spend or growth", () => {
    const { totalRebate } = projectRebates({
      annualSpend: 500_000,
      rebateRate: 0,
      years: 5,
      growthRatePerYear: 0.03,
    })
    expect(totalRebate).toBe(0)
  })

  it("year-1 rebate always equals annualSpend × rebateRate, ignoring growth", () => {
    const { yearlyRebates } = projectRebates({
      annualSpend: 250_000,
      rebateRate: 0.035,
      years: 5,
      growthRatePerYear: 0.08,
    })
    expect(yearlyRebates[0]).toBeCloseTo(250_000 * 0.035, 6)
  })

  it("totalRebate equals the sum of yearlyRebates", () => {
    const { yearlyRebates, totalRebate } = projectRebates({
      annualSpend: 1_000_000,
      rebateRate: 0.04,
      years: 7,
      growthRatePerYear: 0.03,
    })
    const summed = yearlyRebates.reduce((a, b) => a + b, 0)
    expect(totalRebate).toBeCloseTo(summed, 6)
  })
})
