/**
 * Rebate projection across a multi-year contract term.
 *
 * Projects rebate earnings under an assumption that the facility's
 * annual spend grows geometrically year over year and that the rebate
 * rate applies to that growing base.
 */

export interface RebateProjectionInput {
  /** Facility annual spend (year 1 baseline) in dollars. */
  annualSpend: number
  /** Rebate rate applied to spend as a decimal (0.04 = 4%). */
  rebateRate: number
  /** Number of contract years. */
  years: number
  /** Year-over-year spend growth rate as a decimal (0.03 = 3%). */
  growthRatePerYear: number
}

export interface RebateProjectionResult {
  /** Rebate earned in year t (0-indexed; index 0 = contract year 1). */
  yearlyRebates: number[]
  /** Sum of yearlyRebates over the term. */
  totalRebate: number
}

/**
 * Project rebates across the contract term.
 *
 * Formulas (for 0-indexed t, with t=0 meaning contract year 1):
 *   projectedSpend[t]  = annualSpend × (1 + growthRatePerYear)^t
 *   yearlyRebates[t]   = projectedSpend[t] × rebateRate
 *   totalRebate        = Σ yearlyRebates[t]
 *
 * Year 1 rebate is always annualSpend × rebateRate regardless of the
 * growth rate (because (1 + g)^0 = 1). A growth rate of 0 yields a flat
 * rebate stream. A years value of 0 yields an empty array.
 */
export function projectRebates(
  input: RebateProjectionInput,
): RebateProjectionResult {
  const { annualSpend, rebateRate, years, growthRatePerYear } = input
  const yearlyRebates: number[] = []
  let total = 0

  for (let t = 0; t < years; t++) {
    const projectedSpend = annualSpend * Math.pow(1 + growthRatePerYear, t)
    const rebate = projectedSpend * rebateRate
    yearlyRebates.push(rebate)
    total += rebate
  }

  return { yearlyRebates, totalRebate: total }
}
