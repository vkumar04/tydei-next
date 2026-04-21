/**
 * Price escalator — annual compound price adjustment.
 *
 * Roadmap track 10 (2026-04-20). Many multi-year contracts include a
 * CPI-linked or negotiated annual price increase ("prices escalate by
 * 3% per year on the contract anniversary"). `ContractPricing.unitPrice`
 * is the base; this helper returns the escalated price effective at a
 * given date.
 *
 * Math: compound annual increase.
 *   escalated = basePrice × (1 + escalatorPercent) ^ yearsElapsed
 *
 * Where `yearsElapsed = (asOf - effectiveDate) / 365.25` — fractional
 * years so the price ramps smoothly between anniversaries instead of
 * stepping on anniversary dates. Real contracts usually step on
 * anniversaries; callers who want step-semantics can floor `yearsElapsed`
 * before passing it in.
 *
 * Convention: `escalatorPercent` is a FRACTION (0.03 = 3%) matching
 * the rest of the rebate-units convention. Null / undefined / zero =
 * fixed price; helper returns basePrice unchanged.
 *
 * Pure. No DB, no I/O.
 */

export interface EscalatePriceInput {
  basePrice: number
  /** Annual escalator as a fraction (0.03 = 3%). Null/undefined = no escalator. */
  escalatorPercent?: number | null | undefined
  /** When the base price took effect. If omitted, returns basePrice. */
  effectiveDate?: Date | null | undefined
  /** Date at which to compute the escalated price. Default now. */
  asOf?: Date
}

export interface EscalatePriceResult {
  basePrice: number
  escalatedPrice: number
  yearsElapsed: number
  appliedRate: number
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

export function escalatePrice(
  input: EscalatePriceInput,
): EscalatePriceResult {
  const basePrice = Number.isFinite(input.basePrice) ? input.basePrice : 0
  const rawRate = input.escalatorPercent
  const rate =
    rawRate == null || Number(rawRate) <= 0 ? 0 : Number(rawRate)
  const effective = input.effectiveDate ?? null
  if (rate === 0 || !effective) {
    return {
      basePrice,
      escalatedPrice: basePrice,
      yearsElapsed: 0,
      appliedRate: 0,
    }
  }
  const asOf = input.asOf ?? new Date()
  const yearsElapsed = Math.max(
    0,
    (asOf.getTime() - effective.getTime()) / MS_PER_YEAR,
  )
  const escalated = basePrice * Math.pow(1 + rate, yearsElapsed)
  return {
    basePrice,
    escalatedPrice: escalated,
    yearsElapsed,
    appliedRate: rate,
  }
}

/**
 * Step-escalator variant: snaps `yearsElapsed` to the floor integer so
 * the price steps up only on each contract anniversary. Use when the
 * contract language says "each anniversary" rather than "continuously
 * escalating."
 */
export function escalatePriceStep(
  input: EscalatePriceInput,
): EscalatePriceResult {
  const result = escalatePrice(input)
  if (result.appliedRate === 0) return result
  const steppedYears = Math.floor(result.yearsElapsed)
  const escalated =
    result.basePrice * Math.pow(1 + result.appliedRate, steppedYears)
  return {
    ...result,
    escalatedPrice: escalated,
    yearsElapsed: steppedYears,
  }
}
