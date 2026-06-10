"use server"

import { prisma } from "@/lib/db"
import { requireAuth, requireFacility } from "@/lib/actions/auth"
import {
  contractOwnershipWhere,
  contractsOwnedByFacility,
} from "@/lib/actions/contracts-auth"
import { EVERGREEN_DATE } from "@/lib/contracts/evergreen"
import { addDays } from "date-fns"
import type { Prisma } from "@/lib/generated/prisma/client"
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

// ─── Trailing-12mo spend (audit M12) ─────────────────────────────

/**
 * Canonical renewals spend figure — mirrors the contracts-list
 * trailing-12-month cascade (lib/actions/contracts.ts, Charles R5.28):
 *
 *   1. ContractPeriod.totalSpend WHERE periodEnd in [today-12mo, today]
 *   2. else COGRecord.extendedPrice WHERE contractId AND
 *      transactionDate in [today-12mo, today]
 *
 * Pre-M12, getExpiringContracts summed the last 4 ContractPeriod rows
 * and getRenewalSummary summed ALL periods — neither matched the
 * "Current Spend" column on the contracts list, so the same contract
 * showed different spend on the two pages. One helper, both callers.
 */
async function trailing12moSpendByContract(
  contractIds: string[],
): Promise<Map<string, number>> {
  const spend = new Map<string, number>()
  if (contractIds.length === 0) return spend

  const windowEnd = new Date()
  const windowStart = new Date(windowEnd)
  windowStart.setFullYear(windowStart.getFullYear() - 1)

  const [periodGroups, cogGroups] = await Promise.all([
    prisma.contractPeriod.groupBy({
      by: ["contractId"],
      where: {
        contractId: { in: contractIds },
        // Same predicate as the contracts list/detail: the period ENDS
        // inside the window (straddling periods count).
        periodEnd: { gte: windowStart, lte: windowEnd },
      },
      _sum: { totalSpend: true },
    }),
    prisma.cOGRecord.groupBy({
      by: ["contractId"],
      where: {
        contractId: { in: contractIds },
        transactionDate: { gte: windowStart, lte: windowEnd },
      },
      _sum: { extendedPrice: true },
    }),
  ])

  const cogByContract = new Map<string, number>()
  for (const g of cogGroups) {
    if (g.contractId) {
      cogByContract.set(g.contractId, Number(g._sum.extendedPrice ?? 0))
    }
  }
  for (const id of contractIds) {
    spend.set(id, cogByContract.get(id) ?? 0)
  }
  for (const g of periodGroups) {
    const periodSpend = Number(g._sum.totalSpend ?? 0)
    if (periodSpend > 0) spend.set(g.contractId, periodSpend)
  }
  return spend
}

// ─── Get Expiring Contracts ──────────────────────────────────────

export async function getExpiringContracts(input: {
  /** @deprecated 2026-06-09 audit BLOCKER: ignored — derived from session. */
  facilityId?: string
  /** @deprecated 2026-06-09 audit BLOCKER: ignored — derived from session. */
  vendorId?: string
  windowDays: number
}): Promise<ExpiringContract[]> {
  // 2026-06-09 audit BLOCKER: tenant scope MUST come from the session,
  // never from client input — the prior signature let any authenticated
  // user pass another tenant's facilityId/vendorId (or neither, dumping
  // every tenant's contracts). Same class as the getUnreadAlertCount
  // round-10 fix.
  const session = await requireAuth()
  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { facility: true, vendor: true } } },
  })
  const facilityId = member?.organization?.facility?.id ?? null
  const vendorId = member?.organization?.vendor?.id ?? null
  if (!facilityId && !vendorId) {
    throw new Error("No facility or vendor associated with this account")
  }
  const { windowDays } = input

  const now = new Date()
  const windowEnd = addDays(now, windowDays)

  // Facility scope includes ContractFacility join-shared contracts
  // (CLAUDE.md hard rule); vendor scope includes grouped contracts where
  // this vendor sits in additionalVendorIds (group-vendor drift class).
  const tenantWhere: Prisma.ContractWhereInput = facilityId
    ? contractsOwnedByFacility(facilityId)
    : {
        OR: [
          { vendorId: vendorId as string },
          { additionalVendorIds: { has: vendorId as string } },
        ],
      }

  const contracts = await prisma.contract.findMany({
    where: {
      AND: [
        tenantWhere,
        {
          // 2026-06-09 audit HIGH: windowDays was computed and never
          // applied — every contract (incl. drafts) returned regardless
          // of window, and evergreen contracts would surface as
          // year-9999 ICS events. Expired contracts stay visible (they
          // render as critical/overdue); drafts are excluded — nothing
          // to renew.
          status: { in: ["active", "expiring", "expired"] },
          expirationDate: { lte: windowEnd, not: EVERGREEN_DATE },
        },
      ],
    },
    include: {
      vendor: { select: { id: true, name: true } },
      facility: { select: { id: true, name: true } },
      // Latest period only — for tierAchieved. Spend comes from the
      // canonical trailing-12mo cascade below (audit M12).
      periods: {
        select: { tierAchieved: true },
        orderBy: { periodEnd: "desc" },
        take: 1,
      },
      // Charles 2026-05-04 DRIFT-4: route totalRebate through canonical
      // helper (CLAUDE.md "Rebates Earned (lifetime)" invariant) instead
      // of the sparse `ContractPeriod.rebateEarned` reducer.
      rebates: { select: { rebateEarned: true, payPeriodEnd: true } },
    },
    orderBy: { expirationDate: "asc" },
  })

  // Audit M12: spend through the canonical trailing-12mo cascade so the
  // renewals page agrees with the contracts list.
  const spendByContract = await trailing12moSpendByContract(
    contracts.map((c) => c.id),
  )

  return serialize(contracts.map((c) => {
    const totalSpend = spendByContract.get(c.id) ?? 0
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
      // Bug 2026-05-26 (Vick "Commitment column not coming in"):
      // renewals-list reads `commitmentMet = currentMarketShare /
      // marketShareCommitment` via deriveCommitmentMet. The mapper
      // already expected these fields on ExpiringContract; the query
      // simply wasn't returning them, so every row collapsed to the
      // spend-based fallback (which also returns null when contracts
      // have no ContractPeriod rows yet — i.e. newly imported ones).
      // Surface the canonical market-share fields directly so set
      // contracts render a real %.
      marketShareCommitment:
        c.marketShareCommitment != null
          ? Number(c.marketShareCommitment)
          : null,
      currentMarketShare:
        c.currentMarketShare != null
          ? Number(c.currentMarketShare)
          : null,
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
      // Latest period only — for tierAchieved. Spend comes from the
      // canonical trailing-12mo cascade below (audit M12; this used to
      // sum EVERY period — a lifetime figure mislabeled as spend).
      periods: {
        select: { tierAchieved: true },
        orderBy: { periodEnd: "desc" },
        take: 1,
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
  const spendByContract = await trailing12moSpendByContract([contract.id])
  const totalSpend = spendByContract.get(contract.id) ?? 0
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
  // 2026-06-09 audit BLOCKER: ownership check — the prior version read
  // any contract's per-year spend/rebate history from a caller-supplied
  // id. Both portals use this (renewals detail modal), so branch on the
  // session member like getExpiringContracts.
  const session = await requireAuth()
  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { facility: true, vendor: true } } },
  })
  const facilityId = member?.organization?.facility?.id ?? null
  const vendorId = member?.organization?.vendor?.id ?? null
  if (!facilityId && !vendorId) return []

  const tenantWhere: Prisma.ContractWhereInput = facilityId
    ? contractsOwnedByFacility(facilityId)
    : {
        OR: [
          { vendorId: vendorId as string },
          { additionalVendorIds: { has: vendorId as string } },
        ],
      }
  const owned = await prisma.contract.findFirst({
    where: { AND: [{ id: contractId }, tenantWhere] },
    select: { id: true },
  })
  if (!owned) return []

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
