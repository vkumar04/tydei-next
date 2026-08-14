import { describe, it, expect } from "vitest"
import {
  DEFAULT_PROFORMA_LINE_ITEMS,
  DEFAULT_DIVIDEND_ASSUMPTIONS,
  EMPTY_PURCHASE_SCENARIO,
  otherVariableTotal,
  fixedTotal,
  lineItemsToProforma,
  resolvePnL,
  computePurchaseDividendImpact,
  type PurchaseScenario,
} from "../proforma-pnl"
import { computeNPV } from "../npv"
import { EV_MULTIPLES } from "../prospective-impact-model"

// Parity baseline: the customer's Steady State Proforma at 1.2× Medicare
// (DEFAULT_PROFORMA_LINE_ITEMS). Pinned figures hand-derived from the
// statement: revenue $267,441,411 − $235,348,442 adjustment = $32,092,969;
// variable $17,440,686 (supplies $12,316,248 + other $5,124,438); fixed
// $2,186,820; NOI $12,465,463 on 5,200 cases.
const PROFORMA = lineItemsToProforma(DEFAULT_PROFORMA_LINE_ITEMS)

describe("proforma line-item totals (statement parity)", () => {
  it("other-variable subtotal is $5,124,438", () => {
    expect(otherVariableTotal(DEFAULT_PROFORMA_LINE_ITEMS)).toBe(5_124_438)
  })

  it("fixed subtotal is $2,186,820", () => {
    expect(fixedTotal(DEFAULT_PROFORMA_LINE_ITEMS)).toBe(2_186_820)
  })
})

describe("resolvePnL (statement parity)", () => {
  const pnl = resolvePnL(PROFORMA)

  it("total revenue = standard billing − contractual adjustment", () => {
    expect(pnl.totalRevenue).toBe(32_092_969)
  })

  it("NOI = revenue − variable − fixed = $12,465,463 (38.84% margin)", () => {
    expect(pnl.totalVariableExpense).toBe(17_440_686)
    expect(pnl.netOperatingIncome).toBe(12_465_463)
    expect(pnl.noiMarginPct).toBeCloseTo(38.84, 1)
  })

  it("per-case economics divide by case volume", () => {
    expect(pnl.revenuePerCase).toBeCloseTo(6_171.72, 1)
    expect(pnl.supplyPerCase).toBeCloseTo(2_368.51, 1)
    expect(pnl.otherVariablePerCase).toBeCloseTo(985.47, 1)
    expect(pnl.contributionMarginPerCase).toBeCloseTo(2_817.75, 1)
  })

  it("guards a zero case volume (no division blowup)", () => {
    const pnl0 = resolvePnL({ ...PROFORMA, caseVolume: 0 })
    expect(Number.isFinite(pnl0.revenuePerCase)).toBe(true)
  })
})

// The v0 default scenario: +$250 supply/case on 1,200 affected cases plus
// 150 incremental cases at blended reimbursement, no capital.
const DEFAULT_SCENARIO: PurchaseScenario = {
  ...EMPTY_PURCHASE_SCENARIO,
  productName: "New implant system",
  supplyCostDeltaPerCase: 250,
  affectedCases: 1_200,
  incrementalCases: 150,
}

describe("computePurchaseDividendImpact — default scenario parity", () => {
  const impact = computePurchaseDividendImpact(PROFORMA, DEFAULT_SCENARIO)

  it("NOI impact ≈ +$85,161 (incremental margin beats the price increase)", () => {
    expect(impact.noiImpact).toBeCloseTo(85_161, 0)
    expect(impact.after.netOperatingIncome).toBeCloseTo(12_550_624, 0)
  })

  it("dividend = 80% of NOI, before → after", () => {
    expect(impact.annualDividendBefore).toBeCloseTo(9_972_370.4, 0)
    expect(impact.annualDividendAfter).toBeCloseTo(10_040_499.2, 0)
    expect(impact.annualDividendImpact).toBeCloseTo(68_128.8, 0)
    expect(impact.verdict).toBe("accretive")
  })

  it("NPV of the growing dividend stream (10% discount, 3% growth, 5 yrs)", () => {
    expect(impact.netPresentValue).toBeCloseTo(272_692.34, 0)
  })

  it("NPV agrees with computeNPV over the explicit cashflow vector", () => {
    const a = DEFAULT_DIVIDEND_ASSUMPTIONS
    const cashflows = [0]
    for (let t = 1; t <= a.dcfProjectionYears; t++) {
      cashflows.push(
        impact.annualDividendImpact * Math.pow(1 + a.cashFlowGrowthPct, t - 1),
      )
    }
    expect(impact.netPresentValue).toBeCloseTo(
      computeNPV(cashflows, a.discountRatePct),
      0,
    )
  })

  it("EV scenarios use the canonical 10/12/14× ladder on ΔNOI", () => {
    expect(impact.evScenarios.map((s) => s.multiple)).toEqual([
      EV_MULTIPLES.conservative,
      EV_MULTIPLES.expected,
      EV_MULTIPLES.aggressive,
    ])
    expect(impact.evScenarios[0].incrementalEv).toBeCloseTo(851_610, 0)
    expect(impact.evScenarios[1].incrementalEv).toBeCloseTo(1_021_932, 0)
    expect(impact.evScenarios[2].incrementalEv).toBeCloseTo(1_192_254, 0)
    // No capital outlay → net-of-capital equals the raw ΔEV.
    expect(impact.evScenarios[1].incrementalEvNetOfCapital).toBeCloseTo(
      impact.evScenarios[1].incrementalEv,
      0,
    )
  })

  it("no capital outlay → payback is null", () => {
    expect(impact.paybackYears).toBeNull()
  })

  it("revenue and case volume grow with incremental cases", () => {
    expect(impact.after.caseVolume).toBe(5_350)
    expect(impact.after.totalRevenue).toBeCloseTo(33_018_727, 0)
    expect(impact.after.medicalSupplyExpense).toBeCloseTo(13_009_024.5, 0)
  })
})

describe("computePurchaseDividendImpact — capital scenario", () => {
  // Robot: $1.5M outlay, $120K/yr service, 200 incremental cases at blended
  // reimbursement, no per-case supply delta.
  const impact = computePurchaseDividendImpact(PROFORMA, {
    ...EMPTY_PURCHASE_SCENARIO,
    productName: "Robot",
    incrementalCases: 200,
    capitalOutlay: 1_500_000,
    recurringAnnualCost: 120_000,
  })

  it("NOI impact nets the recurring cost", () => {
    expect(impact.noiImpact).toBeCloseTo(443_548, 0)
  })

  it("NPV subtracts the capital outlay (negative here)", () => {
    expect(impact.netPresentValue).toBeCloseTo(-79_723.78, 0)
  })

  it("payback routes through computePaybackAnalysis (0.1-yr rounding)", () => {
    expect(impact.paybackYears).toBeCloseTo(3.4, 5)
  })

  it("EV net of capital subtracts the outlay per multiple", () => {
    const expected = impact.evScenarios[1]
    expect(expected.incrementalEvNetOfCapital).toBeCloseTo(
      expected.incrementalEv - 1_500_000,
      0,
    )
  })
})

describe("computePurchaseDividendImpact — reimbursement + verdict edges", () => {
  it("incremental cases bill at caseReimbursement when provided", () => {
    const impact = computePurchaseDividendImpact(PROFORMA, {
      ...EMPTY_PURCHASE_SCENARIO,
      incrementalCases: 100,
      caseReimbursement: 11_340, // Total Knee $9,450 × 1.2
    })
    expect(impact.noiImpact).toBeCloseTo(798_602, 0)
  })

  it("a pure price increase with no offsets is dilutive", () => {
    const impact = computePurchaseDividendImpact(PROFORMA, {
      ...EMPTY_PURCHASE_SCENARIO,
      supplyCostDeltaPerCase: 100,
      affectedCases: 1_000,
    })
    expect(impact.noiImpact).toBeCloseTo(-100_000, 0)
    expect(impact.verdict).toBe("dilutive")
    expect(impact.annualDividendImpact).toBeCloseTo(-80_000, 0)
  })

  it("an empty purchase is neutral and leaves the P&L unchanged", () => {
    const impact = computePurchaseDividendImpact(PROFORMA, EMPTY_PURCHASE_SCENARIO)
    expect(impact.verdict).toBe("neutral")
    expect(impact.noiImpact).toBe(0)
    expect(impact.after.totalRevenue).toBe(impact.before.totalRevenue)
  })

  it("affectedCases is explicit — 0 models zero cases, not the whole book", () => {
    // The v0 engine defaulted 0 → all 5,200 cases while the UI displayed 0;
    // the ported engine deliberately drops that silent default.
    const impact = computePurchaseDividendImpact(PROFORMA, {
      ...EMPTY_PURCHASE_SCENARIO,
      supplyCostDeltaPerCase: -10,
    })
    expect(impact.noiImpact).toBe(0)
    expect(impact.verdict).toBe("neutral")

    const explicit = computePurchaseDividendImpact(PROFORMA, {
      ...EMPTY_PURCHASE_SCENARIO,
      supplyCostDeltaPerCase: -10,
      affectedCases: 5_200,
    })
    expect(explicit.noiImpact).toBeCloseTo(52_000, 0)
    expect(explicit.verdict).toBe("accretive")
  })

  it("a defined $0 caseReimbursement bills incremental cases at $0, not blended", () => {
    // Packaged add-on codes (e.g. navigation) carry no separate ASC payment;
    // when the Medicare card shows $0/case the engine must agree.
    const impact = computePurchaseDividendImpact(PROFORMA, {
      ...EMPTY_PURCHASE_SCENARIO,
      incrementalCases: 100,
      caseReimbursement: 0,
    })
    // 100 new cases with $0 revenue but full supply + variable cost.
    expect(impact.noiImpact).toBeLessThan(0)
    expect(impact.verdict).toBe("dilutive")
    expect(impact.after.totalRevenue).toBe(impact.before.totalRevenue)
  })

  it("payback is null (Never) when capital never returns", () => {
    const impact = computePurchaseDividendImpact(PROFORMA, {
      ...EMPTY_PURCHASE_SCENARIO,
      supplyCostDeltaPerCase: 100,
      affectedCases: 1_000,
      capitalOutlay: 500_000,
    })
    expect(impact.paybackYears).toBeNull()
    expect(impact.verdict).toBe("dilutive")
  })
})

// ─── Capital charge on the dividend (v0 engine update, 2026-08-13) ───
// A capital outlay is not a P&L item, but the owners fund it. Amortizing it
// into an annual charge is what stops a $5M robot reporting a pure dividend
// GAIN. NPV is unaffected: it charges the full outlay at year 0 and discounts
// the OPERATING stream, so capital is counted exactly once.

describe("computePurchaseDividendImpact — annual capital charge", () => {
  const robot = {
    ...EMPTY_PURCHASE_SCENARIO,
    productName: "Robot",
    incrementalCases: 200,
    capitalOutlay: 1_500_000,
    recurringAnnualCost: 120_000,
  }

  it("splits the operating impact from the net, by the annual charge", () => {
    const i = computePurchaseDividendImpact(PROFORMA, robot)
    expect(i.operatingDividendImpact).toBeCloseTo(354_838.4, 0)
    expect(i.annualCapitalCharge).toBe(300_000) // 1.5M over the 5-yr horizon
    expect(i.annualDividendImpact).toBeCloseTo(54_838.4, 0)
    expect(i.annualDividendAfter - i.annualDividendBefore).toBeCloseTo(
      i.annualDividendImpact,
      0,
    )
  })

  it("NPV is unchanged — capital is charged once, at year 0", () => {
    // Same figure as before the capital-charge change; the operating stream
    // (not the net) is what gets discounted.
    expect(computePurchaseDividendImpact(PROFORMA, robot).netPresentValue).toBeCloseTo(
      -79_723.78,
      0,
    )
  })

  it("capitalUsefulLifeYears spreads the charge over its own life", () => {
    const i = computePurchaseDividendImpact(PROFORMA, {
      ...robot,
      capitalUsefulLifeYears: 10,
    })
    expect(i.annualCapitalCharge).toBe(150_000)
    expect(i.annualDividendImpact).toBeCloseTo(204_838.4, 0)
  })

  it("a capital charge exceeding the operating gain flips the verdict", () => {
    // The whole point: pre-change this reported +$354,838 accretive no matter
    // how large the outlay.
    const i = computePurchaseDividendImpact(PROFORMA, {
      ...robot,
      capitalOutlay: 5_000_000,
    })
    expect(i.annualCapitalCharge).toBe(1_000_000)
    expect(i.annualDividendImpact).toBeCloseTo(-645_161.6, 0)
    expect(i.verdict).toBe("dilutive")
  })

  it("no outlay means no charge, and net equals operating", () => {
    const i = computePurchaseDividendImpact(PROFORMA, DEFAULT_SCENARIO)
    expect(i.annualCapitalCharge).toBe(0)
    expect(i.annualDividendImpact).toBe(i.operatingDividendImpact)
  })
})
