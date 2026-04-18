"use server"

import { prisma } from "@/lib/db"
import { ContractStatus } from "@prisma/client"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { computeRebateFromPrismaTiers, DEFAULT_COLLECTION_RATE } from "@/lib/rebates/calculate"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"

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

  // Subsystem-0 note: the canonical spec dashboard needs a
  // `totalContractValue` KPI (sum of Contract.totalValue across the
  // active-ish statuses included above) plus an "action-required"
  // `pendingAlerts` count that matches the canonical rubric —
  // contracts expiring within 90 days OR active contracts whose
  // commitment progress is < 80%. We keep the original alert-row
  // count as `pendingAlertCount` for the existing UI and expose
  // the new derived count as `pendingAlerts`.
  const ninetyDaysAhead = new Date()
  ninetyDaysAhead.setDate(ninetyDaysAhead.getDate() + 90)

  const [
    activeContractCount,
    recentContractsAdded,
    totalSpendAgg,
    onContractSpendAgg,
    rebateEarnedAgg,
    rebateCollectedAgg,
    alertCount,
    totalContractValueAgg,
    expiringSoonCount,
    activeContractsForCommitment,
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
    // Sum of Contract.totalValue across the facility's active portfolio.
    prisma.contract.aggregate({
      where: facilityContractFilter,
      _sum: { totalValue: true },
    }),
    // Count of contracts expiring within 90 days — canonical-spec
    // "pending alerts" component.
    prisma.contract.count({
      where: {
        ...facilityContractFilter,
        status: { in: [ContractStatus.active, ContractStatus.expiring] },
        expirationDate: { gte: new Date(), lte: ninetyDaysAhead },
      },
    }),
    // Active contracts with a defined marketShareCommitment — we then
    // flag those whose commitment progress is < 80% as pending.
    prisma.contract.findMany({
      where: {
        ...facilityContractFilter,
        status: { in: [ContractStatus.active, ContractStatus.expiring] },
        marketShareCommitment: { not: null },
      },
      select: {
        id: true,
        marketShareCommitment: true,
        currentMarketShare: true,
      },
    }),
  ])

  const totalSpend = Number(totalSpendAgg._sum.extendedPrice ?? 0)
  const onContractSpend = Number(onContractSpendAgg._sum.extendedPrice ?? 0)
  const onContractPercent = totalSpend > 0 ? (onContractSpend / totalSpend) * 100 : 0

  let rebatesEarned = Number(rebateEarnedAgg._sum.rebateEarned ?? 0)
  let rebatesCollected = Number(rebateCollectedAgg._sum.rebateCollected ?? 0)

  // If no persisted ContractPeriod rows returned rebates but we DO have
  // on-contract spend, compute rebates dynamically from active contracts'
  // tier structures × matched COG spend. This covers user-created contracts
  // that haven't been seeded with period rows.
  if (rebatesEarned === 0 && onContractSpend > 0) {
    const contractsWithTiers = await prisma.contract.findMany({
      where: {
        status: { in: ["active", "expiring"] },
        OR: [
          { facilityId },
          { contractFacilities: { some: { facilityId } } },
        ],
      },
      select: {
        id: true,
        vendorId: true,
        terms: {
          include: { tiers: { orderBy: { tierNumber: "asc" } } },
          take: 1,
        },
      },
    })

    for (const contract of contractsWithTiers) {
      const tiers = contract.terms[0]?.tiers ?? []
      if (tiers.length === 0) continue

      const vendorSpendAgg = await prisma.cOGRecord.aggregate({
        where: {
          facilityId,
          vendorId: contract.vendorId,
          transactionDate: { gte: new Date(dateFrom), lte: new Date(dateTo) },
        },
        _sum: { extendedPrice: true },
      })
      const vendorSpend = Number(vendorSpendAgg._sum.extendedPrice ?? 0)
      if (vendorSpend <= 0) continue

      const result = computeRebateFromPrismaTiers(vendorSpend, tiers)
      rebatesEarned += result.rebateEarned
    }
    rebatesCollected = rebatesEarned * DEFAULT_COLLECTION_RATE
  }

  const collectionRate = rebatesEarned > 0 ? (rebatesCollected / rebatesEarned) * 100 : 0

  const totalContractValue = Number(totalContractValueAgg._sum.totalValue ?? 0)

  // Commitment-progress pending count: active contracts with a defined
  // marketShareCommitment whose currentMarketShare is below 80% of it
  // (or null, which we treat as "not yet tracked" and therefore pending).
  const lowCommitmentCount = activeContractsForCommitment.reduce((acc, c) => {
    const commit = Number(c.marketShareCommitment ?? 0)
    if (commit <= 0) return acc
    const current = Number(c.currentMarketShare ?? 0)
    const progress = (current / commit) * 100
    return progress < 80 ? acc + 1 : acc
  }, 0)

  const pendingAlerts = expiringSoonCount + lowCommitmentCount

  return serialize({
    // ─── Legacy field names (existing UI consumers) ─────────────
    activeContractCount,
    recentContractsAdded,
    totalSpend,
    onContractSpend,
    onContractPercent,
    rebatesEarned,
    rebatesCollected,
    collectionRate,
    pendingAlertCount: alertCount,
    // ─── Canonical-spec field names (subsystem-0 audit §3.0) ────
    // The new UI (subsystem 1) consumes these; we expose both so
    // the legacy dashboard-stats.tsx keeps rendering until the
    // metric-card refactor lands.
    activeCount: activeContractCount,
    totalContractValue,
    totalSpendYTD: totalSpend,
    totalContractSpend: onContractSpend,
    spendProgress: onContractPercent,
    rebateCollectionRate: collectionRate,
    pendingAlerts,
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

  // Zero-fill the trailing 12 months (anchored on the `dateTo` bound)
  // so the trend-line renders continuously even when individual months
  // have no transactions. Canonical spec §3.0 requires this.
  const anchor = new Date(dateTo)
  const filledMonths: Array<{ month: string; spend: number }> = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1),
    )
    const key = d.toISOString().slice(0, 7)
    filledMonths.push({ month: key, spend: monthMap.get(key) ?? 0 })
  }

  return serialize(filledMonths)
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

  // Category resolution order, each layer only used when the previous
  // can't answer:
  //   1. The free-text `category` column on the COGRecord itself.
  //   2. Pricing file match by (vendorId, vendorItemNo) — most common
  //      source of real-world category coverage because pricing files
  //      almost always have categories even when COG imports don't.
  //   3. Vendor-name first-word fallback (canonical spec §3.0/§5):
  //      for COG rows whose vendorItemNo doesn't hit a pricing row,
  //      match on the first token of the vendor name against any
  //      vendor that has at least one categorized pricing row, and
  //      use that vendor's first-seen category.
  //   4. Vendor's active contract productCategory.
  //   5. "Uncategorized".
  const records = await prisma.cOGRecord.findMany({
    where: {
      facilityId,
      transactionDate: { gte: new Date(dateFrom), lte: new Date(dateTo) },
    },
    select: {
      category: true,
      extendedPrice: true,
      vendorId: true,
      vendorName: true,
      vendorItemNo: true,
      vendor: {
        select: {
          name: true,
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

  // Build a (vendorId, vendorItemNo) → category lookup from pricing
  // files that cover the items actually appearing in this COG window.
  const vendorIdsSeen = new Set<string>()
  const itemNosSeen = new Set<string>()
  for (const r of records) {
    if (r.vendorId && r.vendorItemNo) {
      vendorIdsSeen.add(r.vendorId)
      itemNosSeen.add(r.vendorItemNo)
    }
  }
  const pricingCategoryMap = new Map<string, string>()
  // Vendor-name first-word → first-seen category map, built from any
  // pricing row whose vendor has at least one categorized row. Keyed
  // by lowercased first token so "Medtronic Surgical Inc." matches
  // "medtronic" COG entries regardless of casing drift.
  const vendorNameCategoryMap = new Map<string, string>()
  if (vendorIdsSeen.size > 0) {
    const pricingRows = await prisma.pricingFile.findMany({
      where: {
        vendorId: { in: Array.from(vendorIdsSeen) },
        category: { not: null },
      },
      select: {
        vendorId: true,
        vendorItemNo: true,
        category: true,
        vendor: { select: { name: true } },
      },
    })
    for (const pr of pricingRows) {
      if (!pr.category) continue
      // Primary (vendorId, vendorItemNo) map — only populate when both
      // sides match an item actually seen in this COG window.
      if (itemNosSeen.has(pr.vendorItemNo)) {
        pricingCategoryMap.set(`${pr.vendorId}::${pr.vendorItemNo}`, pr.category)
      }
      // Vendor-name first-word fallback map. First row wins ("first-seen").
      const firstWord = pr.vendor?.name?.trim().split(/\s+/)[0]?.toLowerCase()
      if (firstWord && !vendorNameCategoryMap.has(firstWord)) {
        vendorNameCategoryMap.set(firstWord, pr.category)
      }
    }
  }

  const catMap = new Map<string, number>()
  for (const r of records) {
    const pricingCategory =
      r.vendorId && r.vendorItemNo
        ? pricingCategoryMap.get(`${r.vendorId}::${r.vendorItemNo}`) ?? null
        : null
    const vendorNameFirstWord = (r.vendor?.name ?? r.vendorName ?? "")
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
    const vendorNameCategory = vendorNameFirstWord
      ? vendorNameCategoryMap.get(vendorNameFirstWord) ?? null
      : null
    const vendorContractCategory =
      r.vendor?.contracts[0]?.productCategory?.name ?? null
    const cat =
      r.category ||
      pricingCategory ||
      vendorNameCategory ||
      vendorContractCategory ||
      "Uncategorized"
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
    // Canonical spec §3.0 / §5 chart 2: top 8 vendors.
    take: 8,
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
    where: contractsOwnedByFacility(facilityId),
    include: { vendor: { select: { id: true, name: true, logoUrl: true } } },
    // Canonical spec §3.0: most recent by effectiveDate — not
    // updatedAt, because editing a stale contract shouldn't push it
    // ahead of a brand-new one on the dashboard's "recent" list.
    orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
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
