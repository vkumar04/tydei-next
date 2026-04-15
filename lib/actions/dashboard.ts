"use server"

import { prisma } from "@/lib/db"
import { ContractStatus } from "@prisma/client"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

// ─── Dashboard Stats ─────────────────────────────────────────────

export async function getDashboardStats(input: {
  facilityId?: string
  dateFrom: string
  dateTo: string
}) {
  const { facility } = await requireFacility()
  const facilityId = facility.id
  const { dateFrom, dateTo } = input

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  // Match the ownership check used elsewhere: direct facilityId OR many-to-many
  // via ContractFacility. Include all non-expired statuses so the count reflects
  // contracts the user has actually loaded (draft/pending contracts should still
  // appear — otherwise a freshly-created contract is invisible on the dashboard).
  const facilityContractFilter = {
    OR: [
      { facilityId },
      { contractFacilities: { some: { facilityId } } },
    ],
    status: {
      in: [
        ContractStatus.active,
        ContractStatus.expiring,
        ContractStatus.draft,
        ContractStatus.pending,
      ],
    },
  }

  const [
    activeContractCount,
    recentContractsAdded,
    totalSpendAgg,
    onContractSpendAgg,
    rebateEarnedAgg,
    rebateCollectedAgg,
    alertCount,
  ] = await Promise.all([
    prisma.contract.count({ where: facilityContractFilter }),
    prisma.contract.count({
      where: {
        ...facilityContractFilter,
        createdAt: { gte: thirtyDaysAgo },
      },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        facilityId,
        transactionDate: { gte: new Date(dateFrom), lte: new Date(dateTo) },
      },
      _sum: { extendedPrice: true },
    }),
    // "On-contract" spend = COG rows whose vendor has an active contract
    // scoped to this facility (direct or via contract_facility join). The
    // previous `vendorId: { not: null }` proxy just counted every
    // vendor-tagged row and reported "100% on-contract" even when the
    // vendor had no contract at all.
    prisma.cOGRecord.aggregate({
      where: {
        facilityId,
        transactionDate: { gte: new Date(dateFrom), lte: new Date(dateTo) },
        vendor: {
          contracts: {
            some: {
              status: { in: ["active", "expiring"] },
              OR: [
                { facilityId },
                { contractFacilities: { some: { facilityId } } },
              ],
            },
          },
        },
      },
      _sum: { extendedPrice: true },
    }),
    // Rebate aggregates use date *overlap* instead of containment —
    // otherwise a monthly period that straddles the window edge gets
    // dropped entirely, which is why the dashboard card was stuck at $0
    // on 30/60/90-day windows.
    prisma.contractPeriod.aggregate({
      where: {
        facilityId,
        periodStart: { lte: new Date(dateTo) },
        periodEnd: { gte: new Date(dateFrom) },
      },
      _sum: { rebateEarned: true },
    }),
    prisma.contractPeriod.aggregate({
      where: {
        facilityId,
        periodStart: { lte: new Date(dateTo) },
        periodEnd: { gte: new Date(dateFrom) },
      },
      _sum: { rebateCollected: true },
    }),
    prisma.alert.count({
      where: { facilityId, status: { in: ["new_alert", "read"] } },
    }),
  ])

  const totalSpend = Number(totalSpendAgg._sum.extendedPrice ?? 0)
  const onContractSpend = Number(onContractSpendAgg._sum.extendedPrice ?? 0)
  const onContractPercent = totalSpend > 0 ? (onContractSpend / totalSpend) * 100 : 0
  const rebatesEarned = Number(rebateEarnedAgg._sum.rebateEarned ?? 0)
  const rebatesCollected = Number(rebateCollectedAgg._sum.rebateCollected ?? 0)
  const collectionRate = rebatesEarned > 0 ? (rebatesCollected / rebatesEarned) * 100 : 0

  return serialize({
    activeContractCount,
    recentContractsAdded,
    totalSpend,
    onContractSpend,
    onContractPercent,
    rebatesEarned,
    rebatesCollected,
    collectionRate,
    pendingAlertCount: alertCount,
  })
}

// ─── Monthly Spend Trend ─────────────────────────────────────────

export async function getMonthlySpend(input: {
  facilityId?: string
  dateFrom: string
  dateTo: string
}) {
  const { facility } = await requireFacility()
  const facilityId = facility.id
  const { dateFrom, dateTo } = input

  const records = await prisma.cOGRecord.findMany({
    where: {
      facilityId,
      transactionDate: { gte: new Date(dateFrom), lte: new Date(dateTo) },
    },
    select: { transactionDate: true, extendedPrice: true },
  })

  const monthMap = new Map<string, number>()
  for (const r of records) {
    if (!r.transactionDate) continue
    const key = r.transactionDate.toISOString().slice(0, 7)
    monthMap.set(key, (monthMap.get(key) ?? 0) + Number(r.extendedPrice ?? 0))
  }

  return serialize(
    Array.from(monthMap.entries())
      .map(([month, spend]) => ({ month, spend }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12)
  )
}

// ─── Spend by Category ───────────────────────────────────────────

export async function getSpendByCategory(input: {
  facilityId?: string
  dateFrom: string
  dateTo: string
}) {
  const { facility } = await requireFacility()
  const facilityId = facility.id
  const { dateFrom, dateTo } = input

  // Category resolution order:
  //   1. The free-text category column on the COGRecord itself (when
  //      the import payload supplied it).
  //   2. The vendor's active contract's productCategory.name (most
  //      realistic source — COG imports almost never ship a category
  //      column, but contracts do).
  //   3. "Uncategorized" as a last-resort bucket.
  const records = await prisma.cOGRecord.findMany({
    where: {
      facilityId,
      transactionDate: { gte: new Date(dateFrom), lte: new Date(dateTo) },
    },
    select: {
      category: true,
      extendedPrice: true,
      vendor: {
        select: {
          contracts: {
            where: {
              status: { in: ["active", "expiring"] },
              OR: [
                { facilityId },
                { contractFacilities: { some: { facilityId } } },
              ],
              productCategoryId: { not: null },
            },
            select: { productCategory: { select: { name: true } } },
            take: 1,
            orderBy: { effectiveDate: "desc" },
          },
        },
      },
    },
  })

  const catMap = new Map<string, number>()
  for (const r of records) {
    const vendorCategory =
      r.vendor?.contracts[0]?.productCategory?.name ?? null
    const cat = r.category || vendorCategory || "Uncategorized"
    catMap.set(cat, (catMap.get(cat) ?? 0) + Number(r.extendedPrice ?? 0))
  }

  return serialize(
    Array.from(catMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  )
}

// ─── Earned Rebate by Month ──────────────────────────────────────

export async function getEarnedRebateByMonth(input: {
  facilityId?: string
  dateFrom: string
  dateTo: string
}) {
  const { facility } = await requireFacility()
  const facilityId = facility.id
  const { dateFrom, dateTo } = input

  const periods = await prisma.contractPeriod.findMany({
    where: {
      facilityId,
      // Overlap semantics so periods straddling the window edge count.
      periodStart: { lte: new Date(dateTo) },
      periodEnd: { gte: new Date(dateFrom) },
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

  return serialize(Array.from(monthMap.entries()).map(([month, vendors]) => ({
    month,
    ...vendors,
  })))
}

// ─── Spend by Vendor ─────────────────────────────────────────────

export async function getSpendByVendor(input: {
  facilityId?: string
  dateFrom: string
  dateTo: string
}) {
  const { facility } = await requireFacility()
  const facilityId = facility.id
  const { dateFrom, dateTo } = input

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

  return serialize(records.map((r) => ({
    vendor: vendorMap.get(r.vendorId!) ?? "Unknown",
    total: Number(r._sum.extendedPrice ?? 0),
  })))
}

// ─── Contract Lifecycle ──────────────────────────────────────────

export async function getContractLifecycle(_facilityId?: string) {
  const { facility } = await requireFacility()
  const facilityId = facility.id

  const [active, expired, expiring] = await Promise.all([
    prisma.contract.count({ where: { facilityId, status: "active" } }),
    prisma.contract.count({ where: { facilityId, status: "expired" } }),
    prisma.contract.count({ where: { facilityId, status: "expiring" } }),
  ])

  return serialize({ active, expired, expiring })
}

// ─── Spend Needed for Tier ───────────────────────────────────────

export async function getSpendNeededForTier(_facilityId?: string) {
  const { facility } = await requireFacility()
  const facilityId = facility.id

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

  return serialize(contracts
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
    .slice(0, 8))
}

// ─── Recent Contracts ────────────────────────────────────────────

export async function getRecentContracts(_facilityId?: string, limit = 5) {
  const { facility } = await requireFacility()
  const facilityId = facility.id

  const contracts = await prisma.contract.findMany({
    where: {
      OR: [
        { facilityId },
        { contractFacilities: { some: { facilityId } } },
      ],
    },
    include: { vendor: { select: { id: true, name: true, logoUrl: true } } },
    orderBy: { updatedAt: "desc" },
    take: limit,
  })
  return serialize(contracts)
}

// ─── Recent Alerts ───────────────────────────────────────────────

export async function getRecentAlerts(_facilityId?: string, limit = 5) {
  const { facility } = await requireFacility()
  const facilityId = facility.id

  const alerts = await prisma.alert.findMany({
    where: { facilityId, status: { in: ["new_alert", "read"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  return serialize(alerts)
}
