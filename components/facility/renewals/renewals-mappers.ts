/**
 * Shape adapters — bridge the legacy `ExpiringContract` payload to the
 * row/detail/summary shapes our child components consume.
 *
 * Kept as a sibling helper (not co-located in the orchestrator) so the
 * client stays well under the ≤200-line target and the mapping logic is
 * unit-testable in isolation.
 *
 * Commitment is derived from a conservative `spend / (spend × 1.1)` proxy
 * until the real commitment-met metric wires through from the contracts
 * rewrite (spec §4.2 subsystem 0). Returning `null` when spend is zero
 * keeps downstream UI from rendering a spurious 0%.
 */

import { classifyRenewalStatus } from "@/lib/renewals/engine"
import type { RenewalContractInput } from "@/lib/renewals/summary-stats"
import type { ExpiringContract } from "@/lib/actions/renewals"
import type { RenewalRow } from "./renewals-list"
import type { RenewalDetail } from "./renewal-detail-tabs"

export function deriveCommitmentMet(c: ExpiringContract): number | null {
  if (c.totalSpend <= 0) return null
  const target = c.totalSpend * 1.1
  return Math.min(100, Math.round((c.totalSpend / target) * 100))
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

export function toDetail(c: ExpiringContract): RenewalDetail {
  const tier = c.tierAchieved ?? 1
  return {
    id: c.id,
    name: c.name,
    contractNumber: c.contractNumber,
    vendorName: c.vendorName,
    expirationDate: c.expirationDate,
    daysUntilExpiry: c.daysUntilExpiry,
    totalSpend: c.totalSpend,
    rebatesEarned: c.totalRebate,
    commitmentMet: deriveCommitmentMet(c),
    currentTier: tier,
    maxTier: Math.max(tier + 1, 3),
    currentMarketShare: null,
    marketShareCommitment: null,
    // Real history loads via a dedicated detail query in a later slice.
    // Empty here emits the "insufficient history" empty state — better
    // than synthesizing numbers we don't have.
    performanceHistory: [],
  }
}

export function toSummaryInput(c: ExpiringContract): RenewalContractInput {
  return {
    id: c.id,
    daysUntilExpiration: c.daysUntilExpiry,
    totalSpend: c.totalSpend,
    rebatesEarned: c.totalRebate,
    commitmentMet: deriveCommitmentMet(c) ?? 0,
    status: c.status,
  }
}
