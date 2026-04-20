/**
 * Charles W1.Y-D — Capital retirement needed math (tie-in-specific).
 *
 * Pure reducer. Given remaining capital (capitalAmount − rebatesApplied),
 * months left on the amortization schedule, and the current tier rebate %,
 * returns the monthly and annual spend needed to retire the capital at the
 * current pace.
 *
 * Inputs:
 *   - capitalAmount: full capital entered on the contract terms.
 *   - rebatesApplied: canonical `sumRebateAppliedToCapital` output.
 *   - monthsRemaining: remaining periods on the amortization schedule.
 *   - rebatePercent: current tier rate, as integer percent (5 = 5%).
 *
 * Outputs:
 *   - remainingCapital: capitalAmount − rebatesApplied (floored at 0).
 *   - monthlySpendNeeded / annualSpendNeeded: spend at current tier rate
 *     to close the remaining capital across monthsRemaining. Null when the
 *     tier rate is zero or months remaining is zero (math undefined).
 *
 * Used by the Capital Amortization card ("Annual Spend Needed to Retire
 * Capital" tile, tie-in only).
 */

export interface CapitalRetirementNeededInput {
  capitalAmount: number
  rebatesApplied: number
  monthsRemaining: number
  rebatePercent: number
}

export interface CapitalRetirementNeededResult {
  remainingCapital: number
  monthlySpendNeeded: number | null
  annualSpendNeeded: number | null
}

export function computeCapitalRetirementNeeded(
  input: CapitalRetirementNeededInput,
): CapitalRetirementNeededResult {
  const remainingCapital = Math.max(
    input.capitalAmount - input.rebatesApplied,
    0,
  )
  if (remainingCapital === 0) {
    return { remainingCapital: 0, monthlySpendNeeded: 0, annualSpendNeeded: 0 }
  }
  if (input.rebatePercent <= 0 || input.monthsRemaining <= 0) {
    return { remainingCapital, monthlySpendNeeded: null, annualSpendNeeded: null }
  }
  const monthlyRebateNeeded = remainingCapital / input.monthsRemaining
  const monthlySpendNeeded = monthlyRebateNeeded / (input.rebatePercent / 100)
  return {
    remainingCapital,
    monthlySpendNeeded,
    annualSpendNeeded: monthlySpendNeeded * 12,
  }
}
