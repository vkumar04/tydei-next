/**
 * v0 spec — Alert severity thresholds.
 * Source: docs/contract-calculations.md §10 + facility-alerts doc.
 */

/**
 * Contract expiration severity by days-remaining.
 *   ≤ 7   critical
 *   ≤ 14  high
 *   ≤ 30  warning
 *   else  none
 */
export type V0ExpirationSeverity = "critical" | "high" | "warning" | "none"
export function v0ExpirationSeverity(daysRemaining: number): V0ExpirationSeverity {
  if (daysRemaining <= 7) return "critical"
  if (daysRemaining <= 14) return "high"
  if (daysRemaining <= 30) return "warning"
  return "none"
}

/** Price-discrepancy severity per §10 alertTriggers.PRICE_DISCREPANCY. */
export function v0PriceDiscrepancySeverity(
  variancePct: number,
): "critical" | "warning" | "none" {
  const abs = Math.abs(variancePct)
  if (abs > 5) return "critical"
  if (abs > 2) return "warning"
  return "none"
}

/**
 * Tier-threshold approaching: fires when ≤ 10% of the next threshold
 * is unmet. Returns the tier name if triggered, null otherwise.
 */
export function v0TierApproachingFires(input: {
  currentSpend: number
  nextTierMin: number
}): boolean {
  if (input.nextTierMin <= 0) return false
  const remaining = input.nextTierMin - input.currentSpend
  if (remaining <= 0) return false
  return remaining / input.nextTierMin <= 0.1
}

/**
 * Compliance-drop alert: fires when current compliance rate is
 * at least 5 percentage points below historical average.
 */
export function v0ComplianceDropFires(input: {
  currentPct: number
  historicalAvgPct: number
  thresholdPp?: number
}): boolean {
  const threshold = input.thresholdPp ?? 5
  return input.currentPct < input.historicalAvgPct - threshold
}

/**
 * Vendor-inactive alert: fires when days-since-last-purchase > 90.
 */
export function v0VendorInactiveFires(
  daysSinceLastPurchase: number,
  thresholdDays = 90,
): boolean {
  return daysSinceLastPurchase > thresholdDays
}

/**
 * Tie-in-at-risk: fires when any member's projected spend is below
 * 90% of its minimum commitment.
 */
export function v0TieInAtRiskFires(
  members: Array<{ projectedSpend: number; minimumSpend: number }>,
): boolean {
  return members.some((m) => m.projectedSpend < m.minimumSpend * 0.9)
}
