/**
 * v0 spec — Contract Renewals math.
 * Source: docs/contract-renewals-functionality.md.
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24

/** Days until expiration, ceiling, never negative. */
export function v0DaysRemaining(endDate: Date, today: Date = new Date()): number {
  return Math.max(0, Math.ceil((endDate.getTime() - today.getTime()) / MS_PER_DAY))
}

/**
 * Renewal status bucket by days-to-expiration.
 *   ≤30   critical
 *   31-90 warning
 *   91-180 upcoming
 *   >180  ok
 */
export type V0RenewalStatus = "critical" | "warning" | "upcoming" | "ok"
export function v0RenewalStatus(daysRemaining: number): V0RenewalStatus {
  if (daysRemaining <= 30) return "critical"
  if (daysRemaining <= 90) return "warning"
  if (daysRemaining <= 180) return "upcoming"
  return "ok"
}

/** Commitment fulfillment % (actualSpend / totalValue × 100), integer-rounded. */
export function v0CommitmentMetPct(
  actualSpend: number,
  contractTotalValue: number,
): number {
  if (contractTotalValue <= 0) return 0
  return Math.round((actualSpend / contractTotalValue) * 100)
}

/**
 * Synthesized 2-year history for a brand-new contract (facility POV).
 * Doc rule: last year = 85% of current; two years ago = 72%.
 * Compliance floors at 80 / 75 respectively.
 */
export interface V0PerformanceHistoryRow {
  yearOffset: -1 | -2
  spend: number
  rebate: number
  compliance: number
}
export function v0SynthesizePerformanceHistory(input: {
  currentSpend: number
  earnedRebate: number
  contractComplianceRate: number
}): V0PerformanceHistoryRow[] {
  return [
    {
      yearOffset: -1,
      spend: input.currentSpend * 0.85,
      rebate: input.earnedRebate * 0.85,
      compliance: Math.max(80, input.contractComplianceRate - 5),
    },
    {
      yearOffset: -2,
      spend: input.currentSpend * 0.72,
      rebate: input.earnedRebate * 0.72,
      compliance: Math.max(75, input.contractComplianceRate - 10),
    },
  ]
}

/** Timeline marker position (0-100%) based on fraction of a year remaining. */
export function v0TimelinePositionPct(daysUntilExpiration: number): number {
  return Math.min((daysUntilExpiration / 365) * 100, 100)
}
