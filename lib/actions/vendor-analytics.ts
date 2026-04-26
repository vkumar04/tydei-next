"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"

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
  /** Real signal: trailing 12-month spend vs annualValue target. */
  compliance: number | null
  /** No on-time-delivery data source today; null until we ingest one. */
  delivery: number | null
  /** No quality scoring model today; null until we ingest one. */
  quality: number | null
  /** No price-variance benchmarking pipeline today; null until we ingest one. */
  pricing: number | null
  /** No vendor responsiveness signal today; null until we ingest one. */
  responsiveness: number | null
  contractCount: number
  activeFacilities: number
  avgRebateRate: number
  totalSpend: number
}

export interface VendorPerformanceCategoryRow {
  category: string
  spend: number
  priorSpend: number
  pctOfPrior: number | null
}

export interface VendorPerformanceMonthlyTrendPoint {
  month: string
  spend: number
  rebates: number
}

export interface VendorPerformanceTier {
  contractId: string
  contractName: string
  facilityName: string | null
  tier: string
  threshold: number
  current: number
  rebateRate: number
  achieved: boolean
}

export interface VendorPerformanceContractRow {
  id: string
  name: string
  facility: string
  targetSpend: number
  actualSpend: number
  rebateRate: number
  rebatePaid: number
  compliance: number
  status: "on-track" | "exceeding" | "at-risk"
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

  // Charles vendor /performance audit (V2): the prior implementation
  // returned hard-coded `delivery: 95, quality: 90, pricing: 85` whenever
  // a vendor had any active contracts — Charles called these out as
  // misleading. We don't have an on-time-delivery feed, a QA scoring
  // model, or a price-variance pipeline yet, so those axes are returned
  // as `null` and the radar UI renders an explicit "not yet enabled"
  // placeholder. Spend Compliance is the one axis with a real signal:
  // trailing 12-month vendor COG vs the sum of active-contract
  // annualValue / totalValue targets. That mirrors the canonical spend
  // source per CLAUDE.md (cOGRecord, not the sparse ContractPeriod
  // rollup — see `getVendorSpendTrend` rationale).
  const now = new Date()
  const trailing12MoStart = new Date(now)
  trailing12MoStart.setMonth(trailing12MoStart.getMonth() - 12)

  const [contractCount, activeFacilities, cogAgg, rebateRows, contracts] =
    await Promise.all([
      prisma.contract.count({ where: { vendorId, status: "active" } }),
      prisma.contract.groupBy({
        by: ["facilityId"],
        where: { vendorId, status: "active", facilityId: { not: null } },
      }),
      prisma.cOGRecord.aggregate({
        where: {
          vendorId,
          transactionDate: { gte: trailing12MoStart, lte: now },
        },
        _sum: { extendedPrice: true },
      }),
      prisma.rebate.findMany({
        where: { contract: { vendorId } },
        select: {
          payPeriodEnd: true,
          rebateEarned: true,
        },
      }),
      prisma.contract.findMany({
        where: { vendorId, status: "active" },
        select: { totalValue: true, annualValue: true },
      }),
    ])

  const totalSpend = Number(cogAgg._sum.extendedPrice ?? 0)
  const totalRebate = sumEarnedRebatesLifetime(rebateRows, now)
  const avgRebateRate = totalSpend > 0 ? (totalRebate / totalSpend) * 100 : 0

  const totalTarget = contracts.reduce(
    (s, c) => s + Number(c.annualValue || c.totalValue || 0),
    0,
  )
  const compliance =
    totalTarget > 0 ? Math.min(100, (totalSpend / totalTarget) * 100) : null

  return serialize({
    compliance:
      compliance === null ? null : Math.round(compliance * 10) / 10,
    delivery: null,
    quality: null,
    pricing: null,
    responsiveness: null,
    contractCount,
    activeFacilities: activeFacilities.length,
    avgRebateRate: Math.round(avgRebateRate * 100) / 100,
    totalSpend,
  })
}

// ─── Vendor Performance: Category Breakdown ─────────────────────

/**
 * Trailing 12-month vendor-scoped spend by category, with the prior
 * 12-month window as the comparison "target". Replaces the old
 * `MOCK_CATEGORY_BREAKDOWN` constants on the vendor /performance page
 * (Charles V2 audit). Sourced from cOGRecord per CLAUDE.md — same data
 * source as `getVendorSpendTrend` and the vendor dashboard market-share
 * card.
 */
export async function getVendorPerformanceCategoryBreakdown(
  _vendorId?: string,
): Promise<VendorPerformanceCategoryRow[]> {
  const { vendor: sessionVendor } = await requireVendor()
  const vendorId = sessionVendor.id

  const now = new Date()
  const trailing12MoStart = new Date(now)
  trailing12MoStart.setMonth(trailing12MoStart.getMonth() - 12)
  const prior12MoStart = new Date(trailing12MoStart)
  prior12MoStart.setMonth(prior12MoStart.getMonth() - 12)

  const [currentRows, priorRows] = await Promise.all([
    prisma.cOGRecord.groupBy({
      by: ["category"],
      where: {
        vendorId,
        transactionDate: { gte: trailing12MoStart, lte: now },
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.groupBy({
      by: ["category"],
      where: {
        vendorId,
        transactionDate: { gte: prior12MoStart, lt: trailing12MoStart },
      },
      _sum: { extendedPrice: true },
    }),
  ])

  const priorMap = new Map(
    priorRows.map((r) => [r.category, Number(r._sum.extendedPrice ?? 0)]),
  )

  const rows = currentRows
    .map((r) => {
      const spend = Number(r._sum.extendedPrice ?? 0)
      const priorSpend = priorMap.get(r.category) ?? 0
      const pctOfPrior =
        priorSpend > 0 ? Math.round((spend / priorSpend) * 1000) / 10 : null
      return {
        category: r.category ?? "Uncategorized",
        spend,
        priorSpend,
        pctOfPrior,
      }
    })
    .filter((r) => r.spend > 0 || r.priorSpend > 0)
    .sort((a, b) => b.spend - a.spend)

  return serialize(rows)
}

// ─── Vendor Performance: Monthly Trend ──────────────────────────

/**
 * Last 12 months of vendor-scoped COG spend bucketed by transaction
 * month, plus rebates earned (`payPeriodEnd` within the same window).
 * Replaces `MOCK_MONTHLY_TREND` on the vendor /performance Overview
 * tab. Same canonical source as `getVendorSpendTrend` in
 * `vendor-dashboard.ts` (kept here as a peer rather than re-importing
 * a `"use server"` action that lives in another off-limits file).
 */
export async function getVendorPerformanceMonthlyTrend(
  _vendorId?: string,
): Promise<VendorPerformanceMonthlyTrendPoint[]> {
  const { vendor: sessionVendor } = await requireVendor()
  const vendorId = sessionVendor.id

  const now = new Date()
  const from = new Date(now)
  from.setMonth(from.getMonth() - 12)

  const [cogRows, rebateRows] = await Promise.all([
    prisma.cOGRecord.findMany({
      where: { vendorId, transactionDate: { gte: from, lte: now } },
      select: { transactionDate: true, extendedPrice: true },
    }),
    prisma.rebate.findMany({
      where: {
        contract: { vendorId },
        payPeriodEnd: { gte: from, lte: now },
      },
      select: { payPeriodEnd: true, rebateEarned: true },
    }),
  ])

  const monthMap = new Map<string, { spend: number; rebates: number }>()

  for (const r of cogRows) {
    const key = r.transactionDate.toISOString().slice(0, 7)
    const entry = monthMap.get(key) ?? { spend: 0, rebates: 0 }
    entry.spend += Number(r.extendedPrice ?? 0)
    monthMap.set(key, entry)
  }

  for (const r of rebateRows) {
    if (!r.payPeriodEnd) continue
    const key = r.payPeriodEnd.toISOString().slice(0, 7)
    const entry = monthMap.get(key) ?? { spend: 0, rebates: 0 }
    entry.rebates += Number(r.rebateEarned ?? 0)
    monthMap.set(key, entry)
  }

  return serialize(
    Array.from(monthMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([month, data]) => ({ month, ...data })),
  )
}

// ─── Vendor Performance: Real Rebate Tiers ──────────────────────

/**
 * Real `ContractTier` rows for the vendor's active contracts, joined
 * with trailing-12mo vendor-scoped COG so each tier carries a `current`
 * progress value. Replaces `MOCK_DEFAULT_REBATE_TIERS` (Charles V2
 * audit). Per CLAUDE.md, `ContractTier.rebateValue` is stored as a
 * fraction (0.05 = 5%), so we scale by 100 at the Prisma boundary.
 */
export async function getVendorPerformanceTiers(
  _vendorId?: string,
): Promise<VendorPerformanceTier[]> {
  const { vendor: sessionVendor } = await requireVendor()
  const vendorId = sessionVendor.id

  const now = new Date()
  const trailing12MoStart = new Date(now)
  trailing12MoStart.setMonth(trailing12MoStart.getMonth() - 12)

  const contracts = await prisma.contract.findMany({
    where: { vendorId, status: "active" },
    select: {
      id: true,
      name: true,
      facility: { select: { name: true } },
      terms: {
        select: {
          tiers: {
            orderBy: { tierNumber: "asc" },
            select: {
              tierNumber: true,
              tierName: true,
              spendMin: true,
              rebateValue: true,
            },
          },
        },
      },
    },
  })

  const contractIds = contracts.map((c) => c.id)
  const cogByContract =
    contractIds.length > 0
      ? await prisma.cOGRecord.groupBy({
          by: ["contractId"],
          where: {
            vendorId,
            contractId: { in: contractIds },
            transactionDate: { gte: trailing12MoStart, lte: now },
          },
          _sum: { extendedPrice: true },
        })
      : []
  const spendMap = new Map(
    cogByContract.map((r) => [
      r.contractId ?? "",
      Number(r._sum.extendedPrice ?? 0),
    ]),
  )

  const out: VendorPerformanceTier[] = []
  for (const c of contracts) {
    const current = spendMap.get(c.id) ?? 0
    for (const term of c.terms) {
      for (const t of term.tiers) {
        const threshold = Number(t.spendMin ?? 0)
        out.push({
          contractId: c.id,
          contractName: c.name,
          facilityName: c.facility?.name ?? null,
          tier: t.tierName ?? `Tier ${t.tierNumber}`,
          threshold,
          current,
          // Stored as fraction (0.05 = 5%) — scale by 100 at the
          // boundary per CLAUDE.md "Rebate engine units" rule.
          rebateRate: Number(t.rebateValue ?? 0) * 100,
          achieved: threshold > 0 && current >= threshold,
        })
      }
    }
  }

  return serialize(out)
}

// ─── Vendor Performance: Per-Contract Rows ──────────────────────

/**
 * Per-contract performance rows used by the Contracts and Rebate
 * Progress tabs. Spend is trailing-12mo vendor-scoped COG (per
 * CLAUDE.md). Rebate paid is the canonical lifetime earned figure
 * (`sumEarnedRebatesLifetime`). Replaces the in-component mock
 * fallback that mixed in `MOCK_CONTRACT_PERFORMANCE` whenever the
 * server returned an empty list.
 */
export async function getVendorPerformanceContracts(
  _vendorId?: string,
): Promise<VendorPerformanceContractRow[]> {
  const { vendor: sessionVendor } = await requireVendor()
  const vendorId = sessionVendor.id

  const now = new Date()
  const trailing12MoStart = new Date(now)
  trailing12MoStart.setMonth(trailing12MoStart.getMonth() - 12)

  const contracts = await prisma.contract.findMany({
    where: { vendorId, status: "active" },
    select: {
      id: true,
      name: true,
      totalValue: true,
      annualValue: true,
      facility: { select: { name: true } },
    },
  })
  if (contracts.length === 0) return []

  const contractIds = contracts.map((c) => c.id)

  const [cogByContract, rebateRows] = await Promise.all([
    prisma.cOGRecord.groupBy({
      by: ["contractId"],
      where: {
        vendorId,
        contractId: { in: contractIds },
        transactionDate: { gte: trailing12MoStart, lte: now },
      },
      _sum: { extendedPrice: true },
    }),
    prisma.rebate.findMany({
      where: { contractId: { in: contractIds } },
      select: {
        contractId: true,
        payPeriodEnd: true,
        rebateEarned: true,
      },
    }),
  ])

  const spendMap = new Map(
    cogByContract.map((r) => [
      r.contractId ?? "",
      Number(r._sum.extendedPrice ?? 0),
    ]),
  )

  const rebatesByContract = new Map<
    string,
    { payPeriodEnd: Date | null; rebateEarned: number }[]
  >()
  for (const r of rebateRows) {
    if (!r.contractId) continue
    const list = rebatesByContract.get(r.contractId) ?? []
    list.push({
      payPeriodEnd: r.payPeriodEnd,
      rebateEarned: Number(r.rebateEarned ?? 0),
    })
    rebatesByContract.set(r.contractId, list)
  }

  const rows: VendorPerformanceContractRow[] = contracts.map((c) => {
    const actualSpend = spendMap.get(c.id) ?? 0
    const targetSpend = Number(c.annualValue || c.totalValue || 0)
    const compliance =
      targetSpend > 0 ? Math.min((actualSpend / targetSpend) * 100, 120) : 0
    const status: "on-track" | "exceeding" | "at-risk" =
      compliance >= 100 ? "exceeding" : compliance >= 90 ? "on-track" : "at-risk"
    const rebatePaid = sumEarnedRebatesLifetime(
      rebatesByContract.get(c.id) ?? [],
      now,
    )
    const rebateRate = actualSpend > 0 ? (rebatePaid / actualSpend) * 100 : 0
    return {
      id: c.id,
      name: c.name,
      facility: c.facility?.name ?? "—",
      targetSpend,
      actualSpend,
      rebateRate: Math.round(rebateRate * 100) / 100,
      rebatePaid,
      compliance: Math.round(compliance * 10) / 10,
      status,
    }
  })

  return serialize(rows)
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
