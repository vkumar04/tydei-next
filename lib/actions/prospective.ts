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

export interface VendorProposal {
  id: string
  vendorId: string
  facilityIds: string[]
  status: "draft" | "submitted" | "accepted" | "rejected"
  itemCount: number
  totalProposedCost: number
  dealScore: DealScore | null
  createdAt: string
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
  })
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
      return {
        id: a.id,
        vendorId: vendor.id,
        facilityIds: (meta.facilityIds as string[]) ?? [],
        status: "submitted" as const,
        itemCount: ((meta.pricingItems as unknown[]) ?? []).length,
        totalProposedCost: Number(meta.totalCost ?? 0),
        dealScore: null,
        createdAt: a.createdAt.toISOString(),
      }
    }))
}
