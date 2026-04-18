/**
 * Facility-wide renewal dashboard rollup stats.
 *
 * Pure function over pre-loaded contract rows — no Prisma, no I/O.
 *
 * Bucketing mirrors `lib/renewals/engine.ts::classifyRenewalStatus`:
 *   ≤30  → critical (includes already-expired / negative days)
 *   ≤90  → warning
 *   ≤180 → upcoming
 *   else → ok
 *
 * The rule is intentionally duplicated here (not imported) to avoid
 * any future circular-dependency worry between the engine and summary
 * layer.
 */

export interface RenewalContractInput {
  id: string
  daysUntilExpiration: number
  totalSpend: number
  rebatesEarned: number
  /** Commitment met as a percentage (0-100+, where 100 means fully met). */
  commitmentMet: number
  /** "active" | "expiring" | "expired" | "pending_review" */
  status: string
}

export interface RenewalSummary {
  totalContracts: number
  /** <= 30 days (includes already-expired contracts with negative days). */
  criticalCount: number
  /** 31..90 days. */
  warningCount: number
  /** 91..180 days. */
  upcomingCount: number
  /** > 180 days. */
  okCount: number
  /** commitmentMet < 80 */
  atRisk: number
  /** commitmentMet >= 100 */
  strongPerformers: number
  /** Sum of `totalSpend` across at-risk contracts. */
  totalAtRiskSpend: number
  /** Sum of `rebatesEarned` across at-risk contracts. */
  totalAtRiskRebates: number
}

/**
 * Aggregate a flat list of renewal contract rows into dashboard stats.
 *
 * Empty input → all-zero summary.
 */
export function computeRenewalSummary(
  contracts: RenewalContractInput[],
): RenewalSummary {
  const summary: RenewalSummary = {
    totalContracts: 0,
    criticalCount: 0,
    warningCount: 0,
    upcomingCount: 0,
    okCount: 0,
    atRisk: 0,
    strongPerformers: 0,
    totalAtRiskSpend: 0,
    totalAtRiskRebates: 0,
  }

  if (!Array.isArray(contracts) || contracts.length === 0) {
    return summary
  }

  for (const c of contracts) {
    summary.totalContracts += 1

    // Urgency bucket (mirror of classifyRenewalStatus).
    const days = c.daysUntilExpiration
    if (days <= 30) {
      summary.criticalCount += 1
    } else if (days <= 90) {
      summary.warningCount += 1
    } else if (days <= 180) {
      summary.upcomingCount += 1
    } else {
      summary.okCount += 1
    }

    // Performance buckets.
    if (c.commitmentMet < 80) {
      summary.atRisk += 1
      summary.totalAtRiskSpend += c.totalSpend
      summary.totalAtRiskRebates += c.rebatesEarned
    }
    if (c.commitmentMet >= 100) {
      summary.strongPerformers += 1
    }
  }

  return summary
}
