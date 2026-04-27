"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { computeCategoryMarketShare } from "@/lib/contracts/market-share-filter"

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

  // Pull the vendor's facility set so we can compute correct category
  // totals (denominator) at every facility this vendor sells into.
  // Previously this action sliced facility-wide COG with `category IN
  // (...)` which (a) lost the contract-category fallback for the
  // denominator and (b) leaked spend across facilities the vendor
  // doesn't actually sell at.
  const vendorFacilityRows = await prisma.cOGRecord.findMany({
    where: { vendorId },
    select: { facilityId: true },
    distinct: ["facilityId"],
  })
  const facilityIds = vendorFacilityRows.map((r) => r.facilityId)

  if (facilityIds.length === 0) {
    return serialize({ rows: [], uncategorizedSpend: 0, totalVendorSpend: 0 })
  }

  const cogRows = await prisma.cOGRecord.findMany({
    where: { facilityId: { in: facilityIds } },
    select: {
      vendorId: true,
      category: true,
      extendedPrice: true,
      contractId: true,
    },
  })

  const contractIds = Array.from(
    new Set(cogRows.map((r) => r.contractId).filter((v): v is string => !!v)),
  )
  const contractCategoryRows =
    contractIds.length > 0
      ? await prisma.contract.findMany({
          where: { id: { in: contractIds } },
          select: {
            id: true,
            productCategory: { select: { name: true } },
          },
        })
      : []
  const contractCategoryMap = new Map<string, string | null>(
    contractCategoryRows.map((c) => [c.id, c.productCategory?.name ?? null]),
  )

  const computed = computeCategoryMarketShare({
    rows: cogRows,
    contractCategoryMap,
    vendorId,
  })

  // Map to the existing UI-compatible row shape. The chart uses `share`
  // (0–100 percentage), so map from `sharePct` (same semantics, different name).
  const rows: VendorMarketShareCategoryRow[] = computed.rows
    .slice(0, 5)
    .map((r) => ({
      category:
        r.category.length > 15 ? r.category.substring(0, 12) + "..." : r.category,
      share: r.sharePct,
    }))

  return serialize({
    rows,
    uncategorizedSpend: computed.uncategorizedSpend,
    totalVendorSpend: computed.totalVendorSpend,
  })
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
