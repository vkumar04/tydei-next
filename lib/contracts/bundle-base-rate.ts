/**
 * Bundle base-rate selection for the tie-in compliance card.
 *
 * The tie-in "effective rate" headline needs a PERCENT base rate. A contract's
 * terms can mix rebate types — a `compliance_rebate` term, for example, carries
 * `fixed_rebate` tiers whose `rebateValue` is a DOLLAR amount, not a rate. The
 * pre-fix code grabbed `terms[0].tiers[0]` blindly, so a $17,500 fixed
 * compliance rebate was read as 17,500% and clamped to 100% (Charles, observed
 * 2026-06-07 on STK-2025-TIE). Pull the base rate only from a percent-based
 * tier; fall back to the v0 default when none exists. A genuinely out-of-range
 * percent value (e.g. a spend threshold mis-stored in the rebate column) is
 * still clamped to 0..100 as defense.
 */
import {
  isPercentRebateType,
  toDisplayRebateValue,
} from "@/lib/contracts/rebate-value-normalize"

/** v0 default bundle base rate (%) when the contract has no percent tier. */
export const DEFAULT_BUNDLE_BASE_RATE = 2

export interface BaseRateTierLike {
  rebateType?: string | null
  rebateValue: number | string | { toString(): string }
}

export interface BaseRateTermLike {
  tiers: ReadonlyArray<BaseRateTierLike>
}

export interface BundleBaseRateResult {
  /** Effective base rate %, clamped to 0..100. */
  baseRate: number
  /** True when a percent tier's display value fell outside 0..100 and was clamped. */
  clamped: boolean
  /** Pre-clamp display value of the selected percent tier (null when none found). */
  rawDisplay: number | null
  /** Raw stored rebateValue of the selected percent tier (null when none found). */
  rawValue: number | null
}

/**
 * Select the bundle base rate from the top tier of the first PERCENT-based term.
 * Skips fixed-dollar tiers; falls back to {@link DEFAULT_BUNDLE_BASE_RATE} when
 * no percent tier exists; clamps out-of-range percent values to 0..100.
 */
export function selectBundleBaseRate(
  terms: ReadonlyArray<BaseRateTermLike>,
): BundleBaseRateResult {
  const percentTopTier = terms
    .map((t) => t.tiers[0])
    .find(
      (ti): ti is BaseRateTierLike =>
        !!ti && isPercentRebateType(ti.rebateType ?? "percent_of_spend"),
    )

  if (!percentTopTier) {
    return {
      baseRate: DEFAULT_BUNDLE_BASE_RATE,
      clamped: false,
      rawDisplay: null,
      rawValue: null,
    }
  }

  const rawValue = Number(percentTopTier.rebateValue)
  const rawDisplay = toDisplayRebateValue(
    percentTopTier.rebateType ?? "percent_of_spend",
    rawValue,
  )
  const baseRate = Math.max(0, Math.min(100, rawDisplay))
  return {
    baseRate,
    clamped: rawDisplay < 0 || rawDisplay > 100,
    rawDisplay,
    rawValue,
  }
}
