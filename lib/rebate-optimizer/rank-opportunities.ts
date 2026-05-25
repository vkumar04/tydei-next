import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

/**
 * Filter + sort opportunities for the "Top ranked opportunities" surface.
 *
 * Bug 2026-05-25 (Charles Bugs.rtfd): the rebate-optimizer's ranked list
 * was showing entries like "Increase spend by $0 to reach Tier 1 and earn
 * an additional $0 in rebates" — i.e. opportunities with
 * `projectedAdditionalRebate === 0`. A zero-reward "opportunity" is not
 * actionable; it's either a contract whose tiers all carry the same rate
 * (no rebate gain to capture) or a contract with `currentSpend === 0`
 * (no baseline to multiply the rate delta against). Either way, it
 * doesn't belong in a list titled "ranked opportunities."
 *
 * Lives in lib/rebate-optimizer/ alongside the engine so callers from
 * any surface use the same ranking semantics (per CLAUDE.md's canonical-
 * reducer rule — one helper owns the filter).
 */
export function rankOpportunities(
  opportunities: RebateOpportunity[],
): RebateOpportunity[] {
  return opportunities
    .filter((o) => o.projectedAdditionalRebate > 0)
    .sort(
      (a, b) => b.projectedAdditionalRebate - a.projectedAdditionalRebate,
    )
}
