"use server"

import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"
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
  vendorId: string
  facilityId?: string
  dateFrom?: string
  dateTo?: string
}): Promise<MarketShareData> {
  await requireAuth()
  const { vendorId, facilityId, dateFrom, dateTo } = input

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

  // By facility
  const facilityRecords = await prisma.cOGRecord.groupBy({
    by: ["facilityId"],
    where: { vendorId },
    _sum: { extendedPrice: true },
  })

  const facilityIds = facilityRecords.map((r) => r.facilityId)
  const facilities = await prisma.facility.findMany({
    where: { id: { in: facilityIds } },
    select: { id: true, name: true },
  })
  const facilityMap = new Map(facilities.map((f) => [f.id, f.name]))

  const byFacility = facilityRecords.map((r) => ({
    facility: facilityMap.get(r.facilityId) ?? "Unknown",
    share: Number(r._sum.extendedPrice ?? 0),
  }))

  return serialize({ byCategory, byFacility, trend: [] })
}

// ─── Performance KPIs ───────────────────────────────────────────

export async function getVendorPerformance(vendorId: string): Promise<VendorPerformanceData> {
  await requireAuth()

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

  return serialize({
    compliance: 85 + Math.random() * 15,
    delivery: 80 + Math.random() * 20,
    quality: 75 + Math.random() * 25,
    pricing: 70 + Math.random() * 30,
    contractCount,
    activeFacilities: activeFacilities.length,
    avgRebateRate: Math.round(avgRebateRate * 100) / 100,
    totalSpend,
  })
}

// ─── Product Benchmarks ─────────────────────────────────────────

export async function getProductBenchmarks(input: {
  vendorId: string
  category?: string
}): Promise<ProductBenchmark[]> {
  await requireAuth()
  const { vendorId, category } = input

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
