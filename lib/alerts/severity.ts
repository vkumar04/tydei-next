/**
 * Alert severity helpers — pure functions derived from v0 spec
 * (docs/contract-calculations.md §10). Mirror the v0-spec helpers at
 * lib/v0-spec/alerts.ts so tydei surfaces can route through these
 * canonical classifiers without reaching into the spec module.
 *
 * Tydei alert severity is currently "high"|"medium"|"low". v0 has
 * critical/high/warning/none. Mapping:
 *   v0 critical → tydei "high"
 *   v0 high     → tydei "high"
 *   v0 warning  → tydei "medium"
 *   v0 none     → tydei "low" (or no alert)
 *
 * Expiration-severity band logic already lives in
 * `lib/alerts/synthesizer.ts::classifyExpirationSeverity`; these are
 * the missing v0 rules that previously had no tydei implementation.
 */

/**
 * Price-discrepancy severity (v0 §10 alertTriggers.PRICE_DISCREPANCY).
 * Matches the 3-band contract-calculations §6 rule — |variance| ≤ 2%
 * is acceptable (no alert), ≤ 5% is warning, > 5% is critical.
 */
export function priceDiscrepancySeverity(
  variancePct: number,
): "critical" | "warning" | "none" {
  const abs = Math.abs(variancePct)
  if (abs > 5) return "critical"
  if (abs > 2) return "warning"
  return "none"
}

/**
 * Compliance-drop alert fires when current compliance rate has
 * fallen at least 5 percentage points below the historical average.
 * v0 docs §10 alertTriggers.COMPLIANCE_DROP.
 */
export function complianceDropFires(input: {
  currentPct: number
  historicalAvgPct: number
  thresholdPp?: number
}): boolean {
  const threshold = input.thresholdPp ?? 5
  return input.currentPct < input.historicalAvgPct - threshold
}

/**
 * Vendor-inactive alert: days-since-last-purchase > 90 (default).
 * v0 docs §10 alertTriggers.VENDOR_INACTIVE.
 */
export function vendorInactiveFires(
  daysSinceLastPurchase: number,
  thresholdDays = 90,
): boolean {
  return daysSinceLastPurchase > thresholdDays
}

/**
 * Tie-in at-risk: any bundle member's projected spend is below 90%
 * of its minimum commitment. v0 docs §10 alertTriggers.TIE_IN_AT_RISK.
 */
export function tieInAtRiskFires(
  members: Array<{ projectedSpend: number; minimumSpend: number }>,
): boolean {
  return members.some((m) => m.projectedSpend < m.minimumSpend * 0.9)
}
