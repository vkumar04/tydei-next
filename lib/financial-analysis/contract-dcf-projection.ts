/**
 * How ONE contract affects ONE saved Dividend/DCF proposal, year by year.
 *
 * Charles 2026-08-13: the contract tab should "consider the specific contract
 * at hand relative to the DCF proposal and how that specific contract affects
 * that DCF proposal", and carry a prospective piece.
 *
 * The model, driven by a SINGLE growth rate g:
 *
 *   g                = usageGrowthPercent/100, defaulting to the proposal's own
 *                      `assumptions.cashFlowGrowthPct` — so "no override" is the
 *                      identity case against the Dividend/DCF tab
 *   operating[y]     = the proposal's operating dividend x (1+g)^(y-1)
 *   contractSpend[y] = baseAnnualSpend                   x (1+g)^(y-1)
 *   rebate[y]        = the tier ladder applied to CUMULATIVE QUALIFYING spend —
 *                      i.e. after this term's period cap and, for a growth-only
 *                      term, after the annual spendBaseline comes off EACH
 *                      year's spend
 *   ownerDividend[y] = operating[y] + rebate[y] x distributable%
 *   NPV              = proposal NPV(at g) + Σ rebate[y] x dist% / (1+r)^y
 *
 * Growth compounds BOTH sides because they share a cause: more procedures means
 * both more revenue in the proposal and more spend against the contract, which
 * is what steps the rebate tier up over the term.
 *
 * Two canonical helpers own the two halves; neither is re-implemented here.
 *
 *  - OPERATING half: `computePurchaseDividendImpact`, which already prices the
 *    stream as a growing annuity and already charges the full outlay once at
 *    year 0. Called ONCE, with `cashFlowGrowthPct` overridden to g — not once
 *    per year at a grown case count, which grows only the incremental-case
 *    component and leaves affected-case savings and the recurring cost flat.
 *  - REBATE half: `projectRebateAccrualSchedule`, so this surface cannot
 *    disagree with the accrual timeline.
 *
 * The override REPLACES cashFlowGrowthPct rather than compounding on top of it:
 * that assumption already is the growth of this dividend stream.
 */

import {
  projectRebateAccrualSchedule,
  type AccrualMethod,
  type AccrualBoundaryRule,
  type AccrualTier,
} from "@/lib/contracts/rebate-accrual-schedule"
import {
  computePurchaseDividendImpact,
  type DividendAssumptions,
  type ProformaPnL,
  type PurchaseScenario,
} from "./proforma-pnl"

export interface ContractDcfYear {
  year: number
  /** Incremental procedure volume at this year's growth factor. */
  cases: number
  /** The proposal's operating dividend impact at that volume (pre-capital). */
  operatingDividend: number
  /** Contract spend this year, grown at the same rate. GROSS. */
  contractSpend: number
  cumulativeContractSpend: number
  /** The slice of contractSpend the ladder actually earned on, after the period
   *  cap and the growth baseline. Equals contractSpend when neither applies. */
  qualifyingSpend: number
  /** Dollars of contractSpend removed by the growth baseline this year. */
  growthBaselineApplied: number
  /** Tier the CUMULATIVE QUALIFYING spend has reached (0 = none). */
  tierAchieved: number
  rebatePercent: number
  rebate: number
  /** The share of the rebate that reaches the owners. */
  rebateUplift: number
  /** operatingDividend + rebateUplift. */
  ownerDividend: number
  presentValue: number
  cumulativePresentValue: number
}

export interface ContractDcfProjection {
  years: ContractDcfYear[]
  /** NPV of the owner-dividend stream, net of the year-0 capital outlay.
   *  Identically `proposalNetPresentValue + totalRebatePv` — the contract is
   *  additive to the proposal, never a re-derivation of it. */
  netPresentValue: number
  /** The linked proposal's OWN NPV at this growth rate, straight from
   *  `computePurchaseDividendImpact`. With an empty ladder it equals
   *  `netPresentValue` exactly. */
  proposalNetPresentValue: number
  /** The growth rate actually applied, in whole percent (3 = +3%/yr). */
  growthPercent: number
  capitalOutlay: number
  /** Fractional year at which cumulative PV turns non-negative; null = never. */
  paybackYears: number | null
  totalRebate: number
  /** PV of the rebate uplift alone — the contract's own contribution. */
  totalRebatePv: number
  firstTier: number
  lastTier: number
  /** True when the tier ladder steps up across the horizon. */
  tierStepsUp: boolean
}

export interface ContractDcfInput {
  proforma: ProformaPnL
  purchase: PurchaseScenario
  assumptions: DividendAssumptions
  /** Year-1 contract spend, before growth. */
  baseAnnualSpend: number
  /** Already in ENGINE units — percent in `rebateValue`, flat dollars in
   *  `fixedRebateAmount`. Producers map Prisma rows with `toEngineRebateUnits`
   *  (lib/rebates/calculate.ts); never assign a raw ContractTier.rebateValue. */
  tiers: AccrualTier[]
  /** Whole percent, e.g. 5 = +5%/yr. OMIT for "no override": the projection
   *  then runs at the proposal's own `assumptions.cashFlowGrowthPct`, the case
   *  where this surface's NPV equals the proposal's EXACTLY. When supplied it
   *  REPLACES that rate — it is never layered on top of it. */
  usageGrowthPercent?: number
  rebateMethod?: AccrualMethod
  boundaryRule?: AccrualBoundaryRule
  /** `ContractTerm.spendBaseline` in annual dollars. Only bites when growthOnly. */
  spendBaseline?: number | null
  /** `ContractTerm.growthOnly` — gates the baseline subtraction. */
  growthOnly?: boolean
  /** `ContractTerm.periodCap`, already annualized (`annualizePeriodCap`). */
  periodCap?: number | null
}

export function computeContractDcfProjection(
  input: ContractDcfInput,
): ContractDcfProjection {
  const {
    proforma,
    purchase,
    assumptions,
    baseAnnualSpend,
    tiers,
    usageGrowthPercent,
    rebateMethod = "cumulative",
    boundaryRule = "exclusive",
    spendBaseline = null,
    growthOnly = false,
    periodCap = null,
  } = input

  const horizon = Math.max(1, Math.floor(assumptions.dcfProjectionYears))
  // No override ⇒ the proposal's own growth convention, so an untouched slider
  // reproduces the Dividend/DCF tab exactly.
  const g =
    usageGrowthPercent === undefined
      ? assumptions.cashFlowGrowthPct
      : usageGrowthPercent / 100
  const r = assumptions.discountRatePct
  const distPct = assumptions.dcfPctOfEbitda
  const capital = purchase.capitalOutlay
  const growthFactor = (year: number) => Math.pow(1 + g, year - 1)

  // Horizon pinned to the one this table renders so the two cannot disagree on
  // period count.
  const effectiveAssumptions: DividendAssumptions = {
    ...assumptions,
    cashFlowGrowthPct: g,
    dcfProjectionYears: horizon,
  }
  const proposalImpact = computePurchaseDividendImpact(
    proforma,
    purchase,
    effectiveAssumptions,
  )
  const operatingBase = proposalImpact.operatingDividendImpact

  // Baseline and cap go through the helper, never applied here: both must bite
  // inside the period loop, before tier lookup and before the delta subtraction.
  const accrual = projectRebateAccrualSchedule({
    tiers,
    periodProjections: Array.from({ length: horizon }, (_, i) => ({
      periodNumber: i + 1,
      projectedSpend: baseAnnualSpend * growthFactor(i + 1),
    })),
    method: rebateMethod,
    boundaryRule,
    spendBaseline,
    growthOnly,
    periodCap,
    periodMonths: 12,
  })

  const years: ContractDcfYear[] = []
  let cumulativePv = -capital

  for (let year = 1; year <= horizon; year++) {
    const vf = growthFactor(year)
    const period = accrual[year - 1]

    // The capital charge is not applied per year — the full outlay is already
    // charged once at year 0 inside proposalImpact.
    const operatingDividend = operatingBase * vf

    const rebate = period?.projectedRebate ?? 0
    const rebateUplift = rebate * distPct
    const ownerDividend = operatingDividend + rebateUplift
    const presentValue = ownerDividend / Math.pow(1 + r, year)

    cumulativePv += presentValue

    years.push({
      year,
      cases: purchase.incrementalCases * vf,
      operatingDividend,
      contractSpend: period?.projectedSpend ?? 0,
      cumulativeContractSpend: period?.cumulativeSpend ?? 0,
      qualifyingSpend: period?.qualifyingSpend ?? 0,
      growthBaselineApplied: period?.growthBaselineApplied ?? 0,
      tierAchieved: period?.achievedTier ?? 0,
      rebatePercent: period?.rebateAccrualPercent ?? 0,
      rebate,
      rebateUplift,
      ownerDividend,
      presentValue,
      cumulativePresentValue: cumulativePv,
    })
  }

  // Fractional payback: interpolate within the year cumulative PV crosses zero.
  let paybackYears: number | null = null
  let prev = -capital
  for (const y of years) {
    if (y.cumulativePresentValue >= 0) {
      const frac = y.presentValue > 0 ? -prev / y.presentValue : 0
      paybackYears = y.year - 1 + Math.min(Math.max(frac, 0), 1)
      break
    }
    prev = y.cumulativePresentValue
  }

  const totalRebate = years.reduce((s, y) => s + y.rebate, 0)
  const totalRebatePv = years.reduce(
    (s, y) => s + y.rebateUplift / Math.pow(1 + r, y.year),
    0,
  )
  const firstTier = years[0]?.tierAchieved ?? 0
  const lastTier = years[years.length - 1]?.tierAchieved ?? 0

  return {
    years,
    // Rows re-derive from the cent-rounded operatingBase, so Σ row PV − capital
    // can differ from this by a couple of cents. This is the canonical figure.
    netPresentValue: proposalImpact.netPresentValue + totalRebatePv,
    proposalNetPresentValue: proposalImpact.netPresentValue,
    growthPercent: g * 100,
    capitalOutlay: capital,
    paybackYears,
    totalRebate,
    totalRebatePv,
    firstTier,
    lastTier,
    tierStepsUp: lastTier > firstTier,
  }
}
