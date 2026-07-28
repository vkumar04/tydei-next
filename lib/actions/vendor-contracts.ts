"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import type { ContractStatus, Prisma } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import {
  contractsOwnedByVendor,
  scopeContractWhereToFacility,
} from "@/lib/actions/contracts-vendor-auth"

// ─── Vendor Contracts List ──────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20
/** Hard ceiling on rows a single call will return. */
const MAX_PAGE_SIZE = 500
const EXPIRING_SOON_WINDOW_DAYS = 30
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Every ContractStatus present, so a missing groupBy row reads as 0. */
const ZERO_STATUS_COUNTS: Record<ContractStatus, number> = {
  active: 0,
  expired: 0,
  expiring: 0,
  draft: 0,
  pending: 0,
}

/**
 * Vendor contracts list + the vendor's WHOLE-PORTFOLIO rollup.
 *
 * The two halves of the return value are deliberately different scopes,
 * and callers must not confuse them:
 *
 *   - `contracts` / `total` / `hasMore` describe THIS PAGE and the
 *     `status` + `search` + `facilityId` filters applied to it.
 *   - `portfolio` describes every contract owned by (or grouped with)
 *     this vendor, ignoring the page window AND the
 *     status/search/facility filters — it is what the hero banner
 *     renders, so the hero stays put as the user narrows the table
 *     below it.
 *
 * Charles 2026-07-27 (vendor hero understates Total Value): the hero
 * used to be reduced client-side over the FIRST PAGE of 20 rows ordered
 * `updatedAt desc`. A vendor with 60 contracts averaging $500k saw a
 * "Total Value / Lifetime commitment" ~$20M short, with nothing on
 * screen indicating a cap, and a facility filter missing every facility
 * whose contracts hadn't been touched recently. Same failure shape as
 * the contract-detail `periods` slice below: never reduce a truncated
 * page and present it as the whole truth. Counts, money, facilities and
 * status splits are now one batched server round trip over the full
 * ownership predicate.
 */
export async function getVendorContracts(input: {
  vendorId?: string
  status?: ContractStatus | "all"
  search?: string
  /** Narrows the PAGE to one facility (`"all"`/undefined = every facility). */
  facilityId?: string
  page?: number
  pageSize?: number
}) {
  const { vendor } = await requireVendor()
  const { status, search, facilityId, page = 1 } = input
  const pageSize = Math.min(
    Math.max(1, Math.trunc(input.pageSize ?? DEFAULT_PAGE_SIZE)),
    MAX_PAGE_SIZE,
  )
  const skip = (Math.max(1, page) - 1) * pageSize

  // Scope to contracts owned by OR grouped with this vendor (never bare
  // vendorId — that drops grouped additionalVendorIds; group-vendor-drift).
  // This predicate alone IS the portfolio: every hero number below is
  // computed over it, so they all describe the same population.
  const portfolioWhere = contractsOwnedByVendor(vendor.id)

  // The facility pick narrows the PAGE only, and it has to be applied
  // server-side: the dropdown is built from the whole-portfolio facility
  // list below, so a client-side filter over a capped page would offer a
  // facility and then render an empty table for it (the same
  // unreachable-option defect the dropdown fix was meant to close).
  // `scopeContractWhereToFacility` owns the `"all"` sentinel and only ever
  // NARROWS an already vendor-scoped predicate.
  const conditions: Prisma.ContractWhereInput[] = [
    scopeContractWhereToFacility(portfolioWhere, facilityId),
  ]

  if (status && status !== "all") conditions.push({ status })
  if (search) {
    conditions.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { contractNumber: { contains: search, mode: "insensitive" } },
        { facility: { name: { contains: search, mode: "insensitive" } } },
      ],
    })
  }

  const where: Prisma.ContractWhereInput = { AND: conditions }

  const now = new Date()
  const expiringCutoff = new Date(
    now.getTime() + EXPIRING_SOON_WINDOW_DAYS * MS_PER_DAY,
  )

  const [
    contracts,
    total,
    portfolioAgg,
    statusGroups,
    portfolioFacilities,
    expiringSoonCount,
  ] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: {
        facility: { select: { id: true, name: true } },
        productCategory: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.contract.count({ where }),
    // Count AND money in one aggregate so the hero's "Total Contracts"
    // and "Total Value" can never be computed at different scopes.
    prisma.contract.aggregate({
      where: portfolioWhere,
      _count: { id: true },
      _sum: { totalValue: true },
    }),
    // One groupBy instead of five `count()` calls for the status splits.
    prisma.contract.groupBy({
      by: ["status"],
      _count: true,
      where: portfolioWhere,
    }),
    // Distinct facilities across the WHOLE portfolio — this is both the
    // "Facilities Served" number and the facility-filter option list, so
    // the dropdown can never be missing a facility the hero counted.
    prisma.facility.findMany({
      where: { contracts: { some: portfolioWhere } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Same predicate the facility hero's badge is counted by
    // (`getContractStats`, lib/actions/contracts.ts): everything not
    // already expired whose expirationDate lands inside the window.
    // Filtering on `status: "active"` instead dropped every contract
    // already flagged `expiring` — literally the population the badge
    // names — so the pill under-reported against its own label. The rest
    // of the codebase treats in-effect as `["active", "expiring"]`; the
    // badge must not disagree.
    prisma.contract.count({
      where: {
        AND: [
          portfolioWhere,
          {
            status: { not: "expired" },
            expirationDate: { gt: now, lte: expiringCutoff },
          },
        ],
      },
    }),
  ])

  const statusCounts: Record<ContractStatus, number> = { ...ZERO_STATUS_COUNTS }
  for (const group of statusGroups) statusCounts[group.status] = group._count

  const portfolio = {
    contractCount: portfolioAgg._count.id,
    // `_sum` is null when the vendor owns no contracts — coalesce.
    totalValue: Number(portfolioAgg._sum.totalValue ?? 0),
    activeCount: statusCounts.active,
    statusCounts,
    facilities: portfolioFacilities,
    facilitiesServed: portfolioFacilities.length,
    expiringSoonCount,
    expiringSoonWindowDays: EXPIRING_SOON_WINDOW_DAYS,
  }

  // Bug #14 (2026-05-24): log when vendor's query returns 0 — helps
  // diagnose the "approved contract didn't appear" class of bug.
  if (contracts.length === 0) {
    console.info("[getVendorContracts] empty result", {
      vendorId: vendor.id,
      status,
      search,
      total,
      portfolioContractCount: portfolio.contractCount,
    })
  }

  return serialize({
    contracts,
    total,
    page,
    pageSize,
    /** True when the page is a truncation of `total` — the UI must say so. */
    hasMore: skip + contracts.length < total,
    portfolio,
  })
}

// ─── Vendor Contract Detail ─────────────────────────────────────

export async function getVendorContractDetail(id: string, _vendorId?: string) {
  const { vendor } = await requireVendor()

  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id, vendorId: vendor.id },
    include: {
      vendor: { select: { id: true, name: true, logoUrl: true } },
      facility: { select: { id: true, name: true } },
      productCategory: { select: { id: true, name: true } },
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      documents: { orderBy: { uploadDate: "desc" } },
      // `periods` is intentionally a recent-N slice for the ledger
      // tab; lifetime totals must come from `lifetimeTotals` below
      // (the prior code reduced over the truncated 4-row slice and
      // silently under-reported lifetime numbers — Charles audit
      // round-1 vendor C4).
      periods: { orderBy: { periodEnd: "desc" }, take: 4 },
      changeProposals: { orderBy: { submittedAt: "desc" } },
    },
  })

  // Charles audit round-1 vendor C4 + round-2 + round-3: lifetime
  // totals come from canonical helpers per the CLAUDE.md invariants
  // table. Rebate metrics come from sumEarnedRebatesLifetime +
  // sumCollectedRebates over the Rebate rows — same source the
  // facility surfaces use, no drift.
  //
  // Charles 2026-04-26 (Bug 3): Spend was being read from
  // `ContractPeriod._sum(totalSpend)` — but ContractPeriod is sparse
  // on prod (Stryker at Lighthouse has 0 period rows despite $1.7M+
  // of categorized COG), so the contract detail page rendered
  // "Spend to Date $0". Cascade now mirrors `getContract`:
  //   1. Prefer ContractPeriod._sum(totalSpend) when populated
  //      (persisted rollup is the canonical spend source when present).
  //   2. Fall back to cOGRecord.extendedPrice scoped to {contractId}.
  // CLAUDE.md hard rule: never use ContractPeriod as the SOLE source
  // of vendor spend.
  const [spendAgg, cogAgg, rebateRows] = await Promise.all([
    prisma.contractPeriod.aggregate({
      where: { contractId: id },
      _sum: { totalSpend: true },
    }),
    prisma.cOGRecord.aggregate({
      // 2026-06-09 vendor audit: contract-stamped rows already belong to
      // this contract (and the contract lookup above is vendor-constrained),
      // so the extra `vendorId: vendor.id` filter only DROPPED grouped-member
      // rows (e.g. FLEX FINANCIAL under the Stryker group — $4,991.14 on
      // prod). The recurring contractVendorIds() drift class; match the
      // facility tier-2: contractId-only.
      where: { contractId: id },
      _sum: { extendedPrice: true },
    }),
    prisma.rebate.findMany({
      where: { contractId: id },
      select: {
        id: true,
        rebateEarned: true,
        rebateCollected: true,
        payPeriodStart: true,
        payPeriodEnd: true,
        collectionDate: true,
        notes: true,
        // tierAchieved lives on ContractPeriod, not Rebate — pull it
        // through the relation so the vendor-overview Tier column has
        // a value to render. Pre-fix this was selected as
        // `tierAchieved: true` directly on Rebate, which the
        // prisma-select-schema-scanner rightly flagged as a runtime
        // bug (Unknown field).
        period: { select: { tierAchieved: true } },
      },
      orderBy: { payPeriodEnd: "desc" },
    }),
  ])
  const periodSpend = Number(spendAgg._sum.totalSpend ?? 0)
  const cogSpend = Number(cogAgg._sum.extendedPrice ?? 0)
  const lifetimeTotals = {
    spend: periodSpend > 0 ? periodSpend : cogSpend,
    rebateEarned: sumEarnedRebatesLifetime(rebateRows),
    rebateCollected: sumCollectedRebates(rebateRows),
  }

  return serialize({ ...contract, lifetimeTotals, rebates: rebateRows })
}
