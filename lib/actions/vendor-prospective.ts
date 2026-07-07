"use server"

import { prisma } from "@/lib/db"
import { getTrailing12MonthWindow } from "@/lib/dates/trailing-window"
import type { Prisma } from "@/lib/generated/prisma/client"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"
import { onlyProspectiveProposalRows } from "@/lib/prospective/proposal-rows"
import { dealConstructSchema } from "@/lib/prospective/deal-construct-schema"
import {
  callerVendorDivisionIds,
  divisionScopeWhere,
} from "@/lib/actions/division-auth"
import {
  divisionCategoryKeySet,
  categoryInDivisionScope,
} from "@/lib/divisions/category-scope"
import {
  buildCptRateSchedule,
  resolveCaseReimbursement,
} from "@/lib/case-costing/cpt-rate-map"
import { expandCategoriesToCogVariants } from "@/lib/contracts/cog-category-filter"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"
import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import {
  dealAssumptionsSchema,
  fractionToWholePct,
  type DealAssumptions,
} from "@/lib/prospective/deal-assumptions"
import {
  analyzeVendorProspective,
  type BenchmarkDataPoint,
  type CapitalDealDetails,
  type VendorContractVariant,
  type VendorFacilityType,
  type VendorPricingScenario,
  type VendorProspectiveInput,
  type VendorProspectiveResult,
} from "@/lib/prospective-analysis/vendor-prospective-analyzer"
import {
  computeDealScore,
  dealScoreComponentsSchema,
  type DealScoreBreakdown,
} from "@/lib/prospective-analysis/deal-score"
import { z } from "zod"

// ─── Input shape ───────────────────────────────────────────────

/** A Deal-Scorer construct as persisted onto the proposal for the handoff. */
export interface PersistedDealConstruct {
  benchmarkId: string | null
  productName: string
  /** Per-construct category (benchmark Category column / proposal category /
   *  vendor-typed) — additive, optional (Charles 2026-07-06). */
  category?: string
  current: number
  floor: number
  target: number
  ask: number
  annualVolume: number
  rebatePercent: number
}


/**
 * Caller-supplied portion of a vendor prospective analysis request.
 *
 * We accept the user-entered scenario inputs (price/volume/rebate per
 * scenario), the target margin floors, and an optional capital block
 * + an optional reference to a stored proposal draft from
 * `createProposal`. The action backfills facility metadata and pulls
 * benchmarks scoped to the calling vendor.
 */
export interface VendorProspectiveAnalysisInput {
  facilityId: string
  contractVariant: VendorContractVariant
  pricingScenarios: VendorPricingScenario[]
  /** Decimal targets, e.g. 0.40 = 40%. */
  targetGrossMarginPercent: number
  minimumAcceptableGrossMarginPercent: number
  /** Vendor's true unit COGS ($/unit), entered on the form. When omitted
   *  the analyzer falls back to the 55% gross-margin assumption + warns. */
  internalUnitCost?: number
  facilityEstimatedAnnualSpend?: number
  facilityCurrentVendorShare?: number
  /**
   * The facility's CURRENT annual revenue/spend on these products, summed
   * directly from the uploaded usage + current-price files
   * (Σ currentPrice × volume). When provided it is authoritative — penetration
   * uses it as `currentAnnualRevenue` instead of `spend × share` (Vick
   * 2026-06-25 "current revenue should come from the usage file").
   */
  facilityCurrentVendorRevenue?: number
  /**
   * When set, the facility-spend backfill (the vendor-COG-at-facility
   * aggregate) is scoped to this category — matched canonically via
   * `expandCategoriesToCogVariants`, never a raw `in` (CLAUDE.md invariant).
   */
  estimatedSpendCategory?: string
  /**
   * Multi-category spend (Charles 2026-07-05 "should be able to enter more
   * than one category spend"): one row per category. When present, the
   * effective facility estimated spend is the Σ of entered spends, and the
   * backfill's category scope covers every listed category.
   * `estimatedSpendCategory` stays as the single-category back-compat path.
   */
  estimatedCategorySpends?: { category: string; spend: number | null }[]
  targetVendorShare?: number
  capitalDetails?: CapitalDealDetails
  /**
   * The per-construct deal as entered in the Deal Scorer (one row per product:
   * Current/Floor/Target/Ask prices, volume, rebate). Not used by the analyzer
   * (it scores the blended `pricingScenarios`); persisted onto the proposal's
   * `pricingData` so a scored proposal can be pushed into the Opportunity Engine.
   */
  constructs?: PersistedDealConstruct[]
  /** Σ(current × volume) across constructs — what the facility pays today. */
  currentAnnualSpend?: number
  /**
   * Optional draft-proposal id from `createProposal` (a draft
   * `PendingContract` row — see lib/prospective/proposal-rows.ts).
   * When provided and owned by the calling vendor:
   *   - the proposal's pricing items / product categories seed the
   *     benchmark lookup, and
   *   - the analyzer's overall score is persisted onto the row's
   *     `pricingData.dealScore` so the proposals list can display it
   *     (2026-06-10 audit H2 — dealScore was permanently null before).
   */
  proposalRowId?: string
}

/**
 * What `getVendorProspectiveAnalysis` returns: the pure analyzer result
 * plus the weighted deal-quality score (Wave-3 F). `dealScore.overall`
 * keeps the 0–100 scale + the 80/65/40 recommendation thresholds
 * (`recommendationForScore` in lib/actions/prospective.ts); the
 * `components` legend lets the UI explain what moves the score.
 */
export interface VendorProspectiveAnalysisResult
  extends VendorProspectiveResult {
  dealScore: DealScoreBreakdown
}

// ─── Vendor↔facility relationship scope (audit M5) ─────────────

/**
 * Facilities a vendor has a real relationship with: a contract
 * (including grouped membership via `additionalVendorIds`), COG sales
 * history, or a submitted/draft PendingContract. Used by both the
 * prospective page's facility list and the analysis action's facility
 * lookup so a vendor can't enumerate or analyze arbitrary facilities.
 */
function vendorRelatedFacilityWhere(
  vendorId: string,
): Prisma.FacilityWhereInput {
  return {
    OR: [
      {
        contracts: {
          some: {
            OR: [
              { vendorId },
              { additionalVendorIds: { has: vendorId } },
            ],
          },
        },
      },
      { cogRecords: { some: { vendorId } } },
      { pendingContracts: { some: { vendorId } } },
    ],
  }
}

/**
 * Active facilities related to the calling vendor (contract incl.
 * grouped `additionalVendorIds` membership, COG history, or
 * PendingContract). Returns an empty list — and the page renders an
 * honest empty state — when the vendor has no relationships yet.
 */
export async function getVendorRelatedFacilities(): Promise<
  { id: string; name: string }[]
> {
  const { vendor } = await requireVendor()
  const facilities = await prisma.facility.findMany({
    where: { status: "active", ...vendorRelatedFacilityWhere(vendor.id) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  return serialize(facilities)
}

// ─── Per-facility Current State (vendor pitch view) ────────────

/**
 * The facility-Analysis "Current State" measurable seeds, for ONE facility
 * the calling vendor is pitching (Vick 2026-06-22: "these numbers are
 * relevant for each facility a vendor is pitching"). Mirrors the measurable
 * inputs of `getFacilityAnalysisData` (total supply spend + case volume +
 * reimbursement coverage) so the vendor surface can run the SAME
 * `computeFacilityProspectiveModel` (EBITDA / DCF) for the target facility.
 *
 * Deliberately OMITS the category / vendor breakdown the facility-side action
 * returns — the vendor sees only the top-line state of the prize, not the
 * facility's competitive supplier mix.
 *
 * IDOR-safe: scoped through `vendorRelatedFacilityWhere`, so a vendor can
 * only pull a facility it actually has a relationship with.
 *
 * MODE-GATED: these are the facility's numbers, so they flow only over an
 * accepted `two_way` Connection (same gate as `getFacilityActualsForVendor`);
 * a one-way vendor gets the explicit zeroed `mode: "one_way"` variant.
 */
export interface VendorFacilityCurrentState {
  facilityId: string
  facilityName: string
  /**
   * Connection-mode gate (mirrors `getFacilityActualsForVendor` — the one
   * mode gate): facility actuals flow ONLY over an accepted `two_way`
   * Connection row. `one_way` = every facility-derived figure below is
   * zeroed and the panel renders the manual/assumption path.
   * `Vendor.defaultMode` never substitutes for the real Connection row.
   */
  mode: "one_way" | "two_way"
  /**
   * TOTAL facility supply spend across ALL vendors, trailing 12 months (the
   * addressable prize) — facility-side data, NOT the caller's own sales.
   * Zero in `one_way` mode.
   */
  currentVendorSpend: number
  /** Case count annualized over the years the case data spans (all-time ÷ span). */
  annualCaseVolume: number
  /** Summed case-costing reimbursement (the "Actuals" revenue figure). */
  measuredReimbursement: number
  reimbursementCoverage: { withRate: number; totalCases: number }
  hasData: boolean
}

export async function getFacilityCurrentStateForVendor(
  facilityId: string,
): Promise<VendorFacilityCurrentState> {
  const { vendor } = await requireVendor()

  const facility = await prisma.facility.findFirst({
    where: { id: facilityId, ...vendorRelatedFacilityWhere(vendor.id) },
    select: { id: true, name: true },
  })
  if (!facility) {
    throw new Error(
      "Facility not found or not related to your organization",
    )
  }

  // The two-way gate — identical to `getFacilityActualsForVendor`'s: the
  // facility's supply spend / case volume / reimbursement are FACILITY-side
  // data and flow only over an accepted `mode: "two_way"` Connection row
  // (Charles 2026-06-30: "it says '1 way' so it should not be pulling
  // anything from the other side"). No connection, pending/declined, or
  // `one_way` → an explicit zeroed one_way variant, with NO facility reads.
  const connection = await prisma.connection.findFirst({
    where: {
      facilityId,
      vendorId: vendor.id,
      status: "accepted",
      mode: "two_way",
    },
    select: { id: true },
  })
  if (!connection) {
    return serialize({
      facilityId: facility.id,
      facilityName: facility.name,
      mode: "one_way" as const,
      currentVendorSpend: 0,
      annualCaseVolume: 0,
      measuredReimbursement: 0,
      reimbursementCoverage: { withRate: 0, totalCases: 0 },
      hasData: false,
    })
  }

  const { start, end } = getTrailing12MonthWindow()
  const [cogRows, cases, payorContracts] = await Promise.all([
    prisma.cOGRecord.findMany({
      where: { facilityId, transactionDate: { gte: start, lte: end } },
      select: { extendedPrice: true },
    }),
    prisma.case.findMany({
      where: { facilityId },
      select: {
        totalReimbursement: true,
        primaryCptCode: true,
        dateOfSurgery: true,
        procedures: { select: { cptCode: true } },
      },
    }),
    prisma.payorContract.findMany({
      where: { facilityId, status: "active" },
      select: { cptRates: true },
    }),
  ])

  let totalSpend = 0
  for (const r of cogRows) totalSpend += Number(r.extendedPrice ?? 0)

  // Annualize the case count: all Case rows are counted (no date window —
  // prod demo cases cluster in one past month, so a trailing-12mo window
  // would zero it), divided by the years the data spans. Data spanning ≤1
  // year divides by 1, so the count is unchanged.
  let minSurgeryMs = Number.POSITIVE_INFINITY
  let maxSurgeryMs = Number.NEGATIVE_INFINITY
  const cptRateSchedule = buildCptRateSchedule(payorContracts)
  let measuredReimbursement = 0
  let casesWithRate = 0
  for (const c of cases) {
    const t = c.dateOfSurgery.getTime()
    if (t < minSurgeryMs) minSurgeryMs = t
    if (t > maxSurgeryMs) maxSurgeryMs = t
    const v = resolveCaseReimbursement(
      {
        storedReimbursement: Number(c.totalReimbursement),
        primaryCptCode: c.primaryCptCode,
        procedureCptCodes: c.procedures.map((p) => p.cptCode),
      },
      cptRateSchedule,
      c.dateOfSurgery,
    )
    measuredReimbursement += v
    if (v > 0) casesWithRate += 1
  }

  const spanYears =
    cases.length > 0
      ? Math.max(1, (maxSurgeryMs - minSurgeryMs) / (365.25 * 86_400_000))
      : 1

  return serialize({
    facilityId: facility.id,
    facilityName: facility.name,
    mode: "two_way" as const,
    currentVendorSpend: totalSpend,
    annualCaseVolume: Math.round(cases.length / spanYears),
    measuredReimbursement,
    reimbursementCoverage: { withRate: casesWithRate, totalCases: cases.length },
    hasData: cogRows.length > 0,
  })
}

// ─── Two-way sync auto-pull (Wave-2 E) ─────────────────────────

/** One SKU's trailing-12mo facility actuals for this vendor. */
export interface FacilityActualsItem {
  /** `normalizeSku` key of the REQUESTED item number — callers match their
   *  own side with `normalizeSku(itemNumber)` (SKU-class rule: never raw
   *  `===`). */
  sku: string
  /** Trailing-12mo spend ÷ quantity (rows with qty ≤ 0 are excluded). */
  avgUnitPrice: number
  /** Trailing-12mo purchased quantity (estimated annual qty). */
  annualQty: number
}

/**
 * Discriminated on `mode`: `one_way` is deliberately bare — the UI keeps
 * manual entry / uploads and shows the "Manual mode (one-way)" badge.
 */
export type FacilityActualsForVendor =
  | { mode: "one_way" }
  | {
      mode: "two_way"
      items: FacilityActualsItem[]
      /** Vendor spend ÷ facility spend in the vendor's categories, as a
       *  WHOLE percent (0–100, rounded 0.1) — UI-state units. Null when no
       *  denominator exists. */
      currentSharePct: number | null
      /** The share denominator: trailing-12mo facility spend (all vendors)
       *  within the vendor's canonical categories — seeds the Deal Scorer's
       *  "Facility estimated annual category spend". */
      categorySpend: number | null
    }

/**
 * Facility actuals for the Deal Scorer's two-way sync (Vick's item 4):
 * when the vendor has an ACCEPTED `two_way` connection with the facility,
 * return per-SKU trailing-12mo actuals (avg unit price + annual qty) from
 * the facility's COGRecord rows for THIS vendor, plus the vendor's current
 * category market share and the category-spend denominator. Anything else —
 * no connection, pending/declined, or `one_way` — returns `{mode:"one_way"}`
 * and the UI stays manual.
 *
 * THE one mode gate in the codebase: data flows ONLY over a real
 * `status: "accepted"`, `mode: "two_way"` Connection row. (The facility-side
 * `vendorContractsVisibleToFacility` gate was removed as dead code
 * 2026-07-03 — it was never enforced anywhere; re-derive from this where
 * clause if facility-side gating is ever wanted.)
 * `Vendor.defaultMode` never substitutes — it is the STANDALONE vendor's
 * own operating mode (own contracts + own VendorCogRecord COGs), not a
 * facility-data grant, so a vendor with `defaultMode: "two_way"` but no
 * Connection row still gets `one_way` here — exactly like the contract-flow
 * gate, which also requires the actual accepted two-way row.
 *
 * Tenant/IDOR: the facility must pass `vendorRelatedFacilityWhere` (throws
 * otherwise), and every COG read is scoped `{facilityId, vendorId}` except
 * the share denominator, which aggregates the facility's own category
 * totals — a market-share denominator, same disclosure surface as
 * `computeCategoryMarketShare` on the vendor dashboard. Division-restricted
 * callers only see rows in their divisions' categories
 * (`divisionCategoryKeySet`, like the sibling benchmark read).
 *
 * Share math mirrors `getVendorCOGPatterns` post-#129 (bug-bash E-C3): the
 * denominator is facility spend in the VENDOR'S categories (canonicalized
 * via `canonicalizeCategoryName`, never raw `===`); vendors with only
 * uncategorized rows fall back to total facility spend.
 */
export async function getFacilityActualsForVendor(
  facilityId: string,
  itemNumbers: string[],
): Promise<FacilityActualsForVendor> {
  const { vendor, user } = await requireVendor()

  const facility = await prisma.facility.findFirst({
    where: { id: facilityId, ...vendorRelatedFacilityWhere(vendor.id) },
    select: { id: true },
  })
  if (!facility) {
    throw new Error("Facility not found or not related to your organization")
  }

  // The two-way gate — presence of an accepted two_way connection row.
  const connection = await prisma.connection.findFirst({
    where: {
      facilityId,
      vendorId: vendor.id,
      status: "accepted",
      mode: "two_way",
    },
    select: { id: true },
  })
  if (!connection) return { mode: "one_way" }

  const divisionIds = await callerVendorDivisionIds(user.id, vendor.id)
  const divisionCategoryKeys = await divisionCategoryKeySet(divisionIds)

  const wanted = new Set(
    itemNumbers.map((s) => normalizeSku(s)).filter((s) => s.length > 0),
  )
  const { start, end } = getTrailing12MonthWindow()

  const [vendorRows, facilityCategoryGroups] = await Promise.all([
    prisma.cOGRecord.findMany({
      where: {
        facilityId,
        vendorId: vendor.id,
        transactionDate: { gte: start, lte: end },
      },
      select: {
        vendorItemNo: true,
        extendedPrice: true,
        quantity: true,
        category: true,
      },
    }),
    prisma.cOGRecord.groupBy({
      by: ["category"],
      where: { facilityId, transactionDate: { gte: start, lte: end } },
      _sum: { extendedPrice: true },
    }),
  ])

  // Division isolation by category (COGRecord has no division column) —
  // same predicate the benchmark read uses.
  const scopedRows = vendorRows.filter((r) =>
    categoryInDivisionScope(r.category, divisionCategoryKeys),
  )

  let vendorSpend = 0
  const vendorCategories = new Set<string>()
  const bySku = new Map<string, { spend: number; qty: number }>()
  for (const r of scopedRows) {
    const spend = Number(r.extendedPrice ?? 0)
    vendorSpend += spend
    const canon = canonicalizeCategoryName(r.category ?? "")
    if (canon !== "") vendorCategories.add(canon)
    const key = normalizeSku(r.vendorItemNo)
    if (!key || !wanted.has(key)) continue
    const cur = bySku.get(key) ?? { spend: 0, qty: 0 }
    cur.spend += spend
    cur.qty += r.quantity ?? 0
    bySku.set(key, cur)
  }

  const items: FacilityActualsItem[] = [...bySku.entries()]
    .filter(([, v]) => v.qty > 0)
    .map(([sku, v]) => ({
      sku,
      avgUnitPrice: v.spend / v.qty,
      annualQty: v.qty,
    }))

  // Denominator (E-C3 mirror): facility spend in the vendor's canonical
  // categories; uncategorized-only vendors fall back to total facility spend.
  let categorySpend: number | null = null
  if (scopedRows.length > 0) {
    categorySpend = facilityCategoryGroups
      .filter(
        (g) =>
          vendorCategories.size === 0 ||
          vendorCategories.has(canonicalizeCategoryName(g.category ?? "")),
      )
      .reduce((s, g) => s + Number(g._sum?.extendedPrice ?? 0), 0)
    if (!(categorySpend > 0)) categorySpend = null
  }

  const currentSharePct =
    categorySpend != null
      ? Math.round((vendorSpend / categorySpend) * 1000) / 10
      : null

  const result: FacilityActualsForVendor = {
    mode: "two_way",
    items,
    currentSharePct,
    categorySpend,
  }
  return serialize(result)
}

// ─── Action ────────────────────────────────────────────────────

export async function getVendorProspectiveAnalysis(
  input: VendorProspectiveAnalysisInput,
): Promise<VendorProspectiveAnalysisResult> {
  const { vendor, user } = await requireVendor()
  await requireCanMutate()
  // Division isolation: a restricted member can only attach a score to a
  // proposal in their own divisions, and only sees benchmark rows in their
  // divisions' categories.
  const divisionIds = await callerVendorDivisionIds(user.id, vendor.id)
  const divisionScope = await divisionScopeWhere(divisionIds)
  const divisionCategoryKeys = await divisionCategoryKeySet(divisionIds)

  try {
    return await runAnalysis(vendor, input, divisionScope, divisionCategoryKeys)
  } catch (err) {
    // AI-action error-path convention (CLAUDE.md): log the underlying
    // exception server-side, surface a named user-facing message.
    console.error("[getVendorProspectiveAnalysis]", err, {
      vendorId: vendor.id,
      facilityId: input.facilityId,
    })
    const reason = err instanceof Error ? err.message : "unknown error"
    if (reason.startsWith("Deal analysis failed:")) throw err
    throw new Error(`Deal analysis failed: ${reason}`)
  }
}

async function runAnalysis(
  vendor: { id: string },
  input: VendorProspectiveAnalysisInput,
  divisionScope: { vendorDivisionId?: { in: string[] } } = {},
  divisionCategoryKeys: Set<string> | null = null,
): Promise<VendorProspectiveAnalysisResult> {
  // Audit M5: scope the facility lookup to vendor-related facilities,
  // and fail with a clear message instead of a bare findUniqueOrThrow
  // digest (audit L11).
  const facility = await prisma.facility.findFirst({
    where: {
      id: input.facilityId,
      ...vendorRelatedFacilityWhere(vendor.id),
    },
    select: { id: true, name: true, type: true },
  })
  if (!facility) {
    throw new Error(
      "Deal analysis failed: Facility not found or not related to your organization",
    )
  }

  // Optional draft-proposal row (audit H2). Loaded up front so its
  // pricing items / categories can seed the benchmark lookup.
  const proposalRow = input.proposalRowId
    ? await prisma.pendingContract.findFirst({
        where: {
          id: input.proposalRowId,
          vendorId: vendor.id,
          ...onlyProspectiveProposalRows(),
          ...divisionScope,
        },
        select: { id: true, pricingData: true },
      })
    : null

  const proposalMeta = (proposalRow?.pricingData ?? {}) as Record<
    string,
    unknown
  >
  const proposalItemNos = Array.isArray(proposalMeta.pricingItems)
    ? (proposalMeta.pricingItems as { vendorItemNo?: unknown }[])
        .map((p) => p.vendorItemNo)
        .filter((n): n is string => typeof n === "string" && n.length > 0)
    : []
  const proposalCategories = Array.isArray(proposalMeta.productCategories)
    ? (proposalMeta.productCategories as unknown[]).filter(
        (c): c is string => typeof c === "string" && c.length > 0,
      )
    : []

  // Pull UPLOADED benchmarks only (Vick 2026-06-22 "Benchmark should only come
  // from uploaded files") — the vendor's own rows (vendorId = vendor.id), NOT
  // the seeded/national rows (vendorId = null). Audit M8: when a proposal
  // supplies items/categories, filter to matching rows instead of grabbing an
  // arbitrary first page; always order deterministically and cap the read.
  const scopeFilter: Prisma.ProductBenchmarkWhereInput[] = []
  if (proposalItemNos.length > 0)
    scopeFilter.push({ vendorItemNo: { in: proposalItemNos } })
  if (proposalCategories.length > 0)
    scopeFilter.push({ category: { in: proposalCategories } })

  const benchmarkRows = await prisma.productBenchmark.findMany({
    where: {
      vendorId: vendor.id,
      ...(scopeFilter.length > 0 ? { AND: [{ OR: scopeFilter }] } : {}),
    },
    select: {
      vendorItemNo: true,
      category: true,
      nationalAvgPrice: true,
    },
    orderBy: { vendorItemNo: "asc" },
    take: 200,
  })

  const benchmarks: BenchmarkDataPoint[] = benchmarkRows
    // Division isolation by category (ProductBenchmark has no division column).
    .filter((b) => categoryInDivisionScope(b.category, divisionCategoryKeys))
    .map((b) => ({
    vendorItemNo: b.vendorItemNo,
    category: b.category,
    nationalAvgPrice: b.nationalAvgPrice ? Number(b.nationalAvgPrice) : null,
    // ProductBenchmark has no internal-vendor-cost column today;
    // analyzer falls back to the 55% gross-margin assumption.
    internalListPrice: null,
    internalUnitCost: null,
  }))

  // Estimate the facility's annual category spend from COG when the
  // caller didn't supply it. The trailing-12mo extendedPrice for this
  // vendor at this facility is the only vendor-portal-visible signal —
  // but it is the VENDOR'S OWN sales, not the facility's total category
  // spend (audit H3). So when we backfill:
  //   - the vendor sales figure is passed as `facilityCurrentVendorRevenue`
  //     (the analyzer uses it directly for revenue-at-risk/penetration);
  //   - the facility TOTAL is derived as vendorSpend / currentShare when
  //     a share was supplied (share > 0), else the vendor spend stands in
  //     for the total and we attach an explicit warning.
  // Multi-category rows: their Σ is the effective estimate when the single
  // field wasn't sent (the client sums too — this keeps the API correct on
  // its own).
  const categoryRowSum = (input.estimatedCategorySpends ?? []).reduce(
    (acc, r) => acc + (r.spend ?? 0),
    0,
  )
  let facilityEstimatedAnnualSpend =
    input.facilityEstimatedAnnualSpend ??
    (categoryRowSum > 0 ? categoryRowSum : undefined)
  // An explicit usage-derived current revenue (Σ currentPrice × volume from the
  // uploaded usage + price files) is authoritative — it wins over the
  // share-derived fallback below (Vick 2026-06-25).
  let facilityCurrentVendorRevenue: number | undefined =
    input.facilityCurrentVendorRevenue != null && input.facilityCurrentVendorRevenue > 0
      ? input.facilityCurrentVendorRevenue
      : undefined
  let backfillWarning: string | null = null
  if (facilityEstimatedAnnualSpend == null) {
    const { start: oneYearAgo } = getTrailing12MonthWindow()
    // Group-vendor drift (project_group_vendor_drift): this scopes COG by
    // the bare session vendorId. Vendor orgs that span grouped vendor
    // records would under-count here, but there is no established
    // vendor-side helper for "all vendor ids in my group" (COGRecord has
    // a single vendorId and the session resolves one vendor). Smallest
    // correct change: keep the bare id and flag the class.
    // Optional category scope — expand to every drifted COG category variant
    // (case/word-order/plural insensitive); a raw `in` would drop rows.
    const spendCategories = [
      input.estimatedSpendCategory?.trim() ?? "",
      ...(input.estimatedCategorySpends ?? []).map((r) => r.category.trim()),
    ].filter((c) => c !== "")
    const categoryFilter: Prisma.COGRecordWhereInput =
      spendCategories.length > 0
        ? {
            category: {
              in: expandCategoriesToCogVariants(
                spendCategories,
                await facilityCogCategoryUniverse(facility.id),
              ),
            },
          }
        : {}
    const agg = await prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: vendor.id,
        transactionDate: { gte: oneYearAgo },
        ...categoryFilter,
      },
      _sum: { extendedPrice: true },
    })
    const vendorSpend = Number(agg._sum?.extendedPrice ?? 0)
    // Don't clobber an explicit usage-derived current revenue.
    facilityCurrentVendorRevenue ??= vendorSpend
    const share = input.facilityCurrentVendorShare
    if (share != null && share > 0) {
      facilityEstimatedAnnualSpend = vendorSpend / share
    } else {
      facilityEstimatedAnnualSpend = vendorSpend
      backfillWarning =
        "Facility total spend estimated from your own sales — penetration deltas are approximate. Supply a current share % or the facility's total category spend for accurate numbers."
    }
  }

  const facilityType = mapFacilityType(facility.type)

  const analyzerInput: VendorProspectiveInput = {
    facilityId: facility.id,
    facilityName: facility.name,
    facilityType,
    contractVariant: input.contractVariant,
    pricingScenarios: input.pricingScenarios,
    benchmarks,
    internalUnitCost: input.internalUnitCost ?? null,
    facilityEstimatedAnnualSpend,
    facilityCurrentVendorRevenue,
    facilityCurrentVendorShare: input.facilityCurrentVendorShare,
    targetVendorShare: input.targetVendorShare,
    capitalDetails: input.capitalDetails,
    targetGrossMarginPercent: input.targetGrossMarginPercent,
    minimumAcceptableGrossMarginPercent:
      input.minimumAcceptableGrossMarginPercent,
  }

  const result = analyzeVendorProspective(analyzerInput)
  if (backfillWarning) result.warnings.push(backfillWarning)

  // Wave-3 F: the weighted deal-quality score. Resolve the constructs'
  // picked-benchmark medians first (percentile50, fallback nationalAvgPrice)
  // — the vendor's OWN uploaded rows only (prospective-benchmarks
  // invariant: never the seeded vendorId-null rows), division-scoped by
  // category like every other vendor benchmark read.
  const benchmarkMedianById = await resolveConstructBenchmarkMedians(
    vendor.id,
    input.constructs ?? [],
    divisionCategoryKeys,
  )
  const dealScore = deriveOverallScore(result, input, benchmarkMedianById)

  // Audit H2: persist the overall score onto the selected draft
  // proposal so the proposals list can display a REAL score.
  if (input.proposalRowId) {
    if (proposalRow) {
      const score = dealScore.overall
      // Wave-3 F: validate the (server-built) legend rows before the JSON-
      // column write, like dealAssumptions — a failure drops the legend,
      // never the score itself.
      const safeScoreComponents = dealScoreComponentsSchema.safeParse(
        dealScore.components,
      )
      // Validate constructs before persisting; drop silently to [] on a bad
      // shape so a malformed payload never blocks the score write.
      const safeConstructs = z
        .array(dealConstructSchema)
        .safeParse(input.constructs ?? [])
      // Wave-2 D (consolidation round-trip): persist EVERY Step-1 assumption
      // so re-opening the proposal restores the Deal Scorer with zero
      // re-entry. UNITS: `*Pct` fields are WHOLE percents (40 = 40%) — the
      // UI string-state units — converted here, once, from the analyzer
      // input's fractions (see lib/prospective/deal-assumptions.ts). Zod-
      // validated JSON-column write (CLAUDE.md); a bad shape drops the
      // assumptions (keeping any previously saved ones via the meta spread)
      // rather than blocking the score write.
      const safeAssumptions = dealAssumptionsSchema.safeParse({
        targetMarginPct: fractionToWholePct(input.targetGrossMarginPercent),
        floorMarginPct: fractionToWholePct(
          input.minimumAcceptableGrossMarginPercent,
        ),
        currentSharePct:
          input.facilityCurrentVendorShare != null
            ? fractionToWholePct(input.facilityCurrentVendorShare)
            : null,
        estimatedSpend: input.facilityEstimatedAnnualSpend ?? null,
        estimatedSpendCategory: input.estimatedSpendCategory ?? null,
        estimatedCategorySpends: input.estimatedCategorySpends ?? null,
        internalUnitCost: input.internalUnitCost ?? null,
        contractVariant: input.contractVariant,
        capital: input.capitalDetails
          ? {
              equipmentCost: input.capitalDetails.equipmentCost,
              // Optional analyzer fields default to the analyzer's own
              // fallbacks (same values the Deal Scorer form seeds).
              annualMaintenanceCost:
                input.capitalDetails.annualMaintenanceCost ?? 0,
              termMonths: input.capitalDetails.termMonths ?? 60,
              interestRatePct: fractionToWholePct(
                input.capitalDetails.interestRate ?? 0.05,
              ),
              discountRatePct: fractionToWholePct(
                input.capitalDetails.discountRate ?? 0.1,
              ),
            }
          : null,
      } satisfies DealAssumptions)
      // auth-scope-scanner-skip: row authorized via vendor-scoped findFirst above
      await prisma.pendingContract.update({
        where: { id: proposalRow.id },
        data: {
          pricingData: JSON.parse(
            JSON.stringify({
              ...proposalMeta,
              dealScore: { score, scoredAt: new Date().toISOString() },
              // Wave-3 F: the per-component legend, so My-Proposals / the
              // detail dialog can explain the score later. Zod-validated
              // like dealAssumptions (CLAUDE.md: validate JSON-column
              // writes); additive/optional on read.
              ...(safeScoreComponents.success
                ? { scoreComponents: safeScoreComponents.data }
                : {}),
              // Deal-Scorer handoff payload for the Opportunity Engine.
              dealConstructs: safeConstructs.success ? safeConstructs.data : [],
              dealCurrentAnnualSpend: input.currentAnnualSpend ?? 0,
              // The facility + target share the deal was ANALYZED with, so
              // the persisted handoff (My-Proposals "Opportunity Engine"
              // button) seeds Step 2 exactly like the live post-Analyze
              // handoff (bug-bash V-C5).
              dealFacilityId: input.facilityId,
              dealTargetSharePct:
                input.targetVendorShare != null
                  ? input.targetVendorShare * 100
                  : null,
              // Capital in the deal (equipment cost) — so the persisted
              // handoff's Capital/Robotic figure matches the live one.
              dealCapitalRevenue: input.capitalDetails?.equipmentCost ?? null,
              // Step-1 assumptions round-trip (Wave-2 D) — only overwrite
              // when the fresh payload validated.
              ...(safeAssumptions.success
                ? { dealAssumptions: safeAssumptions.data }
                : {}),
            }),
          ) as Prisma.InputJsonValue,
        },
      })
    } else {
      result.warnings.push(
        "Could not attach the score to the selected proposal — it was not found (legacy proposals created before 2026-06-09 cannot be scored).",
      )
    }
  }

  const analysisResult: VendorProspectiveAnalysisResult = {
    ...result,
    dealScore,
  }
  return serialize(analysisResult)
}

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Resolve the constructs' picked-benchmark ids to a median price
 * (`percentile50`, fallback `nationalAvgPrice`) for the deal score's
 * price-vs-benchmark component. UPLOADED rows only (`vendorId: vendor.id`
 * — the prospective-benchmarks invariant), division-scoped by category
 * like the sibling benchmark reads. Ids that don't resolve to a usable
 * price are simply absent from the map (the construct scores as
 * un-benchmarked).
 */
async function resolveConstructBenchmarkMedians(
  vendorId: string,
  constructs: PersistedDealConstruct[],
  divisionCategoryKeys: Set<string> | null,
): Promise<Map<string, number>> {
  const ids = [
    ...new Set(
      constructs
        .map((c) => c.benchmarkId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ]
  const medianById = new Map<string, number>()
  if (ids.length === 0) return medianById

  const rows = await prisma.productBenchmark.findMany({
    where: { id: { in: ids }, vendorId },
    select: {
      id: true,
      category: true,
      percentile50: true,
      nationalAvgPrice: true,
    },
  })
  for (const b of rows) {
    if (!categoryInDivisionScope(b.category, divisionCategoryKeys)) continue
    const p50 = Number(b.percentile50 ?? 0)
    const median = p50 > 0 ? p50 : Number(b.nationalAvgPrice ?? 0)
    if (median > 0) medianById.set(b.id, median)
  }
  return medianById
}

/**
 * Thin adapter over the canonical `computeDealScore`
 * (lib/prospective-analysis/deal-score.ts — Wave-3 F). The old
 * implementation here was margin-vs-own-target anchors ONLY
 * (20/50/80 + 1pt per point above target), which scored a blank form
 * ~95 "strong_accept" off the 55% GM assumption; the weighted blend
 * (margin 35 / price-vs-benchmark 25 / rebate 15 / share-ask 10 /
 * data-confidence 15) lives in the pure module — never re-derive it
 * inline. Recommendation thresholds at read time stay 80/65/40
 * (`recommendationForScore` in lib/actions/prospective.ts).
 */
function deriveOverallScore(
  result: VendorProspectiveResult,
  input: VendorProspectiveAnalysisInput,
  benchmarkMedianById: Map<string, number>,
): DealScoreBreakdown {
  return computeDealScore({
    recommendedGrossMargin:
      result.recommendedScenario?.grossMarginPercent ?? null,
    targetGrossMargin: input.targetGrossMarginPercent,
    floorGrossMargin: input.minimumAcceptableGrossMarginPercent,
    internalCostProvided:
      input.internalUnitCost != null && input.internalUnitCost > 0,
    constructs: (input.constructs ?? []).map((c) => ({
      targetUnitPrice: c.target,
      annualVolume: c.annualVolume,
      rebatePercent: c.rebatePercent,
      benchmarkMedian: c.benchmarkId
        ? (benchmarkMedianById.get(c.benchmarkId) ?? null)
        : null,
    })),
    currentShareFraction: input.facilityCurrentVendorShare ?? null,
    targetShareFraction: input.targetVendorShare ?? null,
    // "Actuals present" = a real current-revenue figure fed the analysis
    // (Σ currentPrice × volume from uploads / proposal items / the two-way
    // facility-actuals sync) — the strongest signal the baseline is real.
    actualsPresent:
      input.facilityCurrentVendorRevenue != null &&
      input.facilityCurrentVendorRevenue > 0,
  })
}

function mapFacilityType(t: string): VendorFacilityType {
  // Prisma enum: hospital | asc | clinic | surgery_center
  // Charles enum: HOSPITAL | ASC | IDN | CLINIC
  switch (t) {
    case "hospital":
      return "HOSPITAL"
    case "asc":
    case "surgery_center":
      return "ASC"
    case "clinic":
      return "CLINIC"
    default:
      return "HOSPITAL"
  }
}
