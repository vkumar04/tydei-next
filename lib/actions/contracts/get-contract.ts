"use server"

// Split from lib/actions/contracts.ts (subsystem F5 decomposition,
// 2026-08-05). No barrel at the old path — Next.js disallows
// non-async-function re-exports from "use server" modules.

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
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
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { getTrailing12MonthWindow } from "@/lib/dates/trailing-window"

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
