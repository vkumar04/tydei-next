/**
 * Facility Prospective Impact Model — the core engine behind the facility
 * "Analysis" dashboard (Charles spec, 2026-06-21).
 *
 * Pure function. Zero Prisma, zero IO. Fully assumption-driven: the caller
 * supplies a top-line revenue + supply-spend figure plus a handful of
 * financial assumptions (sliders on the page), and the engine derives the
 * facility's current financial state (EBITDA, distributable cash flow,
 * enterprise value) and the prospective impact of a negotiated annual
 * supply saving.
 *
 * Every figure on the page recalculates from this one function so the
 * sliders feel instant. The math is pinned to the screenshot numbers in
 * `__tests__/prospective-impact-model.test.ts`.
 *
 * ── Verified against the screenshot ($41.7M net revenue, 30% EBITDA
 *    margin, 80% DCF, 10% discount, 3% growth, 5 yrs, $625.9K savings):
 *   - EBITDA            = 41.7M × 0.30          = $12.51M
 *   - Distributable/yr  = 12.51M × 0.80         = $10.0M
 *   - DCF (growing PV)  ≈ $40.1M
 *   - ΔEBITDA           = S                      = +$625.9K
 *   - ΔMargin pts       = S / netRevenue × 100   = +1.50 pts
 *   - ΔDCF              = S × 0.80               = +$500.7K
 *   - EV impact         = S × {10, 12, 14}       = +$6.3M / $7.5M / $8.8M
 */

// ─── Inputs ────────────────────────────────────────────────────

/** The Financial Assumptions slider state plus the two top-line seeds. */
export interface FacilityModelAssumptions {
  /** Total facility net revenue (top-line). */
  netRevenue: number
  /** Total annual supply / vendor spend. */
  currentVendorSpend: number
  /** Annual surgical case volume — drives the $/case impact. */
  annualCaseVolume: number

  /** Supply cost as a fraction of revenue (0.30 = 30%). Display + sanity only. */
  supplyCostPctOfRevenue: number
  /** EBITDA margin as a fraction of revenue (0.30 = 30%). */
  ebitdaMarginPct: number
  /** Distributable cash flow as a fraction of EBITDA (0.80 = 80%). */
  dcfPctOfEbitda: number
  /** Discount rate for the DCF, fraction (0.10 = 10%). */
  discountRatePct: number
  /** Annual cash-flow growth, fraction (0.03 = 3%). */
  cashFlowGrowthPct: number
  /** Number of years projected in the DCF. */
  dcfProjectionYears: number
}

/** The three Enterprise Value multiple scenarios. */
export const EV_MULTIPLES = {
  conservative: 10,
  expected: 12,
  aggressive: 14,
} as const

export type EvScenario = keyof typeof EV_MULTIPLES

// ─── Outputs ───────────────────────────────────────────────────

export interface CurrentFinancialState {
  vendorSpend: number
  netRevenue: number
  ebitda: number
  /** Distributable cash flow in year 1 (EBITDA × dcfPct). */
  distributableCashFlowPerYear: number
  /** Discounted cash flow over the projection window. */
  dcf: number
  ebitdaMarginPct: number
}

export interface EnterpriseValueByMultiple {
  scenario: EvScenario
  multiple: number
  /** EV at the current EBITDA. */
  currentEv: number
  /** Incremental EV created by the prospective impact (Δebitda × multiple). */
  incrementalEv: number
  /** EV at the future (post-impact) EBITDA. */
  futureEv: number
}

export interface ProspectiveImpact {
  /** The negotiated annual supply saving driving the impact. */
  annualSupplySavings: number
  /** Savings as a fraction of current vendor spend. */
  savingsPctOfSpend: number
  /** ΔEBITDA — savings flow straight to EBITDA. */
  impactToEbitda: number
  /** ΔMargin in percentage points. */
  impactToMarginPoints: number
  /** ΔDistributable cash flow (per year). */
  impactToDistributableCashFlow: number
  /** $ impact spread per case. */
  impactPerCase: number
  /** Post-impact EBITDA. */
  futureEbitda: number
  /** Post-impact EBITDA margin (fraction). */
  futureEbitdaMarginPct: number
  /** EV impact at each multiple. */
  enterpriseValue: EnterpriseValueByMultiple[]
}

export interface FacilityProspectiveModel {
  current: CurrentFinancialState
  impact: ProspectiveImpact
}

// ─── Engine ────────────────────────────────────────────────────

/**
 * Discounted cash flow of a growing annuity: a level base cash flow that
 * grows at `growth` each year, discounted at `discount`, over `years`.
 *
 *   PV = Σ_{t=1..n}  base × (1+g)^(t-1) / (1+r)^t
 *
 * Closed-form when r ≠ g, summed directly otherwise (also dodges the
 * r==g singularity). Returns 0 for non-positive years.
 */
export function discountedCashFlow(
  baseCashFlow: number,
  years: number,
  discount: number,
  growth: number,
): number {
  const n = Math.max(0, Math.floor(years))
  if (n === 0) return 0
  // Direct sum — robust to r==g and cheap for the small n we use here.
  let pv = 0
  for (let t = 1; t <= n; t++) {
    pv += (baseCashFlow * Math.pow(1 + growth, t - 1)) / Math.pow(1 + discount, t)
  }
  return pv
}

export function computeFacilityProspectiveModel(
  assumptions: FacilityModelAssumptions,
  annualSupplySavings: number,
): FacilityProspectiveModel {
  const {
    netRevenue,
    currentVendorSpend,
    annualCaseVolume,
    ebitdaMarginPct,
    dcfPctOfEbitda,
    discountRatePct,
    cashFlowGrowthPct,
    dcfProjectionYears,
  } = assumptions

  // ── Current state ──────────────────────────────────────────
  const ebitda = netRevenue * ebitdaMarginPct
  const distributableCashFlowPerYear = ebitda * dcfPctOfEbitda
  const dcf = discountedCashFlow(
    distributableCashFlowPerYear,
    dcfProjectionYears,
    discountRatePct,
    cashFlowGrowthPct,
  )

  const current: CurrentFinancialState = {
    vendorSpend: currentVendorSpend,
    netRevenue,
    ebitda,
    distributableCashFlowPerYear,
    dcf,
    ebitdaMarginPct,
  }

  // ── Prospective impact ─────────────────────────────────────
  const savings = Math.max(0, annualSupplySavings)
  const futureEbitda = ebitda + savings
  const futureEbitdaMarginPct = netRevenue > 0 ? futureEbitda / netRevenue : 0

  const impact: ProspectiveImpact = {
    annualSupplySavings: savings,
    savingsPctOfSpend: currentVendorSpend > 0 ? savings / currentVendorSpend : 0,
    impactToEbitda: savings,
    impactToMarginPoints:
      netRevenue > 0 ? (savings / netRevenue) * 100 : 0,
    impactToDistributableCashFlow: savings * dcfPctOfEbitda,
    impactPerCase: annualCaseVolume > 0 ? savings / annualCaseVolume : 0,
    futureEbitda,
    futureEbitdaMarginPct,
    enterpriseValue: computeEnterpriseValueScenarios(ebitda, savings),
  }

  return { current, impact }
}

function computeEnterpriseValueScenarios(
  currentEbitda: number,
  deltaEbitda: number,
): EnterpriseValueByMultiple[] {
  return (Object.keys(EV_MULTIPLES) as EvScenario[]).map((scenario) => {
    const multiple = EV_MULTIPLES[scenario]
    const currentEv = currentEbitda * multiple
    const incrementalEv = deltaEbitda * multiple
    return {
      scenario,
      multiple,
      currentEv,
      incrementalEv,
      futureEv: currentEv + incrementalEv,
    }
  })
}

/** Sensible defaults for a mid-size ASC — seeds the sliders on first load. */
export const DEFAULT_FACILITY_ASSUMPTIONS: FacilityModelAssumptions = {
  netRevenue: 41_700_000,
  currentVendorSpend: 12_500_000,
  annualCaseVolume: 5,
  supplyCostPctOfRevenue: 0.3,
  ebitdaMarginPct: 0.3,
  dcfPctOfEbitda: 0.8,
  discountRatePct: 0.1,
  cashFlowGrowthPct: 0.03,
  dcfProjectionYears: 5,
}
