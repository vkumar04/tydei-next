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
  let remaining = eligibleAmount
  let cursor = 0
  let total = 0
  const brackets: Array<{
    tierNumber: number
    bracketSpend: number
    bracketRate: number
    bracketRebate: number
  }> = []

  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i]!
    const nextTier = sorted[i + 1]

    // Bracket capacity = (next tier's thresholdMin - this tier's thresholdMin).
    // Under EXCLUSIVE, the next tier starts AT nextTier.thresholdMin so the
    // capacity is (nextMin - currentMin) strictly. Under INCLUSIVE, the next
    // tier starts ABOVE nextMin so capacity is same from the lower tier's POV.
    // The difference is in which tier the boundary dollar is COUNTED in —
    // determineTier handles that; here we just stack brackets in order.
    const effectiveCap =
      nextTier === null || nextTier === undefined
        ? Infinity
        : nextTier.thresholdMin - tier.thresholdMin

    const bracketSpend = Math.min(remaining, effectiveCap)
    if (bracketSpend <= 0) break

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

    remaining -= bracketSpend
    cursor += bracketSpend

    // Under EXCLUSIVE, once we've filled a bracket exactly to its cap,
    // the next dollar spills into the NEXT tier (handled by the loop).
    // Under INCLUSIVE, same behavior at this math level — determineTier
    // distinguishes "value exactly at boundary" which is a separate concern.
    if (remaining <= 0) break
    void boundaryRule // boundary semantics are encoded in capacity above
    void cursor // retained for potential debug / logging
  }

  return { totalRebate: total, brackets }
}
