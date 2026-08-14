import { describe, it, expect } from "vitest"
import {
  computeDividendImpactFromPayload,
  resolveDividendProposalSummary,
  resolveProposalAssumptions,
} from "../dividend-proposal-summary"
import {
  computePurchaseDividendImpact,
  lineItemsToProforma,
  DEFAULT_DIVIDEND_ASSUMPTIONS,
  DEFAULT_PROFORMA_LINE_ITEMS,
  EMPTY_PURCHASE_SCENARIO,
  type DividendAssumptions,
  type PurchaseScenario,
} from "../proforma-pnl"

// A saved DividendProposal.payload is a write-through cache, never a second
// source of truth: these helpers must RECOMPUTE from the payload through the
// live engine. Every expectation below is either derived by running
// `computePurchaseDividendImpact` in the test (pinning the helper as a pure
// delegate) or a literal hand-derived from the statement parity baseline in
// proforma-pnl.test.ts.
const LINE_ITEMS = DEFAULT_PROFORMA_LINE_ITEMS
const PROFORMA = lineItemsToProforma(LINE_ITEMS)

/** Robot: $1.5M outlay, $120K/yr service, 200 incremental cases at blended rate. */
const ROBOT: PurchaseScenario = {
  ...EMPTY_PURCHASE_SCENARIO,
  productName: "Robot",
  incrementalCases: 200,
  capitalOutlay: 1_500_000,
  recurringAnnualCost: 120_000,
}

/** A realistic saved payload — provenance fields included, as the UI writes them. */
function payloadFor(
  purchase: PurchaseScenario,
  assumptions?: DividendAssumptions,
): Record<string, unknown> {
  return {
    lineItems: LINE_ITEMS,
    purchase,
    ...(assumptions ? { assumptions } : {}),
    payorGroupNames: ["Knee"],
    quarterEdits: {},
    percentOfMedicare: 120,
    medicareRateOverride: null,
    medicareRateSetId: null,
    medicareRateOverrides: [],
  }
}

describe("resolveDividendProposalSummary — pure delegate to the engine", () => {
  it("returns the engine's fields verbatim for a $1.5M capital payload", () => {
    const expected = computePurchaseDividendImpact(
      PROFORMA,
      ROBOT,
      DEFAULT_DIVIDEND_ASSUMPTIONS,
    )

    expect(resolveDividendProposalSummary(payloadFor(ROBOT))).toEqual({
      verdict: expected.verdict,
      noiImpact: expected.noiImpact,
      annualDividendImpact: expected.annualDividendImpact,
      netPresentValue: expected.netPresentValue,
      paybackYears: expected.paybackYears,
    })
  })

  it("annualDividendImpact is the NET figure — operating MINUS the capital charge", () => {
    const engine = computePurchaseDividendImpact(
      PROFORMA,
      ROBOT,
      DEFAULT_DIVIDEND_ASSUMPTIONS,
    )
    const summary = resolveDividendProposalSummary(payloadFor(ROBOT))

    expect(summary).not.toBeNull()
    // Relationship, not a literal: net = operating − annual capital charge.
    expect(summary?.annualDividendImpact).toBeCloseTo(
      engine.operatingDividendImpact - engine.annualCapitalCharge,
      6,
    )
    // …and it is NOT the pre-PR operating-only figure.
    expect(engine.annualCapitalCharge).toBeGreaterThan(0)
    expect(summary?.annualDividendImpact).not.toBe(engine.operatingDividendImpact)
  })

  it("no capital outlay → net equals operating and nothing is subtracted", () => {
    const noCapital: PurchaseScenario = {
      ...EMPTY_PURCHASE_SCENARIO,
      productName: "New implant system",
      supplyCostDeltaPerCase: 250,
      affectedCases: 1_200,
      incrementalCases: 150,
    }
    const engine = computePurchaseDividendImpact(
      PROFORMA,
      noCapital,
      DEFAULT_DIVIDEND_ASSUMPTIONS,
    )
    const summary = resolveDividendProposalSummary(payloadFor(noCapital))

    expect(engine.annualCapitalCharge).toBe(0)
    expect(summary?.annualDividendImpact).toBe(engine.operatingDividendImpact)
    expect(summary?.paybackYears).toBeNull()
  })
})

// ─── REGRESSION: the verdict must follow the NET number ───────────────
// Pre-fix, the saved `summary` columns were read straight off the row and held
// the OPERATING dividend impact (+$354,838.40 → "accretive") no matter how
// large the outlay. A $5M robot amortized over the 5-yr horizon carries a
// $1,000,000/yr charge, so the honest net is −$645,161.60 → "dilutive".
describe("resolveDividendProposalSummary — capital-heavy verdict flip (regression)", () => {
  const heavyRobot: PurchaseScenario = { ...ROBOT, capitalOutlay: 5_000_000 }

  it("a $5M outlay is dilutive even though operations alone are accretive", () => {
    const engine = computePurchaseDividendImpact(
      PROFORMA,
      heavyRobot,
      DEFAULT_DIVIDEND_ASSUMPTIONS,
    )
    // ΔNOI = 200 cases × $2,817.75 contribution − $120,000 recurring = $443,548;
    // × 80% distributable = $354,838.40 of operating dividend — accretive alone.
    expect(engine.operatingDividendImpact).toBe(354_838.4)
    expect(engine.annualCapitalCharge).toBe(1_000_000) // $5M ÷ the 5-yr horizon

    const summary = resolveDividendProposalSummary(payloadFor(heavyRobot))
    expect(summary?.annualDividendImpact).toBe(-645_161.6)
    expect(summary?.verdict).toBe("dilutive")
  })

  it("the same purchase at $1.5M stays accretive — the flip is the capital, not the product", () => {
    const summary = resolveDividendProposalSummary(payloadFor(ROBOT))
    // $1.5M ÷ 5 = $300,000/yr charge → $354,838.40 − $300,000 = $54,838.40.
    expect(summary?.annualDividendImpact).toBe(54_838.4)
    expect(summary?.verdict).toBe("accretive")
  })
})

describe("computeDividendImpactFromPayload — capital useful life", () => {
  it("amortizes over assumptions.dcfProjectionYears when the life is absent", () => {
    const tenYearHorizon: DividendAssumptions = {
      ...DEFAULT_DIVIDEND_ASSUMPTIONS,
      dcfProjectionYears: 10,
    }
    const impact = computeDividendImpactFromPayload(
      payloadFor(ROBOT, tenYearHorizon),
    )
    // $1,500,000 ÷ 10 projection years — the horizon, not a hard-coded 5.
    expect(impact?.annualCapitalCharge).toBe(150_000)
    // $354,838.40 operating − $150,000 charge.
    expect(impact?.annualDividendImpact).toBe(204_838.4)
  })

  it("honours an explicit capitalUsefulLifeYears over the horizon", () => {
    const impact = computeDividendImpactFromPayload(
      payloadFor({ ...ROBOT, capitalUsefulLifeYears: 4 }),
    )
    // $1,500,000 ÷ 4 = $375,000/yr, despite the 5-yr DCF horizon.
    expect(impact?.annualCapitalCharge).toBe(375_000)
    // $354,838.40 operating − $375,000 charge → the shorter life flips it.
    expect(impact?.annualDividendImpact).toBe(-20_161.6)
    expect(impact?.verdict).toBe("dilutive")
  })
})

describe("resolveProposalAssumptions", () => {
  const custom: DividendAssumptions = {
    dcfPctOfEbitda: 0.6,
    discountRatePct: 0.15,
    cashFlowGrowthPct: 0.08,
    dcfProjectionYears: 7,
  }

  it("returns the saved snapshot when the payload carries one", () => {
    expect(resolveProposalAssumptions(payloadFor(ROBOT, custom))).toEqual(custom)
  })

  it("falls back to the defaults for a payload saved before the field existed", () => {
    expect(resolveProposalAssumptions(payloadFor(ROBOT))).toEqual(
      DEFAULT_DIVIDEND_ASSUMPTIONS,
    )
  })

  it("falls back to the defaults for an unparseable payload", () => {
    expect(resolveProposalAssumptions(null)).toEqual(DEFAULT_DIVIDEND_ASSUMPTIONS)
    expect(resolveProposalAssumptions(undefined)).toEqual(DEFAULT_DIVIDEND_ASSUMPTIONS)
    expect(resolveProposalAssumptions({})).toEqual(DEFAULT_DIVIDEND_ASSUMPTIONS)
    expect(resolveProposalAssumptions("not-a-payload")).toEqual(
      DEFAULT_DIVIDEND_ASSUMPTIONS,
    )
  })
})

describe("resolveDividendProposalSummary — the saved assumption set drives the math", () => {
  const custom: DividendAssumptions = {
    dcfPctOfEbitda: 0.6,
    discountRatePct: 0.15,
    cashFlowGrowthPct: 0.08,
    dcfProjectionYears: 7,
  }

  it("recomputes under the payload's assumptions, not the defaults", () => {
    const underCustom = computePurchaseDividendImpact(PROFORMA, ROBOT, custom)
    const underDefaults = computePurchaseDividendImpact(
      PROFORMA,
      ROBOT,
      DEFAULT_DIVIDEND_ASSUMPTIONS,
    )
    const summary = resolveDividendProposalSummary(payloadFor(ROBOT, custom))

    expect(summary).toEqual({
      verdict: underCustom.verdict,
      noiImpact: underCustom.noiImpact,
      annualDividendImpact: underCustom.annualDividendImpact,
      netPresentValue: underCustom.netPresentValue,
      paybackYears: underCustom.paybackYears,
    })
    // Guard the guard: a defaults-only recompute would be a different number,
    // which is exactly the cross-surface divergence this pins shut.
    expect(underCustom.netPresentValue).not.toBe(underDefaults.netPresentValue)
    expect(summary?.netPresentValue).not.toBe(underDefaults.netPresentValue)
    expect(summary?.annualDividendImpact).not.toBe(
      underDefaults.annualDividendImpact,
    )
  })

  it("ΔNOI is assumption-independent; the dividend and NPV are not", () => {
    const underCustom = resolveDividendProposalSummary(payloadFor(ROBOT, custom))
    const underDefaults = resolveDividendProposalSummary(payloadFor(ROBOT))
    // NOI is pure operations — no assumption touches it.
    expect(underCustom?.noiImpact).toBe(underDefaults?.noiImpact)
    // 60% distributable over a 7-yr life: $443,548 × 0.6 − $1.5M ÷ 7.
    expect(underCustom?.annualDividendImpact).toBeCloseTo(
      443_548 * 0.6 - 1_500_000 / 7,
      2,
    )
  })
})

describe("resolveDividendProposalSummary — drifted provenance still recomputes", () => {
  it("a non-object quarterEdits does not block the recompute", () => {
    const drifted = { ...payloadFor(ROBOT), quarterEdits: "not-an-object" }
    expect(resolveDividendProposalSummary(drifted)).toEqual(
      resolveDividendProposalSummary(payloadFor(ROBOT)),
    )
  })

  it("a numeric medicareRateOverrides does not block the recompute", () => {
    const drifted = { ...payloadFor(ROBOT), medicareRateOverrides: 42 }
    expect(resolveDividendProposalSummary(drifted)).toEqual(
      resolveDividendProposalSummary(payloadFor(ROBOT)),
    )
  })

  it("provenance drift does not disturb the assumption snapshot either", () => {
    const custom: DividendAssumptions = {
      ...DEFAULT_DIVIDEND_ASSUMPTIONS,
      cashFlowGrowthPct: 0.08,
    }
    const drifted = {
      ...payloadFor(ROBOT, custom),
      quarterEdits: "not-an-object",
      medicareRateOverrides: 42,
    }
    expect(resolveProposalAssumptions(drifted)).toEqual(custom)
  })
})

describe("resolveDividendProposalSummary — unusable payloads return null", () => {
  const unusable: Array<[string, unknown]> = [
    ["empty object", {}],
    ["null", null],
    ["undefined", undefined],
    ["a bare string", "not-a-payload"],
    ["a number", 42],
    ["an array", []],
    ["missing lineItems", { purchase: ROBOT }],
    ["missing purchase", { lineItems: LINE_ITEMS }],
    [
      "malformed lineItems (non-numeric line)",
      { lineItems: { ...LINE_ITEMS, medicalSupplies: "lots" }, purchase: ROBOT },
    ],
    [
      "malformed lineItems (missing a line)",
      (() => {
        const { caseVolume: _caseVolume, ...rest } = LINE_ITEMS
        return { lineItems: rest, purchase: ROBOT }
      })(),
    ],
    [
      "non-finite lineItems value",
      {
        lineItems: { ...LINE_ITEMS, standardBillingRevenue: Number.POSITIVE_INFINITY },
        purchase: ROBOT,
      },
    ],
    [
      "malformed purchase (non-numeric outlay)",
      { lineItems: LINE_ITEMS, purchase: { ...ROBOT, capitalOutlay: "1.5M" } },
    ],
    [
      "malformed purchase (zero useful life)",
      { lineItems: LINE_ITEMS, purchase: { ...ROBOT, capitalUsefulLifeYears: 0 } },
    ],
    ["purchase is a string", { lineItems: LINE_ITEMS, purchase: "robot" }],
  ]

  for (const [label, payload] of unusable) {
    it(`returns null and never throws for ${label}`, () => {
      expect(() => resolveDividendProposalSummary(payload)).not.toThrow()
      expect(resolveDividendProposalSummary(payload)).toBeNull()
      expect(computeDividendImpactFromPayload(payload)).toBeNull()
    })
  }
})
