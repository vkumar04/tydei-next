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
 *    margin, 80% DCF, 10% discount, 3% growth, 3% terminal growth, 5 yrs,
 *    $625.9K savings):
 *   - EBITDA            = 41.7M × 0.30          = $12.51M
 *   - Distributable/yr  = 12.51M × 0.80         = $10.0M
 *   - DCF explicit PV   ≈ $40.1M
 *   - DCF terminal PV   ≈ $102.9M  (Gordon Growth, discounted back)
 *   - DCF (enterprise)  ≈ $143.0M  = explicit + terminal
 *   - ΔEBITDA           = S                      = +$625.9K
 *   - ΔMargin pts       = S / netRevenue × 100   = +1.50 pts
 *   - ΔDCF              = S × 0.80               = +$500.7K
 *   - EV impact         = S × {10, 12, 14}       = +$6.3M / $7.5M / $8.8M
 *
 * DCF rationale (Vick/John 2026-06-22): a finite N-year sum of discounted
 * cash flow omits the terminal value — the value of every cash flow beyond
 * the projection window — which in a standard DCF is 60–80% of enterprise
 * value. The old engine returned only the explicit-period PV (~$40M on the
 * screenshot), which read as "wrong." We now add the Gordon-Growth terminal
 * value: TV = FCF_N × (1+g) / (r − g), discounted back N years.
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
  /**
   * Perpetuity (terminal) growth rate for the Gordon-Growth terminal value,
   * fraction. Anchored to long-run GDP (~2–3%). Optional — defaults to
   * {@link DEFAULT_TERMINAL_GROWTH_PCT} so existing callers/tests keep
   * compiling. Must stay below the discount rate or the perpetuity diverges
   * (the engine clamps it just under `discountRatePct`).
   */
  terminalGrowthPct?: number
}

/** Default perpetuity growth for the terminal value (≈ long-run GDP). */
export const DEFAULT_TERMINAL_GROWTH_PCT = 0.03

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
  /**
   * Discounted cash flow = enterprise value: PV of the explicit-period cash
   * flows PLUS the present value of the Gordon-Growth terminal value.
   */
  dcf: number
  /** PV of the explicit N-year projection window only (no terminal value). */
  dcfExplicit: number
  /** PV of the terminal value (the perpetuity beyond year N). */
  dcfTerminalValue: number
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

export interface DcfBreakdown {
  /** PV of the explicit N-year growing-annuity cash flows. */
  explicitPv: number
  /** PV of the Gordon-Growth terminal value (perpetuity beyond year N). */
  terminalValuePv: number
  /** explicitPv + terminalValuePv — the DCF enterprise value. */
  total: number
}

/**
 * Full DCF enterprise value: the explicit-period PV {@link discountedCashFlow}
 * plus the present value of a Gordon-Growth terminal value.
 *
 *   TV (at end of year N) = FCF_N × (1 + g_terminal) / (r − g_terminal)
 *   PV(TV)                = TV / (1 + r)^N
 *
 * where FCF_N is the final explicit-year cash flow (`base × (1+g)^(N-1)`).
 * The perpetuity requires `r > g_terminal`; we clamp the terminal growth to
 * just under the discount rate so the value stays finite and positive rather
 * than diverging or flipping negative when a user drags the sliders together.
 */
export function discountedCashFlowWithTerminalValue(
  baseCashFlow: number,
  years: number,
  discount: number,
  growth: number,
  terminalGrowth: number,
): DcfBreakdown {
  const n = Math.max(0, Math.floor(years))
  const explicitPv = discountedCashFlow(baseCashFlow, n, discount, growth)
  if (n === 0 || baseCashFlow <= 0) {
    return { explicitPv, terminalValuePv: 0, total: explicitPv }
  }
  const fcfFinalYear = baseCashFlow * Math.pow(1 + growth, n - 1)
  // Keep the perpetuity convergent: terminal growth must stay below r.
  const safeTerminalGrowth = Math.min(terminalGrowth, discount - 0.005)
  const spread = discount - safeTerminalGrowth // ≥ 0.005 whenever discount > 0
  const terminalValue =
    spread > 0 ? (fcfFinalYear * (1 + safeTerminalGrowth)) / spread : 0
  const terminalValuePv = terminalValue / Math.pow(1 + discount, n)
  return { explicitPv, terminalValuePv, total: explicitPv + terminalValuePv }
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
    terminalGrowthPct,
  } = assumptions

  // ── Current state ──────────────────────────────────────────
  const ebitda = netRevenue * ebitdaMarginPct
  const distributableCashFlowPerYear = ebitda * dcfPctOfEbitda
  const dcfBreakdown = discountedCashFlowWithTerminalValue(
    distributableCashFlowPerYear,
    dcfProjectionYears,
    discountRatePct,
    cashFlowGrowthPct,
    terminalGrowthPct ?? DEFAULT_TERMINAL_GROWTH_PCT,
  )

  const current: CurrentFinancialState = {
    vendorSpend: currentVendorSpend,
    netRevenue,
    ebitda,
    distributableCashFlowPerYear,
    dcf: dcfBreakdown.total,
    dcfExplicit: dcfBreakdown.explicitPv,
    dcfTerminalValue: dcfBreakdown.terminalValuePv,
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

/**
 * Derive the negotiated annual supply saving from a buyer-side DEAL SCENARIO —
 * the facility lens on the vendor Opportunity Engine's levers:
 *   savings = currentVendorSpend × conversion × (1 + volumeGrowth) × priceReduction
 * where priceReduction is the magnitude of a price CUT (a -5% priceChange = 5%
 * saving on the converted, grown spend base). A price increase yields 0 saving.
 */
export interface DealScenarioInput {
  currentVendorSpend: number
  /** Price change vs current, fraction (-0.05 = 5% cut). */
  priceChangePct: number
  /** Share of spend converted onto the deal, fraction (0–1). */
  conversionPct: number
  /** Expected volume growth on the converted base, fraction. */
  volumeGrowthPct: number
}

export function computeDealScenarioSavings(input: DealScenarioInput): number {
  const priceReduction = Math.max(0, -input.priceChangePct)
  const conversion = Math.min(1, Math.max(0, input.conversionPct))
  const base =
    input.currentVendorSpend * conversion * (1 + input.volumeGrowthPct)
  const savings = base * priceReduction
  return Number.isFinite(savings) && savings > 0 ? savings : 0
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
  terminalGrowthPct: DEFAULT_TERMINAL_GROWTH_PCT,
}
