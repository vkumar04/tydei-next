import { describe, it, expect } from "vitest"
import { computeContractDcfProjection } from "../contract-dcf-projection"
import {
  DEFAULT_PROFORMA_LINE_ITEMS,
  DEFAULT_DIVIDEND_ASSUMPTIONS,
  EMPTY_PURCHASE_SCENARIO,
  computePurchaseDividendImpact,
  lineItemsToProforma,
  type PurchaseScenario,
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

// A proposal whose operating dividend is made ENTIRELY of components the old
// per-year re-run left flat: savings on affected cases and a recurring annual
// cost. incrementalCases is 0, so the only thing the old code scaled by the
// growth factor was zero — every year printed the same operating dividend.
//   ΔNOI = 1,200 x $400 saved − $250,000 recurring = +$230,000
//   operating dividend = $230,000 x 0.8 distributable = $184,000
const OPERATING_ONLY_PURCHASE: PurchaseScenario = {
  ...EMPTY_PURCHASE_SCENARIO,
  productName: "Service-heavy console",
  supplyCostDeltaPerCase: -400,
  affectedCases: 1_200,
  incrementalCases: 0,
  recurringAnnualCost: 250_000,
  capitalOutlay: 1_500_000,
}

describe("computeContractDcfProjection — parity with the Dividend/DCF tab", () => {
  it("with an EMPTY ladder and no growth override, NPV EQUALS the proposal's own NPV", () => {
    // THE central identity: the contract tab must not restate the proposal.
    const p = computeContractDcfProjection({
      proforma: PROFORMA,
      purchase: OPERATING_ONLY_PURCHASE,
      assumptions: DEFAULT_DIVIDEND_ASSUMPTIONS,
      baseAnnualSpend: 4_000_000,
      tiers: [],
    })
    const proposal = computePurchaseDividendImpact(
      PROFORMA,
      OPERATING_ONLY_PURCHASE,
      DEFAULT_DIVIDEND_ASSUMPTIONS,
    )

    expect(p.totalRebatePv).toBe(0)
    expect(p.netPresentValue).toBe(proposal.netPresentValue)
    expect(p.proposalNetPresentValue).toBe(proposal.netPresentValue)
  })

  it("holds the identity for the empty purchase and for a spend-only proposal", () => {
    for (const purchase of [EMPTY_PURCHASE_SCENARIO, PURCHASE]) {
      const p = computeContractDcfProjection({
        proforma: PROFORMA,
        purchase,
        assumptions: DEFAULT_DIVIDEND_ASSUMPTIONS,
        baseAnnualSpend: 4_000_000,
        tiers: [],
      })
      expect(p.netPresentValue).toBe(
        computePurchaseDividendImpact(PROFORMA, purchase, DEFAULT_DIVIDEND_ASSUMPTIONS)
          .netPresentValue,
      )
    }
  })

  it("proposalNetPresentValue is the proposal's OWN NPV at the applied growth", () => {
    const p = run() // usageGrowthPercent: 5
    const proposal = computePurchaseDividendImpact(PROFORMA, PURCHASE, {
      ...DEFAULT_DIVIDEND_ASSUMPTIONS,
      cashFlowGrowthPct: 0.05,
    })
    expect(p.proposalNetPresentValue).toBe(proposal.netPresentValue)
    // The ladder never moves the proposal half.
    expect(run({ tiers: [] }).proposalNetPresentValue).toBe(
      p.proposalNetPresentValue,
    )
  })

  it("netPresentValue = proposalNetPresentValue + totalRebatePv, ladder or not", () => {
    for (const p of [run(), run({ tiers: [] }), run({ usageGrowthPercent: 15 })]) {
      expect(p.netPresentValue).toBe(p.proposalNetPresentValue + p.totalRebatePv)
    }
    // With a real ladder the contract is strictly additive on top.
    const withLadder = run()
    expect(withLadder.totalRebatePv).toBeGreaterThan(0)
    expect(withLadder.netPresentValue).toBeGreaterThan(
      withLadder.proposalNetPresentValue,
    )
  })
})

describe("computeContractDcfProjection — the growth rate actually applied", () => {
  it("omitting the override runs at assumptions.cashFlowGrowthPct (3%)", () => {
    const p = computeContractDcfProjection({
      proforma: PROFORMA,
      purchase: PURCHASE,
      assumptions: DEFAULT_DIVIDEND_ASSUMPTIONS,
      baseAnnualSpend: 4_000_000,
      tiers: TIERS,
    })
    expect(DEFAULT_DIVIDEND_ASSUMPTIONS.cashFlowGrowthPct).toBe(0.03)
    expect(p.growthPercent).toBe(3)
    expect(p.years[1].contractSpend).toBeCloseTo(4_000_000 * 1.03, 6)
    expect(p.years[4].cases).toBeCloseTo(100 * 1.03 ** 4, 6)
  })

  it("an override REPLACES cashFlowGrowthPct — 5 stays 5, never 8", () => {
    const p = run({ usageGrowthPercent: 5 })
    expect(p.growthPercent).toBe(5)
    // 5% layered on top of the proposal's 3% would compound to 8.15%.
    expect(p.growthPercent).not.toBe(8)
    expect(p.years[4].contractSpend).toBeCloseTo(4_000_000 * 1.05 ** 4, 6)
    expect(p.years[4].contractSpend).not.toBeCloseTo(
      4_000_000 * (1.05 * 1.03) ** 4,
      2,
    )
  })

  it("an explicit 0 override is honoured, not treated as 'no override'", () => {
    expect(run({ usageGrowthPercent: 0 }).growthPercent).toBe(0)
  })
})

describe("computeContractDcfProjection — the operating stream grows with the slider", () => {
  const runOperating = (usageGrowthPercent: number) =>
    computeContractDcfProjection({
      proforma: PROFORMA,
      purchase: OPERATING_ONLY_PURCHASE,
      assumptions: DEFAULT_DIVIDEND_ASSUMPTIONS,
      baseAnnualSpend: 4_000_000,
      tiers: [],
      usageGrowthPercent,
    })

  it("year 1 is the proposal's own operating dividend impact ($184,000)", () => {
    const p = runOperating(5)
    const proposal = computePurchaseDividendImpact(
      PROFORMA,
      OPERATING_ONLY_PURCHASE,
      DEFAULT_DIVIDEND_ASSUMPTIONS,
    )
    // 1,200 affected cases x $400 saved − $250,000 recurring = $230,000 ΔNOI,
    // x 0.8 distributable = $184,000.
    expect(proposal.operatingDividendImpact).toBe(184_000)
    expect(p.years[0].operatingDividend).toBe(184_000)
  })

  it("every row is operatingBase x (1+g)^(y-1) — affected-case and recurring components included", () => {
    const p = runOperating(5)
    const base = p.years[0].operatingDividend
    for (const y of p.years) {
      expect(y.operatingDividend).toBeCloseTo(base * 1.05 ** (y.year - 1), 6)
    }
    expect(p.years[4].operatingDividend).toBeCloseTo(184_000 * 1.05 ** 4, 6)
  })

  it("REGRESSION: the old per-year re-run left those components FLAT forever", () => {
    const p = runOperating(5)
    // What the old code computed for year 5: the proposal re-run with the
    // incremental case count grown. With no incremental cases that is the
    // year-1 figure again — flat, no matter where the slider sits.
    const oldYear5 = computePurchaseDividendImpact(
      PROFORMA,
      {
        ...OPERATING_ONLY_PURCHASE,
        incrementalCases: OPERATING_ONLY_PURCHASE.incrementalCases * 1.05 ** 4,
      },
      DEFAULT_DIVIDEND_ASSUMPTIONS,
    ).operatingDividendImpact

    expect(oldYear5).toBe(p.years[0].operatingDividend)
    expect(p.years[4].operatingDividend).not.toBeCloseTo(oldYear5, 2)
    expect(p.years[4].operatingDividend).toBeGreaterThan(oldYear5)
  })

  it("a bigger slider means a bigger operating stream and a bigger NPV", () => {
    const slow = runOperating(0)
    const fast = runOperating(10)
    expect(slow.years.every((y) => y.operatingDividend === 184_000)).toBe(true)
    expect(fast.years[4].operatingDividend).toBeGreaterThan(
      slow.years[4].operatingDividend,
    )
    expect(fast.netPresentValue).toBeGreaterThan(slow.netPresentValue)
  })
})

describe("computeContractDcfProjection — qualifying-spend narrowing passes through", () => {
  // One flat 4% tier from dollar zero, so the rebate is a clean 4% of whatever
  // the helper decides is qualifying. Zero growth keeps every year identical.
  const FLAT_TIER = [{ spendMin: 0, spendMax: null, rebateValue: 4 }]
  const runSpend = (
    over: Partial<Parameters<typeof computeContractDcfProjection>[0]> = {},
  ) =>
    run({
      tiers: FLAT_TIER,
      baseAnnualSpend: 4_200_000,
      usageGrowthPercent: 0,
      ...over,
    })

  it("qualifyingSpend equals contractSpend when neither cap nor baseline applies", () => {
    for (const p of [run(), runSpend()]) {
      for (const y of p.years) {
        expect(y.qualifyingSpend).toBe(y.contractSpend)
        expect(y.growthBaselineApplied).toBe(0)
      }
    }
  })

  it("a growth-only baseline earns on the growth slice only: 4% x $200,000 = $8,000", () => {
    const p = runSpend({ spendBaseline: 4_000_000, growthOnly: true })
    expect(p.years[0].contractSpend).toBe(4_200_000)
    expect(p.years[0].qualifyingSpend).toBe(200_000)
    expect(p.years[0].growthBaselineApplied).toBe(4_000_000)
    expect(p.years[0].rebate).toBeCloseTo(8_000, 6)
    // Flat spend ⇒ the same $200,000 slice every year: 5 x $8,000.
    expect(p.totalRebate).toBeCloseTo(40_000, 6)
    // Unbaselined, the whole $4.2M earns: 4% x $4.2M = $168,000/yr.
    expect(runSpend().years[0].rebate).toBeCloseTo(168_000, 6)
  })

  it("growthOnly:false leaves the baseline inert — nothing changes at all", () => {
    const withBaseline = runSpend({
      spendBaseline: 4_000_000,
      growthOnly: false,
    })
    expect(withBaseline.years).toEqual(runSpend().years)
    expect(withBaseline.totalRebate).toBe(runSpend().totalRebate)
  })

  it("periodCap clamps eligible spend without touching gross contract spend", () => {
    const p = runSpend({ periodCap: 1_000_000 })
    expect(p.years[0].contractSpend).toBe(4_200_000)
    expect(p.years[0].qualifyingSpend).toBe(1_000_000)
    // 4% x $1.0M = $40,000/yr, five years.
    expect(p.years[0].rebate).toBeCloseTo(40_000, 6)
    expect(p.totalRebate).toBeCloseTo(200_000, 6)
    expect(p.totalRebate).toBeLessThan(runSpend().totalRebate)
  })

  it("the cap comes off first, then the baseline off the capped figure", () => {
    const p = runSpend({
      periodCap: 4_100_000,
      spendBaseline: 4_000_000,
      growthOnly: true,
    })
    expect(p.years[0].qualifyingSpend).toBe(100_000)
    expect(p.years[0].growthBaselineApplied).toBe(4_000_000)
    expect(p.years[0].rebate).toBeCloseTo(4_000, 6)
  })

  it("narrowing the rebate never touches the proposal half", () => {
    const capped = runSpend({ periodCap: 1_000_000 })
    expect(capped.proposalNetPresentValue).toBe(runSpend().proposalNetPresentValue)
    expect(capped.netPresentValue).toBeLessThan(runSpend().netPresentValue)
  })
})
