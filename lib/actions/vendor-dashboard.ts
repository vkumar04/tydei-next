"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"

// ─── Vendor Dashboard Stats ─────────────────────────────────────

export async function getVendorDashboardStats(vendorId: string) {
  await requireVendor()

  const [totalContracts, contractAgg, rebateAgg, activeFacilities] =
    await Promise.all([
      prisma.contract.count({ where: { vendorId } }),
      prisma.contract.aggregate({
        where: { vendorId },
        _sum: { totalValue: true },
      }),
      prisma.contractPeriod.aggregate({
        where: { contract: { vendorId } },
        _sum: { rebateEarned: true },
      }),
      prisma.contract.groupBy({
        by: ["facilityId"],
        where: { vendorId, status: "active", facilityId: { not: null } },
      }),
    ])

  return {
    totalContracts,
    totalSpend: Number(contractAgg._sum.totalValue ?? 0),
    totalRebates: Number(rebateAgg._sum.rebateEarned ?? 0),
    activeFacilities: activeFacilities.length,
  }
}

// ─── Vendor Spend Trend ─────────────────────────────────────────

export async function getVendorSpendTrend(input: {
  vendorId: string
  dateFrom: string
  dateTo: string
}) {
  await requireVendor()
  const { vendorId, dateFrom, dateTo } = input

  const periods = await prisma.contractPeriod.findMany({
    where: {
      contract: { vendorId },
      periodStart: { gte: new Date(dateFrom) },
      periodEnd: { lte: new Date(dateTo) },
    },
    orderBy: { periodStart: "asc" },
  })

  const monthMap = new Map<string, { spend: number; rebate: number }>()

  for (const p of periods) {
    const key = p.periodStart.toISOString().slice(0, 7)
    const entry = monthMap.get(key) ?? { spend: 0, rebate: 0 }
    entry.spend += Number(p.totalSpend)
    entry.rebate += Number(p.rebateEarned)
    monthMap.set(key, entry)
  }

  return Array.from(monthMap.entries()).map(([month, data]) => ({
    month,
    spend: data.spend,
    rebate: data.rebate,
  }))
}
