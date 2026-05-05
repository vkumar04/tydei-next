"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import {
  sumEarnedRebatesLifetime,
  sumEarnedRebatesYTD,
} from "@/lib/contracts/rebate-earned-filter"

// ─── Existing: per-contract list rollup ──────────────────────────

export interface VendorContractReport {
  id: string
  name: string
  facilityName: string
  totalSpend: number
  rebateEarned: number
  status: string
}

/**
 * Backwards-compatible per-contract rollup used by the vendor reports
 * surface. Pre-fix this read `c.periods[0]?.rebateEarned` — the most
 * recent ContractPeriod row only — which silently under-reported any
 * contract with multiple rebate rows or with a populated Rebate ledger
 * but sparse periods (Charles W1.U-B / 2026-04-26 Bug 3 cases).
 *
 * Now routed through canonical helpers per the CLAUDE.md invariants
 * table:
 *   - Spend: ContractPeriod._sum(totalSpend) preferred when populated;
 *     fall back to cOGRecord.extendedPrice (mirrors
 *     getVendorContractDetail). Never read ContractPeriod as the sole
 *     spend source.
 *   - Earned: sumEarnedRebatesLifetime over the contract's Rebate rows.
 */
export async function getVendorReportData(_vendorId?: string): Promise<VendorContractReport[]> {
  const { vendor } = await requireVendor()

  const contracts = await prisma.contract.findMany({
    where: { vendorId: vendor.id },
    include: {
      facility: { select: { name: true } },
      periods: {
        select: { totalSpend: true },
      },
      rebates: {
        select: {
          rebateEarned: true,
          rebateCollected: true,
          payPeriodEnd: true,
          collectionDate: true,
        },
      },
    },
    orderBy: { name: "asc" },
    take: 50,
  })

  // Single-batch COG fallback for contracts with no ContractPeriod rows.
  const contractIds = contracts.map((c) => c.id)
  const cogAggByContract = contractIds.length
    ? await prisma.cOGRecord.groupBy({
        by: ["contractId"],
        where: {
          contractId: { in: contractIds },
          vendorId: vendor.id,
        },
        _sum: { extendedPrice: true },
      })
    : []
  const cogSpendByContract = new Map<string, number>()
  for (const row of cogAggByContract) {
    if (!row.contractId) continue
    cogSpendByContract.set(row.contractId, Number(row._sum.extendedPrice ?? 0))
  }

  return serialize(
    contracts.map((c) => {
      const periodSpend = c.periods.reduce(
        (sum, p) => sum + Number(p.totalSpend ?? 0),
        0,
      )
      const cogSpend = cogSpendByContract.get(c.id) ?? 0
      return {
        id: c.id,
        name: c.name,
        facilityName: c.facility?.name ?? "N/A",
        totalSpend: periodSpend > 0 ? periodSpend : cogSpend,
        rebateEarned: sumEarnedRebatesLifetime(c.rebates),
        status: c.status,
      }
    }),
  )
}

// ─── New canonical report-data actions ──────────────────────────

export interface VendorRebateStatementRow {
  contractId: string
  contractName: string
  facilityName: string
  earnedThisPeriod: number
  collectedThisPeriod: number
  outstanding: number
}

/**
 * Per-contract rebate statement for a billing window.
 *
 * - "earnedThisPeriod" sums Rebate.rebateEarned for rows whose
 *   payPeriodEnd falls inside [periodStart, periodEnd] AND is on/before
 *   today (engaging the canonical "earned = closed period" filter).
 * - "collectedThisPeriod" sums Rebate.rebateCollected for rows whose
 *   collectionDate falls inside the window (canonical "collected =
 *   collectionDate is set" filter, narrowed to the window).
 * - "outstanding" = lifetime earned − lifetime collected for the
 *   contract (the running balance, NOT period-scoped — that's the
 *   number a finance team actually chases).
 */
export async function getVendorRebateStatement(
  periodStart: string,
  periodEnd: string,
): Promise<VendorRebateStatementRow[]> {
  const { vendor } = await requireVendor()

  const start = new Date(periodStart)
  const end = new Date(periodEnd)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`Invalid period: ${periodStart} → ${periodEnd}`)
  }

  const contracts = await prisma.contract.findMany({
    where: { vendorId: vendor.id },
    select: {
      id: true,
      name: true,
      facility: { select: { name: true } },
      rebates: {
        select: {
          rebateEarned: true,
          rebateCollected: true,
          payPeriodEnd: true,
          collectionDate: true,
        },
      },
    },
    orderBy: { name: "asc" },
  })

  const today = new Date()

  const rows = contracts.map((c) => {
    // Earned this period: closed periods inside the window.
    const earnedThisPeriod = c.rebates.reduce((sum, r) => {
      const ppe = r.payPeriodEnd
      if (!ppe) return sum
      const d = ppe instanceof Date ? ppe : new Date(ppe)
      if (Number.isNaN(d.getTime())) return sum
      if (d > today) return sum
      if (d < start || d > end) return sum
      return sum + Number(r.rebateEarned ?? 0)
    }, 0)

    // Collected this period: collectionDate inside the window.
    const collectedThisPeriod = c.rebates.reduce((sum, r) => {
      const cd = r.collectionDate
      if (!cd) return sum
      const d = cd instanceof Date ? cd : new Date(cd)
      if (Number.isNaN(d.getTime())) return sum
      if (d < start || d > end) return sum
      return sum + Number(r.rebateCollected ?? 0)
    }, 0)

    // Outstanding (lifetime) — uses canonical helpers so the running
    // balance can never disagree with the contract-detail header card.
    const lifetimeEarned = sumEarnedRebatesLifetime(c.rebates, today)
    const lifetimeCollected = sumCollectedRebates(c.rebates)

    return {
      contractId: c.id,
      contractName: c.name,
      facilityName: c.facility?.name ?? "N/A",
      earnedThisPeriod,
      collectedThisPeriod,
      outstanding: lifetimeEarned - lifetimeCollected,
    }
  })

  return serialize(rows)
}

export interface VendorPerformanceSummaryRow {
  facilityId: string
  facilityName: string
  spend: number
  earned: number
  collected: number
  compliancePercent: number
  marketSharePercent: number
}

/**
 * Per-facility roll-up across all this vendor's contracts inside the
 * given window.
 *
 * Spend uses the COG cascade (ContractPeriod _sum when present, else
 * cOGRecord.extendedPrice) consistent with `getVendorContractDetail`.
 * Earned/collected route through the canonical helpers but narrowed to
 * the window. Compliance/market share are reported as the simple
 * average of `Contract.complianceRate` / `Contract.currentMarketShare`
 * across the facility's active contracts (those persisted-derived
 * fields are the "Strategic-direction Plan #1" canonical source).
 */
export async function getVendorPerformanceSummary(
  periodStart: string,
  periodEnd: string,
): Promise<VendorPerformanceSummaryRow[]> {
  const { vendor } = await requireVendor()

  const start = new Date(periodStart)
  const end = new Date(periodEnd)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`Invalid period: ${periodStart} → ${periodEnd}`)
  }

  const contracts = await prisma.contract.findMany({
    where: { vendorId: vendor.id },
    select: {
      id: true,
      facilityId: true,
      facility: { select: { id: true, name: true } },
      complianceRate: true,
      currentMarketShare: true,
      periods: {
        where: {
          AND: [
            { periodStart: { lte: end } },
            { periodEnd: { gte: start } },
          ],
        },
        select: { totalSpend: true },
      },
      rebates: {
        select: {
          rebateEarned: true,
          rebateCollected: true,
          payPeriodEnd: true,
          collectionDate: true,
        },
      },
    },
  })

  // Window-scoped COG fallback (per-contract, vendor-scoped).
  const contractIds = contracts.map((c) => c.id)
  const cogAggByContract = contractIds.length
    ? await prisma.cOGRecord.groupBy({
        by: ["contractId"],
        where: {
          contractId: { in: contractIds },
          vendorId: vendor.id,
          transactionDate: { gte: start, lte: end },
        },
        _sum: { extendedPrice: true },
      })
    : []
  const cogSpendByContract = new Map<string, number>()
  for (const row of cogAggByContract) {
    if (!row.contractId) continue
    cogSpendByContract.set(row.contractId, Number(row._sum.extendedPrice ?? 0))
  }

  const today = new Date()

  // Group contract-level metrics by facility.
  type Acc = {
    facilityId: string
    facilityName: string
    spend: number
    earned: number
    collected: number
    complianceSamples: number[]
    marketShareSamples: number[]
  }
  const byFacility = new Map<string, Acc>()
  for (const c of contracts) {
    const fid = c.facilityId ?? c.facility?.id ?? "__no_facility__"
    const fname = c.facility?.name ?? "Unattributed"

    const periodSpend = c.periods.reduce(
      (s, p) => s + Number(p.totalSpend ?? 0),
      0,
    )
    const cogSpend = cogSpendByContract.get(c.id) ?? 0
    const spendForContract = periodSpend > 0 ? periodSpend : cogSpend

    const earnedForContract = c.rebates.reduce((sum, r) => {
      const ppe = r.payPeriodEnd
      if (!ppe) return sum
      const d = ppe instanceof Date ? ppe : new Date(ppe)
      if (Number.isNaN(d.getTime())) return sum
      if (d > today) return sum
      if (d < start || d > end) return sum
      return sum + Number(r.rebateEarned ?? 0)
    }, 0)

    const collectedForContract = c.rebates.reduce((sum, r) => {
      const cd = r.collectionDate
      if (!cd) return sum
      const d = cd instanceof Date ? cd : new Date(cd)
      if (Number.isNaN(d.getTime())) return sum
      if (d < start || d > end) return sum
      return sum + Number(r.rebateCollected ?? 0)
    }, 0)

    const acc = byFacility.get(fid) ?? {
      facilityId: fid,
      facilityName: fname,
      spend: 0,
      earned: 0,
      collected: 0,
      complianceSamples: [],
      marketShareSamples: [],
    }
    acc.spend += spendForContract
    acc.earned += earnedForContract
    acc.collected += collectedForContract
    if (c.complianceRate != null) acc.complianceSamples.push(Number(c.complianceRate))
    if (c.currentMarketShare != null)
      acc.marketShareSamples.push(Number(c.currentMarketShare))
    byFacility.set(fid, acc)
  }

  const rows = Array.from(byFacility.values()).map((a) => ({
    facilityId: a.facilityId,
    facilityName: a.facilityName,
    spend: a.spend,
    earned: a.earned,
    collected: a.collected,
    compliancePercent: a.complianceSamples.length
      ? a.complianceSamples.reduce((s, n) => s + n, 0) / a.complianceSamples.length
      : 0,
    marketSharePercent: a.marketShareSamples.length
      ? a.marketShareSamples.reduce((s, n) => s + n, 0) /
        a.marketShareSamples.length
      : 0,
  }))

  rows.sort((a, b) => a.facilityName.localeCompare(b.facilityName))
  return serialize(rows)
}

export interface VendorContractRosterRow {
  contractId: string
  contractName: string
  contractNumber: string | null
  facilityName: string
  status: string
  effectiveDate: Date | string
  expirationDate: Date | string
  rebateMethod: string
  lastActivity: Date | string | null
  rebateEarnedYTD: number
  rebateEarnedLifetime: number
}

/**
 * All this vendor's contracts (any status) with key terms + a
 * lifetime/YTD earned roll-up. "Last activity" is the latest
 * `payPeriodEnd` across the contract's Rebate rows — the closest proxy
 * for "when did money last move on this paper".
 *
 * `rebateMethod` is taken from the FIRST ContractTerm (most contracts
 * have a single term; multi-term contracts surface the primary one
 * with a "+N more" hint left to the UI). This matches the v0
 * "Contract Roster" shape.
 */
export async function getVendorContractRoster(): Promise<
  VendorContractRosterRow[]
> {
  const { vendor } = await requireVendor()

  const contracts = await prisma.contract.findMany({
    where: { vendorId: vendor.id },
    select: {
      id: true,
      name: true,
      contractNumber: true,
      status: true,
      effectiveDate: true,
      expirationDate: true,
      facility: { select: { name: true } },
      terms: {
        select: { rebateMethod: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
      rebates: {
        select: {
          rebateEarned: true,
          payPeriodEnd: true,
          collectionDate: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  })

  const today = new Date()

  const rows = contracts.map((c) => {
    let lastActivity: Date | null = null
    for (const r of c.rebates) {
      const ppe = r.payPeriodEnd
      if (!ppe) continue
      const d = ppe instanceof Date ? ppe : new Date(ppe)
      if (Number.isNaN(d.getTime())) continue
      if (lastActivity === null || d > lastActivity) lastActivity = d
    }
    return {
      contractId: c.id,
      contractName: c.name,
      contractNumber: c.contractNumber,
      facilityName: c.facility?.name ?? "Unattributed",
      status: c.status,
      effectiveDate: c.effectiveDate,
      expirationDate: c.expirationDate,
      rebateMethod: c.terms[0]?.rebateMethod ?? "—",
      lastActivity,
      rebateEarnedYTD: sumEarnedRebatesYTD(c.rebates, today),
      rebateEarnedLifetime: sumEarnedRebatesLifetime(c.rebates, today),
    }
  })

  return serialize(rows)
}
