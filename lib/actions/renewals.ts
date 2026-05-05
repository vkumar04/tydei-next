"use server"

import { prisma } from "@/lib/db"
import { requireAuth, requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { addDays } from "date-fns"
import { serialize } from "@/lib/serialize"
import {
  buildRealPerformanceHistory,
  type PerformanceHistoryRow,
} from "@/lib/renewals/performance-history"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"

export interface ExpiringContract {
  id: string
  name: string
  contractNumber: string | null
  vendorName: string
  vendorId: string
  facilityName: string | null
  facilityId: string | null
  expirationDate: string
  daysUntilExpiry: number
  status: string
  contractType: string
  totalSpend: number
  totalRebate: number
  tierAchieved: number | null
  autoRenewal: boolean
  // Plan-aligned optional aliases — populated when upstream data has the
  // detailed renewal metrics surfaced in the Overview modal. Real loader
  // may still return the legacy fields above; mapDetail falls back.
  currentSpend?: number
  rebatesEarned?: number
  marketShareCommitment?: number | null
  currentMarketShare?: number | null
  tier?: { current: number; total: number }
  daysUntilExpiration?: number
}

export interface RenewalSummary {
  contract: {
    id: string
    name: string
    contractNumber: string | null
    vendorName: string
    effectiveDate: string
    expirationDate: string
    autoRenewal: boolean
  }
  daysUntilExpiry: number
  totalSpend: number
  totalRebate: number
  tierAchieved: number | null
  renewalRecommendation: string
}

// ─── Get Expiring Contracts ──────────────────────────────────────

export async function getExpiringContracts(input: {
  facilityId?: string
  vendorId?: string
  windowDays: number
}): Promise<ExpiringContract[]> {
  await requireAuth()
  const { facilityId, vendorId, windowDays } = input

  const now = new Date()
  const windowEnd = addDays(now, windowDays)

  const contracts = await prisma.contract.findMany({
    where: {
      ...(facilityId ? { facilityId } : {}),
      ...(vendorId ? { vendorId } : {}),
      status: { in: ["active", "expiring", "expired", "draft"] },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      facility: { select: { id: true, name: true } },
      periods: {
        select: { totalSpend: true, tierAchieved: true },
        orderBy: { periodEnd: "desc" },
        take: 4,
      },
      // Charles 2026-05-04 DRIFT-4: route totalRebate through canonical
      // helper (CLAUDE.md "Rebates Earned (lifetime)" invariant) instead
      // of the sparse `ContractPeriod.rebateEarned` reducer.
      rebates: { select: { rebateEarned: true, payPeriodEnd: true } },
    },
    orderBy: { expirationDate: "asc" },
  })

  return serialize(contracts.map((c) => {
    const totalSpend = c.periods.reduce((sum, p) => sum + Number(p.totalSpend), 0)
    const totalRebate = sumEarnedRebatesLifetime(c.rebates)
    const latestTier = c.periods[0]?.tierAchieved ?? null
    const daysUntilExpiry = Math.ceil(
      (c.expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    )

    return {
      id: c.id,
      name: c.name,
      contractNumber: c.contractNumber,
      vendorName: c.vendor.name,
      vendorId: c.vendor.id,
      facilityName: c.facility?.name ?? null,
      facilityId: c.facility?.id ?? null,
      expirationDate: c.expirationDate.toISOString(),
      daysUntilExpiry,
      status: c.status,
      contractType: c.contractType,
      totalSpend,
      totalRebate,
      tierAchieved: latestTier,
      autoRenewal: c.autoRenewal,
    }
  }))
}

// ─── Get Renewal Summary ─────────────────────────────────────────

export async function getRenewalSummary(contractId: string): Promise<RenewalSummary> {
  // Charles audit round-12 BLOCKER: gate by facility ownership.
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    include: {
      vendor: { select: { name: true } },
      periods: {
        select: { totalSpend: true, tierAchieved: true },
        orderBy: { periodEnd: "desc" },
      },
      // Charles 2026-05-04 DRIFT-4: route totalRebate through canonical
      // helper (CLAUDE.md "Rebates Earned (lifetime)" invariant) instead
      // of the sparse `ContractPeriod.rebateEarned` reducer.
      rebates: { select: { rebateEarned: true, payPeriodEnd: true } },
    },
  })

  const now = new Date()
  const daysUntilExpiry = Math.ceil(
    (contract.expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  )
  const totalSpend = contract.periods.reduce((s, p) => s + Number(p.totalSpend), 0)
  const totalRebate = sumEarnedRebatesLifetime(contract.rebates)
  const tierAchieved = contract.periods[0]?.tierAchieved ?? null

  let recommendation = "Review terms and consider renewal."
  if (totalRebate > 0 && tierAchieved && tierAchieved >= 2) {
    recommendation = "Strong performance. Recommend renewal with potential for improved terms."
  } else if (daysUntilExpiry <= 30) {
    recommendation = "Urgent: Contract expiring soon. Initiate renewal immediately."
  }

  return serialize({
    contract: {
      id: contract.id,
      name: contract.name,
      contractNumber: contract.contractNumber,
      vendorName: contract.vendor.name,
      effectiveDate: contract.effectiveDate.toISOString(),
      expirationDate: contract.expirationDate.toISOString(),
      autoRenewal: contract.autoRenewal,
    },
    daysUntilExpiry,
    totalSpend,
    totalRebate,
    tierAchieved,
    renewalRecommendation: recommendation,
  })
}

// ─── Get Contract Performance History ───────────────────────────

/**
 * Real per-year performance history for the renewals detail modal.
 *
 * Loads the contract's `ContractPeriod` rows and hands them to
 * `buildRealPerformanceHistory` (pure aggregator). Returns `[]` when no
 * closed periods exist — the UI renders the "insufficient history"
 * empty state in that case. NO SYNTHESIS.
 *
 * NOTE: `ContractPeriod` does not persist a per-period compliance rate
 * today (spec §13 leaves the door open), so we pass `compliance: null`
 * for every period. The aggregator preserves null through to the UI.
 * Rebate values come from `ContractPeriod.rebateEarned` — the same
 * rollup that drives the contracts list / dashboard surfaces (CLAUDE.md
 * rule: rebates are never auto-synthesized for display).
 */
export async function getContractPerformanceHistory(
  contractId: string,
): Promise<PerformanceHistoryRow[]> {
  await requireAuth()

  const periods = await prisma.contractPeriod.findMany({
    where: { contractId },
    select: {
      periodStart: true,
      periodEnd: true,
      totalSpend: true,
      rebateEarned: true,
    },
    orderBy: { periodStart: "asc" },
  })

  return buildRealPerformanceHistory({
    periods: periods.map((p) => ({
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      totalSpend: Number(p.totalSpend),
      compliance: null,
    })),
    accruals: periods.map((p) => ({
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      rebateEarned: Number(p.rebateEarned),
    })),
  })
}

// ─── Initiate Renewal — REMOVED ──────────────────────────────────
//
// The legacy `initiateRenewal(contractId)` action cloned a contract into
// a new draft row. It was only ever called from the vendor "Propose Terms"
// dialog, which actually wants to *submit a proposal*, not clone a
// contract. That flow has been rewired to
// `lib/actions/renewals/proposals.ts::submitRenewalProposal`, which
// persists a `ContractChangeProposal` (spec: docs/superpowers/specs/
// 2026-04-18-renewals-rewrite.md §4.2). See plan entry W1.4 in
// docs/superpowers/plans/2026-04-19-renewals-v0-parity.md.
