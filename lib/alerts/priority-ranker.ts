/**
 * Alerts — priority ranking helper.
 *
 * Reference: docs/superpowers/specs/2026-04-18-alerts-rewrite.md §4.5
 *
 * Pure function: takes un-ranked alerts and scores them by severity +
 * type weight + dollar impact + age, producing a ranked list where the
 * most actionable alerts surface first.
 */

export type AlertSeverity = "low" | "medium" | "high"
export type AlertTypeValue =
  | "off_contract"
  | "expiring_contract"
  | "tier_threshold"
  | "rebate_due"
  | "payment_due"
  | "other"

export interface AlertForRanking {
  id: string
  severity: AlertSeverity
  alertType: AlertTypeValue | string
  /** Optional dollar impact extracted from alert metadata (rebate amount, overcharge total, etc.). */
  dollarImpact?: number | null
  /** When the alert was created — used for age decay. */
  createdAt: Date
}

export interface RankedAlert extends AlertForRanking {
  /** Total priority score; higher = more actionable. */
  priorityScore: number
}

const SEVERITY_WEIGHT: Record<AlertSeverity, number> = {
  high: 100,
  medium: 50,
  low: 15,
}

const TYPE_WEIGHT: Record<string, number> = {
  off_contract: 30,
  rebate_due: 25,
  expiring_contract: 20,
  tier_threshold: 15,
  payment_due: 25,
  other: 5,
}

/**
 * Compute a priority score for one alert. Components:
 *   severity (0-100) + type weight (0-30) + dollar tier (0-50) + age decay (0 to -30)
 *
 * Dollar tier:
 *   >= $100,000 → +50
 *   >= $25,000  → +30
 *   >= $5,000   → +15
 *   >= $500     → +5
 *   else or null → 0
 *
 * Age decay: subtract min(30, daysOld × 0.5). Older alerts lose priority.
 */
export function computePriorityScore(
  alert: AlertForRanking,
  now: Date = new Date(),
): number {
  const severityPts = SEVERITY_WEIGHT[alert.severity]
  const typePts = TYPE_WEIGHT[alert.alertType] ?? TYPE_WEIGHT.other

  const dollar = alert.dollarImpact ?? 0
  const abs = Math.abs(dollar)
  let dollarPts = 0
  if (abs >= 100_000) dollarPts = 50
  else if (abs >= 25_000) dollarPts = 30
  else if (abs >= 5_000) dollarPts = 15
  else if (abs >= 500) dollarPts = 5

  const daysOld = (now.getTime() - alert.createdAt.getTime()) / (24 * 60 * 60 * 1000)
  const ageDecay = Math.min(30, Math.max(0, daysOld * 0.5))

  return severityPts + typePts + dollarPts - ageDecay
}

/**
 * Rank alerts newest-actionable-first. Stable: equal scores sort by
 * alert id descending for deterministic test assertions.
 */
export function rankAlerts(
  alerts: AlertForRanking[],
  now: Date = new Date(),
): RankedAlert[] {
  return alerts
    .map((a) => ({ ...a, priorityScore: computePriorityScore(a, now) }))
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore
      return b.id.localeCompare(a.id)
    })
}
