"use server"

import { prisma } from "@/lib/db"
import type { Prisma } from "@/lib/generated/prisma/client"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import { createInAppNotificationsInternal } from "@/lib/notifications/in-app-helper"
import { onlyVendorProposalAlerts } from "@/lib/alerts/vendor-proposal-filter"
import {
  onlyProspectiveProposalRows,
  PROSPECTIVE_PROPOSAL_KIND,
} from "@/lib/prospective/proposal-rows"

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
  dealScore: DealScore | null
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
}

// NOTE: The legacy `analyzeProposal` 0-100 scoring action and its UI
// consumers (`components/facility/analysis/proposal-upload.tsx`,
// `proposal-comparison-table.tsx`, `useAnalyzeProposal` hook, and the
// `ItemComparison` / `ProposalAnalysis` types) were removed on
// 2026-05-04. The canonical 5-dimension 0-10 engine lives at
// `lib/actions/prospective-analysis.ts` and is the only `analyzeProposal`
// export in the codebase. See
// `docs/superpowers/audits/2026-05-04-prospective-analysis-audit.md`.

// ─── Score a Deal ───────────────────────────────────────────────

export async function scoreDeal(input: {
  financialValue: number
  rebateEfficiency: number
  pricingCompetitiveness: number
  marketShareAlignment: number
  complianceLikelihood: number
}): Promise<DealScore> {
  await requireFacility()
  return computeDealScore(input)
}

function computeDealScore(input: {
  financialValue: number
  rebateEfficiency: number
  pricingCompetitiveness: number
  marketShareAlignment: number
  complianceLikelihood: number
}): DealScore {
  const weights = {
    financialValue: 0.3,
    rebateEfficiency: 0.15,
    pricingCompetitiveness: 0.25,
    marketShareAlignment: 0.15,
    complianceLikelihood: 0.15,
  }

  const overall = Math.round(
    input.financialValue * weights.financialValue +
      input.rebateEfficiency * weights.rebateEfficiency +
      input.pricingCompetitiveness * weights.pricingCompetitiveness +
      input.marketShareAlignment * weights.marketShareAlignment +
      input.complianceLikelihood * weights.complianceLikelihood
  )

  let recommendation: DealScore["recommendation"] = "negotiate"
  if (overall >= 80) recommendation = "strong_accept"
  else if (overall >= 65) recommendation = "accept"
  else if (overall < 40) recommendation = "reject"

  return {
    overall,
    ...input,
    recommendation,
  }
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
  projectedSpend?: number
  projectedVolume?: number
  marketShareCommitment?: number
  gpoFee?: number
  aiNotes?: string
  proposalTerms?: ProposalTermSummary[]
}): Promise<VendorProposal> {
  const { vendor } = await requireVendor()

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
  if (memberUserIds.length > 0) {
    void createInAppNotificationsInternal({
      userIds: memberUserIds,
      type: "vendor_proposal_created",
      title: `Proposal submitted to ${input.facilityIds.length} facilities`,
      body: `${input.pricingItems.length} items, $${totalCost.toLocaleString()} total`,
      payload: { proposalId: row.id },
      actionUrl: "/vendor/prospective",
    })
  }

  return serialize({
    id: row.id,
    vendorId: vendor.id,
    facilityIds: input.facilityIds,
    status: "submitted",
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
 * Returns benchmark rows scoped to the calling vendor's `vendorItemNo`s.
 * Pulls from `ProductBenchmark` rows tagged with the vendor's id, plus
 * national-benchmark rows that match item numbers the vendor has actually
 * sold (i.e. appear in COGRecord under this vendorId). Vendor scoping is
 * enforced via `requireVendor()` and the `vendorId` filter in both queries.
 */
export async function getVendorBenchmarks(): Promise<VendorBenchmarkRow[]> {
  const { vendor } = await requireVendor()

  // 1) Direct vendor benchmarks
  const direct = await prisma.productBenchmark.findMany({
    where: { vendorId: vendor.id },
    orderBy: [{ category: "asc" }, { vendorItemNo: "asc" }],
  })

  // 2) National benchmarks (no vendorId) that match this vendor's catalog
  // (item numbers seen in COGRecord under this vendor).
  const cogItems = await prisma.cOGRecord.findMany({
    where: { vendorId: vendor.id },
    select: { vendorItemNo: true },
    distinct: ["vendorItemNo"],
    take: 500,
  })
  const cogItemNos = cogItems
    .map((r) => r.vendorItemNo)
    .filter((n): n is string => typeof n === "string" && n.length > 0)

  const national =
    cogItemNos.length > 0
      ? await prisma.productBenchmark.findMany({
          where: { vendorId: null, vendorItemNo: { in: cogItemNos } },
          orderBy: [{ category: "asc" }, { vendorItemNo: "asc" }],
        })
      : []

  const seen = new Set<string>()
  const all = [...direct, ...national].filter((b) => {
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
  return {
    id,
    vendorId,
    facilityIds: (meta.facilityIds as string[]) ?? [],
    status: "submitted" as const,
    itemCount: ((meta.pricingItems as unknown[]) ?? []).length,
    totalProposedCost: Number(meta.totalCost ?? 0),
    dealScore: null,
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

  const [pendingRows, legacyAlerts] = await Promise.all([
    prisma.pendingContract.findMany({
      where: { vendorId: vendor.id, ...onlyProspectiveProposalRows() },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.alert.findMany({
      where: {
        vendorId: vendor.id,
        alertType: "compliance",
        ...onlyVendorProposalAlerts(),
      },
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
