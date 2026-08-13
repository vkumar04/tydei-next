/**
 * How ONE contract affects ONE saved Dividend/DCF proposal, year by year.
 *
 * Charles 2026-08-13: the contract tab should "consider the specific contract
 * at hand relative to the DCF proposal and how that specific contract affects
 * that DCF proposal", and carry a prospective piece.
 *
 * The model, driven by a single usage-growth assumption:
 *
 *   volume[y]        = incrementalCases x (1+g)^(y-1)
 *   contractSpend[y] = baseAnnualSpend  x (1+g)^(y-1)
 *   rebate[y]        = the contract's tier ladder applied to CUMULATIVE spend
 *   ownerDividend[y] = proposal operating dividend at volume[y]
 *                      + rebate[y] x distributable%
 *   NPV              = -capitalOutlay + Σ ownerDividend[y] / (1+r)^y
 *
 * Growth compounds BOTH sides because they share a cause: more procedures
 * means both more revenue in the proposal and more spend against the contract,
 * which is what steps the rebate tier up over the term.
 *
 * The rebate ladder is NOT recomputed here — it delegates to
 * `projectRebateAccrualSchedule` (lib/contracts/rebate-accrual-schedule.ts),
 * the canonical cumulative-spend accrual helper, so this surface cannot
 * disagree with the accrual timeline or the contract's own rebate figures.
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
  /** Contract spend this year, grown at the same rate. */
  contractSpend: number
  cumulativeContractSpend: number
  /** Tier the CUMULATIVE spend has reached (0 = none). */
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
  /** NPV of the owner-dividend stream, net of the year-0 capital outlay. */
  netPresentValue: number
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
  /** Already scaled to engine units (percent) — see scaleRebateValueForEngine. */
  tiers: AccrualTier[]
  /** Whole percent, e.g. 5 = +5%/yr. */
  usageGrowthPercent: number
  rebateMethod?: AccrualMethod
  boundaryRule?: AccrualBoundaryRule
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
  } = input

  const horizon = Math.max(1, Math.floor(assumptions.dcfProjectionYears))
  const g = usageGrowthPercent / 100
  const r = assumptions.discountRatePct
  const distPct = assumptions.dcfPctOfEbitda
  const capital = purchase.capitalOutlay
  const growthFactor = (year: number) => Math.pow(1 + g, year - 1)

  // Rebate ladder for the whole horizon, in ONE canonical call.
  const accrual = projectRebateAccrualSchedule({
    tiers,
    periodProjections: Array.from({ length: horizon }, (_, i) => ({
      periodNumber: i + 1,
      projectedSpend: baseAnnualSpend * growthFactor(i + 1),
    })),
    method: rebateMethod,
    boundaryRule,
  })

  const years: ContractDcfYear[] = []
  let cumulativePv = -capital
  let npv = -capital

  for (let year = 1; year <= horizon; year++) {
    const vf = growthFactor(year)
    const period = accrual[year - 1]

    // Re-run the proposal at this year's volume. The capital charge is NOT
    // applied per-year here: the full outlay is a real cash event charged once
    // at year 0 below, so using the OPERATING figure avoids double-counting.
    const yearImpact = computePurchaseDividendImpact(
      proforma,
      { ...purchase, incrementalCases: purchase.incrementalCases * vf },
      assumptions,
    )
    const operatingDividend = yearImpact.operatingDividendImpact

    const rebate = period?.projectedRebate ?? 0
    const rebateUplift = rebate * distPct
    const ownerDividend = operatingDividend + rebateUplift
    const presentValue = ownerDividend / Math.pow(1 + r, year)

    npv += presentValue
    cumulativePv += presentValue

    years.push({
      year,
      cases: purchase.incrementalCases * vf,
      operatingDividend,
      contractSpend: period?.projectedSpend ?? 0,
      cumulativeContractSpend: period?.cumulativeSpend ?? 0,
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
    netPresentValue: npv,
    capitalOutlay: capital,
    paybackYears,
    totalRebate,
    totalRebatePv,
    firstTier,
    lastTier,
    tierStepsUp: lastTier > firstTier,
  }
}
