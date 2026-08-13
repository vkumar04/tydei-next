import { describe, it, expect } from "vitest"
import { computeContractDcfProjection } from "../contract-dcf-projection"
import {
  DEFAULT_PROFORMA_LINE_ITEMS,
  DEFAULT_DIVIDEND_ASSUMPTIONS,
  EMPTY_PURCHASE_SCENARIO,
  lineItemsToProforma,
} from "../proforma-pnl"

const PROFORMA = lineItemsToProforma(DEFAULT_PROFORMA_LINE_ITEMS)
// 4% below $10M cumulative, 6% above — so growth steps the tier up.
const TIERS = [
  { spendMin: 0, spendMax: 10_000_000, rebateValue: 4 },
  { spendMin: 10_000_000, spendMax: null, rebateValue: 6 },
]
const PURCHASE = {
  ...EMPTY_PURCHASE_SCENARIO,
  incrementalCases: 100,
  capitalOutlay: 1_500_000,
}

const run = (over: Partial<Parameters<typeof computeContractDcfProjection>[0]> = {}) =>
  computeContractDcfProjection({
    proforma: PROFORMA,
    purchase: PURCHASE,
    assumptions: DEFAULT_DIVIDEND_ASSUMPTIONS,
    baseAnnualSpend: 4_000_000,
    tiers: TIERS,
    usageGrowthPercent: 5,
    ...over,
  })

describe("computeContractDcfProjection", () => {
  it("projects one row per DCF year", () => {
    expect(run().years).toHaveLength(DEFAULT_DIVIDEND_ASSUMPTIONS.dcfProjectionYears)
  })

  it("compounds BOTH procedure volume and contract spend at the same growth", () => {
    const y = run().years
    expect(y[0].cases).toBeCloseTo(100, 6)
    expect(y[1].cases).toBeCloseTo(105, 6)
    expect(y[4].cases).toBeCloseTo(100 * 1.05 ** 4, 6)
    expect(y[0].contractSpend).toBeCloseTo(4_000_000, 2)
    expect(y[1].contractSpend).toBeCloseTo(4_200_000, 2)
  })

  it("steps the rebate tier up as CUMULATIVE spend crosses the threshold", () => {
    const p = run()
    // Cumulative: 4.0M, 8.2M, 12.61M… → tier 2 from year 3.
    expect(p.years[0].tierAchieved).toBe(1)
    expect(p.years[1].tierAchieved).toBe(1)
    expect(p.years[2].tierAchieved).toBe(2)
    expect(p.years[0].rebatePercent).toBe(4)
    expect(p.years[2].rebatePercent).toBe(6)
    expect(p.tierStepsUp).toBe(true)
  })

  it("owner dividend = operating dividend + rebate x distributable %", () => {
    for (const y of run().years) {
      expect(y.rebateUplift).toBeCloseTo(
        y.rebate * DEFAULT_DIVIDEND_ASSUMPTIONS.dcfPctOfEbitda,
        6,
      )
      expect(y.ownerDividend).toBeCloseTo(y.operatingDividend + y.rebateUplift, 6)
    }
  })

  it("charges the capital outlay once, at year 0", () => {
    const p = run()
    const discounted = p.years.reduce(
      (s, y) => s + y.ownerDividend / 1.1 ** y.year,
      0,
    )
    expect(p.netPresentValue).toBeCloseTo(discounted - 1_500_000, 2)
    // Year-1 cumulative PV starts from -capital, not 0.
    expect(p.years[0].cumulativePresentValue).toBeCloseTo(
      -1_500_000 + p.years[0].presentValue,
      2,
    )
  })

  it("reports fractional payback, and null when it never pays back", () => {
    const p = run()
    expect(p.paybackYears).not.toBeNull()
    expect(p.paybackYears!).toBeGreaterThan(0)
    expect(Number.isInteger(p.paybackYears!)).toBe(false)

    const never = run({ purchase: { ...PURCHASE, capitalOutlay: 500_000_000 } })
    expect(never.paybackYears).toBeNull()
  })

  it("a contract with no tiers contributes no rebate but still projects", () => {
    const p = run({ tiers: [] })
    expect(p.totalRebate).toBe(0)
    expect(p.tierStepsUp).toBe(false)
    for (const y of p.years) {
      expect(y.ownerDividend).toBeCloseTo(y.operatingDividend, 6)
    }
  })

  it("zero growth holds volume, spend and tier flat", () => {
    const p = run({ usageGrowthPercent: 0 })
    expect(p.years.every((y) => Math.abs(y.cases - 100) < 1e-6)).toBe(true)
    expect(p.years.every((y) => Math.abs(y.contractSpend - 4_000_000) < 1e-6)).toBe(true)
  })

  it("more growth returns more rebate — the prospective lever", () => {
    expect(run({ usageGrowthPercent: 15 }).totalRebate).toBeGreaterThan(
      run({ usageGrowthPercent: 0 }).totalRebate,
    )
  })
})
