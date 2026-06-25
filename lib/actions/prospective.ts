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
import { getTrailing12MonthWindow } from "@/lib/dates/trailing-window"

// ─── Types ──────────────────────────────────────────────────────

export interface ProposedPricingItem {
  vendorItemNo: string
  description?: string
  proposedPrice: number
  currentPrice?: number
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
  rebatePercent?: number
}

export interface VendorProposal {
  id: string
  vendorId: string
  facilityIds: string[]
  status: "draft" | "submitted" | "accepted" | "rejected"
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
  constructCount: number
  /** The per-construct rows — feed the Opportunity Engine's by-product export
   *  (structurally matches OppEngineHandoff/OppDealConstructRow). */
  constructs: {
    productName: string
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
}

// NOTE: The legacy `analyzeProposal` 0-100 scoring action and its UI
// consumers (`components/facility/analysis/proposal-upload.tsx`,
// `proposal-comparison-table.tsx`, `useAnalyzeProposal` hook, and the
// `ItemComparison` / `ProposalAnalysis` types) were removed on
// 2026-05-04. The canonical 5-dimension 0-10 engine lives at
// `lib/actions/prospective-analysis.ts` and is the only `analyzeProposal`
// export in the codebase. See
// `docs/superpowers/audits/2026-05-04-prospective-analysis-audit.md`.

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
}): Promise<VendorProposal> {
  const { vendor } = await requireVendor()
  await requireCanMutate()

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
      contractName: `Prospective proposal — ${input.pricingItems.length} item${input.pricingItems.length === 1 ? "" : "s"}`,
      status: "draft",
      totalValue: totalCost,
      notes: input.aiNotes ?? input.terms.notes ?? null,
      pricingData: JSON.parse(
        JSON.stringify({
          kind: PROSPECTIVE_PROPOSAL_KIND,
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
    facilityIds: input.facilityIds,
    status: "draft",
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
  const { vendor } = await requireVendor()
  await requireCanMutate()

  // Current storage: draft PendingContract row, vendor-scoped.
  const pending = await prisma.pendingContract.findFirst({
    where: { id, vendorId: vendor.id, ...onlyProspectiveProposalRows() },
    select: { id: true },
  })
  if (pending) {
    // auth-scope-scanner-skip: row authorized via vendor-scoped findFirst above
    await prisma.pendingContract.delete({ where: { id: pending.id } })
    return
  }

  // Legacy cleanup: pre-split masquerade Alert rows. A non-vendor row
  // or a row owned by another vendor is invisible here, which gives
  // us the auth gate in a single query.
  const alert = await prisma.alert.findFirst({
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
  const { vendor } = await requireVendor()

  // Uploaded-only (Vick 2026-06-22 "Benchmark should only come from uploaded
  // files"): prospective benchmarks are the vendor's OWN uploaded rows
  // (vendorId = vendor.id, from the Benchmarks-tab import). The seeded /
  // national rows (vendorId = null) are intentionally NOT merged in anymore.
  const direct = await prisma.productBenchmark.findMany({
    where: { vendorId: vendor.id },
    orderBy: [{ category: "asc" }, { vendorItemNo: "asc" }],
    take: 500,
  })

  const seen = new Set<string>()
  const all = direct.filter((b) => {
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
    const totalVol = rawConstructs.reduce((s, c) => s + num(c.annualVolume), 0)
    const curSpend = rawConstructs.reduce(
      (s, c) => s + num(c.current) * num(c.annualVolume),
      0,
    )
    const tgtSpend = rawConstructs.reduce(
      (s, c) => s + num(c.target) * num(c.annualVolume),
      0,
    )
    const blendedCur = totalVol > 0 ? curSpend / totalVol : 0
    const blendedTgt = totalVol > 0 ? tgtSpend / totalVol : 0
    dealHandoff = {
      facilityId: ((meta.facilityIds as string[]) ?? [])[0] ?? null,
      currentAnnualSpend: num(meta.dealCurrentAnnualSpend) || curSpend,
      priceChangePct: blendedCur > 0 ? (blendedTgt - blendedCur) / blendedCur : 0,
      targetSharePct:
        meta.marketShareCommitment != null
          ? Number(meta.marketShareCommitment)
          : null,
      constructCount: rawConstructs.length,
      // Carry the per-construct rows so the Opportunity Engine's by-product
      // export works from a saved proposal (was computed-then-discarded).
      constructs: rawConstructs.map((c) => ({
        productName: typeof c.productName === "string" ? c.productName : "",
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
    facilityIds: (meta.facilityIds as string[]) ?? [],
    // Audit M7: these rows ARE drafts (vendor-internal analysis docs,
    // status "draft" in PendingContract; legacy alert rows were never
    // submitted to a facility either). Don't claim "submitted".
    status: "draft" as const,
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
  const { vendor } = await requireVendor()

  // Audit L13: select only the columns the mapper reads — the payload
  // sent to the client is already count-mapped (itemCount, not the full
  // pricingItems array), so don't drag whole rows out of the DB either.
  const [pendingRows, legacyAlerts] = await Promise.all([
    prisma.pendingContract.findMany({
      where: { vendorId: vendor.id, ...onlyProspectiveProposalRows() },
      select: { id: true, submittedAt: true, pricingData: true },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.alert.findMany({
      where: {
        vendorId: vendor.id,
        alertType: "compliance",
        ...onlyVendorProposalAlerts(),
      },
      select: { id: true, createdAt: true, metadata: true },
      orderBy: { createdAt: "desc" },
    }),
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
  const { vendor } = await requireVendor()

  const pending = await prisma.pendingContract.findFirst({
    where: { id, vendorId: vendor.id, ...onlyProspectiveProposalRows() },
    select: { id: true, submittedAt: true, pricingData: true },
  })
  const legacy = pending
    ? null
    : await prisma.alert.findFirst({
        where: { id, vendorId: vendor.id, ...onlyVendorProposalAlerts() },
        select: { id: true, createdAt: true, metadata: true },
      })

  if (!pending && !legacy) throw new Error("Proposal not found")

  const createdAt = pending ? pending.submittedAt : legacy!.createdAt
  const meta = ((pending ? pending.pricingData : legacy!.metadata) ??
    {}) as Record<string, unknown>

  const base = payloadToProposal(id, vendor.id, createdAt, meta)

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

  // Resolve targeted facilities to names. The builder writes ["none"]
  // when no facility was picked (audit M7) — drop that placeholder.
  const realFacilityIds = base.facilityIds.filter((fid) => fid && fid !== "none")
  const facilityRows = realFacilityIds.length
    ? await prisma.facility.findMany({
        where: { id: { in: realFacilityIds } },
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
  })
}
