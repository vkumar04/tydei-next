"use server"

import { prisma } from "@/lib/db"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"

// ─── Types ──────────────────────────────────────────────────────

export interface ProposedPricingItem {
  vendorItemNo: string
  description?: string
  proposedPrice: number
  currentPrice?: number
  quantity?: number
}

export interface ItemComparison {
  vendorItemNo: string
  description: string
  currentPrice: number
  proposedPrice: number
  savings: number
  savingsPercent: number
}

export interface ProposalAnalysis {
  itemComparisons: ItemComparison[]
  totalCurrentCost: number
  totalProposedCost: number
  totalSavings: number
  totalSavingsPercent: number
  dealScore: DealScore
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

// ─── Facility: Analyze Proposal ─────────────────────────────────

export async function analyzeProposal(input: {
  facilityId?: string
  proposedPricing: ProposedPricingItem[]
  vendorId?: string
}): Promise<ProposalAnalysis> {
  const { facility } = await requireFacility()

  const itemComparisons: ItemComparison[] = []

  for (const item of input.proposedPricing) {
    let currentPrice = item.currentPrice ?? 0

    // Look up current COG price if not provided
    if (!currentPrice && item.vendorItemNo) {
      const cogRecord = await prisma.cOGRecord.findFirst({
        where: {
          facilityId: facility.id,
          vendorItemNo: item.vendorItemNo,
        },
        orderBy: { transactionDate: "desc" },
        select: { unitCost: true },
      })
      currentPrice = cogRecord ? Number(cogRecord.unitCost) : 0
    }

    const savings = currentPrice - item.proposedPrice
    const savingsPercent =
      currentPrice > 0 ? (savings / currentPrice) * 100 : 0

    itemComparisons.push({
      vendorItemNo: item.vendorItemNo,
      description: item.description ?? item.vendorItemNo,
      currentPrice,
      proposedPrice: item.proposedPrice,
      savings: Math.round(savings * 100) / 100,
      savingsPercent: Math.round(savingsPercent * 100) / 100,
    })
  }

  const totalCurrentCost = itemComparisons.reduce(
    (s, i) => s + i.currentPrice * (input.proposedPricing.find((p) => p.vendorItemNo === i.vendorItemNo)?.quantity ?? 1),
    0
  )
  const totalProposedCost = itemComparisons.reduce(
    (s, i) => s + i.proposedPrice * (input.proposedPricing.find((p) => p.vendorItemNo === i.vendorItemNo)?.quantity ?? 1),
    0
  )
  const totalSavings = totalCurrentCost - totalProposedCost
  const totalSavingsPercent =
    totalCurrentCost > 0 ? (totalSavings / totalCurrentCost) * 100 : 0

  // ─── Compute all 5 deal-score dimensions from actual data ─────

  // financialValue: based on total savings percentage (0-100 scale)
  const financialValue = Math.min(100, Math.max(0, totalSavingsPercent * 10 + 50))

  // pricingCompetitiveness: same basis as financialValue
  const pricingCompetitiveness = financialValue

  // rebateEfficiency: how attainable are spend tiers given actual COG data?
  // Look up recent annual spend for this vendor to gauge tier reachability
  let rebateEfficiency = 50 // default fallback
  if (input.vendorId) {
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    const annualSpend = await prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: input.vendorId,
        transactionDate: { gte: oneYearAgo },
      },
      _sum: { extendedPrice: true },
    })
    const historicalSpend = Number(annualSpend._sum?.extendedPrice ?? 0)
    if (historicalSpend > 0) {
      // Compare historical spend to proposed cost — higher ratio = more attainable
      const spendRatio = historicalSpend / Math.max(totalProposedCost, 1)
      rebateEfficiency = Math.min(100, Math.max(0, spendRatio * 50))
    }
  }

  // marketShareAlignment: % of proposed items that matched COG records vs total proposed items
  const matchedItems = itemComparisons.filter((ic) => ic.currentPrice > 0).length
  const totalItems = itemComparisons.length
  const marketShareAlignment = totalItems > 0
    ? Math.min(100, Math.round((matchedItems / totalItems) * 100))
    : 50

  // complianceLikelihood: % of items with price decrease (savings > 0) vs total items
  const itemsWithDecrease = itemComparisons.filter((ic) => ic.savings > 0).length
  const complianceLikelihood = totalItems > 0
    ? Math.min(100, Math.round((itemsWithDecrease / totalItems) * 100))
    : 50

  const dealScore = computeDealScore({
    financialValue,
    rebateEfficiency,
    pricingCompetitiveness,
    marketShareAlignment,
    complianceLikelihood,
  })

  return serialize({
    itemComparisons,
    totalCurrentCost: Math.round(totalCurrentCost * 100) / 100,
    totalProposedCost: Math.round(totalProposedCost * 100) / 100,
    totalSavings: Math.round(totalSavings * 100) / 100,
    totalSavingsPercent: Math.round(totalSavingsPercent * 100) / 100,
    dealScore,
  })
}

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

// ─── Vendor: Create Proposal (in-memory, stored as alert metadata) ──

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

  // Store as an alert so we persist without schema migration
  const alert = await prisma.alert.create({
    data: {
      portalType: "vendor",
      alertType: "compliance",
      title: `Proposal submitted to ${input.facilityIds.length} facilities`,
      description: `${input.pricingItems.length} items, $${totalCost.toLocaleString()} total`,
      severity: "low",
      status: "new_alert",
      vendorId: vendor.id,
      metadata: JSON.parse(JSON.stringify({
        type: "vendor_proposal",
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
      })),
    },
  })

  return serialize({
    id: alert.id,
    vendorId: vendor.id,
    facilityIds: input.facilityIds,
    status: "submitted",
    itemCount: input.pricingItems.length,
    totalProposedCost: totalCost,
    dealScore: null,
    createdAt: alert.createdAt.toISOString(),
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
 * Delete a vendor's own proposal. Vendor proposals are persisted as
 * `Alert` rows with `metadata.type === "vendor_proposal"` (see
 * `createProposal` above). This action enforces vendor ownership of
 * the underlying alert before deleting.
 *
 * The constraints in CLAUDE.md / V1 audit reserved `withdrawPendingContract`
 * for `PendingContract` rows submitted via the contract-submission flow;
 * those are a different table from the prospective proposals shown here.
 */
export async function deleteProposal(id: string): Promise<void> {
  const { vendor } = await requireVendor()

  // Look up the alert tenant-scoped to this vendor. A non-vendor row
  // or a row owned by another vendor is invisible here, which gives
  // us the auth gate in a single query.
  const alert = await prisma.alert.findFirst({
    where: { id, vendorId: vendor.id },
    select: { id: true, metadata: true },
  })

  if (!alert) {
    throw new Error("Proposal not found")
  }

  const meta = alert.metadata as Record<string, unknown> | null
  if (meta?.type !== "vendor_proposal") {
    throw new Error("Not a vendor proposal")
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

export async function getVendorProposals(
  _vendorId?: string
): Promise<VendorProposal[]> {
  const { vendor } = await requireVendor()

  const alerts = await prisma.alert.findMany({
    where: {
      vendorId: vendor.id,
      alertType: "compliance",
    },
    orderBy: { createdAt: "desc" },
  })

  return serialize(alerts
    .filter((a) => {
      const meta = a.metadata as Record<string, unknown> | null
      return meta?.type === "vendor_proposal"
    })
    .map((a) => {
      const meta = a.metadata as Record<string, unknown>
      const terms = meta.terms as
        | { contractLength?: number; notes?: string }
        | undefined
      return {
        id: a.id,
        vendorId: vendor.id,
        facilityIds: (meta.facilityIds as string[]) ?? [],
        status: "submitted" as const,
        itemCount: ((meta.pricingItems as unknown[]) ?? []).length,
        totalProposedCost: Number(meta.totalCost ?? 0),
        dealScore: null,
        createdAt: a.createdAt.toISOString(),
        productCategories: (meta.productCategories as string[]) ?? undefined,
        contractLengthMonths: terms?.contractLength,
        projectedSpend:
          meta.projectedSpend != null ? Number(meta.projectedSpend) : undefined,
        projectedVolume:
          meta.projectedVolume != null
            ? Number(meta.projectedVolume)
            : undefined,
        marketShareCommitment:
          meta.marketShareCommitment != null
            ? Number(meta.marketShareCommitment)
            : undefined,
        gpoFee: meta.gpoFee != null ? Number(meta.gpoFee) : undefined,
        aiNotes:
          (meta.aiNotes as string | undefined) ??
          terms?.notes ??
          undefined,
        terms: (meta.proposalTerms as ProposalTermSummary[]) ?? undefined,
      }
    }))
}
