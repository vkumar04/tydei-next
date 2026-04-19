/**
 * Shape adapters — bridge the legacy `ExpiringContract` payload to the
 * row/detail/summary shapes our child components consume.
 *
 * Kept as a sibling helper (not co-located in the orchestrator) so the
 * client stays well under the ≤200-line target and the mapping logic is
 * unit-testable in isolation.
 *
 * Commitment is derived from `currentMarketShare / marketShareCommitment`
 * when both are present (plan 2026-04-18 Task 4); otherwise we fall back
 * to the legacy `spend / (spend × 1.1)` proxy to keep the list cards
 * filled until the real metric wires through everywhere. Returning `null`
 * keeps downstream UI from rendering a spurious 0%.
 */

import { classifyRenewalStatus } from "@/lib/renewals/engine"
import type { PerformanceHistoryRow } from "@/lib/renewals/performance-history"
import type { RenewalContractInput } from "@/lib/renewals/summary-stats"
import type { ExpiringContract } from "@/lib/actions/renewals"
import type { RenewalRow } from "./renewals-list"
import type { RenewalDetail } from "./renewal-detail-tabs"

export function deriveCommitmentMet(c: ExpiringContract): number | null {
  const commit = c.marketShareCommitment ?? null
  const current = c.currentMarketShare ?? null
  if (commit !== null && commit > 0 && current !== null) {
    return Math.round((current / commit) * 100)
  }
  const spend = c.currentSpend ?? c.totalSpend
  if (spend <= 0) return null
  const target = spend * 1.1
  return Math.min(100, Math.round((spend / target) * 100))
}

export function toRow(c: ExpiringContract): RenewalRow {
  return {
    id: c.id,
    name: c.name,
    contractNumber: c.contractNumber,
    vendorName: c.vendorName,
    expirationDate: c.expirationDate,
    daysUntilExpiry: c.daysUntilExpiry,
    status: classifyRenewalStatus(c.daysUntilExpiry),
    commitmentMet: deriveCommitmentMet(c),
  }
}

/**
 * Plan 2026-04-18 Task 4: populate the Renewals-modal Overview grid.
 *
 * Reads the plan-shaped optional fields (`currentSpend`, `rebatesEarned`,
 * `marketShareCommitment`, `currentMarketShare`, `tier`) from the source
 * row and falls back to the legacy `totalSpend` / `totalRebate` /
 * `tierAchieved` fields so existing production payloads keep working.
 */
export function mapDetail(
  row: ExpiringContract,
  performanceHistory: PerformanceHistoryRow[] = [],
): RenewalDetail {
  const commit = row.marketShareCommitment ?? null
  const current = row.currentMarketShare ?? null
  const commitmentProgressPercent =
    commit !== null && commit > 0 && current !== null
      ? (current / commit) * 100
      : null

  const tier =
    row.tier ??
    {
      current: row.tierAchieved ?? 1,
      total: Math.max((row.tierAchieved ?? 1) + 1, 3),
    }

  const totalSpend = Number(row.currentSpend ?? row.totalSpend ?? 0)
  const rebatesEarned = Number(row.rebatesEarned ?? row.totalRebate ?? 0)

  return {
    id: row.id,
    name: row.name,
    contractNumber: row.contractNumber,
    vendorName: row.vendorName,
    expirationDate: row.expirationDate,
    daysUntilExpiry: row.daysUntilExpiry,
    totalSpend,
    rebatesEarned,
    commitmentProgressPercent,
    commitmentMet:
      commitmentProgressPercent === null
        ? deriveCommitmentMet(row)
        : Math.round(commitmentProgressPercent),
    currentTier: tier.current,
    maxTier: tier.total,
    tier,
    currentMarketShare: current,
    marketShareCommitment: commit,
    // Real history is lazy-loaded via `useContractPerformanceHistory`
    // when the detail modal opens (W1.1). Defaults to `[]` so callers
    // that don't pass it still see the "insufficient history" empty
    // state — we never synthesize rows.
    performanceHistory,
  }
}

/** @deprecated Use `mapDetail` — retained for back-compat with existing callers. */
export function toDetail(
  c: ExpiringContract,
  performanceHistory: PerformanceHistoryRow[] = [],
): RenewalDetail {
  return mapDetail(c, performanceHistory)
}

export function toSummaryInput(c: ExpiringContract): RenewalContractInput {
  return {
    id: c.id,
    daysUntilExpiration: c.daysUntilExpiry,
    totalSpend: c.currentSpend ?? c.totalSpend,
    rebatesEarned: c.rebatesEarned ?? c.totalRebate,
    commitmentMet: deriveCommitmentMet(c) ?? 0,
    status: c.status,
  }
}
