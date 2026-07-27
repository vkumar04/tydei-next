"use server"

import { prisma } from "@/lib/db"
import type { Prisma } from "@/lib/generated/prisma/client"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import { createInAppNotificationsInternal } from "@/lib/notifications/in-app-helper"
import { onlyVendorProposalAlerts } from "@/lib/alerts/vendor-proposal-filter"
import {
  onlyProspectiveProposalRows,
  PROSPECTIVE_PROPOSAL_KIND,
} from "@/lib/prospective/proposal-rows"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import { blendConstructsToScenarios } from "@/lib/prospective-analysis/blend-constructs"
import {
  callerVendorDivisionIds,
  divisionScopeWhere,
} from "@/lib/actions/division-auth"
import {
  divisionCategoryKeySet,
  categoryInDivisionScope,
} from "@/lib/divisions/category-scope"
import {
  dealAssumptionsSchema,
  type DealAssumptions,
} from "@/lib/prospective/deal-assumptions"
import { z } from "zod"
import { getTrailing12MonthWindow } from "@/lib/dates/trailing-window"

// ─── Types ──────────────────────────────────────────────────────

export interface ProposedPricingItem {
  vendorItemNo: string
  description?: string
  proposedPrice: number
  currentPrice?: number
  /** Vendor's internal cost per unit (from the builder upload's cost-basis
   *  column) — seeds the Deal Scorer's internal-unit-cost input. */
  costBasis?: number
  quantity?: number
}

export interface DealScore {
  overall: number
  financialValue: number
  rebateEfficiency: number
  pricingCompetitiveness: number
  marketShareAlignment: number
  complianceLikelihood: number
  recommendation: "strong_accept" | "accept" | "negotiate" | "reject"
}

/**
 * The persisted deal score attached to a proposal by the Deal Scorer
 * (`getVendorProspectiveAnalysis` with a `proposalRowId` writes
 * `pricingData.dealScore = { score, scoredAt }` — audit H2). The
 * recommendation is derived from the score at read time using the
 * legacy 80/65/40 thresholds.
 */
export interface ProposalDealScore {
  overall: number
  recommendation: "strong_accept" | "accept" | "negotiate" | "reject"
  scoredAt: string | null
}

export interface FinancialProjection {
  month: number
  label: string
  cumulativeSpend: number
  cumulativeSavings: number
  projectedValue: number
}

export interface ProposalTermSummary {
  termType: string
  name?: string
  targetType?: string
  targetValue?: number
  /** Flat rebate value — a PERCENT when rebateType is "percent" or absent
   *  (historic rows), flat DOLLARS when "fixed", DOLLARS-per-unit when
   *  "per_unit" (mirrors ContractTier.rebateValue per-type semantics). */
  rebatePercent?: number
  /** How the rebate value is denominated. Absent = "percent" (all
   *  pre-2026-07 proposals). Additive/optional so historic rows load
   *  unchanged (Wave 1.C contract-term parity). */
  rebateType?: "percent" | "fixed" | "per_unit"
  /** Tier ladder. min/max are in the targetType's units (spend $, volume
   *  UNITS, market-share PERCENT 0–100); value per rebateType. Persisted
   *  without the builder's UI-only `_uid`. */
  tiers?: { min: number; max?: number; value: number }[]
}

export interface VendorProposal {
  id: string
  vendorId: string
  /** User-chosen proposal name (bugs.rtfd 2026-07-07). Absent on proposals
   *  saved before the field existed — display falls back to #id. */
  name?: string
  facilityIds: string[]
  status: "draft" | "submitted" | "accepted" | "rejected"
  /**
   * Pipeline stage derived from what the vendor actually DID with the row —
   * these proposals are internal analysis drafts (audit M7: `status` is
   * honestly always "draft"), so the hero/Analytics funnel tracks
   * draft → scored (Deal Scorer ran) → analyzed (Opportunity run persisted)
   * instead of a submitted/accepted lifecycle that can never occur.
   */
  stage: "draft" | "scored" | "analyzed"
  /** False for legacy pre-split Alert rows — they can be viewed/deleted but
   *  not edited (updateProposal only writes PendingContract rows). */
  editable: boolean
  itemCount: number
  totalProposedCost: number
  dealScore: ProposalDealScore | null
  createdAt: string
  /** Charles 2026-04-26 #67: richer fields from the proposal builder.
   *  All optional so historic alerts (which lack them) still load. */
  productCategories?: string[]
  contractLengthMonths?: number
  projectedSpend?: number
  projectedVolume?: number
  marketShareCommitment?: number
  gpoFee?: number
  aiNotes?: string
  terms?: ProposalTermSummary[]
  /**
   * Present when the proposal was scored via the construct Deal Scorer — the
   * payload that pre-fills the Opportunity Engine when you click "Analyze in
   * Opportunity Engine" (the proposal → score → opportunity story).
   */
  dealHandoff?: ProposalDealHandoff | null
}

export interface ProposalDealHandoff {
  facilityId: string | null
  /** Σ(current × volume) across constructs — what the facility pays today. */
  currentAnnualSpend: number
  /** Blended Target vs Current unit price, fraction (−0.05 = 5% cheaper). */
  priceChangePct: number
  /** Deal's market-share commitment, 0–100, or null. */
  targetSharePct: number | null
  /** Capital/equipment revenue the deal was analyzed with, or null. */
  capitalRevenue: number | null
  constructCount: number
  /** The per-construct rows — feed the Opportunity Engine's by-product export
   *  (structurally matches OppEngineHandoff/OppDealConstructRow). */
  constructs: {
    productName: string
    category?: string
    current: number
    floor: number
    target: number
    ask: number
    annualVolume: number
    rebatePercent: number
  }[]
}

/** A targeted facility resolved to its display name. */
export interface ProposalFacilityRef {
  id: string
  name: string
}

/**
 * The FULL proposal payload for the detail view — everything the builder
 * tabs captured, read back on demand. The list loader (`getVendorProposals`)
 * deliberately strips the heavy/extra fields (audit L13: only `itemCount`,
 * no pricing rows, no start date / payment terms / divisions), so the
 * "Proposal Details" dialog fetches this richer shape when opened.
 */
export interface VendorProposalDetail extends VendorProposal {
  /** Full per-line pricing rows from the builder Pricing tab. */
  pricingItems: ProposedPricingItem[]
  /** Contract terms tab extras (the list only surfaces contractLengthMonths). */
  startDate?: string
  paymentTerms?: string
  termsNotes?: string
  /** Division names for grouped proposals (audit L13). */
  divisions?: string[]
  /** `facilityIds` resolved to names; the "none" placeholder is dropped. */
  facilities: ProposalFacilityRef[]
  /** Per-construct deal rows persisted by the Deal Scorer (View → Deal tab). */
  dealConstructs?: {
    benchmarkId: string | null
    productName: string
    category?: string
    current: number
    floor: number
    target: number
    ask: number
    annualVolume: number
    rebatePercent: number
  }[]
  /** Last Opportunity Engine run saved onto the proposal (View → Opportunity). */
  opportunityScenario?: ProposalOpportunityScenario
  /**
   * Step-1 Deal-Scorer assumptions persisted on Analyze (Wave-2 D,
   * consolidation round-trip) — margins/share/spend/cost/variant/capital in
   * UI units (whole percents; see lib/prospective/deal-assumptions.ts).
   * Tolerant read: proposals scored before 2026-07-03 have no
   * `dealAssumptions` key and read back as `undefined`.
   */
  dealAssumptions?: DealAssumptions
}

/** A saved Opportunity Engine run (inputs + key outputs). */
export interface ProposalOpportunityScenario {
  division: string
  facility: string
  /** Fractions. */
  priceChangePct: number
  targetShare: number
  expectedVolumeGrowthPct: number
  winProbability: number
  incrementalRevenue: number
  currentRevenue: number
  targetRevenue: number
  blendedMarketShare: number
  /** 0–100. */
  opportunityScore: number
  savedAt: string
}

const opportunityScenarioSchema = z.object({
  division: z.string(),
  facility: z.string(),
  priceChangePct: z.number(),
  targetShare: z.number(),
  expectedVolumeGrowthPct: z.number(),
  winProbability: z.number(),
  incrementalRevenue: z.number(),
  currentRevenue: z.number(),
  targetRevenue: z.number(),
  blendedMarketShare: z.number(),
  opportunityScore: z.number(),
  savedAt: z.string(),
})

// NOTE: The legacy `analyzeProposal` 0-100 scoring action and its UI
// consumers (`components/facility/analysis/proposal-upload.tsx`,
// `proposal-comparison-table.tsx`, `useAnalyzeProposal` hook, and the
// `ItemComparison` / `ProposalAnalysis` types) were removed on
// 2026-05-04. The canonical 5-dimension 0-10 engine lives at
// `lib/actions/prospective-analysis.ts` and is the only `analyzeProposal`
// export in the codebase.

// NOTE: the facility-gated `scoreDeal` action (a pure weighted average
// with zero consumers) was removed on 2026-06-10 (audit H2). Vendor
// proposal scores now come from the Deal Scorer pipeline:
// `getVendorProspectiveAnalysis` persists `pricingData.dealScore` on
// the draft proposal row, and `payloadToProposal` below reads it back.

/** Read-time recommendation thresholds (legacy scorer parity: 80/65/40). */
function recommendationForScore(
  score: number,
): ProposalDealScore["recommendation"] {
  if (score >= 80) return "strong_accept"
  if (score >= 65) return "accept"
  if (score < 40) return "reject"
  return "negotiate"
}

// ─── COG pricing benchmarks (Pricing tab join) ──────────────────

export interface CogPricingBenchmark {
  /** normalizeSku key the caller should match against. */
  skuKey: string
  /** Trailing-12mo quantity-weighted average unit cost from COG. */
  currentPrice: number
  /** Trailing-12mo purchased quantity (estimated annual qty). */
  annualQty: number
}

/**
 * Charles 2026-06-10 ("Analysis pricing not working to compare pricing"):
 * the Pricing tab's analyzer is a pure function that expects items
 * "already joined with COG current prices by the caller" — but no caller
 * ever did the join, so unless the uploaded file happened to carry its own
 * current_price column every line showed "0 matched to COG" and no
 * variance. This action IS that join: trailing-12-month COG unit costs per
 * SKU (normalizeSku keys per the SKU-class rule — never raw ===), scoped
 * to the facility and optionally to a vendor.
 */
export async function getCogPricingBenchmarks(input: {
  itemNumbers: string[]
  vendorId?: string | null
}): Promise<CogPricingBenchmark[]> {
  const { facility } = await requireFacility()
  const wanted = new Set(
    input.itemNumbers.map((s) => normalizeSku(s)).filter((s) => s.length > 0),
  )
  if (wanted.size === 0) return []

  const { start: windowStart, end: windowEnd } = getTrailing12MonthWindow()

  // Review R2 (prod scale): bound the query to the requested SKUs instead
  // of scanning the facility's full 12-month COG table. The insensitive
  // `in` over the raw + trimmed file values catches case drift; the JS
  // normalizeSku pass below stays authoritative for exactness. Known
  // narrowing: a DB SKU with INTERNAL whitespace ("STK 123" vs file
  // "STK123") is missed by the prefilter — accepted, normalizeSku itself
  // documents whitespace-internal variants as rare.
  const rawSkuVariants = Array.from(
    new Set(
      input.itemNumbers.flatMap((s) => [s, s.trim()]).filter((s) => s.length > 0),
    ),
  )
  const rows = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorItemNo: { in: rawSkuVariants, mode: "insensitive" },
      transactionDate: { gte: windowStart, lte: windowEnd },
      ...(input.vendorId ? { vendorId: input.vendorId } : {}),
    },
    select: {
      vendorItemNo: true,
      unitCost: true,
      quantity: true,
    },
  })

  const bySku = new Map<string, { cost: number; qty: number }>()
  for (const r of rows) {
    const key = normalizeSku(r.vendorItemNo)
    if (!wanted.has(key)) continue
    const qty = r.quantity ?? 0
    const unit = r.unitCost == null ? null : Number(r.unitCost)
    if (unit == null) continue
    const cur = bySku.get(key) ?? { cost: 0, qty: 0 }
    // Quantity-weighted: Σ(unit × qty) ÷ Σqty. Zero-qty rows count as 1
    // unit so a price-only row still contributes a benchmark.
    const w = qty > 0 ? qty : 1
    cur.cost += unit * w
    cur.qty += w
    bySku.set(key, cur)
  }

  return serialize(
    Array.from(bySku.entries()).map(([skuKey, v]) => ({
      skuKey,
      currentPrice: v.qty > 0 ? v.cost / v.qty : 0,
      annualQty: v.qty,
    })),
  )
}

// ─── Financial Projections ──────────────────────────────────────

export async function getFinancialProjections(input: {
  contractId: string
  projectionMonths: number
  growthRate?: number
}): Promise<FinancialProjection[]> {
  // Charles audit round-12 BLOCKER: gate by ownership.
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(input.contractId, facility.id),
    select: { annualValue: true },
  })

  const monthlySpend = Number(contract.annualValue) / 12
  const growthRate = (input.growthRate ?? 2) / 100 / 12
  const projections: FinancialProjection[] = []

  let cumSpend = 0
  let cumSavings = 0

  for (let i = 1; i <= input.projectionMonths; i++) {
    const projected = monthlySpend * (1 + growthRate * i)
    cumSpend += projected
    cumSavings += monthlySpend * growthRate * i
    const d = new Date()
    d.setMonth(d.getMonth() + i)

    projections.push({
      month: i,
      label: d.toISOString().slice(0, 7),
      cumulativeSpend: Math.round(cumSpend * 100) / 100,
      cumulativeSavings: Math.round(cumSavings * 100) / 100,
      projectedValue: Math.round(projected * 100) / 100,
    })
  }

  return serialize(projections)
}

// ─── Vendor: Create Proposal (draft PendingContract row) ───────────

export async function createProposal(input: {
  vendorId: string
  facilityIds: string[]
  /** User-chosen proposal name ("It should let you name the proposal",
   *  bugs.rtfd 2026-07-07). Blank → a generated item-count label. */
  name?: string
  pricingItems: ProposedPricingItem[]
  terms: { contractLength: number; startDate: string; paymentTerms?: string; notes?: string }
  /** Charles 2026-04-26 #67: full proposal-builder state. Optional so the
   *  facility-side analyzer flow (which only knows pricing + basic terms)
   *  still works. */
  productCategories?: string[]
  /** Organization division names for grouped proposals (audit L13 —
   *  previously the builder clobbered `productCategories` with these). */
  divisions?: string[]
  projectedSpend?: number
  projectedVolume?: number
  marketShareCommitment?: number
  gpoFee?: number
  aiNotes?: string
  proposalTerms?: ProposalTermSummary[]
  /** Explicit division pick from the builder's selector. Must belong to this
   *  vendor AND (for restricted callers) be one of the caller's divisions. */
  vendorDivisionId?: string | null
}): Promise<VendorProposal> {
  const { vendor, user } = await requireVendor()
  await requireCanMutate()
  // Division stamping (hard isolation): a division-restricted creator's
  // proposal is stamped with their division so it stays visible to them and
  // isolated from other divisions. An explicit picker choice wins (validated
  // below); otherwise a restricted member's first division; enterprise/Super
  // creates stay null (enterprise-only visibility, mirroring grouped
  // contracts).
  const creatorDivisionIds = await callerVendorDivisionIds(user.id, vendor.id)
  let stampedDivisionId = creatorDivisionIds?.[0] ?? null
  if (input.vendorDivisionId) {
    const inCallerScope =
      creatorDivisionIds === undefined ||
      creatorDivisionIds.includes(input.vendorDivisionId)
    const division = inCallerScope
      ? await prisma.vendorDivision.findFirst({
          where: { id: input.vendorDivisionId, vendorId: vendor.id },
          select: { id: true },
        })
      : null
    if (!division) throw new Error("Division not found")
    stampedDivisionId = division.id
  }

  const totalCost = input.pricingItems.reduce(
    (s, p) => s + p.proposedPrice * (p.quantity ?? 1),
    0
  )

  // Proposal-feed split (2026-06-09): proposals used to be persisted as
  // masquerade Alert rows (alertType "compliance", metadata
  // `{ type: "vendor_proposal" }`) — frequently the only "alerts" a
  // vendor ever saw. They now live as draft PendingContract rows:
  // `status: "draft"` + `facilityId: null` keeps them out of every
  // facility review surface, and `pricingData.kind` discriminates them
  // from real submissions (see lib/prospective/proposal-rows.ts).
  const row = await prisma.pendingContract.create({
    data: {
      vendorId: vendor.id,
      vendorName: vendor.name,
      facilityId: null,
      facilityName: null,
      contractName:
        input.name?.trim() ||
        `Prospective proposal — ${input.pricingItems.length} item${input.pricingItems.length === 1 ? "" : "s"}`,
      status: "draft",
      vendorDivisionId: stampedDivisionId,
      totalValue: totalCost,
      notes: input.aiNotes ?? input.terms.notes ?? null,
      pricingData: JSON.parse(
        JSON.stringify({
          kind: PROSPECTIVE_PROPOSAL_KIND,
          name: input.name?.trim() || undefined,
          facilityIds: input.facilityIds,
          pricingItems: input.pricingItems,
          terms: input.terms,
          totalCost,
          productCategories: input.productCategories,
          divisions: input.divisions,
          projectedSpend: input.projectedSpend,
          projectedVolume: input.projectedVolume,
          marketShareCommitment: input.marketShareCommitment,
          gpoFee: input.gpoFee,
          aiNotes: input.aiNotes,
          proposalTerms: input.proposalTerms,
        }),
      ) as Prisma.InputJsonValue,
    },
  })

  // Replace the old masquerade alert with a REAL in-app notification to
  // the vendor's own org members (best-effort — the helper swallows and
  // warn-logs failures). Same fan-out pattern as
  // notifyVendorOfPendingDecision in lib/actions/notifications.ts.
  const vendorOrg = await prisma.vendor.findUnique({
    where: { id: vendor.id },
    select: {
      organization: {
        select: {
          members: { select: { user: { select: { id: true } } } },
        },
      },
    },
  })
  const memberUserIds =
    vendorOrg?.organization?.members.map((m) => m.user.id) ?? []
  // Audit M7: the builder writes ["none"] when no facility was picked —
  // don't count that placeholder as a targeted facility.
  const targetedFacilityCount = input.facilityIds.filter(
    (id) => id && id !== "none",
  ).length
  if (memberUserIds.length > 0) {
    void createInAppNotificationsInternal({
      userIds: memberUserIds,
      type: "vendor_proposal_created",
      title: `Proposal draft created — ${targetedFacilityCount} ${targetedFacilityCount === 1 ? "facility" : "facilities"} targeted`,
      body: `${input.pricingItems.length} items, $${totalCost.toLocaleString()} total`,
      payload: { proposalId: row.id },
      actionUrl: "/vendor/prospective",
    })
  }

  // Audit M7: the row is written with status "draft" — surface that
  // truthfully instead of pretending it was submitted.
  return serialize({
    id: row.id,
    vendorId: vendor.id,
    name: input.name?.trim() || undefined,
    facilityIds: input.facilityIds,
    status: "draft",
    stage: "draft",
    editable: true,
    itemCount: input.pricingItems.length,
    totalProposedCost: totalCost,
    dealScore: null,
    createdAt: row.submittedAt.toISOString(),
    productCategories: input.productCategories,
    contractLengthMonths: input.terms.contractLength,
    projectedSpend: input.projectedSpend,
    projectedVolume: input.projectedVolume,
    marketShareCommitment: input.marketShareCommitment,
    gpoFee: input.gpoFee,
    aiNotes: input.aiNotes,
    terms: input.proposalTerms,
  })
}

// ─── Vendor: Update Proposal (edit a draft in place) ──────────────

/**
 * Edit a draft proposal in place (Vick 2026-06-24 "View should let me get back
 * to what I entered"). Mirrors createProposal's builder payload, but MERGES into
 * the existing pricingData so the Deal Scorer / Opportunity Engine data
 * (dealScore, dealConstructs, dealCurrentAnnualSpend, opportunityScenario) that
 * live alongside survive the edit. Vendor-scoped.
 */
export async function updateProposal(input: {
  proposalId: string
  facilityIds: string[]
  /** User-chosen proposal name — blank keeps/regenerates the default label. */
  name?: string
  pricingItems: ProposedPricingItem[]
  terms: { contractLength: number; startDate: string; paymentTerms?: string; notes?: string }
  productCategories?: string[]
  divisions?: string[]
  projectedSpend?: number
  projectedVolume?: number
  marketShareCommitment?: number
  gpoFee?: number
  aiNotes?: string
  proposalTerms?: ProposalTermSummary[]
}): Promise<VendorProposal> {
  const { vendor, user } = await requireVendor()
  await requireCanMutate()
  const divisionScope = await divisionScopeWhere(
    await callerVendorDivisionIds(user.id, vendor.id),
  )
  const existingRow = await prisma.pendingContract.findFirst({
    where: {
      id: input.proposalId,
      vendorId: vendor.id,
      ...onlyProspectiveProposalRows(),
      ...divisionScope,
    },
    select: { id: true, submittedAt: true, pricingData: true },
  })
  if (!existingRow) throw new Error("Proposal not found")
  const existing = (existingRow.pricingData ?? {}) as Record<string, unknown>
  const totalCost = input.pricingItems.reduce(
    (s, p) => s + p.proposedPrice * (p.quantity ?? 1),
    0,
  )
  const merged = {
    ...existing,
    kind: PROSPECTIVE_PROPOSAL_KIND,
    name: input.name?.trim() || undefined,
    facilityIds: input.facilityIds,
    pricingItems: input.pricingItems,
    terms: input.terms,
    totalCost,
    productCategories: input.productCategories,
    divisions: input.divisions,
    projectedSpend: input.projectedSpend,
    projectedVolume: input.projectedVolume,
    marketShareCommitment: input.marketShareCommitment,
    gpoFee: input.gpoFee,
    aiNotes: input.aiNotes,
    proposalTerms: input.proposalTerms,
  }
  // auth-scope-scanner-skip: row authorized via the vendor-scoped findFirst above
  const row = await prisma.pendingContract.update({
    where: { id: existingRow.id },
    data: {
      contractName:
        input.name?.trim() ||
        `Prospective proposal — ${input.pricingItems.length} item${input.pricingItems.length === 1 ? "" : "s"}`,
      totalValue: totalCost,
      notes: input.aiNotes ?? input.terms.notes ?? null,
      pricingData: JSON.parse(JSON.stringify(merged)) as Prisma.InputJsonValue,
    },
  })
  return serialize(payloadToProposal(row.id, vendor.id, row.submittedAt, merged))
}

// ─── Vendor: Delete Proposal ────────────────────────────────────

/**
 * Delete a vendor's own proposal. New proposals are draft
 * `PendingContract` rows (`pricingData.kind === "vendor_proposal"` —
 * see `createProposal` above); proposals created before the
 * 2026-06-09 proposal-feed split are legacy masquerade `Alert` rows
 * (`metadata.type === "vendor_proposal"`). We no longer CREATE the
 * alert rows, but the delete path stays tolerant of them so vendors
 * can clean up their historic proposals. Both lookups are
 * tenant-scoped to the calling vendor.
 *
 * The constraints in CLAUDE.md / V1 audit reserved `withdrawPendingContract`
 * for `PendingContract` rows submitted via the contract-submission flow;
 * prospective drafts never enter that flow (status "draft",
 * facilityId null).
 */
export async function deleteProposal(id: string): Promise<void> {
  const { vendor, user } = await requireVendor()
  await requireCanMutate()
  const divisionIds = await callerVendorDivisionIds(user.id, vendor.id)
  const divisionScope = await divisionScopeWhere(divisionIds)

  // Current storage: draft PendingContract row, vendor- and division-scoped.
  const pending = await prisma.pendingContract.findFirst({
    where: {
      id,
      vendorId: vendor.id,
      ...onlyProspectiveProposalRows(),
      ...divisionScope,
    },
    select: { id: true },
  })
  if (pending) {
    // auth-scope-scanner-skip: row authorized via vendor-scoped findFirst above
    await prisma.pendingContract.delete({ where: { id: pending.id } })
    return
  }

  // Legacy cleanup: pre-split masquerade Alert rows. A non-vendor row
  // or a row owned by another vendor is invisible here, which gives
  // us the auth gate in a single query. Division-restricted members can't
  // see legacy rows (no division column), so they can't delete them either.
  const alert =
    divisionIds !== undefined
      ? null
      : await prisma.alert.findFirst({
          where: { id, vendorId: vendor.id, ...onlyVendorProposalAlerts() },
          select: { id: true },
        })

  if (!alert) {
    throw new Error("Proposal not found")
  }

  // auth-scope-scanner-skip: row authorized via vendor-scoped findFirst above
  await prisma.alert.delete({ where: { id: alert.id } })
}

// ─── Vendor: Get Benchmarks ─────────────────────────────────────

export interface VendorBenchmarkRow {
  id: string
  productName: string
  itemNumber: string
  category: string
  nationalAvgPrice: number
  percentile25: number
  percentile50: number
  percentile75: number
  minPrice: number
  maxPrice: number
  sampleSize: number
  source: string
  dataDate: string | null
}

/**
 * Returns the vendor's UPLOADED benchmark rows only (`ProductBenchmark` rows
 * tagged with the vendor's id, from the Benchmarks-tab import). Seeded /
 * national rows (vendorId = null) are NOT included — prospective benchmarks
 * come only from uploaded files (Vick 2026-06-22). Vendor scoping via
 * `requireVendor()` + the `vendorId` filter.
 */
export async function getVendorBenchmarks(): Promise<VendorBenchmarkRow[]> {
  const { vendor, user } = await requireVendor()
  // Division isolation by CATEGORY (ProductBenchmark has no division column):
  // restricted members see only benchmark rows in their divisions' categories.
  const divisionCategoryKeys = await divisionCategoryKeySet(
    await callerVendorDivisionIds(user.id, vendor.id),
  )

  // Uploaded-only (Vick 2026-06-22 "Benchmark should only come from uploaded
  // files"): prospective benchmarks are the vendor's OWN uploaded rows
  // (vendorId = vendor.id, from the Benchmarks-tab import). The seeded /
  // national rows (vendorId = null) are intentionally NOT merged in anymore.
  // Charles 2026-07-27 ("Benchmarks still do not have all of the information"):
  // the cap used to be 500 with no signal, so a vendor who imported more than
  // that silently saw a truncated table whose footer counted the truncated set
  // as if it were everything — a second, independent way the complaint could be
  // literally true. Raised well past any real uploaded benchmark set, and a hit
  // is now logged rather than swallowed. Note the cap applies BEFORE the
  // division-scope filter below, so a restricted member legitimately sees fewer.
  const BENCHMARK_ROW_CAP = 5_000
  const direct = await prisma.productBenchmark.findMany({
    where: { vendorId: vendor.id },
    orderBy: [{ category: "asc" }, { vendorItemNo: "asc" }],
    take: BENCHMARK_ROW_CAP,
  })
  if (direct.length === BENCHMARK_ROW_CAP) {
    console.warn(
      `[getVendorBenchmarks] hit the ${BENCHMARK_ROW_CAP}-row cap for vendor ${vendor.id} — the table is truncated and its row count understates the real set.`,
    )
  }

  const seen = new Set<string>()
  const all = direct.filter((b) => {
    if (!categoryInDivisionScope(b.category, divisionCategoryKeys)) return false
    const k = `${b.vendorItemNo}|${b.source}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  return serialize(
    all.map((b) => ({
      id: b.id,
      productName: b.description ?? b.vendorItemNo,
      itemNumber: b.vendorItemNo,
      category: b.category ?? "Uncategorized",
      nationalAvgPrice: Number(b.nationalAvgPrice ?? 0),
      percentile25: Number(b.percentile25 ?? 0),
      percentile50: Number(b.percentile50 ?? 0),
      percentile75: Number(b.percentile75 ?? 0),
      minPrice: Number(b.minPrice ?? 0),
      maxPrice: Number(b.maxPrice ?? 0),
      sampleSize: Number(b.sampleSize ?? 0),
      source: b.source,
      dataDate: b.dataDate ? b.dataDate.toISOString().slice(0, 10) : null,
    })),
  )
}

// ─── Vendor: Get Proposals ──────────────────────────────────────

/**
 * Map the shared proposal payload (PendingContract `pricingData` for
 * new rows, Alert `metadata` for legacy rows — same field names apart
 * from the `kind`/`type` discriminator) to the `VendorProposal` shape.
 */
function payloadToProposal(
  id: string,
  vendorId: string,
  createdAt: Date,
  meta: Record<string, unknown>,
  editable = true,
): VendorProposal {
  const terms = meta.terms as
    | { contractLength?: number; notes?: string }
    | undefined
  // Audit H2: read the persisted Deal Scorer result
  // (`pricingData.dealScore = { score, scoredAt }`, written by
  // getVendorProspectiveAnalysis) instead of hardcoding null.
  const rawScore = meta.dealScore as
    | { score?: unknown; scoredAt?: unknown }
    | undefined
  const dealScore: ProposalDealScore | null =
    rawScore && typeof rawScore.score === "number"
      ? {
          overall: Math.round(rawScore.score),
          recommendation: recommendationForScore(rawScore.score),
          scoredAt:
            typeof rawScore.scoredAt === "string" ? rawScore.scoredAt : null,
        }
      : null
  // Deal-Scorer handoff: when constructs were persisted, derive the blended
  // price change + current spend so the Opportunity Engine can be pre-filled.
  const rawConstructs = Array.isArray(meta.dealConstructs)
    ? (meta.dealConstructs as Array<Record<string, unknown>>)
    : []
  let dealHandoff: ProposalDealHandoff | null = null
  if (rawConstructs.length > 0) {
    const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0)
    // Route through the canonical blend (CLAUDE.md: never re-derive inline).
    // Its Target tier is dropped when no target prices were entered — in that
    // case the price change is 0, not −100% (bug-bash V-C6).
    const blended = blendConstructsToScenarios(
      rawConstructs.map((c) => ({
        current: num(c.current),
        floor: num(c.floor),
        target: num(c.target),
        ask: num(c.ask),
        annualVolume: num(c.annualVolume),
        rebatePercent: num(c.rebatePercent),
      })),
    )
    const totalVol =
      blended.scenarios[0]?.estimatedAnnualVolume ??
      rawConstructs.reduce((s, c) => s + Math.max(0, num(c.annualVolume)), 0)
    const blendedCur = totalVol > 0 ? blended.currentAnnualSpend / totalVol : 0
    const blendedTgt =
      blended.scenarios.find((s) => s.scenarioName === "Target")?.unitPrice ?? 0
    dealHandoff = {
      // Prefer the facility/share the deal was actually ANALYZED with
      // (persisted by runAnalysis, bug-bash V-C5) — the builder's
      // facilityIds[0]/marketShareCommitment are only the pre-lifecycle
      // fallback, so persisted and live handoffs stay identical.
      facilityId:
        (typeof meta.dealFacilityId === "string" && meta.dealFacilityId) ||
        ((meta.facilityIds as string[]) ?? [])[0] ||
        null,
      currentAnnualSpend:
        num(meta.dealCurrentAnnualSpend) || blended.currentAnnualSpend,
      priceChangePct:
        blendedCur > 0 && blendedTgt > 0
          ? (blendedTgt - blendedCur) / blendedCur
          : 0,
      targetSharePct:
        meta.dealTargetSharePct != null
          ? Number(meta.dealTargetSharePct)
          : meta.marketShareCommitment != null
            ? Number(meta.marketShareCommitment)
            : null,
      capitalRevenue:
        meta.dealCapitalRevenue != null
          ? Number(meta.dealCapitalRevenue)
          : null,
      constructCount: rawConstructs.length,
      // Carry the per-construct rows so the Opportunity Engine's by-product
      // export works from a saved proposal (was computed-then-discarded).
      constructs: rawConstructs.map((c) => ({
        productName: typeof c.productName === "string" ? c.productName : "",
        category: typeof c.category === "string" ? c.category : undefined,
        current: num(c.current),
        floor: num(c.floor),
        target: num(c.target),
        ask: num(c.ask),
        annualVolume: num(c.annualVolume),
        rebatePercent: num(c.rebatePercent),
      })),
    }
  }

  return {
    id,
    vendorId,
    name:
      typeof meta.name === "string" && meta.name.trim()
        ? meta.name.trim()
        : undefined,
    facilityIds: (meta.facilityIds as string[]) ?? [],
    // Audit M7: these rows ARE drafts (vendor-internal analysis docs,
    // status "draft" in PendingContract; legacy alert rows were never
    // submitted to a facility either). Don't claim "submitted".
    status: "draft" as const,
    stage:
      meta.opportunityScenario != null
        ? ("analyzed" as const)
        : dealScore
          ? ("scored" as const)
          : ("draft" as const),
    editable,
    itemCount: ((meta.pricingItems as unknown[]) ?? []).length,
    totalProposedCost: Number(meta.totalCost ?? 0),
    dealScore,
    createdAt: createdAt.toISOString(),
    productCategories: (meta.productCategories as string[]) ?? undefined,
    contractLengthMonths: terms?.contractLength,
    projectedSpend:
      meta.projectedSpend != null ? Number(meta.projectedSpend) : undefined,
    projectedVolume:
      meta.projectedVolume != null ? Number(meta.projectedVolume) : undefined,
    marketShareCommitment:
      meta.marketShareCommitment != null
        ? Number(meta.marketShareCommitment)
        : undefined,
    gpoFee: meta.gpoFee != null ? Number(meta.gpoFee) : undefined,
    aiNotes:
      (meta.aiNotes as string | undefined) ?? terms?.notes ?? undefined,
    terms: (meta.proposalTerms as ProposalTermSummary[]) ?? undefined,
    dealHandoff,
  }
}

/**
 * Proposal-feed split (2026-06-09): reads the REAL source — draft
 * `PendingContract` rows with the `pricingData.kind` discriminator —
 * plus a tolerant legacy read of pre-split masquerade `Alert` rows so
 * historic proposals don't vanish from the list. `createProposal` no
 * longer writes alert rows; once legacy databases are cleaned up the
 * alert branch can be dropped.
 */
export async function getVendorProposals(
  _vendorId?: string
): Promise<VendorProposal[]> {
  const { vendor, user } = await requireVendor()
  // Hard division isolation: restricted members see only their divisions'
  // proposals (undefined = enterprise/Super, byte-identical to pre-feature).
  // Legacy Alert rows carry no division, so they are enterprise-only.
  const divisionIds = await callerVendorDivisionIds(user.id, vendor.id)
  const divisionScope = await divisionScopeWhere(divisionIds)

  // Audit L13: select only the columns the mapper reads — the payload
  // sent to the client is already count-mapped (itemCount, not the full
  // pricingItems array), so don't drag whole rows out of the DB either.
  const [pendingRows, legacyAlerts] = await Promise.all([
    prisma.pendingContract.findMany({
      where: {
        vendorId: vendor.id,
        ...onlyProspectiveProposalRows(),
        ...divisionScope,
      },
      select: { id: true, submittedAt: true, pricingData: true },
      orderBy: { submittedAt: "desc" },
    }),
    divisionIds === undefined
      ? prisma.alert.findMany({
          where: {
            vendorId: vendor.id,
            alertType: "compliance",
            ...onlyVendorProposalAlerts(),
          },
          select: { id: true, createdAt: true, metadata: true },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ])

  const proposals = [
    ...pendingRows.map((p) =>
      payloadToProposal(
        p.id,
        vendor.id,
        p.submittedAt,
        (p.pricingData ?? {}) as Record<string, unknown>,
      ),
    ),
    ...legacyAlerts.map((a) =>
      payloadToProposal(
        a.id,
        vendor.id,
        a.createdAt,
        (a.metadata ?? {}) as Record<string, unknown>,
        // Legacy Alert rows can't be edited — updateProposal only writes
        // PendingContract rows, so the Edit affordance is hidden (D9).
        false,
      ),
    ),
  ].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  return serialize(proposals)
}

// ─── Vendor: Get Proposal Detail (full builder payload) ─────────

/**
 * Read the FULL proposal payload for the detail dialog — the pricing
 * rows, contract-term extras, divisions, and resolved facility names
 * that `getVendorProposals` strips for the lean list (audit L13).
 *
 * Vendor-scoped (tenant isolation): the row is only returned when it
 * belongs to the caller's vendor. Mirrors `deleteProposal`'s two-source
 * read — new draft `PendingContract` rows first, then the legacy
 * masquerade `Alert` rows so historic proposals still open.
 */
export async function getVendorProposalDetail(
  id: string,
): Promise<VendorProposalDetail> {
  const { vendor, user } = await requireVendor()
  const divisionIds = await callerVendorDivisionIds(user.id, vendor.id)
  const divisionScope = await divisionScopeWhere(divisionIds)

  const pending = await prisma.pendingContract.findFirst({
    where: {
      id,
      vendorId: vendor.id,
      ...onlyProspectiveProposalRows(),
      ...divisionScope,
    },
    select: { id: true, submittedAt: true, pricingData: true },
  })
  // Legacy Alert rows carry no division — enterprise-only under restriction.
  const legacy =
    pending || divisionIds !== undefined
      ? null
      : await prisma.alert.findFirst({
          where: { id, vendorId: vendor.id, ...onlyVendorProposalAlerts() },
          select: { id: true, createdAt: true, metadata: true },
        })

  if (!pending && !legacy) throw new Error("Proposal not found")

  const createdAt = pending ? pending.submittedAt : legacy!.createdAt
  const meta = ((pending ? pending.pricingData : legacy!.metadata) ??
    {}) as Record<string, unknown>

  const base = payloadToProposal(id, vendor.id, createdAt, meta, !!pending)

  const terms = meta.terms as
    | {
        contractLength?: number
        startDate?: string
        paymentTerms?: string
        notes?: string
      }
    | undefined
  const pricingItems = (meta.pricingItems as ProposedPricingItem[]) ?? []
  const divisions = (meta.divisions as string[] | undefined)?.filter(Boolean)
  // Per-construct deal rows persisted by the Deal Scorer (View → Deal tab).
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0)
  const dealConstructs = Array.isArray(meta.dealConstructs)
    ? (meta.dealConstructs as Array<Record<string, unknown>>).map((c) => ({
        benchmarkId: typeof c.benchmarkId === "string" ? c.benchmarkId : null,
        productName: typeof c.productName === "string" ? c.productName : "",
        category: typeof c.category === "string" ? c.category : undefined,
        current: num(c.current),
        floor: num(c.floor),
        target: num(c.target),
        ask: num(c.ask),
        annualVolume: num(c.annualVolume),
        rebatePercent: num(c.rebatePercent),
      }))
    : undefined
  const oppParsed = opportunityScenarioSchema.safeParse(meta.opportunityScenario)
  const opportunityScenario = oppParsed.success ? oppParsed.data : undefined
  // Step-1 assumptions round-trip (Wave-2 D) — tolerant read: older
  // proposals (no key / drifted shape) simply come back undefined.
  const assumptionsParsed = dealAssumptionsSchema.safeParse(
    meta.dealAssumptions,
  )
  const dealAssumptions = assumptionsParsed.success
    ? assumptionsParsed.data
    : undefined

  // Resolve targeted facilities to names. The builder writes ["none"]
  // when no facility was picked (audit M7) — drop that placeholder.
  const realFacilityIds = base.facilityIds.filter((fid) => fid && fid !== "none")
  // Scope the name lookup to facilities this vendor actually relates to
  // (security audit 2026-07-05, LOW): a vendor could otherwise plant an
  // arbitrary facility cuid in its own draft's `facilityIds` and read the
  // name back. Unrelated ids fall through to "Unknown facility". Predicate
  // mirrors vendor-prospective's `vendorRelatedFacilityWhere`.
  const facilityRows = realFacilityIds.length
    ? await prisma.facility.findMany({
        where: {
          id: { in: realFacilityIds },
          OR: [
            {
              contracts: {
                some: {
                  OR: [
                    { vendorId: vendor.id },
                    { additionalVendorIds: { has: vendor.id } },
                  ],
                },
              },
            },
            { cogRecords: { some: { vendorId: vendor.id } } },
            { pendingContracts: { some: { vendorId: vendor.id } } },
          ],
        },
        select: { id: true, name: true },
      })
    : []
  const nameById = new Map(facilityRows.map((f) => [f.id, f.name]))
  const facilities: ProposalFacilityRef[] = realFacilityIds.map((fid) => ({
    id: fid,
    name: nameById.get(fid) ?? "Unknown facility",
  }))

  return serialize({
    ...base,
    pricingItems,
    startDate: terms?.startDate,
    paymentTerms: terms?.paymentTerms,
    termsNotes: terms?.notes,
    divisions: divisions && divisions.length ? divisions : undefined,
    facilities,
    dealConstructs: dealConstructs && dealConstructs.length ? dealConstructs : undefined,
    opportunityScenario,
    dealAssumptions,
  })
}

/**
 * Persist an Opportunity Engine run onto a proposal so its "View" dialog shows
 * the last scenario (Vick 2026-06-24 "view should show all of that"). Vendor-
 * scoped + zod-validated JSON-column write.
 */
export async function updateProposalOpportunity(input: {
  proposalId: string
  scenario: ProposalOpportunityScenario
}): Promise<void> {
  const { vendor, user } = await requireVendor()
  await requireCanMutate()
  const parsed = opportunityScenarioSchema.safeParse(input.scenario)
  if (!parsed.success) throw new Error("Invalid opportunity scenario")
  const divisionScope = await divisionScopeWhere(
    await callerVendorDivisionIds(user.id, vendor.id),
  )
  const row = await prisma.pendingContract.findFirst({
    where: {
      id: input.proposalId,
      vendorId: vendor.id,
      ...onlyProspectiveProposalRows(),
      ...divisionScope,
    },
    select: { id: true, pricingData: true },
  })
  if (!row) throw new Error("Proposal not found")
  const meta = (row.pricingData ?? {}) as Record<string, unknown>
  // auth-scope-scanner-skip: row authorized via the vendor-scoped findFirst above
  await prisma.pendingContract.update({
    where: { id: row.id },
    data: {
      pricingData: JSON.parse(
        JSON.stringify({ ...meta, opportunityScenario: parsed.data }),
      ) as Prisma.InputJsonValue,
    },
  })
}
