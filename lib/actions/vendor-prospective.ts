"use server"

import { prisma } from "@/lib/db"
import { getTrailing12MonthWindow } from "@/lib/dates/trailing-window"
import type { Prisma } from "@/lib/generated/prisma/client"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"
import { onlyProspectiveProposalRows } from "@/lib/prospective/proposal-rows"
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
import { z } from "zod"

// ─── Input shape ───────────────────────────────────────────────

/** A Deal-Scorer construct as persisted onto the proposal for the handoff. */
export interface PersistedDealConstruct {
  benchmarkId: string | null
  productName: string
  current: number
  floor: number
  target: number
  ask: number
  annualVolume: number
  rebatePercent: number
}

// Validate the client-supplied constructs before writing them into the
// `pricingData` JSON column (CLAUDE.md: validate JSON-column writes).
const dealConstructSchema = z.object({
  benchmarkId: z.string().nullable(),
  productName: z.string().max(120),
  current: z.number(),
  floor: z.number(),
  target: z.number(),
  ask: z.number(),
  annualVolume: z.number(),
  rebatePercent: z.number(),
})

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
 */
export interface VendorFacilityCurrentState {
  facilityId: string
  facilityName: string
  /** Total facility supply spend, trailing 12 months (the addressable prize). */
  currentVendorSpend: number
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

  const cptRateSchedule = buildCptRateSchedule(payorContracts)
  let measuredReimbursement = 0
  let casesWithRate = 0
  for (const c of cases) {
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

  return serialize({
    facilityId: facility.id,
    facilityName: facility.name,
    currentVendorSpend: totalSpend,
    annualCaseVolume: cases.length,
    measuredReimbursement,
    reimbursementCoverage: { withRate: casesWithRate, totalCases: cases.length },
    hasData: cogRows.length > 0,
  })
}

// ─── Action ────────────────────────────────────────────────────

export async function getVendorProspectiveAnalysis(
  input: VendorProspectiveAnalysisInput,
): Promise<VendorProspectiveResult> {
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
): Promise<VendorProspectiveResult> {
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
  let facilityEstimatedAnnualSpend = input.facilityEstimatedAnnualSpend
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
    const agg = await prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: vendor.id,
        transactionDate: { gte: oneYearAgo },
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

  // Audit H2: persist the overall score onto the selected draft
  // proposal so the proposals list can display a REAL score.
  if (input.proposalRowId) {
    if (proposalRow) {
      const score = deriveOverallScore(result, {
        target: input.targetGrossMarginPercent,
        floor: input.minimumAcceptableGrossMarginPercent,
      })
      // Validate constructs before persisting; drop silently to [] on a bad
      // shape so a malformed payload never blocks the score write.
      const safeConstructs = z
        .array(dealConstructSchema)
        .safeParse(input.constructs ?? [])
      // auth-scope-scanner-skip: row authorized via vendor-scoped findFirst above
      await prisma.pendingContract.update({
        where: { id: proposalRow.id },
        data: {
          pricingData: JSON.parse(
            JSON.stringify({
              ...proposalMeta,
              dealScore: { score, scoredAt: new Date().toISOString() },
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

  return serialize(result)
}

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Map the analyzer result to a 0–100 deal score for the proposals list
 * (audit H2). Anchors: no scenario clears the floor → 20; margin at the
 * floor → 50; margin at target → 80; above target climbs 1 point per
 * margin point, capped at 100. Recommendation thresholds at read time
 * mirror the legacy scorer (80 / 65 / 40 — see
 * `recommendationForScore` in lib/actions/prospective.ts).
 */
function deriveOverallScore(
  result: VendorProspectiveResult,
  margins: { target: number; floor: number },
): number {
  const rec = result.recommendedScenario
  if (!rec) return 20
  const m = rec.grossMarginPercent
  if (m >= margins.target) {
    return Math.min(100, Math.round(80 + (m - margins.target) * 100))
  }
  const span = margins.target - margins.floor
  if (span <= 0) return 80
  return Math.round(50 + 30 * ((m - margins.floor) / span))
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
