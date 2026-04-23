/**
 * Dynamic rebate-tier derivation + attainability score.
 * v0 spec docs/facility-prospective-analysis-functionality.md §24-25.
 *
 * When an analyzer needs to show "what tiers would make sense given
 * this facility's actual spend?", we stamp three tiers at 0.5× / 0.8×
 * / 1.0× of spend with rebate rates relative to a baseRebate:
 *   Tier 1 = baseRebate − 1
 *   Tier 2 = baseRebate
 *   Tier 3 = baseRebate + 1.5
 *
 * Attainability score scales proposedSpend against the tier targets:
 *   ≥ tier2Threshold → 85
 *   ≥ tier1Threshold → 70
 *   else             → 50
 */

export interface DynamicTier {
  tierNumber: 1 | 2 | 3
  threshold: number
  rebatePct: number
}

export function deriveDynamicTiers(input: {
  actualSpend: number
  baseRebatePct: number
}): DynamicTier[] {
  return [
    { tierNumber: 1, threshold: input.actualSpend * 0.5, rebatePct: input.baseRebatePct - 1 },
    { tierNumber: 2, threshold: input.actualSpend * 0.8, rebatePct: input.baseRebatePct },
    { tierNumber: 3, threshold: input.actualSpend * 1.0, rebatePct: input.baseRebatePct + 1.5 },
  ]
}

export function tierAttainabilityScore(input: {
  proposedSpend: number
  tier1Threshold: number
  tier2Threshold: number
}): number {
  if (input.proposedSpend >= input.tier2Threshold) return 85
  if (input.proposedSpend >= input.tier1Threshold) return 70
  return 50
}
