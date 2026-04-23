/**
 * v0 spec — Rebate Optimizer math.
 * Source: docs/rebate-optimizer-functionality.md §1-4.
 */

/** Earned rebate on current spend at current tier's integer-percent rate. */
export function v0EarnedAtTier(
  currentSpend: number,
  currentRebatePercent: number,
): number {
  return (currentSpend * currentRebatePercent) / 100
}

/** Additional spend required to reach the next tier threshold. */
export function v0SpendNeededToNextTier(
  currentSpend: number,
  nextThreshold: number,
): number {
  return Math.max(0, nextThreshold - currentSpend)
}

/**
 * ROI of closing the gap to the next tier: (additional rebate earned
 * by hitting the next tier) ÷ (additional spend needed).
 * Doc example: $420k @ 3.5%, next tier $500k @ 4%.
 *   earned   = $420k × 3.5% = $14,700
 *   atNext   = $500k × 4% = $20,000
 *   addl     = $20,000 − $14,700 = $5,300
 *   needed   = $80k
 *   roi      = 5,300 / 80,000 = 6.625%
 */
export interface V0RebateOpportunity {
  currentRebate: number
  rebateAtNextTier: number
  additionalRebate: number
  spendNeeded: number
  roiPct: number
}

export function v0RebateOpportunity(input: {
  currentSpend: number
  currentRebatePercent: number
  nextThreshold: number
  nextRebatePercent: number
}): V0RebateOpportunity {
  const currentRebate = v0EarnedAtTier(
    input.currentSpend,
    input.currentRebatePercent,
  )
  const rebateAtNextTier = v0EarnedAtTier(
    input.nextThreshold,
    input.nextRebatePercent,
  )
  const additionalRebate = rebateAtNextTier - currentRebate
  const spendNeeded = v0SpendNeededToNextTier(
    input.currentSpend,
    input.nextThreshold,
  )
  const roiPct = spendNeeded > 0 ? (additionalRebate / spendNeeded) * 100 : 0
  return { currentRebate, rebateAtNextTier, additionalRebate, spendNeeded, roiPct }
}

/** Urgency bucket for closing a tier gap. */
export type V0Urgency = "high" | "medium" | "low"
export function v0UrgencyForGap(gap: number): V0Urgency {
  if (gap < 100_000) return "high"
  if (gap < 250_000) return "medium"
  return "low"
}

/** Progress toward the next tier as a 0-100% value, visually capped at 100. */
export function v0ProgressPctToNextTier(
  currentSpend: number,
  nextThreshold: number,
): number {
  if (nextThreshold <= 0) return 0
  return Math.min(100, (currentSpend / nextThreshold) * 100)
}
