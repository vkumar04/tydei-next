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

export interface VendorMarketShareCategoryRow {
  category: string
  share: number
}

export interface VendorMarketShareByCategoryResult {
  rows: VendorMarketShareCategoryRow[]
  /** Vendor spend (any category) where `category IS NULL` — surfaced
   *  so the UI can explain why a vendor with real spend has no per-
   *  category breakdown (parallels `getCategoryMarketShareForVendor`). */
  uncategorizedSpend: number
  /** Sum of all vendor COG (categorized + un-categorized). Tells
   *  "no spend" apart from "all uncategorized" in the empty-state UI. */
  totalVendorSpend: number
}

/**
 * Charles 2026-04-26: matches the facility-side fix in commit 42604e1.
 * Previously this returned a bare `rows[]` and `[]` whenever the
 * vendor had no categorized COG, so the dashboard widget rendered
 * "No market share data" with no explanation. Now mirrors the
 * `{ rows, uncategorizedSpend, totalVendorSpend }` shape from
 * `getCategoryMarketShareForVendor` so the chart can distinguish
 * (a) no spend, (b) spend exists but un-categorized, and (c) mixed.
 */
export async function getVendorMarketShareByCategory(
  _vendorId?: string,
): Promise<VendorMarketShareByCategoryResult> {
  const { vendor: sessionVendor } = await requireVendor()
  const vendorId = sessionVendor.id

  // Pull all the vendor's COG (no `category != null` pre-filter) so we
  // can compute uncategorized spend up-front for the empty-state UI.
  const vendorRows = await prisma.cOGRecord.findMany({
    where: { vendorId },
    select: { category: true, extendedPrice: true },
  })

  let totalVendorSpend = 0
  let uncategorizedSpend = 0
  const vendorByCategory = new Map<string, number>()
  for (const r of vendorRows) {
    const amt = Number(r.extendedPrice ?? 0)
    if (amt <= 0) continue
    totalVendorSpend += amt
    if (!r.category) {
      uncategorizedSpend += amt
      continue
    }
    vendorByCategory.set(
      r.category,
      (vendorByCategory.get(r.category) ?? 0) + amt,
    )
  }

  const categories = Array.from(vendorByCategory.keys())
  if (categories.length === 0) {
    return serialize({
      rows: [],
      uncategorizedSpend,
      totalVendorSpend,
    })
  }

  const totalByCategory = await prisma.cOGRecord.groupBy({
    by: ["category"],
    where: { category: { in: categories } },
    _sum: { extendedPrice: true },
  })

  const totalMap = new Map(
    totalByCategory.map((t) => [t.category, Number(t._sum.extendedPrice ?? 0)]),
  )

  const rows: VendorMarketShareCategoryRow[] = Array.from(
    vendorByCategory.entries(),
  )
    .map(([cat, vendorSpend]) => {
      const totalSpend = totalMap.get(cat) ?? 0
      const display = cat.length > 15 ? cat.substring(0, 12) + "..." : cat
      return {
        category: display,
        share: totalSpend > 0 ? (vendorSpend / totalSpend) * 100 : 0,
      }
    })
    .sort((a, b) => b.share - a.share)
    .slice(0, 5)

  return serialize({ rows, uncategorizedSpend, totalVendorSpend })
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

/**
 * Charles 2026-04-26: prod showed "Aggregate Spend Trend: No spend
 * data available" for Stryker at Lighthouse despite $1.7M+ of
 * categorized COG, because the trend was sourced from `ContractPeriod`
 * rollups — and Stryker has zero rows there. ContractPeriod is sparse
 * on prod; the canonical source for vendor spend (per CLAUDE.md and
 * `getVendorDashboardStats` above) is `cOGRecord.extendedPrice`
 * filtered by `vendorId`. Switched the trend to bucket COG rows by
 * `transactionDate` year-month and pull rebate from `Rebate` rows on
 * the same vendor's contracts.
 */
export async function getVendorSpendTrend(input: {
  vendorId?: string
  dateFrom: string
  dateTo: string
}) {
  const { vendor } = await requireVendor()
  const vendorId = vendor.id
  const { dateFrom, dateTo } = input
  const from = new Date(dateFrom)
  const to = new Date(dateTo)

  const [cogRows, rebateRows] = await Promise.all([
    prisma.cOGRecord.findMany({
      where: {
        vendorId,
        transactionDate: { gte: from, lte: to },
      },
      select: { transactionDate: true, extendedPrice: true },
    }),
    prisma.rebate.findMany({
      where: {
        contract: { vendorId },
        payPeriodEnd: { gte: from, lte: to },
      },
      select: { payPeriodEnd: true, rebateEarned: true },
    }),
  ])

  const monthMap = new Map<string, { spend: number; rebate: number }>()

  for (const r of cogRows) {
    const key = r.transactionDate.toISOString().slice(0, 7)
    const entry = monthMap.get(key) ?? { spend: 0, rebate: 0 }
    entry.spend += Number(r.extendedPrice ?? 0)
    monthMap.set(key, entry)
  }

  for (const r of rebateRows) {
    if (!r.payPeriodEnd) continue
    const key = r.payPeriodEnd.toISOString().slice(0, 7)
    const entry = monthMap.get(key) ?? { spend: 0, rebate: 0 }
    entry.rebate += Number(r.rebateEarned ?? 0)
    monthMap.set(key, entry)
  }

  return serialize(
    Array.from(monthMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([month, data]) => ({
        month,
        spend: data.spend,
        rebate: data.rebate,
      })),
  )
}
