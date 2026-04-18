"use server"

/**
 * Dashboard — contract lifecycle + spend/rebate trend composite.
 *
 * Per docs/superpowers/specs/2026-04-18-facility-dashboard-rewrite.md.
 * Single action returning the two chart payloads used on the dashboard:
 *   - Contract lifecycle pie (active/expiring/expired/other)
 *   - Monthly spend + rebate bar (12 months)
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import {
  computeContractLifecycleDistribution,
  type LifecycleDistribution,
} from "@/lib/reports/lifecycle"
import {
  buildMonthlySpendRebateTrend,
  type MonthlyTrendPoint,
} from "@/lib/reports/monthly-trend"
import { serialize } from "@/lib/serialize"

export interface DashboardChartsPayload {
  lifecycle: LifecycleDistribution
  monthlyTrend: MonthlyTrendPoint[]
}

export async function getDashboardCharts(options?: {
  months?: number
  referenceDate?: Date
}): Promise<DashboardChartsPayload> {
  const { facility } = await requireFacility()
  const referenceDate = options?.referenceDate ?? new Date()
  const months = options?.months ?? 12

  // Pre-build the date window for spend/rebate queries.
  const windowStart = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth() - (months - 1),
      1,
    ),
  )

  const [contracts, cogRecords, rebates] = await Promise.all([
    prisma.contract.findMany({
      where: contractsOwnedByFacility(facility.id),
      select: {
        status: true,
        expirationDate: true,
      },
    }),
    prisma.cOGRecord.findMany({
      where: {
        facilityId: facility.id,
        transactionDate: { gte: windowStart, lte: referenceDate },
      },
      select: {
        transactionDate: true,
        extendedPrice: true,
      },
    }),
    prisma.rebate.findMany({
      where: {
        facilityId: facility.id,
        payPeriodEnd: { gte: windowStart, lte: referenceDate },
      },
      select: {
        payPeriodEnd: true,
        rebateEarned: true,
      },
    }),
  ])

  const lifecycle = computeContractLifecycleDistribution(
    contracts.map((c) => ({
      status: c.status,
      expirationDate: c.expirationDate,
    })),
    referenceDate,
  )

  const monthlyTrend = buildMonthlySpendRebateTrend(
    cogRecords.map((r) => ({
      transactionDate: r.transactionDate,
      extendedPrice: Number(r.extendedPrice ?? 0),
    })),
    rebates.map((r) => ({
      periodEndDate: r.payPeriodEnd,
      rebateEarned: Number(r.rebateEarned ?? 0),
    })),
    { months, referenceDate },
  )

  return serialize({ lifecycle, monthlyTrend })
}
