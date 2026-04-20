"use server"

/**
 * Reports hub — Overview tab data action.
 *
 * Assembles the payload for the /dashboard/reports "Overview" tab:
 *   - Contract lifecycle distribution (active / expiring / expired / other)
 *   - 12-month spend + rebate trend
 *   - Top-line stats (total contracts, total value, total rebates)
 *
 * Aggregation math lives in pure helpers (`lib/reports/lifecycle.ts`,
 * `lib/reports/monthly-trend.ts`). This file is the thin server-action
 * wrapper: scope → load → delegate → serialize.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.0
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import {
  computeContractLifecycleDistribution,
  type ContractForLifecycle,
  type LifecycleDistribution,
} from "@/lib/reports/lifecycle"
import {
  buildMonthlySpendRebateTrend,
  type MonthlyTrendPoint,
  type SpendRecord,
  type RebateRecord,
} from "@/lib/reports/monthly-trend"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"

export interface ReportsOverviewPayload {
  lifecycle: LifecycleDistribution
  monthlyTrend: MonthlyTrendPoint[]
  stats: {
    totalContracts: number
    totalValue: number
    totalRebates: number
  }
}

/**
 * Return the composed Overview payload for the caller's active facility.
 *
 * `dateFrom` / `dateTo` are optional — when supplied, they bound the
 * spend + rebate window used for the trend chart and the rebates stat.
 * `dateTo` is the reference date for the lifecycle bucketing and for
 * the trend window's "end month". When omitted, both fall back to "now".
 */
export async function getReportsOverview(input?: {
  dateFrom?: Date
  dateTo?: Date
}): Promise<ReportsOverviewPayload> {
  const { facility } = await requireFacility()
  const referenceDate = input?.dateTo ?? new Date()

  // ─── Contracts (lifecycle + stats) ────────────────────────────
  const contractRows = await prisma.contract.findMany({
    where: contractsOwnedByFacility(facility.id),
    select: {
      status: true,
      expirationDate: true,
      totalValue: true,
    },
  })

  const lifecycleInput: ContractForLifecycle[] = contractRows.map((c) => ({
    status: c.status as ContractForLifecycle["status"],
    expirationDate: c.expirationDate ?? null,
  }))
  const lifecycle = computeContractLifecycleDistribution(
    lifecycleInput,
    referenceDate,
  )

  const totalContracts = contractRows.length
  const totalValue = contractRows.reduce(
    (sum, c) => sum + Number(c.totalValue ?? 0),
    0,
  )

  // ─── COG spend + Rebates (monthly trend) ──────────────────────
  const cogWhere: {
    facilityId: string
    transactionDate?: { gte?: Date; lte?: Date }
  } = { facilityId: facility.id }
  if (input?.dateFrom || input?.dateTo) {
    cogWhere.transactionDate = {}
    if (input?.dateFrom) cogWhere.transactionDate.gte = input.dateFrom
    if (input?.dateTo) cogWhere.transactionDate.lte = input.dateTo
  }

  const cogRows = await prisma.cOGRecord.findMany({
    where: cogWhere,
    select: { transactionDate: true, extendedPrice: true },
  })

  const spend: SpendRecord[] = cogRows.map((r) => ({
    transactionDate: r.transactionDate,
    extendedPrice: Number(r.extendedPrice ?? 0),
  }))

  const rebateWhere: {
    facilityId: string
    payPeriodEnd?: { gte?: Date; lte?: Date }
  } = { facilityId: facility.id }
  if (input?.dateFrom || input?.dateTo) {
    rebateWhere.payPeriodEnd = {}
    if (input?.dateFrom) rebateWhere.payPeriodEnd.gte = input.dateFrom
    if (input?.dateTo) rebateWhere.payPeriodEnd.lte = input.dateTo
  }

  const rebateRows = await prisma.rebate.findMany({
    where: rebateWhere,
    select: { payPeriodEnd: true, rebateEarned: true },
  })

  const rebates: RebateRecord[] = rebateRows.map((r) => ({
    periodEndDate: r.payPeriodEnd,
    rebateEarned: Number(r.rebateEarned ?? 0),
  }))

  const monthlyTrend = buildMonthlySpendRebateTrend(spend, rebates, {
    referenceDate,
  })

  // Charles W1.U-B: route through the canonical helper so reports'
  // "Total Rebates" stat applies the same `payPeriodEnd <= today`
  // closed-period rule as every other Earned surface. The date-range
  // filter above already narrows the query; the helper adds the
  // future-period safety net for unbounded callers.
  const totalRebates = sumEarnedRebatesLifetime(
    rebateRows.map((r) => ({
      payPeriodEnd: r.payPeriodEnd,
      rebateEarned: r.rebateEarned,
    })),
    referenceDate,
  )

  return serialize({
    lifecycle,
    monthlyTrend,
    stats: {
      totalContracts,
      totalValue,
      totalRebates,
    },
  })
}
