"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

// ─── Vendor Dashboard Stats ─────────────────────────────────────

export async function getVendorDashboardStats(_vendorId?: string) {
  const { vendor: sessionVendor } = await requireVendor()
  const vendorId = sessionVendor.id

  const [
    activeContracts,
    totalContracts,
    contractAgg,
    rebateAgg,
    activeFacilities,
    vendorSpendAgg,
    totalSpendAgg,
  ] = await Promise.all([
    prisma.contract.count({ where: { vendorId, status: "active" } }),
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
    prisma.cOGRecord.aggregate({
      where: { vendorId },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.aggregate({
      _sum: { extendedPrice: true },
    }),
  ])

  const vendorCogSpend = Number(vendorSpendAgg._sum.extendedPrice ?? 0)
  const totalCogSpend = Number(totalSpendAgg._sum.extendedPrice ?? 0)
  const marketSharePercent =
    totalCogSpend > 0 ? (vendorCogSpend / totalCogSpend) * 100 : 0

  // Include pending contracts in the total count
  const pendingCount = await prisma.pendingContract.count({
    where: { vendorId, status: "submitted" },
  }).catch(() => 0)

  return serialize({
    activeContracts,
    totalContracts: totalContracts + pendingCount,
    totalSpend: vendorCogSpend > 0 ? vendorCogSpend : Number(contractAgg._sum.totalValue ?? 0),
    totalRebates: Number(rebateAgg._sum.rebateEarned ?? 0),
    activeFacilities: activeFacilities.length,
    marketSharePercent,
  })
}

// ─── Vendor Market Share by Category ────────────────────────────

export async function getVendorMarketShareByCategory(_vendorId?: string) {
  const { vendor: sessionVendor } = await requireVendor()
  const vendorId = sessionVendor.id

  // Get vendor spend per category
  const vendorByCategory = await prisma.cOGRecord.groupBy({
    by: ["category"],
    where: { vendorId, category: { not: null } },
    _sum: { extendedPrice: true },
  })

  // Get total spend per category (all vendors)
  const categories = vendorByCategory
    .map((v) => v.category)
    .filter((c): c is string => c !== null)

  if (categories.length === 0) return serialize([])

  const totalByCategory = await prisma.cOGRecord.groupBy({
    by: ["category"],
    where: { category: { in: categories } },
    _sum: { extendedPrice: true },
  })

  const totalMap = new Map(
    totalByCategory.map((t) => [t.category, Number(t._sum.extendedPrice ?? 0)])
  )

  const result = vendorByCategory
    .map((v) => {
      const vendorSpend = Number(v._sum.extendedPrice ?? 0)
      const totalSpend = totalMap.get(v.category!) ?? 0
      const cat = v.category ?? "Other"
      return {
        category: cat.length > 15 ? cat.substring(0, 12) + "..." : cat,
        share: totalSpend > 0 ? (vendorSpend / totalSpend) * 100 : 0,
      }
    })
    .sort((a, b) => b.share - a.share)
    .slice(0, 5)

  return serialize(result)
}

// ─── Vendor Contract Status Breakdown ───────────────────────────

export async function getVendorContractStatusBreakdown(_vendorId?: string) {
  const { vendor: sessionVendor } = await requireVendor()
  const vendorId = sessionVendor.id

  const [active, pending, expired] = await Promise.all([
    prisma.contract.count({
      where: { vendorId, status: "active" },
    }),
    prisma.contract.count({
      where: { vendorId, status: { in: ["pending", "draft"] } },
    }),
    prisma.contract.count({
      where: { vendorId, status: { in: ["expired", "expiring"] } },
    }),
  ])

  return serialize({ active, pending, expired })
}

// ─── Vendor Recent Contracts ────────────────────────────────────

export async function getVendorRecentContracts(_vendorId?: string) {
  const { vendor: sessionVendor } = await requireVendor()
  const vendorId = sessionVendor.id

  const contracts = await prisma.contract.findMany({
    where: { vendorId },
    orderBy: { updatedAt: "desc" },
    take: 3,
    select: {
      id: true,
      name: true,
      status: true,
      facility: { select: { name: true } },
    },
  })

  return serialize(
    contracts.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      facilityName: c.facility?.name ?? "Multiple Facilities",
    }))
  )
}

// ─── Vendor Spend Trend ─────────────────────────────────────────

export async function getVendorSpendTrend(input: {
  vendorId?: string
  dateFrom: string
  dateTo: string
}) {
  const { vendor } = await requireVendor()
  const vendorId = vendor.id
  const { dateFrom, dateTo } = input

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

  return serialize(Array.from(monthMap.entries()).map(([month, data]) => ({
    month,
    spend: data.spend,
    rebate: data.rebate,
  })))
}
