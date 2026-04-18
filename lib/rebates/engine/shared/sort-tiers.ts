import type { RebateTier } from "../types"

/**
 * Sort tiers by ascending thresholdMin. Returns a new array (input
 * unchanged) so callers can safely mutate or cache upstream sources.
 */
export function sortTiersAscending(tiers: RebateTier[]): RebateTier[] {
  return [...tiers].sort((a, b) => a.thresholdMin - b.thresholdMin)
}
