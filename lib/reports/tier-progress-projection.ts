/**
 * Reports hub — tier-progress projection.
 *
 * Pure helper for the Reports Hub "Calculations" tab. Given a current
 * spend value, a rebate-tier ladder, and a monthly spend velocity
 * (typically the trailing-3-month average), compute where the facility
 * sits on the ladder and, if not already at the top, project how long
 * it will take to reach the next tier at the current pace.
 *
 * Reference:
 *   - docs/facility-reports.md §4.6
 *   - docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md subsystem 4
 */

export interface TierRow {
  tierNumber: number
  tierName?: string | null
  thresholdMin: number
  thresholdMax: number | null
  /** Percent — e.g. 3 = 3%. */
  rebateValue: number
}

export interface TierProgressProjection {
  currentSpend: number
  currentTierName: string
  currentTierRate: number
  nextTierName: string | null
  nextTierThreshold: number | null
  spendNeeded: number
  nextTierRate: number | null
  additionalRebateIfReached: number | null
  /**
   * Human-readable projection string, or null when we cannot project
   * (already at top tier, zero/negative velocity, or no tiers).
   */
  projection: string | null
}

function tierLabel(tier: TierRow): string {
  return tier.tierName ?? `Tier ${tier.tierNumber}`
}

function formatDollars(amount: number): string {
  return Math.round(amount).toLocaleString("en-US")
}

/**
 * Compute the tier-progress projection.
 *
 * Algorithm:
 *   1. Sort tiers by thresholdMin ascending.
 *   2. Find the current tier (highest tier whose thresholdMin <=
 *      currentSpend). If currentSpend is below the lowest threshold,
 *      report "Below Tier 1" with 0% rate.
 *   3. Find the next tier (index + 1). If none, all next-* fields are
 *      null and projection is null.
 *   4. Otherwise compute spendNeeded, additionalRebateIfReached, and —
 *      when monthlySpendRate > 0 — a projection string.
 */
export function computeTierProgressProjection(input: {
  currentSpend: number
  tiers: TierRow[]
  /** Monthly spend velocity — usually trailing-3-month average. */
  monthlySpendRate: number
}): TierProgressProjection {
  const { currentSpend, monthlySpendRate } = input

  // Zero-tier edge case.
  if (input.tiers.length === 0) {
    return {
      currentSpend,
      currentTierName: "No tier",
      currentTierRate: 0,
      nextTierName: null,
      nextTierThreshold: null,
      spendNeeded: 0,
      nextTierRate: null,
      additionalRebateIfReached: null,
      projection: null,
    }
  }

  const tiers = [...input.tiers].sort(
    (a, b) => a.thresholdMin - b.thresholdMin,
  )

  // Locate the current tier. `currentIdx = -1` means we are below the
  // lowest threshold (not yet on the ladder).
  let currentIdx = -1
  for (let i = 0; i < tiers.length; i++) {
    if (currentSpend >= tiers[i].thresholdMin) {
      currentIdx = i
    } else {
      break
    }
  }

  const currentTier = currentIdx >= 0 ? tiers[currentIdx] : null
  const nextTier =
    currentIdx + 1 < tiers.length ? tiers[currentIdx + 1] : null

  const currentTierName = currentTier ? tierLabel(currentTier) : "Below Tier 1"
  const currentTierRate = currentTier ? currentTier.rebateValue : 0

  if (!nextTier) {
    // Already at the top — nothing to project.
    return {
      currentSpend,
      currentTierName,
      currentTierRate,
      nextTierName: null,
      nextTierThreshold: null,
      spendNeeded: 0,
      nextTierRate: null,
      additionalRebateIfReached: null,
      projection: null,
    }
  }

  const spendNeededRaw = nextTier.thresholdMin - currentSpend
  const spendNeeded = Math.max(0, spendNeededRaw)

  const rateDelta = nextTier.rebateValue - currentTierRate
  const additionalRebateIfReached = (spendNeeded * rateDelta) / 100

  let projection: string | null = null
  if (monthlySpendRate > 0) {
    const monthsToReach = spendNeeded / monthlySpendRate
    projection = `At current monthly rate of $${formatDollars(
      monthlySpendRate,
    )}, ${tierLabel(nextTier)} reached in ${monthsToReach.toFixed(1)} months`
  }

  return {
    currentSpend,
    currentTierName,
    currentTierRate,
    nextTierName: tierLabel(nextTier),
    nextTierThreshold: nextTier.thresholdMin,
    spendNeeded,
    nextTierRate: nextTier.rebateValue,
    additionalRebateIfReached,
    projection,
  }
}
