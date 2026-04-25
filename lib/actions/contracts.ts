"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  contractFiltersSchema,
  createContractSchema,
  updateContractSchema,
  type ContractFilters,
  type CreateContractInput,
  type UpdateContractInput,
} from "@/lib/validators/contracts"
import type { Prisma } from "@prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import { idempotencyGet, idempotencyPut } from "@/lib/idempotency"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { recomputeAccrualForContract } from "@/lib/actions/contracts/recompute-accrual"
import { recomputeCaseSupplyContractStatus } from "@/lib/case-costing/recompute-supply"
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
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import {
  sumEarnedRebatesLifetime,
  sumEarnedRebatesYTD,
} from "@/lib/contracts/rebate-earned-filter"
import { buildUnionCategoryWhereClause, buildCategoryWhereClause } from "@/lib/contracts/cog-category-filter"
import { resolveCategoryIdsToNames } from "@/lib/contracts/resolve-category-names"

// ─── List Contracts ──────────────────────────────────────────────

export async function getContracts(input: ContractFilters) {
  const { facility } = await requireFacility()
  const filters = contractFiltersSchema.parse(input)

  const scope: FacilityScope = filters.facilityScope ?? "this"
  const facilityClause = facilityScopeClause(scope, facility.id)

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
        terms: {
          select: { appliesTo: true, categories: true, tiers: { select: { id: true } } },
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
  // Charles R5.31: earned is scoped to the current calendar year (YTD) so
  // the list column matches the detail header's "Rebates Earned (YTD)"
  // card (added in R5.27). Must stay in lockstep with the `rebateEarnedYTD`
  // computation in `getContract` above. Charles W1.U-B: routed through
  // the canonical `sumEarnedRebatesYTD` helper so the list column, detail
  // header card, and Transactions tab cannot drift apart.
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
  const windowEnd = today
  const windowStart = new Date(today)
  windowStart.setFullYear(windowStart.getFullYear() - 1)
  const contractIds = contracts.map((c) => c.id)
  const vendorIds = Array.from(
    new Set(
      contracts
        .map((c) => c.vendorId)
        .filter((v): v is string => Boolean(v)),
    ),
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
              facilityId: facility.id,
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
                  facilityId: facility.id,
                  vendorId: { in: vendorIds },
                  transactionDate: { gte: windowStart, lte: windowEnd },
                },
                _sum: { extendedPrice: true },
              }),
        ])

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
  // One extra batched aggregate per category-scoped contract — only
  // when the outer `contract_id`-tier returned $0.
  const perContractCategorySpend = new Map<string, number>()
  await Promise.all(
    contracts.map(async (c) => {
      if (!c.vendorId) return
      const termScopes = (c.terms ?? []).map((t) => ({
        appliesTo: t.appliesTo,
        categories: t.categories,
      }))
      const unionWhere = buildUnionCategoryWhereClause(termScopes)
      if (!unionWhere.category) return
      const agg = await prisma.cOGRecord.aggregate({
        where: {
          facilityId: facility.id,
          vendorId: c.vendorId,
          transactionDate: { gte: windowStart, lte: windowEnd },
          ...unionWhere,
        },
        _sum: { extendedPrice: true },
      })
      perContractCategorySpend.set(
        c.id,
        Number(agg._sum?.extendedPrice ?? 0),
      )
    }),
  )

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
          cogSpendByVendor.get(c.vendorId) ??
          0)
      : 0
    const currentSpend =
      periodSpend > 0
        ? periodSpend
        : cogContractSpend > 0
          ? cogContractSpend
          : cogVendorSpend

    return { ...c, rebateEarned, rebateCollected, currentSpend }
  })

  return serialize({ contracts: withDerived, total })
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
  const windowEnd = new Date()
  const windowStart = new Date(windowEnd)
  windowStart.setFullYear(windowStart.getFullYear() - 1)
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
        vendorId: contract.vendorId,
        transactionDate: { gte: windowStart, lte: windowEnd },
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
              periodStart: { gte: windowStart },
              periodEnd: { lte: windowEnd },
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
  for (const t of contract.terms ?? []) {
    const catWhere = buildCategoryWhereClause({
      appliesTo: t.appliesTo,
      categories: t.categories,
    })
    // Short-circuit: all_products (empty where) → reuse currentSpend.
    if (Object.keys(catWhere).length === 0) {
      termScopedSpend[t.id] = currentSpend
      continue
    }
    const termAgg = await prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        OR: [
          { contractId: contract.id },
          { contractId: null, vendorId: contract.vendorId },
        ],
        matchStatus: { in: ["on_contract", "price_variance"] },
        transactionDate: { gte: windowStart, lte: windowEnd },
        ...catWhere,
      },
      _sum: { extendedPrice: true },
    })
    termScopedSpend[t.id] = Number(termAgg._sum.extendedPrice ?? 0)
  }

  return serialize({
    ...contract,
    rebateEarned,
    rebateEarnedYTD,
    rebateCollected,
    currentSpend,
    termScopedSpend,
  })
}

// ─── Contract Stats ──────────────────────────────────────────────

export async function getContractStats(
  input: { facilityScope?: FacilityScope } = {},
) {
  const { facility } = await requireFacility()
  const scope: FacilityScope = input.facilityScope ?? "this"
  const where = facilityScopeClause(scope, facility.id)

  const [totalContracts, aggregates] = await Promise.all([
    prisma.contract.count({ where }),
    prisma.contract.aggregate({
      where,
      _sum: { totalValue: true, annualValue: true },
    }),
  ])

  // Earned counts only periods that have actually closed — pre-recorded
  // rows for upcoming periods are projections, not earned. When scope is
  // "all" we drop the facility filter so the stats reflect the same
  // contract universe that the list query returns.
  //
  // Charles R5.31: the KPI card on the list page is labeled "Total Rebates
  // Earned (YTD)" to match the list column and the detail header. Apply
  // the same calendar-year floor (startOfYear ≤ payPeriodEnd ≤ today).
  // The DB-side aggregation below is the Prisma equivalent of the
  // in-memory `sumEarnedRebatesYTD` helper — keep them in sync (W1.U-B).
  const today = new Date()
  const startOfYear = new Date(today.getFullYear(), 0, 1)
  const rebateResult = await prisma.rebate.aggregate({
    where:
      scope === "all"
        ? { payPeriodEnd: { gte: startOfYear, lte: today } }
        : {
            facilityId: facility.id,
            payPeriodEnd: { gte: startOfYear, lte: today },
          },
    _sum: { rebateEarned: true },
  })

  return serialize({
    totalContracts,
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
    throw err
  }
}

async function _createContractImpl(
  input: CreateContractInput & { terms?: TermFormValues[] },
) {
  const session = await requireFacility()
  const data = createContractSchema.parse(input)
  // Terms travel alongside the validated contract payload rather than as
  // part of it — embedding them in createContractSchema makes react-hook-form's
  // zodResolver unhappy because termFormSchema defaults force the infer'd
  // type to diverge from the input type. We validate them separately below.
  const dataTerms: TermFormValues[] = Array.isArray(input.terms)
    ? input.terms.map((t) => termFormSchemaWithTierCheck.parse(t))
    : []

  // Charles W1.W-E1 — idempotency. When the client supplies a key we
  // hold a 30s cache of (key → created contract). A second call within
  // the window (double-click, network retry, HMR race) returns the
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
  // effectiveDate)` created in the last 30s; if one exists, return it
  // instead of writing a duplicate row. The 30s window is short enough
  // that a user genuinely creating two near-identical contracts a
  // minute apart still succeeds.
  const recentDup = await prisma.contract.findFirst({
    where: {
      facilityId: session.facility.id,
      vendorId: data.vendorId,
      name: data.name,
      effectiveDate: new Date(data.effectiveDate),
      createdAt: { gte: new Date(Date.now() - 30_000) },
    },
  })
  if (recentDup) {
    const replay = serialize(recentDup)
    if (data.idempotencyKey) {
      idempotencyPut(idempotencyScope, data.idempotencyKey, replay)
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
      tieInCapitalContractId: data.tieInCapitalContractId,
      // Charles W1.T — tie-in capital lives on Contract now.
      ...(data.capitalCost != null && { capitalCost: data.capitalCost }),
      ...(data.interestRate != null && { interestRate: data.interestRate }),
      ...(data.termMonths != null && { termMonths: data.termMonths }),
      ...(data.downPayment != null && { downPayment: data.downPayment }),
      ...(data.paymentCadence != null && { paymentCadence: data.paymentCadence }),
      ...(data.amortizationShape != null && {
        amortizationShape: data.amortizationShape,
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

      if (scopedItemNumbers && scopedItemNumbers.length > 0) {
        await tx.contractTermProduct.createMany({
          data: scopedItemNumbers.map((vendorItemNo) => ({
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
    for (const facilityId of facilityIds) {
      await recomputeMatchStatusesForVendor(prisma, {
        vendorId: data.vendorId,
        facilityId,
      })
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

  const result = serialize(contract)

  // Charles W1.W-E1 — cache the serialized result under the client's
  // idempotency key so a concurrent double-submit returns this contract
  // rather than writing another row.
  if (data.idempotencyKey) {
    idempotencyPut(idempotencyScope, data.idempotencyKey, result)
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

  // Charles W1.T — tie-in capital fields on the Contract row. Pass
  // through nullable values (explicitly setting to null clears the
  // capital; undefined leaves it alone).
  if (data.capitalCost !== undefined) updateData.capitalCost = data.capitalCost
  if (data.interestRate !== undefined) updateData.interestRate = data.interestRate
  if (data.termMonths !== undefined) updateData.termMonths = data.termMonths
  if (data.downPayment !== undefined) updateData.downPayment = data.downPayment
  if (data.paymentCadence !== undefined) updateData.paymentCadence = data.paymentCadence
  if (data.amortizationShape !== undefined)
    updateData.amortizationShape = data.amortizationShape

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
  } else if (
    data.amortizationShape === "custom" &&
    data.customAmortizationRows &&
    data.customAmortizationRows.length > 0
  ) {
    const capitalCost = Number(data.capitalCost ?? contract.capitalCost ?? 0)
    const downPayment = Number(data.downPayment ?? contract.downPayment ?? 0)
    const interestRate = Number(
      data.interestRate ?? contract.interestRate ?? 0,
    )
    const cadence =
      data.paymentCadence ?? contract.paymentCadence ?? "monthly"
    const periodsPerYear =
      cadence === "annual" ? 1 : cadence === "quarterly" ? 4 : 12
    const r = interestRate / periodsPerYear

    const sorted = [...data.customAmortizationRows].sort(
      (a, b) => a.periodNumber - b.periodNumber,
    )
    const effectivePrincipal = Math.max(0, capitalCost - downPayment)
    let opening = effectivePrincipal
    const rows = sorted.map((row) => {
      const interestCharge = opening * r
      const amortizationDue = row.amortizationDue
      const principalDue = amortizationDue - interestCharge
      const closingBalance = opening - principalDue
      const built = {
        contractId: id,
        periodNumber: row.periodNumber,
        openingBalance: opening,
        interestCharge,
        principalDue,
        amortizationDue,
        closingBalance,
      }
      opening = closingBalance
      return built
    })
    await prisma.contractAmortizationSchedule.deleteMany({
      where: { contractId: id },
    })
    if (rows.length > 0) {
      await prisma.contractAmortizationSchedule.createMany({ data: rows })
    }
  }

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

  return serialize(contract)
}

// ─── Create Contract Document ───────────────────────────────────

export async function createContractDocument(input: {
  contractId: string
  name: string
  type?: string
  url?: string
}) {
  await requireFacility()
  return prisma.contractDocument.create({
    data: {
      contractId: input.contractId,
      name: input.name,
      type: (input.type as any) ?? "main",
      url: input.url,
    },
  })
}

// ─── Delete Contract Document ───────────────────────────────────

export async function deleteContractDocument(id: string) {
  const session = await requireFacility()
  const { facility } = session

  // Verify the document belongs to a contract owned by this facility
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
