import type { RebateTier, TierBoundaryRule } from "../types"
import { sortTiersAscending } from "./sort-tiers"

/**
 * Find the highest qualifying tier for a given value.
 *
 * ─── Boundary semantics — IMPORTANT NAMING NOTE ──────────────────
 * Charles audit deferred-fix: the boundary-rule names are INVERTED
 * from the standard math-interval reading. In this engine:
 *   - "INCLUSIVE" means tier 2 starts ABOVE its thresholdMin
 *     (the boundary is INCLUDED in the *lower* tier).
 *   - "EXCLUSIVE" means tier 2 starts AT its thresholdMin
 *     (the boundary is EXCLUDED from the lower tier and goes to the
 *     upper one).
 * Most contract-engineer readers expect the opposite. Every current
 * caller passes "EXCLUSIVE" so the practical impact is zero, but
 * future contributors should NOT assume math-textbook semantics
 * here. Renaming would be a breaking schema change
 * (Contract.boundaryRule string values in production DBs).
 *
 * Worked example: value = $50,000, tier 2 thresholdMin = $50,000
 *   - INCLUSIVE → tier 1 (tier 2 starts ABOVE $50k)
 *   - EXCLUSIVE → tier 2 (tier 2 starts AT $50k)
 *
 * Audit fix [A1]: scan ALL tiers and return the highest qualifying
 * match. The pre-fix code broke early after the first match, which
 * silently returned tier 1 when the value qualified for tier 3.
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
