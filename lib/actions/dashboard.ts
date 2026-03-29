"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import type { Prisma } from "@prisma/client"

// ─── Dashboard Stats ─────────────────────────────────────────────

export async function getDashboardStats(input: {
  facilityId: string
  dateFrom: string
  dateTo: string
}) {
  await requireFacility()
  const { facilityId, dateFrom, dateTo } = input

  const [contractAgg, rebateAgg, alertCount, totalContracts, compliantContracts] =
    await Promise.all([
      prisma.contract.aggregate({
        where: {
          facilityId,
          effectiveDate: { gte: new Date(dateFrom) },
          expirationDate: { lte: new Date(dateTo) },
        },
        _sum: { totalValue: true },
      }),
      prisma.contractPeriod.aggregate({
        where: {
          facilityId,
          periodStart: { gte: new Date(dateFrom) },
          periodEnd: { lte: new Date(dateTo) },
        },
        _sum: { rebateEarned: true },
      }),
      prisma.alert.count({
        where: { facilityId, status: { in: ["new_alert", "read"] } },
      }),
      prisma.contract.count({
        where: { facilityId, status: "active" },
      }),
      prisma.contract.count({
        where: {
          facilityId,
          status: "active",
          terms: { some: {} },
        },
      }),
    ])

  const complianceRate =
    totalContracts > 0 ? Math.round((compliantContracts / totalContracts) * 100) : 100

  return {
    totalContractValue: Number(contractAgg._sum.totalValue ?? 0),
    totalRebatesEarned: Number(rebateAgg._sum.rebateEarned ?? 0),
    activeAlertCount: alertCount,
    complianceRate,
  }
}

// ─── Earned Rebate by Month ──────────────────────────────────────

export async function getEarnedRebateByMonth(input: {
  facilityId: string
  dateFrom: string
  dateTo: string
}) {
  await requireFacility()
  const { facilityId, dateFrom, dateTo } = input

  const periods = await prisma.contractPeriod.findMany({
    where: {
      facilityId,
      periodStart: { gte: new Date(dateFrom) },
      periodEnd: { lte: new Date(dateTo) },
      rebateEarned: { gt: 0 },
    },
    include: {
      contract: {
        include: { vendor: { select: { name: true } } },
      },
    },
    orderBy: { periodStart: "asc" },
  })

  const monthMap = new Map<string, Record<string, number>>()

  for (const period of periods) {
    const monthKey = period.periodStart.toISOString().slice(0, 7)
    const vendorName = period.contract.vendor.name

    if (!monthMap.has(monthKey)) monthMap.set(monthKey, {})
    const entry = monthMap.get(monthKey)!
    entry[vendorName] = (entry[vendorName] ?? 0) + Number(period.rebateEarned)
  }

  return Array.from(monthMap.entries()).map(([month, vendors]) => ({
    month,
    ...vendors,
  }))
}

// ─── Spend by Vendor ─────────────────────────────────────────────

export async function getSpendByVendor(input: {
  facilityId: string
  dateFrom: string
  dateTo: string
}) {
  await requireFacility()
  const { facilityId, dateFrom, dateTo } = input

  const records = await prisma.cOGRecord.groupBy({
    by: ["vendorId"],
    where: {
      facilityId,
      transactionDate: { gte: new Date(dateFrom), lte: new Date(dateTo) },
      vendorId: { not: null },
    },
    _sum: { extendedPrice: true },
    orderBy: { _sum: { extendedPrice: "desc" } },
    take: 10,
  })

  const vendorIds = records.map((r) => r.vendorId).filter(Boolean) as string[]
  const vendors = await prisma.vendor.findMany({
    where: { id: { in: vendorIds } },
    select: { id: true, name: true },
  })
  const vendorMap = new Map(vendors.map((v) => [v.id, v.name]))

  return records.map((r) => ({
    vendor: vendorMap.get(r.vendorId!) ?? "Unknown",
    total: Number(r._sum.extendedPrice ?? 0),
    categories: {} as Record<string, number>,
  }))
}

// ─── Contract Lifecycle ──────────────────────────────────────────

export async function getContractLifecycle(facilityId: string) {
  await requireFacility()

  const [active, expired, expiring] = await Promise.all([
    prisma.contract.count({ where: { facilityId, status: "active" } }),
    prisma.contract.count({ where: { facilityId, status: "expired" } }),
    prisma.contract.count({ where: { facilityId, status: "expiring" } }),
  ])

  return { active, expired, expiring }
}

// ─── Spend Needed for Tier ───────────────────────────────────────

export async function getSpendNeededForTier(facilityId: string) {
  await requireFacility()

  const contracts = await prisma.contract.findMany({
    where: { facilityId, status: "active" },
    include: {
      vendor: { select: { name: true } },
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
      },
      periods: { orderBy: { periodEnd: "desc" }, take: 1 },
    },
  })

  return contracts
    .filter((c) => c.terms.some((t) => t.tiers.length > 0))
    .map((c) => {
      const currentSpend = c.periods[0] ? Number(c.periods[0].totalSpend) : 0
      const tiers = c.terms.flatMap((t) =>
        t.tiers.map((tier) => ({
          tier: tier.tierNumber,
          threshold: Number(tier.spendMin),
        }))
      )

      return {
        vendor: c.vendor.name,
        contractName: c.name,
        currentSpend,
        tiers,
      }
    })
    .slice(0, 8)
}

// ─── Recent Contracts ────────────────────────────────────────────

export async function getRecentContracts(facilityId: string, limit = 5) {
  await requireFacility()

  return prisma.contract.findMany({
    where: { facilityId },
    include: { vendor: { select: { id: true, name: true, logoUrl: true } } },
    orderBy: { updatedAt: "desc" },
    take: limit,
  })
}

// ─── Recent Alerts ───────────────────────────────────────────────

export async function getRecentAlerts(facilityId: string, limit = 5) {
  await requireFacility()

  return prisma.alert.findMany({
    where: { facilityId, status: { in: ["new_alert", "read"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
}
