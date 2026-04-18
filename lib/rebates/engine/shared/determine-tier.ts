import type { RebateTier, TierBoundaryRule } from "../types"
import { sortTiersAscending } from "./sort-tiers"

/**
 * Find the highest qualifying tier for a given value.
 *
 * ─── [A1] EXCLUSIVE-boundary fix ─────────────────────────────────
 * The boundary rule determines whether a value EQUAL to a tier's
 * thresholdMin counts as IN that tier (INCLUSIVE) or promotes to the
 * next tier (EXCLUSIVE). Example:
 *   value = $50,000, tier 2 starts at thresholdMin = $50,000
 *   - INCLUSIVE → value stays in tier 1 (tier 2 starts ABOVE $50k)
 *   - EXCLUSIVE → value moves to tier 2 (tier 2 starts AT $50k)
 *
 * Audit fix [A1]: under EXCLUSIVE, scan ALL tiers and return the
 * highest qualifying match. The pre-fix code broke early after the
 * first match, which silently returned tier 1 when the value
 * qualified for tier 3.
 *
 * Returns null when no tier qualifies (value < lowest thresholdMin).
 */
export function determineTier(
  value: number,
  tiers: RebateTier[],
  boundaryRule: TierBoundaryRule,
): RebateTier | null {
  if (tiers.length === 0) return null

  const sorted = sortTiersAscending(tiers)
  let match: RebateTier | null = null

  for (const tier of sorted) {
    const qualifiesLow =
      boundaryRule === "INCLUSIVE"
        ? value > tier.thresholdMin
        : value >= tier.thresholdMin
    const qualifiesHigh =
      tier.thresholdMax === null || value <= tier.thresholdMax

    if (qualifiesLow && qualifiesHigh) {
      match = tier
      // [A1] Keep scanning — higher tiers might also qualify when
      // spendMax ranges overlap (some real contracts have this).
    }
  }

  return match
}
