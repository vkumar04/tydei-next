import { describe, expect, it } from "vitest"

import { buildMacrsSchedule } from "@/lib/financial-analysis/macrs"
import { computeIRR, computeNPV } from "@/lib/financial-analysis/npv"
import { computePriceLockCost } from "@/lib/financial-analysis/price-lock"
import { projectRebates } from "@/lib/financial-analysis/rebate-projection"
import {
  type CapitalROIInput,
  computeCapitalROI,
} from "@/lib/financial-analysis/roi"

const BASE_INPUT: CapitalROIInput = {
  capitalCost: 250_000,
  years: 5,
  discountRate: 0.1,
  payUpfront: true,
  taxRate: 0.21,
  annualSpend: 1_000_000,
  rebateRate: 0.04,
  growthRatePerYear: 0.03,
  marketDeclineRate: 0.02,
}

describe("computeCapitalROI (end-to-end)", () => {
  it("produces a cashflow array of length years + 1 with cashflows[0] = -capitalCost when payUpfront", () => {
    const result = computeCapitalROI(BASE_INPUT)
    expect(result.cashflows).toHaveLength(BASE_INPUT.years + 1)
    expect(result.cashflows[0]).toBe(-BASE_INPUT.capitalCost)
  })

  it("depreciation schedule always has 6 entries (MACRS 5-yr half-year)", () => {
    const result = computeCapitalROI(BASE_INPUT)
    expect(result.depreciation).toHaveLength(6)
  })

  it("rebates and priceLockCost arrays have length = years", () => {
    const result = computeCapitalROI(BASE_INPUT)
    expect(result.rebates).toHaveLength(BASE_INPUT.years)
    expect(result.priceLockCost).toHaveLength(BASE_INPUT.years)
  })

  it("totals agree with the individual engine outputs", () => {
    const result = computeCapitalROI(BASE_INPUT)

    const { totalRebate } = projectRebates({
      annualSpend: BASE_INPUT.annualSpend,
      rebateRate: BASE_INPUT.rebateRate,
      years: BASE_INPUT.years,
      growthRatePerYear: BASE_INPUT.growthRatePerYear,
    })
    const { totalOpportunityCost } = computePriceLockCost({
      annualSpend: BASE_INPUT.annualSpend,
      years: BASE_INPUT.years,
      marketDeclineRate: BASE_INPUT.marketDeclineRate,
    })
    const schedule = buildMacrsSchedule({
      capitalCost: BASE_INPUT.capitalCost,
      taxRate: BASE_INPUT.taxRate,
    })
    // totalTaxSavings reflects the tax savings actually applied to
    // cashflows — limited to the contract term (first `years` MACRS entries).
    const appliedTaxSavings = schedule
      .slice(0, BASE_INPUT.years)
      .reduce((a, b) => a + b.taxSavings, 0)

    expect(result.totalRebate).toBeCloseTo(totalRebate, 6)
    expect(result.totalOpportunityCost).toBeCloseTo(totalOpportunityCost, 6)
    expect(result.totalTaxSavings).toBeCloseTo(appliedTaxSavings, 6)
  })

  it("per-year cashflow equals rebate + taxSavings − priceLockCost (payUpfront=true)", () => {
    const result = computeCapitalROI(BASE_INPUT)
    for (let t = 1; t <= BASE_INPUT.years; t++) {
      const rebate = result.rebates[t - 1] as number
      const taxSavings = result.depreciation[t - 1]!.taxSavings
      const priceLock = result.priceLockCost[t - 1] as number
      const expected = rebate + taxSavings - priceLock
      expect(result.cashflows[t]).toBeCloseTo(expected, 6)
    }
  })

  it("NPV matches computeNPV on the returned cashflows", () => {
    const result = computeCapitalROI(BASE_INPUT)
    expect(result.npv).toBeCloseTo(
      computeNPV(result.cashflows, BASE_INPUT.discountRate),
      6,
    )
  })

  it("IRR matches computeIRR on the returned cashflows (when defined)", () => {
    const result = computeCapitalROI(BASE_INPUT)
    const irr = computeIRR(result.cashflows)
    if (result.irr === null) {
      expect(irr).toBeNull()
    } else {
      expect(irr).not.toBeNull()
      expect(result.irr).toBeCloseTo(irr as number, 6)
    }
  })

  it("payUpfront=false amortizes capital cost linearly across the term", () => {
    const input: CapitalROIInput = { ...BASE_INPUT, payUpfront: false }
    const result = computeCapitalROI(input)
    const upfront = computeCapitalROI(BASE_INPUT)

    expect(result.cashflows[0]).toBe(0)
    const amortized = BASE_INPUT.capitalCost / BASE_INPUT.years
    for (let t = 1; t <= BASE_INPUT.years; t++) {
      expect(result.cashflows[t]).toBeCloseTo(
        (upfront.cashflows[t] as number) - amortized,
        6,
      )
    }
  })

  it("zero-capital, zero-spend input produces an all-zero cashflow stream", () => {
    const result = computeCapitalROI({
      capitalCost: 0,
      years: 3,
      discountRate: 0.08,
      payUpfront: true,
      taxRate: 0.21,
      annualSpend: 0,
      rebateRate: 0.04,
      growthRatePerYear: 0.03,
      marketDeclineRate: 0.02,
    })
    expect(result.cashflows).toHaveLength(4)
    for (const cf of result.cashflows) expect(cf).toBeCloseTo(0, 10)
    expect(result.npv).toBeCloseTo(0, 10)
  })
})
