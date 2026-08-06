"use server"

// Split from lib/actions/contracts.ts (subsystem F5 decomposition,
// 2026-08-05). Next.js disallows non-async-function re-exports from
// "use server" modules, so there is no barrel at the old path — import
// each contract action directly from its file under lib/actions/contracts/.

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  contractFiltersSchema,
  type ContractFilters,
} from "@/lib/validators/contracts"
import { Prisma } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"
import {
  facilityScopeClause,
  type FacilityScope,
} from "@/lib/actions/contracts-auth"
import { getCallerFacilityIds } from "@/lib/actions/facility-assignment"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { buildUnionCategoryWhereClause } from "@/lib/contracts/cog-category-filter"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"
import {
  applyConfirmedCategoryMapToNames,
  loadConfirmedCategoryMap,
} from "@/lib/categories/resolve"
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
