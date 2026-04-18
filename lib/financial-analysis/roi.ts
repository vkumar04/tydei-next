/**
 * Capital-contract ROI orchestrator.
 *
 * Composes the four primitive engines (MACRS depreciation, rebate
 * projection, price-lock opportunity cost, NPV/IRR) into a single
 * end-to-end ROI computation for a capital contract.
 */

import {
  buildMacrsSchedule,
  type DepreciationEntry,
} from "@/lib/financial-analysis/macrs"
import { computeIRR, computeNPV } from "@/lib/financial-analysis/npv"
import { computePriceLockCost } from "@/lib/financial-analysis/price-lock"
import { projectRebates } from "@/lib/financial-analysis/rebate-projection"

export interface CapitalROIInput {
  /** Upfront cost basis of the capital asset. */
  capitalCost: number
  /** Contract term in whole years. */
  years: number
  /** NPV discount rate as a decimal (0.10 = 10%). */
  discountRate: number
  /**
   * When true, the full capitalCost is paid at t=0.
   * When false, the capitalCost is amortized linearly across the term
   * (capitalCost / years subtracted from each inflow year).
   */
  payUpfront: boolean
  /** Marginal tax rate as a decimal (0.21 = 21%). */
  taxRate: number
  /** Annual spend on the vendor/category the contract covers. */
  annualSpend: number
  /** Rebate rate as a decimal (0.04 = 4%). */
  rebateRate: number
  /** Year-over-year spend growth rate as a decimal. */
  growthRatePerYear: number
  /** Market price decline rate as a decimal (0.02 = 2%/yr). */
  marketDeclineRate: number
}

export interface CapitalROIResult {
  /** Full 6-entry MACRS schedule. */
  depreciation: DepreciationEntry[]
  /** Per-year rebate stream (length = years). */
  rebates: number[]
  /** Per-year price-lock opportunity cost (length = years). */
  priceLockCost: number[]
  /**
   * Cash-flow series used for NPV/IRR. Length = years + 1.
   * cashflows[0] is the initial outlay (negative); cashflows[1..years]
   * are year-by-year net inflows to the facility.
   */
  cashflows: number[]
  /** NPV of the cashflow series at `discountRate`. */
  npv: number
  /** IRR of the cashflow series, or null if no real IRR exists. */
  irr: number | null
  /** Sum of the yearly rebates. */
  totalRebate: number
  /** Sum of tax savings across the MACRS schedule. */
  totalTaxSavings: number
  /** Sum of the yearly price-lock opportunity costs. */
  totalOpportunityCost: number
}

/**
 * Compute end-to-end capital-contract ROI.
 *
 * Cash-flow construction (0-indexed, so cashflows[0] is t=0):
 *
 *   cashflows[0] = payUpfront ? −capitalCost : 0
 *
 *   For each t in 1..years (1-indexed contract year):
 *     depreciationIndex = t − 1  (MACRS entries are 0-indexed)
 *     taxSavings[t]     = depreciation[t-1]?.taxSavings ?? 0  (6-entry cap)
 *     netCashIn[t]      = rebates[t-1] + taxSavings[t] − priceLockCost[t-1]
 *     amortizedOutflow  = payUpfront ? 0 : capitalCost / years
 *     cashflows[t]      = netCashIn[t] − amortizedOutflow
 *
 * Note: MACRS only has 6 entries; for contract terms > 6 years the
 * trailing years have zero tax savings. For terms < 6 years the later
 * MACRS entries are simply unused in the cash-flow series.
 *
 * NPV is then `computeNPV(cashflows, discountRate)` and IRR is
 * `computeIRR(cashflows)`.
 */
export function computeCapitalROI(input: CapitalROIInput): CapitalROIResult {
  const {
    capitalCost,
    years,
    discountRate,
    payUpfront,
    taxRate,
    annualSpend,
    rebateRate,
    growthRatePerYear,
    marketDeclineRate,
  } = input

  const depreciation = buildMacrsSchedule({ capitalCost, taxRate })
  const { yearlyRebates, totalRebate } = projectRebates({
    annualSpend,
    rebateRate,
    years,
    growthRatePerYear,
  })
  const { yearlyCost: priceLockCost, totalOpportunityCost } =
    computePriceLockCost({
      annualSpend,
      years,
      marketDeclineRate,
    })

  const amortizedOutflow = payUpfront ? 0 : years > 0 ? capitalCost / years : 0

  const cashflows: number[] = new Array(years + 1)
  cashflows[0] = payUpfront ? -capitalCost : 0

  let totalTaxSavings = 0
  for (let t = 1; t <= years; t++) {
    const entry = depreciation[t - 1]
    const taxSavings = entry ? entry.taxSavings : 0
    totalTaxSavings += taxSavings
    const rebate = yearlyRebates[t - 1] ?? 0
    const plCost = priceLockCost[t - 1] ?? 0
    cashflows[t] = rebate + taxSavings - plCost - amortizedOutflow
  }

  const npv = computeNPV(cashflows, discountRate)
  const irr = computeIRR(cashflows)

  return {
    depreciation,
    rebates: yearlyRebates,
    priceLockCost,
    cashflows,
    npv,
    irr,
    totalRebate,
    totalTaxSavings,
    totalOpportunityCost,
  }
}
