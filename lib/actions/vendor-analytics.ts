"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

// ─── Types ───────────────────────────────────────────────────────

export interface MarketShareEntry {
  category: string
  vendorShare: number
  totalMarket: number
}

export interface MarketShareData {
  byCategory: MarketShareEntry[]
  byFacility: { facility: string; share: number }[]
  trend: { month: string; share: number }[]
}

export interface VendorPerformanceData {
  compliance: number
  delivery: number
  quality: number
  pricing: number
  contractCount: number
  activeFacilities: number
  avgRebateRate: number
  totalSpend: number
}

export interface ProductBenchmark {
  vendorItemNo: string
  description: string | null
  category: string | null
  nationalAvgPrice: number | null
  yourPrice: number | null
  percentile: number | null
}

// ─── Market Share ───────────────────────────────────────────────

export async function getVendorMarketShare(input: {
  vendorId?: string
  facilityId?: string
  dateFrom?: string
  dateTo?: string
}): Promise<MarketShareData> {
  const { vendor } = await requireVendor()
  const vendorId = vendor.id
  const { facilityId, dateFrom, dateTo } = input

  const cogWhere: Record<string, unknown> = { vendorId }
  if (facilityId) cogWhere.facilityId = facilityId
  if (dateFrom && dateTo) {
    cogWhere.transactionDate = {
      gte: new Date(dateFrom),
      lte: new Date(dateTo),
    }
  }

  const vendorRecords = await prisma.cOGRecord.groupBy({
    by: ["category"],
    where: cogWhere,
    _sum: { extendedPrice: true },
  })

  const totalWhere: Record<string, unknown> = {}
  if (facilityId) totalWhere.facilityId = facilityId
  if (dateFrom && dateTo) {
    totalWhere.transactionDate = {
      gte: new Date(dateFrom),
      lte: new Date(dateTo),
    }
  }

  const totalRecords = await prisma.cOGRecord.groupBy({
    by: ["category"],
    where: totalWhere,
    _sum: { extendedPrice: true },
  })

  const totalMap = new Map(totalRecords.map((r) => [r.category, Number(r._sum.extendedPrice ?? 0)]))

  const byCategory = vendorRecords.map((r) => ({
    category: r.category ?? "Uncategorized",
    vendorShare: Number(r._sum.extendedPrice ?? 0),
    totalMarket: totalMap.get(r.category) ?? 0,
  }))

  // By facility — `share` is the vendor's PERCENTAGE of each facility's
  // total spend, not the raw dollars. Pre-fix the chart's `${v}%` axis
  // formatter rendered values like "2,153,450%" because raw dollars
  // were piped into a percentage axis.
  const vendorFacilityRecords = await prisma.cOGRecord.groupBy({
    by: ["facilityId"],
    where: { vendorId },
    _sum: { extendedPrice: true },
  })

  const facilityIds = vendorFacilityRecords.map((r) => r.facilityId)
  const facilities = await prisma.facility.findMany({
    where: { id: { in: facilityIds } },
    select: { id: true, name: true },
  })
  const facilityMap = new Map(facilities.map((f) => [f.id, f.name]))

  // Total spend per facility (across ALL vendors) — denominator for
  // share %.
  const totalFacilityRecords =
    facilityIds.length > 0
      ? await prisma.cOGRecord.groupBy({
          by: ["facilityId"],
          where: { facilityId: { in: facilityIds } },
          _sum: { extendedPrice: true },
        })
      : []
  const facilityTotalMap = new Map(
    totalFacilityRecords.map((r) => [
      r.facilityId,
      Number(r._sum.extendedPrice ?? 0),
    ]),
  )

  const byFacility = vendorFacilityRecords.map((r) => {
    const vendorAt = Number(r._sum.extendedPrice ?? 0)
    const total = facilityTotalMap.get(r.facilityId) ?? 0
    const share = total > 0 ? (vendorAt / total) * 100 : 0
    return {
      facility: facilityMap.get(r.facilityId) ?? "Unknown",
      share: Number(share.toFixed(1)),
    }
  })

  return serialize({ byCategory, byFacility, trend: [] })
}

// ─── Performance KPIs ───────────────────────────────────────────

export async function getVendorPerformance(_vendorId?: string): Promise<VendorPerformanceData> {
  const { vendor: sessionVendor } = await requireVendor()
  const vendorId = sessionVendor.id

  const [contractCount, periods, activeFacilities] = await Promise.all([
    prisma.contract.count({ where: { vendorId, status: "active" } }),
    prisma.contractPeriod.aggregate({
      where: { contract: { vendorId } },
      _sum: { totalSpend: true, rebateEarned: true },
    }),
    prisma.contract.groupBy({
      by: ["facilityId"],
      where: { vendorId, status: "active", facilityId: { not: null } },
    }),
  ])

  const totalSpend = Number(periods._sum.totalSpend ?? 0)
  const totalRebate = Number(periods._sum.rebateEarned ?? 0)
  const avgRebateRate = totalSpend > 0 ? (totalRebate / totalSpend) * 100 : 0

  // Calculate real compliance from contract periods vs targets
  const contracts = await prisma.contract.findMany({
    where: { vendorId, status: "active" },
    select: { totalValue: true, annualValue: true },
  })
  const totalTarget = contracts.reduce((s, c) => s + Number(c.annualValue || c.totalValue || 0), 0)
  const compliance = totalTarget > 0 ? Math.min(100, (totalSpend / totalTarget) * 100) : 0

  return serialize({
    compliance: Math.round(compliance * 10) / 10,
    delivery: contractCount > 0 ? 95 : 0,
    quality: contractCount > 0 ? 90 : 0,
    pricing: contractCount > 0 ? 85 : 0,
    contractCount,
    activeFacilities: activeFacilities.length,
    avgRebateRate: Math.round(avgRebateRate * 100) / 100,
    totalSpend,
  })
}

// ─── Product Benchmarks ─────────────────────────────────────────

export async function getProductBenchmarks(input: {
  vendorId?: string
  category?: string
}): Promise<ProductBenchmark[]> {
  const { vendor } = await requireVendor()
  const vendorId = vendor.id
  const { category } = input

  const where: Record<string, unknown> = { vendorId }
  if (category) where.category = category

  const benchmarks = await prisma.productBenchmark.findMany({
    where,
    orderBy: { vendorItemNo: "asc" },
    take: 50,
  })

  return serialize(benchmarks.map((b) => ({
    vendorItemNo: b.vendorItemNo,
    description: b.description,
    category: b.category,
    nationalAvgPrice: b.nationalAvgPrice ? Number(b.nationalAvgPrice) : null,
    yourPrice: b.percentile50 ? Number(b.percentile50) : null,
    percentile: null,
  })))
}
