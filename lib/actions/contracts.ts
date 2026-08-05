"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { toSafeResult, type SafeResult } from "@/lib/actions/safe-result"
import {
  contractFiltersSchema,
  createContractSchema,
  updateContractSchema,
  type ContractFilters,
  type CreateContractInput,
  type UpdateContractInput,
} from "@/lib/validators/contracts"
import { Prisma } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import {
  invalidateContractAnalytics,
  invalidateFacilityAnalytics,
} from "@/lib/actions/analytics/_cache"
import { idempotencyGet, idempotencyPut } from "@/lib/idempotency"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { recomputeAccrualForContract } from "@/lib/actions/contracts/recompute-accrual"
import { recomputeCaseSupplyContractStatus } from "@/lib/case-costing/recompute-supply"
import { refreshContractMetricsForVendor } from "@/lib/actions/contracts/refresh-metrics"
import {
  termFormSchemaWithTierCheck,
  type TermFormValues,
} from "@/lib/validators/contract-terms"
import {
  contractOwnershipWhere,
  contractsOwnedByFacility,
  facilityScopeClause,
  type FacilityScope,
} from "@/lib/actions/contracts-auth"
import { getCallerFacilityIds } from "@/lib/actions/facility-assignment"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import {
  sumEarnedRebatesLifetime,
  sumEarnedRebatesYTD,
} from "@/lib/contracts/rebate-earned-filter"
import { buildUnionCategoryWhereClause, buildCategoryWhereClause } from "@/lib/contracts/cog-category-filter"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"
import {
  applyConfirmedCategoryMapToNames,
  loadConfirmedCategoryMap,
} from "@/lib/categories/resolve"
import { resolveCategoryIdsToNames } from "@/lib/contracts/resolve-category-names"
import { normalizeScopedItemNumbers } from "@/lib/contracts/normalize-scoped-item-numbers"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { getTrailing12MonthWindow } from "@/lib/dates/trailing-window"

// ─── List Contracts ──────────────────────────────────────────────

export async function getContracts(input: ContractFilters) {
  const { facility } = await requireFacility()
  const filters = contractFiltersSchema.parse(input)

  const scope: FacilityScope = filters.facilityScope ?? "this"
  // Scope "all" is bounded to the facilities THIS CALLER can reach, not to
  // every facility in the database. `getCallerFacilityIds` is the canonical
  // owner of that set (enterprise/Super → every facility in the caller's
  // HealthSystem; scoped user → their FacilityAssignment set ∪ home
  // facility) and is pinned by facility-assignment-auth.test.ts — an
  // enterprise user keeps their whole health system, a scoped user keeps
  // only their assignments. Resolved ONLY for "all": "this" and "shared"
  // are already bounded by `facility.id`, so the default path pays no extra
  // round trip.
  const accessibleFacilityIds =
    scope === "all" ? await getCallerFacilityIds() : undefined
  const facilityClause = facilityScopeClause(
    scope,
    facility.id,
    accessibleFacilityIds,
  )

  // 2026-07-28 (second half of the same wrong-scope bug): the ROW SET above
  // widens under scope "all" to every facility the caller can reach, but the
  // per-row SPEND column below was aggregated over `facility.id` alone. A
  // contract owned by a sibling facility therefore rendered its home
  // facility's dollars in "Current Spend (Last 12 Months)" — not a rounding
  // error, a different facility's money. Measured on the dev seed for a
  // Lighthouse Surgical Center caller under "all":
  //   Integra Dural Repair (Lighthouse Community Hospital)  $0 vs $11,340
  //   Medtronic Spine Hardware      (LCH)   $737,300 (LSC's own) vs $670,920
  //   Stryker Surgical Navigation   (LCH) $2,148,700 (LSC's own) vs $504,200
  // The COG reads now use the SAME facility universe that selected the rows:
  // the caller's own facility for "this"/"shared", the accessible set for
  // "all". It can never widen past `getCallerFacilityIds`, so this stays
  // inside the tenant bound.
  const cogFacilityScope: Prisma.COGRecordWhereInput["facilityId"] =
    accessibleFacilityIds ? { in: accessibleFacilityIds } : facility.id

  const conditions: Prisma.ContractWhereInput[] = [facilityClause]

  if (filters.status) conditions.push({ status: filters.status })
  if (filters.type) conditions.push({ contractType: filters.type })
  if (filters.search) {
    conditions.push({
      OR: [
        { name: { contains: filters.search, mode: "insensitive" } },
        { vendor: { name: { contains: filters.search, mode: "insensitive" } } },
        { contractNumber: { contains: filters.search, mode: "insensitive" } },
      ],
    })
  }

  const where: Prisma.ContractWhereInput = { AND: conditions }

  // Perf: Prisma's `include` issues ONE batched query per relation
  // (`WHERE relationFK IN (...)`), not one per row — so the include
  // here is O(R) queries (R = number of relations), not O(N×R). The
  // tighter cleanup is removing dead-code joins. `tiers: { select: { id } }`
  // (formerly under `terms`) was never read from the returned shape; it
  // contributed an extra batched query per page for nothing. Removed.
  // The `rebates` and `terms` joins below ARE consumed (canonical
  // reducers + category-scoped spend cascade respectively); they stay.
  // We strip them from the per-row return shape after deriving the
  // aggregates so callers don't pay the serialization cost downstream.
  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true, logoUrl: true } },
        productCategory: { select: { id: true, name: true } },
        facility: { select: { id: true, name: true } },
        rebates: {
          select: {
            rebateEarned: true,
            rebateCollected: true,
            payPeriodEnd: true,
            collectionDate: true,
          },
        },
        // Charles W1.U-A — pull `appliesTo` + `categories` so the
        // trailing-12mo spend cascade (below) can narrow the vendor-wide
        // COG aggregate to the categories the contract's terms are
        // actually scoped to. Without this join, a contract whose only
        // term is scoped to ["Extremities & Trauma"] would show every
        // vendor dollar in its "Current Spend (Last 12 Months)" column.
        // Charles 2026-04-26 perf pass: removed the dead `tiers:
        // { select: { id } }` sub-include — never read in this function
        // and not part of the public return shape (consumers fetch tier
        // data via getContract for the detail page). Saves one batched
        // tier query per list page.
        terms: {
          select: { appliesTo: true, categories: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip: ((filters.page ?? 1) - 1) * (filters.pageSize ?? 20),
      take: filters.pageSize ?? 20,
    }),
    prisma.contract.count({ where }),
  ])

  // Derive aggregated rebateEarned / rebateCollected per contract so UI can
  // render the "Rebate Earned" column without an extra round-trip. Same
  // temporal filters as getContract (see CLAUDE.md "Rebates are NEVER
  // auto-computed for display"): earned counts only closed periods,
  // collected counts only rows with a collectionDate set.
  //
  // Charles R5.31 → iMessage 2026-04-20 N13: contracts-list earned column
  // is now LIFETIME (was YTD). Routed through canonical
  // sumEarnedRebatesLifetime so list column + detail Transactions tab
  // "Total Rebates (Lifetime)" + reports overview cannot drift apart.
  // Per CLAUDE.md invariants table: list = lifetime, detail header
  // "Earned (YTD)" card = YTD via sumEarnedRebatesYTD.
  const today = new Date()

  // Charles W1.J — populate `currentSpend` per row using the R5.28
  // trailing-12-month cascade so the list page's SPEND column matches
  // the detail page's "Current Spend (Last 12 Months)" card. Previously
  // this column relied on getContractMetricsBatch (lifetime, no window)
  // and frequently rendered $0 because the batched fallback chain didn't
  // include the vendor-wide COG safety net. Three batched aggregations
  // (periods, COG-by-contractId, COG-by-vendorId) replace per-row queries.
  // Precedence (same as getContract):
  //   1. ContractPeriod.totalSpend WHERE contractId AND periodEnd in [today-12mo, today]
  //   2. COGRecord.extendedPrice  WHERE contractId AND transactionDate in [today-12mo, today]
  //   3. COGRecord.extendedPrice  WHERE vendorId  AND transactionDate in [today-12mo, today]
  // Note: tier 3 is fuzzy — when multiple contracts share a vendor, the
  // vendor-window figure double-counts across those contracts. We accept
  // this bound (already documented in R5.24) because the alternative is
  // $0 for any contract that lacks ContractPeriod rollups AND has no
  // COG rows enriched with its own contractId.
  const { start: windowStart, end: windowEnd } = getTrailing12MonthWindow(today)
  const contractIds = contracts.map((c) => c.id)
  // #2 (Vick 2026-05-31): include every participating vendor of grouped
  // contracts so the tier-3 vendor-window aggregate covers the whole group.
  const vendorIds = Array.from(
    new Set(contracts.flatMap((c) => contractVendorIds(c))),
  )

  const [periodSpendAgg, cogByContractAgg, cogByVendorAgg] =
    contractIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          prisma.contractPeriod.groupBy({
            by: ["contractId"],
            where: {
              contractId: { in: contractIds },
              periodEnd: { gte: windowStart, lte: windowEnd },
            },
            _sum: { totalSpend: true },
          }),
          prisma.cOGRecord.groupBy({
            by: ["contractId"],
            where: {
              facilityId: cogFacilityScope,
              contractId: { in: contractIds },
              transactionDate: { gte: windowStart, lte: windowEnd },
            },
            _sum: { extendedPrice: true },
          }),
          vendorIds.length === 0
            ? Promise.resolve(
                [] as Array<{
                  vendorId: string | null
                  _sum: { extendedPrice: Prisma.Decimal | null }
                }>,
              )
            : prisma.cOGRecord.groupBy({
                by: ["vendorId"],
                where: {
                  facilityId: cogFacilityScope,
                  vendorId: { in: vendorIds },
                  transactionDate: { gte: windowStart, lte: windowEnd },
                },
                _sum: { extendedPrice: true },
              }),
        ])

  // 2026-04-26: A single-CTE rewrite was attempted but rolled back.
  // The three groupBys already run in one wall-clock round-trip via
  // Promise.all (max ≈ one query, not three sequential), and the
  // existing mock-based parity tests would each need a `$queryRaw`
  // shim. The clarity-vs-modest-perf trade favored keeping the
  // groupBys.
  const periodSpendByContract = new Map<string, number>()
  for (const row of periodSpendAgg) {
    periodSpendByContract.set(
      row.contractId,
      Number(row._sum?.totalSpend ?? 0),
    )
  }
  const cogSpendByContract = new Map<string, number>()
  for (const row of cogByContractAgg) {
    if (row.contractId) {
      cogSpendByContract.set(
        row.contractId,
        Number(row._sum?.extendedPrice ?? 0),
      )
    }
  }
  const cogSpendByVendor = new Map<string, number>()
  for (const row of cogByVendorAgg) {
    if (row.vendorId) {
      cogSpendByVendor.set(
        row.vendorId,
        Number(row._sum?.extendedPrice ?? 0),
      )
    }
  }

  // Charles W1.U-A — per-contract category-scoped fallback aggregate.
  // The vendor-wide aggregate above is shared across every contract for
  // a vendor (an intentional fuzziness documented in the block comment
  // above). For contracts whose terms are ALL scoped to specific
  // categories we want the tier-3 fallback to reflect only that slice.
  //
  // Charles 2026-04-26 perf pass: this used to issue ONE
  // `cOGRecord.aggregate` per category-scoped contract (true N+1
  // proportional to page size). Replaced with ONE batched
  // `groupBy(['vendorId','category'])` query over the union of
  // category-scoped vendors; the per-contract sum is computed in JS
  // by summing the buckets that fall in each contract's category union.
  // For a 20-row page where every row was category-scoped this collapses
  // ~20 round-trips into 1.
  const perContractCategorySpend = new Map<string, number>()
  const categoryScopedContracts: Array<{
    id: string
    vendorIds: string[]
    categories: Set<string>
  }> = []
  // 2026-06-08: expand selected categories to the facility's drifted COG
  // category variants so the cascade's category-scoped spend doesn't drop
  // case/word-order-different rows (Charles "not all the spend is brought in").
  // Same universe rule as `cogFacilityScope` above: the drifted-variant list
  // has to cover every facility the aggregates are allowed to read from, or a
  // sibling facility's "Extremities/Trauma" spelling silently drops out of the
  // category-scoped fallback under scope "all". One bounded `Promise.all` over
  // the accessible set (the caller's health system at most) — NOT one call per
  // contract row.
  const cogUniverseFacilityIds = accessibleFacilityIds ?? [facility.id]
  const listCogUniverse = Array.from(
    new Set(
      (
        await Promise.all(
          cogUniverseFacilityIds.map((id) => facilityCogCategoryUniverse(id)),
        )
      ).flat(),
    ),
  )
  for (const c of contracts) {
    // #2: a grouped contract's category-scoped spend spans every
    // participating vendor.
    const vids = contractVendorIds(c)
    if (vids.length === 0) continue
    const termScopes = (c.terms ?? []).map((t) => ({
      appliesTo: t.appliesTo,
      categories: t.categories,
    }))
    const unionWhere = buildUnionCategoryWhereClause(termScopes, listCogUniverse)
    const cats = unionWhere.category?.in
    if (!cats || cats.length === 0) continue
    categoryScopedContracts.push({
      id: c.id,
      vendorIds: vids,
      categories: new Set(cats),
    })
  }
  if (categoryScopedContracts.length > 0) {
    const scopedVendorIds = Array.from(
      new Set(categoryScopedContracts.flatMap((c) => c.vendorIds)),
    )
    const scopedCategorySet = new Set<string>()
    for (const c of categoryScopedContracts) {
      for (const cat of c.categories) scopedCategorySet.add(cat)
    }
    const scopedCategories = Array.from(scopedCategorySet)
    const cogByVendorCategory = await prisma.cOGRecord.groupBy({
      by: ["vendorId", "category"],
      where: {
        facilityId: cogFacilityScope,
        vendorId: { in: scopedVendorIds },
        category: { in: scopedCategories },
        transactionDate: { gte: windowStart, lte: windowEnd },
      },
      _sum: { extendedPrice: true },
    })
    // Index buckets as `${vendorId}::${category}` → sum.
    const bucket = new Map<string, number>()
    for (const row of cogByVendorCategory) {
      if (!row.vendorId || row.category == null) continue
      bucket.set(
        `${row.vendorId}::${row.category}`,
        Number(row._sum?.extendedPrice ?? 0),
      )
    }
    for (const c of categoryScopedContracts) {
      let sum = 0
      for (const vid of c.vendorIds) {
        for (const cat of c.categories) {
          sum += bucket.get(`${vid}::${cat}`) ?? 0
        }
      }
      perContractCategorySpend.set(c.id, sum)
    }
  }

  const withDerived = contracts.map((c) => {
    // Charles W1.U-B: canonical YTD helper — matches the detail header
    // card so the list column and header can never drift.
    // Charles iMessage 2026-04-20 N13: "Make that lifetime rebates
    // earned for each contract." Many rebates earn on the last day of
    // the year; YTD underrepresents the contract. Lifetime is the
    // canonical number for list-row scoring. Detail header still has
    // its own YTD card for compliance reporting.
    const rebateEarned = sumEarnedRebatesLifetime(c.rebates ?? [], today)
    // Charles W1.R: canonical "collected" aggregate — single helper so the
    // list row, detail header card, and Transactions tab cannot drift.
    const rebateCollected = sumCollectedRebates(c.rebates ?? [])

    const periodSpend = periodSpendByContract.get(c.id) ?? 0
    const cogContractSpend = cogSpendByContract.get(c.id) ?? 0
    // Charles W1.U-A — prefer the category-scoped fallback over the
    // raw vendor-wide aggregate when the contract's terms are narrowed
    // to specific categories.
    const cogVendorSpend = c.vendorId
      ? (perContractCategorySpend.get(c.id) ??
          // #2: sum the vendor-window aggregate across the contract's full
          // vendor set so grouped contracts don't under-report spend.
          contractVendorIds(c).reduce(
            (s, vid) => s + (cogSpendByVendor.get(vid) ?? 0),
            0,
          ))
      : 0
    const currentSpend =
      periodSpend > 0
        ? periodSpend
        : cogContractSpend > 0
          ? cogContractSpend
          : cogVendorSpend

    // Charles 2026-04-26 perf pass: strip `rebates` and `terms` from
    // the per-row payload. Both are internal-only inputs to the
    // aggregations above (canonical reducers + category cascade); no
    // list-page consumer reads them off the returned shape (verified by
    // grep across components/ and hooks/). Keeping them inflated the
    // serialized payload to the client by ~the entire rebate ledger
    // per contract — visible on contracts with hundreds of rebate rows.
    const { rebates: _r, terms: _t, ...scalar } = c
    void _r
    void _t
    return { ...scalar, rebateEarned, rebateCollected, currentSpend }
  })

  // Review F11 (2026-06-10): apply the confirmed category mapping to the
  // list's Category column too — the detail page maps at read time, and the
  // list showing the superseded name one click away re-creates Charles's
  // "still showing categories I mapped away".
  const listCategoryMap = await loadConfirmedCategoryMap().catch(() => {
    return new Map<string, string>()
  })
  const mappedList =
    listCategoryMap.size === 0
      ? withDerived
      : withDerived.map((c) =>
          c.productCategory
            ? {
                ...c,
                productCategory: {
                  ...c.productCategory,
                  name: applyConfirmedCategoryMapToNames(
                    [c.productCategory.name],
                    listCategoryMap,
                  )[0],
                },
              }
            : c,
        )

  return serialize({ contracts: mappedList, total })
}

// ─── Merged List (system + vendor-submitted pending) ─────────────
//
// Returns both system Contract rows and vendor-submitted PendingContract
// rows in a single array with a typed `source` discriminator. Used by
// the facility contracts list page (contracts-list-closure §4.0).

export type MergedContract = {
  id: string // stable row id (prefixed to avoid collision across sources)
  contractId: string | null // real Contract.id when source=system, null for pending
  name: string
  source: "system" | "vendor"
  status:
    | "active"
    | "expired"
    | "expiring"
    | "pending"
    | "draft"
    | "rejected"
    | "revision_requested"
  vendor: { id: string; name: string }
  contractType: string
  facilityId: string | null
  facilities: string[]
  effectiveDate: Date | null
  expirationDate: Date | null
  totalValue: number
  score: number | null
}

/**
 * Translate a PendingContractStatus to the unified status enum
 * used by the merged list. `approved` is promoted to `active` because
 * once approved, a pending row has already become a real Contract and
 * wouldn't appear in this list anyway; we treat the edge case defensively.
 * `withdrawn` is filtered out upstream.
 */
function mapPendingStatus(
  status:
    | "draft"
    | "submitted"
    | "approved"
    | "rejected"
    | "revision_requested"
    | "withdrawn",
): MergedContract["status"] | null {
  switch (status) {
    case "submitted":
      return "pending"
    case "approved":
      return "active"
    case "rejected":
      return "rejected"
    case "revision_requested":
      return "revision_requested"
    case "draft":
      return "draft"
    case "withdrawn":
      return null // hide
  }
}

export async function getMergedContracts(options?: {
  /**
   * Optional 3-way facility filter (canonical doc §7). When set:
   * - System contracts match `facilityId == filter` OR any
   *   ContractFacility row has `facilityId == filter`.
   * - Vendor-submitted pending contracts match on `facilityId == filter`
   *   only (PendingContract has no multi-facility join yet).
   */
  facilityFilter?: string | null
}) {
  const { facility } = await requireFacility()
  const facilityFilter = options?.facilityFilter ?? null

  // Build the system-contracts where clause — base ownership + optional
  // 3-way filter narrowing.
  const systemWhere: Prisma.ContractWhereInput = {
    AND: [
      contractsOwnedByFacility(facility.id),
      ...(facilityFilter
        ? [
            {
              OR: [
                { facilityId: facilityFilter },
                { contractFacilities: { some: { facilityId: facilityFilter } } },
              ],
            },
          ]
        : []),
    ],
  }

  const pendingWhere: Prisma.PendingContractWhereInput = {
    facilityId: facilityFilter ?? facility.id,
    status: { in: ["submitted", "revision_requested", "rejected", "draft"] },
  }

  const [systemContracts, pendingContracts] = await Promise.all([
    prisma.contract.findMany({
      where: systemWhere,
      include: {
        vendor: { select: { id: true, name: true } },
        contractFacilities: { select: { facilityId: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.pendingContract.findMany({
      where: pendingWhere,
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { submittedAt: "desc" },
    }),
  ])

  const systemRows: MergedContract[] = systemContracts.map((c) => ({
    id: `system:${c.id}`,
    contractId: c.id,
    name: c.name,
    source: "system",
    status: c.status,
    vendor: { id: c.vendor.id, name: c.vendor.name },
    contractType: c.contractType,
    facilityId: c.facilityId,
    facilities: Array.from(
      new Set([
        ...(c.facilityId ? [c.facilityId] : []),
        ...c.contractFacilities.map((cf) => cf.facilityId),
      ]),
    ),
    effectiveDate: c.effectiveDate,
    expirationDate: c.expirationDate,
    totalValue: Number(c.totalValue),
    // Contract.score doesn't exist on the current schema; reserved for
    // future contracts-rewrite scoring subsystem. Always null for now.
    score: null,
  }))

  const vendorRows: MergedContract[] = pendingContracts
    .map((p): MergedContract | null => {
      const mapped = mapPendingStatus(p.status)
      if (mapped === null) return null
      return {
        id: `vendor:${p.id}`,
        contractId: null,
        name: p.contractName,
        source: "vendor",
        status: mapped,
        vendor: { id: p.vendor.id, name: p.vendor.name },
        contractType: p.contractType,
        facilityId: p.facilityId,
        facilities: p.facilityId ? [p.facilityId] : [],
        effectiveDate: p.effectiveDate,
        expirationDate: p.expirationDate,
        totalValue: Number(p.totalValue ?? 0),
        score: null,
      }
    })
    .filter((x): x is MergedContract => x !== null)

  return serialize([...systemRows, ...vendorRows])
}

// ─── Single Contract ─────────────────────────────────────────────

export async function getContract(
  id: string,
  options?: { periodId?: string },
) {
  const { facility } = await requireFacility()

  // When a periodId is provided, resolve the period's date window so we can
  // narrow the rebate aggregation (and therefore the earned/collected KPIs)
  // to rows that fall inside that window. The periodId must belong to this
  // contract — we never trust client input for cross-contract reads.
  const period = options?.periodId
    ? await prisma.contractPeriod.findFirst({
        where: { id: options.periodId, contractId: id },
        select: { periodStart: true, periodEnd: true },
      })
    : null

  const contract = await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(id, facility.id),
    include: {
      vendor: { select: { id: true, name: true, logoUrl: true, contactName: true, contactEmail: true } },
      productCategory: { select: { id: true, name: true } },
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      documents: { orderBy: { uploadDate: "desc" } },
      contractFacilities: {
        include: { facility: { select: { id: true, name: true } } },
      },
      contractCategories: {
        select: {
          productCategoryId: true,
          productCategory: { select: { id: true, name: true } },
        },
      },
      rebates: {
        where: period
          ? { payPeriodEnd: { gte: period.periodStart, lte: period.periodEnd } }
          : undefined,
        select: {
          id: true,
          rebateEarned: true,
          rebateCollected: true,
          payPeriodEnd: true,
          collectionDate: true,
        },
      },
      periods: { orderBy: { periodStart: "asc" } },
      createdBy: { select: { id: true, name: true } },
    },
  })

  // Aggregates come from explicit Rebate rows only (never tier-engine math).
  // Earned counts only periods that have actually closed (payPeriodEnd ≤ today)
  // — pre-recorded rows for upcoming periods are projections, not earned.
  // Collected counts only rows with a collectionDate set — a row with
  // rebateCollected=0 and no collectionDate is "pending collection".
  //
  // Charles R5.27: The contract detail header card shows YTD (calendar year)
  // earned rebates to disambiguate from the "Total Rebates (Lifetime)" card
  // on the Transactions tab. `rebateEarned` stays lifetime-earned (still used
  // by the collection-ratio widget on the Overview tab); `rebateEarnedYTD`
  // is the calendar-year slice surfaced in the header stat card.
  // Charles W1.U-B: canonical helpers — see lib/contracts/rebate-earned-filter.
  // `rebateEarned` is the lifetime closed-period aggregate (still used by
  // the collection-ratio widget on the Overview tab); `rebateEarnedYTD` is
  // the calendar-year slice surfaced in the header stat card. Both share
  // the `payPeriodEnd <= today` rule — the YTD variant just layers a
  // `>= Jan 1 of today's year` floor on top.
  const today = new Date()
  const rebateEarned = sumEarnedRebatesLifetime(contract.rebates, today)
  const rebateEarnedYTD = sumEarnedRebatesYTD(contract.rebates, today)
  // Charles W1.R: canonical helper — see lib/contracts/rebate-collected-filter.
  const rebateCollected = sumCollectedRebates(contract.rebates)

  // Spend resolution chain — Charles R5.28: "Current Spend" is the
  // trailing 12 calendar months of activity, NOT lifetime and NOT the
  // contract's effective window. Horizon: transactionDate (or period
  // window) between (today - 12 months) and today. All three cascade
  // tiers apply the same horizon so they're directly comparable.
  // Precedence (unchanged):
  //   1. ContractPeriod.totalSpend WHERE contractId AND periodStart >= today-12mo AND periodEnd <= today
  //   2. COGRecord.extendedPrice WHERE contractId AND transactionDate in [today-12mo, today]
  //   3. COGRecord.extendedPrice WHERE vendorId AND transactionDate in [today-12mo, today]
  //      (the contract.effectiveDate/expirationDate clamp from R5.24 is
  //      dropped — "last 12 months" is user-facing, not contract-window.
  //      A contract expired > 12 months ago will correctly read $0.)
  // No tier-engine derivation — spend is a recorded figure.
  // If a periodId was passed, constrain the ContractPeriod aggregate to
  // that window so the displayed value matches the period filter
  // (explicit period filter overrides the 12-month default).
  const { start: windowStart, end: windowEnd } = getTrailing12MonthWindow()
  // #2 (Vick 2026-05-31): the tier-3 vendor-window aggregate (and the
  // per-term fallback below) span the contract's full vendor set so the
  // detail "Current Spend (12mo)" card stays in lockstep with the list and
  // grouped contracts don't under-report.
  const detailVendorIds = contractVendorIds(contract)
  // 2026-06-09 audit (#4): the tier-3 vendor-wide fallback must apply the
  // same category narrowing the LIST applies (its W1.U-A per-contract
  // category slice) — otherwise a fully category-scoped contract with no
  // periods and no contract-stamped COG shows different spend on the two
  // surfaces. Hoisted the COG category universe fetch (also used by the
  // per-term scoped spend below) so the union clause expands to drifted
  // category variants.
  const detailCogUniverse = await facilityCogCategoryUniverse(facility.id)
  const detailUnionCategoryWhere = buildUnionCategoryWhereClause(
    (contract.terms ?? []).map((t) => ({
      appliesTo: t.appliesTo,
      categories: t.categories,
    })),
    detailCogUniverse,
  )
  const [cogAgg, cogVendorAgg, periodAgg] = await Promise.all([
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        contractId: contract.id,
        transactionDate: { gte: windowStart, lte: windowEnd },
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: { in: detailVendorIds },
        transactionDate: { gte: windowStart, lte: windowEnd },
        ...detailUnionCategoryWhere,
      },
      _sum: { extendedPrice: true },
    }),
    prisma.contractPeriod.aggregate({
      where: {
        contractId: contract.id,
        ...(period
          ? {
              periodStart: { gte: period.periodStart },
              periodEnd: { lte: period.periodEnd },
            }
          : {
              // 2026-06-09 audit (#2): match the LIST's predicate
              // (periodEnd inside the window) — the previous
              // periodStart >= windowStart additionally excluded periods
              // that STARTED before the 12-month boundary but ended
              // inside it, so a straddling period counted on the list
              // but not here. Keep both surfaces identical.
              periodEnd: { gte: windowStart, lte: windowEnd },
            }),
      },
      _sum: { totalSpend: true },
    }),
  ])
  const cogSpend = Number(cogAgg._sum.extendedPrice ?? 0)
  const cogVendorSpend = Number(cogVendorAgg._sum.extendedPrice ?? 0)
  const periodSpend = Number(periodAgg._sum.totalSpend ?? 0)
  const currentSpend =
    periodSpend > 0 ? periodSpend : cogSpend > 0 ? cogSpend : cogVendorSpend

  // Per-term scoped spend — for the Terms & Tiers display. Terms whose
  // `appliesTo === "specific_category"` should show tier progress based
  // on the spend that falls inside their category scope, not the
  // contract-wide aggregate. Terms with `appliesTo === "all_products"`
  // fall back to the contract-wide currentSpend. User-reported bug
  // 2026-04-23: the Distal Extremities Rebate term showed identical
  // projections to the Qualified Annual Spend Rebate term because both
  // were multiplying contract-wide spend by their tier rate.
  const termScopedSpend: Record<string, number> = {}
  // detailCogUniverse hoisted above the currentSpend cascade (audit #4).
  for (const t of contract.terms ?? []) {
    // bugs.rtfd 2026-06-13 ("OrthoJoints ... not being picked up with the
    // rebate"): a `lifetime` term's tier qualifies on spend accumulated over
    // the WHOLE contract, so its progress display must aggregate the full
    // contract window — not the trailing-12-month window the periodic terms
    // use. Without this a lifetime term whose yearly spend never clears the
    // threshold (but whose cumulative does) would render $0/Tier 0.
    const isLifetimeTerm =
      (t as { evaluationPeriod?: string }).evaluationPeriod === "lifetime"
    const termWindowStart = isLifetimeTerm ? contract.effectiveDate : windowStart
    const termWindowEnd = isLifetimeTerm
      ? new Date(
          Math.min(windowEnd.getTime(), contract.expirationDate.getTime()),
        )
      : windowEnd
    const catWhere = buildCategoryWhereClause(
      {
        appliesTo: t.appliesTo,
        categories: t.categories,
      },
      detailCogUniverse,
    )
    // Short-circuit: all_products (empty where) → reuse currentSpend, except
    // a lifetime all-products term still needs its cumulative window summed.
    if (Object.keys(catWhere).length === 0 && !isLifetimeTerm) {
      termScopedSpend[t.id] = currentSpend
      continue
    }
    const termAgg = await prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        OR: [
          { contractId: contract.id },
          { contractId: null, vendorId: { in: detailVendorIds } },
        ],
        matchStatus: { in: ["on_contract", "price_variance"] },
        transactionDate: { gte: termWindowStart, lte: termWindowEnd },
        ...catWhere,
      },
      _sum: { extendedPrice: true },
    })
    termScopedSpend[t.id] = Number(termAgg._sum.extendedPrice ?? 0)
  }

  // Vick 2026-05-31 bug doc ("there is not where to see in the
  // overview who the grouped vendors are"): contract.additionalVendorIds
  // is just an array of IDs; resolve to {id, name} so the detail
  // header can render the participating vendors as readable badges.
  const additionalVendors =
    contract.additionalVendorIds && contract.additionalVendorIds.length > 0
      ? await prisma.vendor.findMany({
          where: { id: { in: contract.additionalVendorIds } },
          select: { id: true, name: true, displayName: true },
        })
      : []

  // Charles 2026-06-10 ("still showing categories I mapped away" / "the
  // categories here should reflect the names of what was mapped"): apply the
  // confirmed CategoryMapping at read time so term chips, market-share rows,
  // and category badges can never display a superseded name — even when the
  // stored rows predate the mapping (the retro-rewrite in remapCOGCategory
  // only reaches rows that exist at confirm time).
  // Defensive: the mapping is a display concern — a read failure must not
  // take down the whole contract detail. Fall back to pass-through names.
  const confirmedCategoryMap = await loadConfirmedCategoryMap().catch((err) => {
    console.warn(`[getContract] loadConfirmedCategoryMap failed:`, err)
    return new Map<string, string>()
  })
  const mapName = <T extends { name: string } | null>(pc: T): T =>
    pc
      ? {
          ...pc,
          name: applyConfirmedCategoryMapToNames([pc.name], confirmedCategoryMap)[0],
        }
      : pc
  const mappedTerms = (contract.terms ?? []).map((t) => ({
    ...t,
    categories: applyConfirmedCategoryMapToNames(
      t.categories ?? [],
      confirmedCategoryMap,
    ),
  }))
  const mappedProductCategory = mapName(contract.productCategory ?? null)
  const mappedContractCategories = (contract.contractCategories ?? []).map(
    (cc) => ({
      ...cc,
      productCategory: mapName(cc.productCategory),
    }),
  )

  return serialize({
    ...contract,
    terms: mappedTerms,
    productCategory: mappedProductCategory,
    contractCategories: mappedContractCategories,
    rebateEarned,
    rebateEarnedYTD,
    rebateCollected,
    currentSpend,
    termScopedSpend,
    additionalVendors,
  })
}

// ─── Contract Stats ──────────────────────────────────────────────

/**
 * Window (in days) behind the contracts-hero "expiring soon" pill.
 *
 * Module-local const — a `"use server"` file may only export async
 * functions — and echoed back on the payload as `expiringSoonWindowDays`
 * so the badge's label ("expiring in N days") is rendered from the same
 * constant the count was filtered by.
 */
const EXPIRING_SOON_WINDOW_DAYS = 30

export async function getContractStats(
  input: { facilityScope?: FacilityScope } = {},
) {
  const { facility } = await requireFacility()
  const scope: FacilityScope = input.facilityScope ?? "this"
  // Same accessible-facility set the list query is bounded by (see
  // `getContracts`) — the hero has to describe the contract universe the
  // table below it renders, so both resolve "all" through the one canonical
  // helper rather than each deciding what "all" means.
  const accessibleFacilityIds =
    scope === "all" ? await getCallerFacilityIds() : undefined
  const where = facilityScopeClause(scope, facility.id, accessibleFacilityIds)

  // Earned counts only periods that have actually closed — pre-recorded
  // rows for upcoming periods are projections, not earned. Every number
  // below is computed over `where`, so the stats describe exactly the
  // contract universe the list query returns for the same scope.
  //
  // Charles R5.31: the KPI card on the list page is labeled "Total Rebates
  // Earned (YTD)" to match the list column and the detail header. Apply
  // the same calendar-year floor (startOfYear ≤ payPeriodEnd ≤ today).
  // The DB-side aggregation below is the Prisma equivalent of the
  // in-memory `sumEarnedRebatesYTD` helper — keep them in sync (W1.U-B).
  const today = new Date()
  const startOfYear = new Date(today.getFullYear(), 0, 1)
  const expiringCutoff = new Date(
    today.getTime() + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )

  // 2026-07-28 (same wrong-scope sweep): "Rebates Earned (YTD)" sits on the
  // same hero row as the contract counts, so it has to describe the SAME
  // contracts. Filtering the ledger by `facilityId` alone did not: under
  // scope "shared" the hero counted only multi-facility contracts while this
  // summed every rebate the facility had ever earned, single-facility
  // contracts included — money and counts, one row, two different sets.
  // Routing the ledger through the same `where` fixes that.
  //
  // The ledger keeps a `facilityId` bound at ALL times — it is never dropped,
  // only ever pointed at a bounded set. That bound is what stops a shared
  // contract's PEER-facility rebate rows landing in this facility's total.
  //
  // Its width now follows the scope, because the scope is finally bounded:
  //   "this" / "shared" → `facility.id`, the caller's own facility.
  //   "all"             → `{ in: accessibleFacilityIds }`, the SAME set the
  //                       contract counts above were computed over.
  //
  // Under "all" this is a widening from one facility to the caller's
  // accessible set, and it is only safe because that set is bounded: it comes
  // from `getCallerFacilityIds`, i.e. the caller's own HealthSystem
  // (enterprise) or their own FacilityAssignment rows (scoped). It can never
  // reach a facility the caller may not read, and `contract: where` narrows it
  // again to contracts in the same set.
  //
  // The earlier unconditional `facility.id` bound existed because "all"
  // resolved to an unbounded `{}` here: widening the ledger then would have
  // summed EVERY tenant's rebate dollars into this card. That hole is closed
  // (see `facilityScopeClause`), so money and counts can sit on one hero row
  // describing one set of facilities — which is the whole point of the row.
  const rebateWhere: Prisma.RebateWhereInput = {
    payPeriodEnd: { gte: startOfYear, lte: today },
    contract: where,
    facilityId: accessibleFacilityIds
      ? { in: accessibleFacilityIds }
      : facility.id,
  }

  // 2026-07-28 (wrong-scope bug class): `activeContracts` and
  // `expiringSoon` used to be counted CLIENT-side in
  // contracts-list-client from `getContracts`'s FIRST PAGE (pageSize 20,
  // ordered `updatedAt desc`) while `totalContracts` came from a real DB
  // count over the whole scope. A facility with 45 contracts therefore
  // read "45 Total / 20 Active" on one hero row, and "expiring soon"
  // silently depended on which contracts had been edited most recently.
  // All four hero numbers now come from this one action, over this one
  // `where`, in one round trip.
  //
  // `groupBy(['status'])` supplies BOTH the total and the active bucket —
  // `totalContracts` is the sum of its buckets — so the two numbers sat
  // side by side on the hero literally cannot be computed over different
  // row sets. `expiringSoon` needs a date predicate the grouping can't
  // express, so it's one extra scoped `count` (not one count per status).
  const [statusGroups, expiringSoon, aggregates, rebateResult] =
    await Promise.all([
      prisma.contract.groupBy({
        by: ["status"],
        _count: true,
        where,
      }),
      prisma.contract.count({
        where: {
          AND: [
            where,
            {
              status: { not: "expired" },
              expirationDate: { gt: today, lte: expiringCutoff },
            },
          ],
        },
      }),
      prisma.contract.aggregate({
        where,
        _sum: { totalValue: true, annualValue: true },
      }),
      prisma.rebate.aggregate({
        where: rebateWhere,
        _sum: { rebateEarned: true },
      }),
    ])

  let totalContracts = 0
  let activeContracts = 0
  for (const group of statusGroups ?? []) {
    const bucket = typeof group._count === "number" ? group._count : 0
    totalContracts += bucket
    if (group.status === "active") activeContracts += bucket
  }

  return serialize({
    totalContracts,
    activeContracts,
    expiringSoon,
    expiringSoonWindowDays: EXPIRING_SOON_WINDOW_DAYS,
    totalValue: Number(aggregates._sum.totalValue ?? 0),
    totalRebates: Number(rebateResult._sum?.rebateEarned ?? 0),
  })
}

// ─── Per-row Metrics Batch — REMOVED (Charles W1.X-D) ────────────
//
// `getContractMetricsBatch` used to compute per-row spend + rebate for
// the contracts list via Prisma-side aggregates that were "kept in sync"
// with the canonical in-memory reducers. In practice the two paths
// drifted (Charles iMessage 2026-04-20): the list column accessor's
// `?? metricsRebate` / `?? metricsSpend` fallback shadowed the
// canonical value whenever the batch path differed.
//
// The single source for list-row metrics is now `getContracts`, which
// computes `rebateEarned` (YTD), `rebateCollected` (lifetime), and
// `currentSpend` (trailing 12mo) via the canonical helpers
// `sumEarnedRebatesYTD`, `sumCollectedRebates`, and the trailing-12mo
// cascade. See
// `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`
// for the CI drift guard that enforces list vs detail parity.

// ─── Create Contract ─────────────────────────────────────────────

export async function createContract(
  input: CreateContractInput & { terms?: TermFormValues[] },
) {
  try {
    return await _createContractImpl(input)
  } catch (err) {
    console.error("[createContract]", err, {
      name: input.name,
      vendorId: input.vendorId,
      contractType: input.contractType,
      termCount: Array.isArray(input.terms) ? input.terms.length : 0,
    })
    // Bug #9 — surface the real reason instead of letting Next.js redact
    // the server-action error to "An error occurred in the Server
    // Components render." The client toast pattern in
    // `useCreateContract.onError` uses `error.message`, so a sanitized
    // explanatory message has to arrive ON the Error itself.
    throw new Error(humanizeCreateContractError(err))
  }
}

/**
 * Error-as-value variant of createContract for production resilience.
 *
 * Vick 2026-05-30: in production Next.js 16 builds, Errors thrown
 * from Server Actions are stripped — the client only sees a generic
 * "An error occurred in the Server Components render." digest. Even
 * a thoughtfully-humanized `throw new Error(...)` is discarded for
 * security. This wrapper RETURNS the error as a serializable value
 * instead, which crosses the action boundary intact.
 *
 * Use this from React Query mutations; throw from the mutationFn
 * if `!result.ok` so the rest of the React Query API (onError,
 * isError) keeps working.
 */
export async function createContractSafe(
  input: CreateContractInput & { terms?: TermFormValues[] },
): Promise<
  | { ok: true; contract: Awaited<ReturnType<typeof _createContractImpl>> }
  | { ok: false; error: string; code?: string }
> {
  try {
    const contract = await _createContractImpl(input)
    return { ok: true, contract }
  } catch (err) {
    console.error("[createContractSafe]", err, {
      name: input.name,
      vendorId: input.vendorId,
      contractType: input.contractType,
      termCount: Array.isArray(input.terms) ? input.terms.length : 0,
    })
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : undefined
    return { ok: false, error: humanizeCreateContractError(err), code }
  }
}

function humanizeCreateContractError(err: unknown): string {
  // Zod validation: include the path + first issue.
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues?: Array<{ path: unknown[]; message: string }> })
      .issues
    if (Array.isArray(issues) && issues.length > 0) {
      const first = issues[0]
      const path = Array.isArray(first.path) ? first.path.join(".") : "(root)"
      return `Contract validation failed at ${path}: ${first.message}`
    }
  }
  // Prisma known errors: keep the code so we can map common ones.
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code?: unknown }).code ?? "")
    const meta = (err as { meta?: { target?: unknown; field_name?: unknown } })
      .meta
    if (code === "P2002") {
      const target = Array.isArray(meta?.target)
        ? meta!.target.join(", ")
        : String(meta?.target ?? "")
      return `Contract creation failed: a row with the same ${target || "unique key"} already exists.`
    }
    if (code === "P2003") {
      const field = String(meta?.field_name ?? "")
      return `Contract creation failed: foreign-key violation${field ? ` on ${field}` : ""}. The referenced row likely no longer exists or was never created (vendor / category / facility).`
    }
    if (code === "P2025") {
      return "Contract creation failed: a referenced row (vendor / category / facility) does not exist."
    }
  }
  if (err instanceof Error) {
    return `Contract creation failed: ${err.message}`
  }
  return "Contract creation failed (unknown error). Check the server logs for the full stack."
}

async function _createContractImpl(
  input: CreateContractInput & { terms?: TermFormValues[] },
) {
  const session = await requireFacility()
  await requireCanMutate()
  const data = createContractSchema.parse(input)
  // Terms travel alongside the validated contract payload rather than as
  // part of it — embedding them in createContractSchema makes react-hook-form's
  // zodResolver unhappy because termFormSchema defaults force the infer'd
  // type to diverge from the input type. We validate them separately below.
  const dataTerms: TermFormValues[] = Array.isArray(input.terms)
    ? input.terms.map((t) => termFormSchemaWithTierCheck.parse(t))
    : []

  // bugs.rtfd 2026-06-11 B1 — dedupe window for create-contract. Both
  // dedupe layers (in-memory idempotency TTL below + the DB soft-dedupe
  // lookback) were 30s, but the post-create pricing-file import runs
  // under a 120s transaction timeout (lib/actions/pricing-files.ts), so
  // a second click mid-import landed OUTSIDE both windows and wrote a
  // duplicate contract. 180s = 120s import ceiling + margin. Local
  // (non-exported) const — "use server" files may only export async fns.
  const CREATE_DEDUPE_WINDOW_MS = 180_000

  // Charles W1.W-E1 — idempotency. When the client supplies a key we
  // hold a CREATE_DEDUPE_WINDOW_MS cache of (key → created contract).
  // A second call within the window (double-click, network retry, HMR
  // race, re-click during the post-create pricing import) returns the
  // original contract instead of writing a duplicate row. Scope the
  // cache by user+facility so two users can't collide.
  type CachedContract = Awaited<ReturnType<typeof prisma.contract.create>>
  const idempotencyScope = `create-contract:${session.user.id}:${session.facility.id}`
  if (data.idempotencyKey) {
    const cached = idempotencyGet<CachedContract>(
      idempotencyScope,
      data.idempotencyKey,
    )
    if (cached) return cached
  }

  // Charles W1.Y-B — DB-level soft-dedupe. The in-memory idempotency
  // map above covers fast double-clicks inside one form session, but
  // misses (a) TTL-expired re-submits, (b) submit paths that forgot to
  // thread an idempotency key through, and (c) multi-instance deploys
  // where the cache is process-local. Before writing, look for a
  // contract with the same business key `(facility, vendor, name,
  // effectiveDate)` created within CREATE_DEDUPE_WINDOW_MS; if one
  // exists, return it instead of writing a duplicate row. The business
  // key is specific enough (same vendor + exact name + exact effective
  // date) that a user genuinely creating two near-identical contracts
  // inside the window still succeeds by varying the name.
  const recentDup = await prisma.contract.findFirst({
    where: {
      facilityId: session.facility.id,
      vendorId: data.vendorId,
      name: data.name,
      effectiveDate: new Date(data.effectiveDate),
      createdAt: { gte: new Date(Date.now() - CREATE_DEDUPE_WINDOW_MS) },
    },
  })
  if (recentDup) {
    const replay = serialize(recentDup)
    if (data.idempotencyKey) {
      idempotencyPut(
        idempotencyScope,
        data.idempotencyKey,
        replay,
        CREATE_DEDUPE_WINDOW_MS,
      )
    }
    return replay
  }

  // Charles 2026-04-24 (Bug 10): wrap contract + terms + tiers +
  // ContractTermProduct + additional facilities in a single interactive
  // transaction so term #N failing mid-loop (e.g. a bad tier row) rolls
  // back the whole contract instead of leaving a half-saved header with
  // some-but-not-all terms. Pre-resolve scoped category IDs → names
  // BEFORE opening the transaction so we don't hold it open on a
  // read-only lookup. Post-write rebate-accrual + COG match recomputes
  // stay outside the tx — they're idempotent best-effort and shouldn't
  // block the write from committing.
  const resolvedCategoryNamesByTerm = new Map<number, string[]>()
  for (let i = 0; i < dataTerms.length; i++) {
    const ids = dataTerms[i].scopedCategoryIds
    if (ids && ids.length > 0) {
      resolvedCategoryNamesByTerm.set(i, await resolveCategoryIdsToNames(ids))
    }
  }

  const contract = await prisma.$transaction(async (tx) => {
    const created = await tx.contract.create({
    data: {
      name: data.name,
      contractNumber: data.contractNumber,
      vendorId: data.vendorId,
      facilityId: session.facility.id,
      productCategoryId: data.productCategoryId,
      contractType: data.contractType,
      status: data.status,
      effectiveDate: new Date(data.effectiveDate),
      // Empty string → evergreen sentinel. Prisma Contract.expirationDate
      // is NOT NULL (prisma/schema.prisma line 601), so we write the
      // sentinel 9999-12-31 instead of null. `formatDate` renders it as
      // "Evergreen"; `lib/contracts/match.ts:156` treats any date past
      // the COG transaction as in-window, so every future row matches.
      expirationDate: data.expirationDate
        ? new Date(data.expirationDate)
        : new Date(Date.UTC(9999, 11, 31)),
      autoRenewal: data.autoRenewal,
      terminationNoticeDays: data.terminationNoticeDays,
      totalValue: data.totalValue,
      annualValue: data.annualValue,
      description: data.description,
      notes: data.notes,
      gpoAffiliation: data.gpoAffiliation,
      performancePeriod: data.performancePeriod,
      rebatePayPeriod: data.rebatePayPeriod,
      isMultiFacility: data.isMultiFacility,
      isGrouped: data.isGrouped ?? false,
      additionalVendorIds: data.additionalVendorIds ?? [],
      tieInCapitalContractId: data.tieInCapitalContractId,
      // Charles audit suggestion #4 (v0-port): legacy capital fields
      // removed — capital lives in ContractCapitalLineItem rows now.
      // amortizationShape is the only contract-level capital field
      // that survives.
      ...(data.amortizationShape != null && {
        amortizationShape: data.amortizationShape,
      }),
      // Charles 2026-04-25 (audit follow-up): persist contract-level
      // metrics that drive compliance + market-share rebate accruals.
      ...(data.complianceRate != null && { complianceRate: data.complianceRate }),
      ...(data.currentMarketShare != null && {
        currentMarketShare: data.currentMarketShare,
      }),
      ...(data.marketShareCommitment != null && {
        marketShareCommitment: data.marketShareCommitment,
      }),
      ...(data.marketShareCommitmentByCategory !== undefined && {
        // null clears (Prisma's `Prisma.JsonNull` sentinel); array
        // value passes through as InputJsonValue.
        marketShareCommitmentByCategory:
          data.marketShareCommitmentByCategory === null
            ? Prisma.JsonNull
            : (data.marketShareCommitmentByCategory as Prisma.InputJsonValue),
      }),
      createdById: session.user.id,
      ...(data.facilityIds.length > 0 && {
        isMultiFacility: true,
        contractFacilities: {
          create: data.facilityIds.map((fId) => ({ facilityId: fId })),
        },
      }),
      ...(data.categoryIds.length > 0 && {
        contractCategories: {
          create: data.categoryIds.map((cId) => ({ productCategoryId: cId })),
        },
      }),
    },
  })

  // Charles — atomic term+tier persistence. Terms used to be written
  // by a client-side loop calling `createContractTerm` after `createContract`
  // returned; a stale Next.js server-action hash (or any network blip)
  // between the two round-trips would leave the contract with no terms.
  // Users then saw a contract they had to "Edit" to re-save terms. By
  // writing terms inside this same server action, the only failure mode
  // is "nothing saved, error surfaced to client" — never half-saved.
  if (dataTerms.length > 0) {
    for (let termIdx = 0; termIdx < dataTerms.length; termIdx++) {
      const formTerm = dataTerms[termIdx]
      const {
        tiers,
        scopedItemNumbers,
        scopedCategoryId: _scopedCategoryId,
        scopedCategoryIds,
        customAmortizationRows: _customAmortizationRows,
        capitalCost: _termCapitalCost,
        interestRate: _termInterestRate,
        termMonths: _termMonths,
        downPayment: _termDownPayment,
        paymentCadence: _termPaymentCadence,
        amortizationShape: _termAmortizationShape,
        id: _termId,
        ...termData
      } = formTerm
      void _scopedCategoryId
      void _customAmortizationRows
      void _termCapitalCost
      void _termInterestRate
      void _termMonths
      void _termDownPayment
      void _termPaymentCadence
      void _termAmortizationShape
      void _termId

      // Empty effectiveEnd → same evergreen sentinel the parent contract
      // uses. Required because terms nested in the create payload from the
      // AI-extract path inherit the parent contract's effective window;
      // when AI returns null expirationDate (evergreen), the form passes
      // "" through, and `new Date("")` is Invalid Date → Prisma rejects.
      const EVERGREEN = new Date(Date.UTC(9999, 11, 31))
      const resolvedCategoryNames = resolvedCategoryNamesByTerm.get(termIdx)
      const termCreateData: Prisma.ContractTermCreateInput = {
        ...termData,
        effectiveStart: termData.effectiveStart
          ? new Date(termData.effectiveStart)
          : new Date(Date.UTC(1970, 0, 1)),
        effectiveEnd: termData.effectiveEnd
          ? new Date(termData.effectiveEnd)
          : EVERGREEN,
        contract: { connect: { id: created.id } },
        ...(resolvedCategoryNames && resolvedCategoryNames.length > 0 && {
          categories: resolvedCategoryNames,
        }),
        ...(tiers.length > 0 && {
          tiers: {
            create: tiers.map((tier) => ({
              tierNumber: tier.tierNumber,
              spendMin: tier.spendMin,
              spendMax: tier.spendMax,
              volumeMin: tier.volumeMin,
              volumeMax: tier.volumeMax,
              marketShareMin: tier.marketShareMin,
              marketShareMax: tier.marketShareMax,
              rebateType: tier.rebateType,
              rebateValue: tier.rebateValue,
            })),
          },
        }),
      }
      const createdTerm = await tx.contractTerm.create({
        data: termCreateData,
      })

      const normalizedScopedItemNumbers =
        normalizeScopedItemNumbers(scopedItemNumbers)
      if (normalizedScopedItemNumbers.length > 0) {
        await tx.contractTermProduct.createMany({
          data: normalizedScopedItemNumbers.map((vendorItemNo) => ({
            termId: createdTerm.id,
            vendorItemNo,
          })),
          skipDuplicates: true,
        })
      }
    }
  }

  // Persist additional facilities selected via the multi-facility picker.
  // Uses the ContractFacility join table with skipDuplicates so repeat
  // saves (or overlap with data.facilityIds above) don't violate the
  // (contractId, facilityId) unique index.
  if (data.additionalFacilityIds?.length) {
    await tx.contractFacility.createMany({
      data: data.additionalFacilityIds.map((fid) => ({
        contractId: created.id,
        facilityId: fid,
      })),
      skipDuplicates: true,
    })
  }

    return created
  })

  // Keep auto-accrual rebate rows in sync — idempotent best-effort after
  // the transaction commits, so a recompute failure doesn't roll back
  // the saved contract (the user can re-trigger via "Recompute").
  if (dataTerms.length > 0) {
    try {
      await recomputeAccrualForContract(contract.id)
    } catch (err) {
      console.warn(
        `[createContract] recomputeAccrualForContract(${contract.id}) failed:`,
        err,
      )
    }
  }

  await logAudit({
    userId: session.user.id,
    action: "contract.created",
    entityType: "contract",
    entityId: contract.id,
    metadata: { name: data.name, vendorId: data.vendorId },
  })

  // Recompute COG match-statuses for this vendor so rows flip to
  // on_contract / price_variance / out_of_scope as appropriate.
  //
  // W2.A.1 H-B: fan out across every facility the contract touches —
  // {contract.facilityId} ∪ data.facilityIds ∪ data.additionalFacilityIds.
  // Previously we only recomputed for `session.facility.id`, which left
  // COG rows at peer facilities on a multi-facility contract stuck at
  // matchStatus=pending. De-dupe via Set so the same pair can't be
  // recomputed twice in one CRUD.
  {
    const facilityIds = new Set<string>()
    if (contract.facilityId) facilityIds.add(contract.facilityId)
    for (const fId of data.facilityIds) facilityIds.add(fId)
    for (const fId of data.additionalFacilityIds ?? []) facilityIds.add(fId)
    // #2 (Vick 2026-05-31): recompute match statuses for EVERY participating
    // vendor of a grouped contract — not just the primary. Otherwise the
    // group's secondary-vendor COG never gets re-matched (the matcher now
    // attributes it, but only if its vendor is in the recompute scope), so
    // group spend + carve-out stay empty after a save.
    const vendorIds = new Set<string>([data.vendorId])
    for (const v of data.additionalVendorIds ?? []) vendorIds.add(v)
    for (const facilityId of facilityIds) {
      for (const vendorId of vendorIds) {
        await recomputeMatchStatusesForVendor(prisma, { vendorId, facilityId })
        // 2026-06-07 (Vick "every time a contract is created these should
        // auto run"): refresh the persisted derived metrics
        // (complianceRate, currentMarketShare, annualValue) right after the
        // match recompute — same fan-out as bulkImportCOGRecords. Before this,
        // a contract created AFTER its COG was imported showed no
        // matches/market-share until the user manually edited+saved or hit
        // "Recompute Earned Rebates". Best-effort: a metrics-refresh failure
        // must never roll back or surface from the create (mirrors the
        // rebate-accrual / case-supply recompute pattern below).
        try {
          await refreshContractMetricsForVendor({ vendorId, facilityId })
        } catch (err) {
          console.warn(
            `[createContract] refreshContractMetricsForVendor(${vendorId}, ${facilityId}) failed:`,
            err,
          )
        }
      }
      // Charles 2026-04-25 (Bug 27 part 2): keep CaseSupply.isOnContract
      // in sync with the contract catalog so Case Costing's "Avg
      // On-Contract %" reflects newly-added/removed contracts.
      // Best-effort — a recompute failure logs but doesn't block the
      // create from succeeding (matches the rebate-accrual recompute
      // pattern).
      try {
        await recomputeCaseSupplyContractStatus(prisma, facilityId)
      } catch (err) {
        console.warn(
          `[createContract] recomputeCaseSupplyContractStatus(${facilityId}) failed:`,
          err,
        )
      }
    }
  }

  // Contract health-score feature removed 2026-04-23 (Bug 15) — the
  // A-F rollup was unclear in provenance ("what is this score based on?
  // not sure we need that") so the whole subsystem was ripped out.

  revalidatePath("/dashboard/cog")
  revalidatePath("/dashboard/contracts")
  revalidatePath("/dashboard")
  // New contract → invalidate facility-scoped analytics so spend
  // concentration / admin time savings counts pick up the row.
  if (contract.facilityId) {
    await invalidateFacilityAnalytics(contract.facilityId)
  }
  await invalidateContractAnalytics(contract.id)

  const result = serialize(contract)

  // Charles W1.W-E1 — cache the serialized result under the client's
  // idempotency key so a concurrent double-submit returns this contract
  // rather than writing another row. TTL extended to the B1 dedupe
  // window so the cache outlives the post-create pricing import.
  if (data.idempotencyKey) {
    idempotencyPut(
      idempotencyScope,
      data.idempotencyKey,
      result,
      CREATE_DEDUPE_WINDOW_MS,
    )
  }

  return result
}

// ─── Update Contract ─────────────────────────────────────────────

export async function updateContract(id: string, input: UpdateContractInput) {
  try {
    return await _updateContractImpl(id, input)
  } catch (err) {
    // Per CLAUDE.md "AI-action error path" — every server action that can
    // throw should `console.error` with enough breadcrumbs to debug in
    // production logs, because the client only sees a redacted digest
    // ("An error occurred in the Server Components render"). Without
    // this, a Save-failed toast is unactionable — which is exactly the
    // scenario the user hit on 2026-04-23 while editing a tie-in.
    console.error("[updateContract]", err, { contractId: id })
    throw err
  }
}

async function _updateContractImpl(
  id: string,
  input: UpdateContractInput,
) {
  const session = await requireFacility()
  const { facility } = session
  await requireCanMutate()
  const data = updateContractSchema.parse(input)

  // Verify ownership before updating
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(id, facility.id),
    select: { id: true },
  })

  const updateData: Prisma.ContractUpdateInput = {}

  if (data.name !== undefined) updateData.name = data.name
  if (data.contractNumber !== undefined) updateData.contractNumber = data.contractNumber
  if (data.vendorId !== undefined) updateData.vendor = { connect: { id: data.vendorId } }
  if (data.productCategoryId !== undefined) updateData.productCategory = { connect: { id: data.productCategoryId } }
  if (data.contractType !== undefined) updateData.contractType = data.contractType
  if (data.status !== undefined) updateData.status = data.status
  if (data.effectiveDate !== undefined) updateData.effectiveDate = new Date(data.effectiveDate)
  if (data.expirationDate !== undefined)
    updateData.expirationDate = data.expirationDate
      ? new Date(data.expirationDate)
      : new Date(Date.UTC(9999, 11, 31))
  if (data.autoRenewal !== undefined) updateData.autoRenewal = data.autoRenewal
  if (data.terminationNoticeDays !== undefined) updateData.terminationNoticeDays = data.terminationNoticeDays
  if (data.totalValue !== undefined) updateData.totalValue = data.totalValue
  if (data.annualValue !== undefined) updateData.annualValue = data.annualValue
  if (data.description !== undefined) updateData.description = data.description
  if (data.notes !== undefined) updateData.notes = data.notes
  if (data.gpoAffiliation !== undefined) updateData.gpoAffiliation = data.gpoAffiliation
  if (data.performancePeriod !== undefined) updateData.performancePeriod = data.performancePeriod
  if (data.rebatePayPeriod !== undefined) updateData.rebatePayPeriod = data.rebatePayPeriod
  if (data.isMultiFacility !== undefined) updateData.isMultiFacility = data.isMultiFacility
  if (data.isGrouped !== undefined) updateData.isGrouped = data.isGrouped
  if (data.additionalVendorIds !== undefined)
    updateData.additionalVendorIds = data.additionalVendorIds

  // Charles audit suggestion #4 (v0-port): legacy contract-level
  // capital fields removed — capital lives in ContractCapitalLineItem
  // rows now, managed via lib/actions/contracts/capital-line-items.ts.
  // amortizationShape is the only contract-level capital field that
  // survives.
  if (data.amortizationShape !== undefined)
    updateData.amortizationShape = data.amortizationShape
  // Charles 2026-04-25 (audit follow-up): contract-level metrics for
  // compliance + market-share rebate engines. Use undefined-vs-null
  // discipline so the form can explicitly clear a value (set to null)
  // without confusing it with "field not in payload" (undefined).
  if (data.complianceRate !== undefined)
    updateData.complianceRate = data.complianceRate
  if (data.currentMarketShare !== undefined)
    updateData.currentMarketShare = data.currentMarketShare
  if (data.marketShareCommitment !== undefined)
    updateData.marketShareCommitment = data.marketShareCommitment
  if (data.marketShareCommitmentByCategory !== undefined)
    updateData.marketShareCommitmentByCategory =
      data.marketShareCommitmentByCategory === null
        ? Prisma.JsonNull
        : (data.marketShareCommitmentByCategory as Prisma.InputJsonValue)

  if (data.facilityIds !== undefined) {
    await prisma.contractFacility.deleteMany({ where: { contractId: id } })
    if (data.facilityIds.length > 0) {
      updateData.isMultiFacility = true
      await prisma.contractFacility.createMany({
        data: data.facilityIds.map((fId) => ({ contractId: id, facilityId: fId })),
      })
    }
  }

  // Charles W1.Y-A — `additionalFacilityIds` is the companion array for
  // the FacilityMultiSelect picker (contract-form.tsx:790-795). On CREATE
  // these land in the ContractFacility join table (line 703 in this
  // file) with skipDuplicates. On UPDATE the handler was missing
  // entirely, so any facility the user added to a multi-facility
  // contract via that picker silently reverted to the "beginning" on
  // reload. Mirror the create path: run after the facilityIds rewrite
  // above so skipDuplicates protects against a facility appearing in
  // both arrays (the unique index on (contractId, facilityId) would
  // otherwise throw).
  if (data.additionalFacilityIds?.length) {
    await prisma.contractFacility.createMany({
      data: data.additionalFacilityIds.map((fid) => ({
        contractId: id,
        facilityId: fid,
      })),
      skipDuplicates: true,
    })
  }

  if (data.categoryIds !== undefined) {
    await prisma.contractProductCategory.deleteMany({ where: { contractId: id } })
    if (data.categoryIds.length > 0) {
      updateData.productCategory = { connect: { id: data.categoryIds[0] } }
      await prisma.contractProductCategory.createMany({
        data: data.categoryIds.map((cId) => ({ contractId: id, productCategoryId: cId })),
      })
    }
  }

  const contract = await prisma.contract.update({
    where: { id },
    data: updateData,
  })

  // Charles W1.T — persist (or clear) ContractAmortizationSchedule rows
  // when the shape field is in the payload. Symmetrical clears the
  // table so the read path falls back to the live PMT compute; custom
  // replaces every row with the caller-supplied amortizationDue values,
  // rebuilding opening/interest/principal/closing from the running
  // opening balance.
  if (data.amortizationShape === "symmetrical") {
    await prisma.contractAmortizationSchedule.deleteMany({
      where: { contractId: id },
    })
  }
  // Charles audit suggestion #4 (v0-port): customAmortizationRows
  // payload is no longer accepted on updateContract — per-asset
  // payment schedules now live on ContractCapitalLineItem rows
  // (paymentType="variable"). The custom-shape persisted rows are
  // either pre-existing legacy data (read-only) or built by the
  // per-item engine downstream.

  await logAudit({
    userId: session.user.id,
    action: "contract.updated",
    entityType: "contract",
    entityId: id,
    metadata: { updatedFields: Object.keys(updateData) },
  })

  // Recompute COG match-statuses for this contract's vendor. If the vendor
  // changed, recompute for both the old and new vendor so COG rows flip
  // off the old contract and onto (or off of) the new one.
  //
  // W2.A.1 H-B: fan out across every facility the contract touches —
  // {contract.facilityId} ∪ contractFacilities[].facilityId — not just
  // the acting session's facility. Without this, COG at peer facilities
  // in a multi-facility contract stayed pending after an edit.
  const vendorsToRecompute = new Set<string>()
  vendorsToRecompute.add(contract.vendorId)
  if (data.vendorId !== undefined && data.vendorId !== contract.vendorId) {
    vendorsToRecompute.add(data.vendorId)
  }
  // #2 (Vick 2026-05-31): grouped contracts — recompute every participating
  // vendor (old set so removed members get cleared, new set so added members
  // get matched). Without this, editing a group contract leaves the
  // additional vendors' COG at its stale match status → no group spend.
  for (const v of contract.additionalVendorIds ?? []) vendorsToRecompute.add(v)
  for (const v of data.additionalVendorIds ?? []) vendorsToRecompute.add(v)

  // Re-read the contract with its facility join so the recompute set
  // reflects the post-update multi-facility membership (data.facilityIds
  // may have just replaced the whole join table).
  const contractWithFacilities = await prisma.contract.findUnique({
    where: { id },
    select: {
      facilityId: true,
      contractFacilities: { select: { facilityId: true } },
    },
  })
  const facilityIds = new Set<string>()
  if (contractWithFacilities?.facilityId) {
    facilityIds.add(contractWithFacilities.facilityId)
  }
  for (const cf of contractWithFacilities?.contractFacilities ?? []) {
    facilityIds.add(cf.facilityId)
  }
  // Fall back to the session facility if the contract somehow has no
  // facility linkage (shouldn't happen, but keep the old behavior as a
  // safety net rather than skipping recompute entirely).
  if (facilityIds.size === 0) facilityIds.add(facility.id)

  for (const vendorId of vendorsToRecompute) {
    for (const facilityId of facilityIds) {
      await recomputeMatchStatusesForVendor(prisma, {
        vendorId,
        facilityId,
      })
    }
  }

  // Charles 2026-04-25 (Bug 27 part 2): same case-supply recompute as
  // createContract — done once per facility (not per vendor) since the
  // case-supply join doesn't filter by vendor.
  for (const facilityId of facilityIds) {
    try {
      await recomputeCaseSupplyContractStatus(prisma, facilityId)
    } catch (err) {
      console.warn(
        `[updateContract] recomputeCaseSupplyContractStatus(${facilityId}) failed:`,
        err,
      )
    }
  }

  // Contract health-score feature removed 2026-04-23 (Bug 15).
  revalidatePath("/dashboard/cog")
  revalidatePath("/dashboard/contracts")
  revalidatePath(`/dashboard/contracts/${id}`)
  revalidatePath("/dashboard")
  await invalidateContractAnalytics(id)
  if (contract.facilityId) {
    await invalidateFacilityAnalytics(contract.facilityId)
  }

  return serialize(contract)
}

// ─── Create Contract Document ───────────────────────────────────

export async function createContractDocument(input: {
  contractId: string
  name: string
  type?: string
  url?: string
}) {
  // Charles audit round-7 BLOCKER: verify the contract belongs to
  // this facility before attaching a document. Pre-fix any facility
  // user could attach a document to any other facility's contract
  // (deleteContractDocument already verified — pattern was right
  // there to copy).
  const { facility } = await requireFacility()
  await requireCanMutate()
  // Storage keys only — a stored absolute URL would become a navigation
  // target on the Documents tab (planted-phishing vector).
  if (input.url && /^[a-z][a-z0-9+.-]*:/i.test(input.url)) {
    throw new Error("Document url must be a storage key, not a URL")
  }
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(input.contractId, facility.id),
    select: { id: true },
  })
  return prisma.contractDocument.create({
    data: {
      contractId: input.contractId,
      name: input.name,
      type: (input.type as any) ?? "main",
      url: input.url,
    },
  })
}

/**
 * Error-as-value variant of createContractDocument — returns the failure
 * reason as a serializable value so it survives Next.js 16's production
 * Server Action error redaction. See lib/actions/safe-result.ts.
 */
export async function createContractDocumentSafe(input: {
  contractId: string
  name: string
  type?: string
  url?: string
}): Promise<SafeResult<Awaited<ReturnType<typeof createContractDocument>>>> {
  return toSafeResult(
    "createContractDocument",
    { contractId: input.contractId, name: input.name },
    () => createContractDocument(input),
  )
}

// ─── Delete Contract Document ───────────────────────────────────

export async function deleteContractDocument(id: string) {
  const session = await requireFacility()
  const { facility } = session
  await requireCanMutate()

  // Verify the document belongs to a contract owned by this facility.
  // auth-scope-scanner-skip: read-only identity probe; the ownership decision is
  // the explicit `owned` comparison below, which throws before the delete.
  const doc = await prisma.contractDocument.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      contractId: true,
      contract: {
        select: {
          facilityId: true,
          contractFacilities: { select: { facilityId: true } },
        },
      },
    },
  })
  const owned =
    doc.contract.facilityId === facility.id ||
    doc.contract.contractFacilities.some((cf) => cf.facilityId === facility.id)
  if (!owned) {
    throw new Error("Not authorized to delete this document")
  }

  // auth-scope-scanner-skip: unreachable unless the `owned` check above passed,
  // which proves the document's contract belongs to this facility.
  await prisma.contractDocument.delete({ where: { id } })

  await logAudit({
    userId: session.user.id,
    action: "contract_document.deleted",
    entityType: "contractDocument",
    entityId: id,
    metadata: { contractId: doc.contractId },
  })
}

// ─── Delete Contract ─────────────────────────────────────────────

export async function deleteContract(id: string) {
  const session = await requireFacility()
  const { facility } = session
  await requireCanMutate()

  // Verify ownership + capture vendorId AND the full facility set before
  // deleting so we can recompute COG match-statuses everywhere the
  // contract used to cover (W2.A.1 H-B).
  const existing = await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(id, facility.id),
    select: {
      id: true,
      vendorId: true,
      facilityId: true,
      contractFacilities: { select: { facilityId: true } },
    },
  })

  await prisma.contract.delete({ where: { id } })

  await logAudit({
    userId: session.user.id,
    action: "contract.deleted",
    entityType: "contract",
    entityId: id,
  })

  // Recompute: rows that were on this contract flip to
  // off_contract_item / out_of_scope depending on remaining contracts.
  //
  // W2.A.1 H-B: fan out across every facility the deleted contract
  // touched, not just the acting session's facility. Otherwise COG at
  // peer facilities keeps its stale on_contract linkage.
  const facilityIds = new Set<string>()
  if (existing.facilityId) facilityIds.add(existing.facilityId)
  for (const cf of existing.contractFacilities) facilityIds.add(cf.facilityId)
  if (facilityIds.size === 0) facilityIds.add(facility.id)
  for (const facilityId of facilityIds) {
    await recomputeMatchStatusesForVendor(prisma, {
      vendorId: existing.vendorId,
      facilityId,
    })
  }
  revalidatePath("/dashboard/cog")
  revalidatePath("/dashboard/contracts")
  revalidatePath("/dashboard")
  await invalidateContractAnalytics(id)
  if (existing.facilityId) {
    await invalidateFacilityAnalytics(existing.facilityId)
  }
}

// ─── Compute-heavy actions (split to lib/actions/contracts/*) ───────
//
// These are split into per-action files during subsystem F5 tech debt.
// Next.js disallows non-async-function re-exports from "use server"
// modules, so callers must import them directly from the sub-file:
//   import { getContractInsights } from "@/lib/actions/contracts/insights"
//   import { getAccrualTimeline } from "@/lib/actions/contracts/accrual"
//   import { getContractMarginAnalysis } from "@/lib/actions/contracts/margin"
//   import { getContractTieInBundle } from "@/lib/actions/contracts/tie-in"
