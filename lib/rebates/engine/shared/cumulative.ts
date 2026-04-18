import type { RebateTier } from "../types"
import { determineTier } from "./determine-tier"

/**
 * Cumulative rebate: achieved tier's rate × full eligible amount.
 *
 * Example: $75,000 spend with tiers [0, $50k=2%], [$50k, $100k=4%]
 *   → tier 2 achieved → rebate = $75,000 × 4% = $3,000 (on FULL spend)
 */
export function calculateCumulativeRebate(
  eligibleAmount: number,
  tiers: RebateTier[],
  boundaryRule: "EXCLUSIVE" | "INCLUSIVE",
): { rebate: number; tier: RebateTier | null } {
  const tier = determineTier(eligibleAmount, tiers, boundaryRule)
  if (!tier) return { rebate: 0, tier: null }

  // When a fixed-dollar rebate is set on the tier, it wins over
  // percentage-of-spend math.
  if (tier.fixedRebateAmount != null) {
    return { rebate: tier.fixedRebateAmount, tier }
  }

  // rebateValue expressed as percent (e.g. 4 = 4%) — matches Tydei's
  // existing ContractTier.rebateValue semantics.
  const rebate = (eligibleAmount * tier.rebateValue) / 100
  return { rebate, tier }
}
