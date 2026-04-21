import type { RebateTier } from "../types"
import { sortTiersAscending } from "./sort-tiers"

/**
 * Marginal rebate: spend portion within each bracket × that bracket's
 * rate. Summed across all brackets up to and including the achieved
 * tier.
 *
 * Example: $75,000 spend with tiers [0, $50k=2%], [$50k, null=4%]
 *   → tier 1 bracket: $50,000 × 2% = $1,000
 *   → tier 2 bracket: $25,000 × 4% = $1,000
 *   → total: $2,000
 *
 * ─── Audit fixes ──────────────────────────────────────────────
 * [A2] No cent-rounding — bracket capacity = nextMin - currentMin exactly.
 *      Division operations retain full floating precision. Caller is
 *      responsible for display rounding.
 * [A3] INCLUSIVE boundary: handled naturally by bracket capacity (the
 *      boundary dollar belongs to the lower bracket by construction).
 *      EXCLUSIVE boundary: the boundary dollar belongs to the upper
 *      bracket, so bracket capacity is (nextMin - currentMin) from the
 *      LOWER tier's POV; the upper tier starts AT nextMin.
 */
export function calculateMarginalRebate(
  eligibleAmount: number,
  tiers: RebateTier[],
  boundaryRule: "EXCLUSIVE" | "INCLUSIVE",
): {
  totalRebate: number
  brackets: Array<{
    tierNumber: number
    bracketSpend: number
    bracketRate: number
    bracketRebate: number
  }>
} {
  if (tiers.length === 0 || eligibleAmount <= 0) {
    return { totalRebate: 0, brackets: [] }
  }

  const sorted = sortTiersAscending(tiers)
  let total = 0
  const brackets: Array<{
    tierNumber: number
    bracketSpend: number
    bracketRate: number
    bracketRebate: number
  }> = []

  // Each tier occupies the range [tier.thresholdMin, nextTier.thresholdMin).
  // bracketSpend is the amount of eligibleAmount that falls INSIDE that
  // range — clamped to zero below thresholdMin and capped at upperBound.
  //
  // 2026-04-20 property-test catch: the pre-fix implementation treated
  // `remaining = eligibleAmount` as "total to distribute starting from
  // zero" and decremented it per bracket. That silently over-allocated
  // to upper tiers whenever tier 1's thresholdMin was nonzero (e.g.
  // Charles's Qualified Annual Spend Rebate with tier 1 @ \$5.3M: spend
  // of \$200k above the floor was attributed across multiple brackets
  // even though the user was clearly IN tier 1). The corrected
  // implementation reads bracket spend directly from eligibleAmount
  // using the tier's own min/max boundaries, matching the intent of
  // marginal-bracket math in real tier ladders.
  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i]!
    const nextTier = sorted[i + 1]
    const upperBound =
      nextTier === null || nextTier === undefined
        ? Infinity
        : nextTier.thresholdMin

    const bracketSpend = Math.max(
      0,
      Math.min(eligibleAmount, upperBound) - tier.thresholdMin,
    )
    if (bracketSpend <= 0) {
      // Either spend hasn't reached this tier, or an earlier malformed
      // tier ordering produced a negative bracket — skip without
      // contributing.
      continue
    }

    // When a fixed-rebate amount is set on the tier, switch to fixed dollars
    // for this bracket (used for flat-rebate tier structures).
    const bracketRebate =
      tier.fixedRebateAmount != null
        ? tier.fixedRebateAmount
        : (bracketSpend * tier.rebateValue) / 100

    total += bracketRebate
    brackets.push({
      tierNumber: tier.tierNumber,
      bracketSpend,
      bracketRate: tier.rebateValue,
      bracketRebate,
    })

    // boundaryRule semantics (EXCLUSIVE vs INCLUSIVE) are resolved by
    // determineTier when callers need to classify the boundary dollar;
    // here we just stack brackets by range.
    void boundaryRule
  }

  return { totalRebate: total, brackets }
}
