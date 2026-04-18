"use server"

/**
 * Prospective analysis — engine-wired server actions.
 *
 * Thin Prisma-backed wrappers around the pure engines in
 * `lib/prospective-analysis/`:
 *   - scoring + recommendation + rebate-tier generator (analyzeProposal)
 *   - cog-spend-analyzer (getVendorCOGPatterns)
 *   - pdf-clause-analyzer (analyzeUploadedPDF)
 *   - comparison (compareStoredProposals — placeholder until
 *     ContractChangeProposal.kind="proposal_analysis" is populated)
 *
 * Strict TypeScript, no `any`. All tier math / scoring / tier synthesis /
 * PDF clause matching is delegated to the pure modules — this file only
 * loads data from Prisma, shapes it, and returns serialized results.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import {
  calculateProposalScores,
  type ProposalInput,
  type ProposalScores,
} from "@/lib/prospective-analysis/scoring"
import {
  generateRecommendation,
  type Recommendation,
} from "@/lib/prospective-analysis/recommendation"
import {
  generateDynamicRebateTiers,
  type DynamicRebateTier,
} from "@/lib/prospective-analysis/rebate-tiers"
import {
  compareProposals,
  type ComparisonResult,
} from "@/lib/prospective-analysis/comparison"
import {
  analyzeCOGSpendPatterns,
  type CogPurchase,
  type PricingFileRow,
  type SpendPatternAnalysis,
} from "@/lib/prospective-analysis/cog-spend-analyzer"
import {
  analyzePDFContract,
  type ClauseAnalysis,
} from "@/lib/prospective-analysis/pdf-clause-analyzer"

// ─── Re-exported types for callers ──────────────────────────────────

export type {
  ProposalScores,
  DynamicRebateTier,
  Recommendation,
  ComparisonResult,
  SpendPatternAnalysis,
  ClauseAnalysis,
}

// ─── analyzeProposal ────────────────────────────────────────────────

export interface AnalyzeProposalInput {
  proposedAnnualSpend: number
  currentSpend: number
  priceVsMarket: number
  minimumSpend: number
  proposedRebateRate: number
  termYears: number
  exclusivity: boolean
  marketShareCommitment?: number | null
  minimumSpendIsHighPct: boolean
  priceProtection: boolean
  paymentTermsNet60Or90: boolean
  volumeDiscountAbove5Percent: boolean
}

export interface AnalyzeProposalResult {
  scores: ProposalScores
  recommendation: Recommendation
  dynamicTiers: DynamicRebateTier[]
}

/**
 * Score a prospective vendor proposal. Wraps the pure scoring engine,
 * the recommendation generator, and the dynamic rebate-tier synthesizer
 * into a single round-trip so the UI can render all three blocks from
 * one action call.
 */
export async function analyzeProposal(
  input: AnalyzeProposalInput,
): Promise<AnalyzeProposalResult> {
  await requireFacility()

  const scoringInput: ProposalInput = {
    proposedAnnualSpend: input.proposedAnnualSpend,
    currentSpend: input.currentSpend,
    priceVsMarket: input.priceVsMarket,
    minimumSpend: input.minimumSpend,
    proposedRebateRate: input.proposedRebateRate,
    termYears: input.termYears,
    exclusivity: input.exclusivity,
    marketShareCommitment: input.marketShareCommitment ?? null,
    minimumSpendIsHighPct: input.minimumSpendIsHighPct,
    priceProtection: input.priceProtection,
    paymentTermsNet60Or90: input.paymentTermsNet60Or90,
    volumeDiscountAbove5Percent: input.volumeDiscountAbove5Percent,
  }

  const scores = calculateProposalScores(scoringInput)
  const recommendation = generateRecommendation(scores, {
    termYears: input.termYears,
    exclusivity: input.exclusivity,
    marketShareCommitment: input.marketShareCommitment ?? null,
    minimumSpendIsHighPct: input.minimumSpendIsHighPct,
  })
  const dynamicTiers = generateDynamicRebateTiers({
    baselineSpend: input.currentSpend,
    proposedRebateRate: input.proposedRebateRate,
  })

  return serialize({ scores, recommendation, dynamicTiers })
}

// ─── getVendorCOGPatterns ──────────────────────────────────────────

/**
 * Load last-12-months COG purchases + pricing-file rows for the given
 * vendor (scoped to the caller's facility), then feed them through the
 * pure COG spend-pattern analyzer.
 */
export async function getVendorCOGPatterns(
  vendorId: string,
): Promise<SpendPatternAnalysis> {
  const { facility } = await requireFacility()

  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1)

  const [cogRows, pricingRows, facilityTotalAgg] = await Promise.all([
    prisma.cOGRecord.findMany({
      where: {
        facilityId: facility.id,
        vendorId,
        transactionDate: { gte: twelveMonthsAgo },
      },
      select: {
        transactionDate: true,
        extendedPrice: true,
        vendorId: true,
        vendorItemNo: true,
        inventoryDescription: true,
        category: true,
      },
    }),
    prisma.pricingFile.findMany({
      where: {
        facilityId: facility.id,
        vendorId,
      },
      select: {
        vendorItemNo: true,
        contractPrice: true,
      },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        transactionDate: { gte: twelveMonthsAgo },
      },
      _sum: { extendedPrice: true },
    }),
  ])

  const purchases: CogPurchase[] = cogRows.map((row) => ({
    transactionDate: row.transactionDate,
    extendedPrice: Number(row.extendedPrice ?? 0),
    vendorId: row.vendorId ?? vendorId,
    vendorItemNo: row.vendorItemNo,
    productDescription: row.inventoryDescription,
    productCategory: row.category,
  }))

  const pricingFile: PricingFileRow[] = pricingRows
    .filter((p) => p.contractPrice !== null && p.contractPrice !== undefined)
    .map((p) => ({
      vendorItemNo: p.vendorItemNo,
      contractPrice: Number(p.contractPrice ?? 0),
    }))

  const categoryTotalSpend12Mo = Number(
    facilityTotalAgg._sum.extendedPrice ?? 0,
  )

  const analysis = analyzeCOGSpendPatterns({
    vendorId,
    purchases,
    pricingFile,
    categoryTotalSpend12Mo,
  })

  return serialize(analysis)
}

// ─── analyzeUploadedPDF ────────────────────────────────────────────

export interface AnalyzeUploadedPDFInput {
  pdfText: string
  fileName?: string
}

/**
 * Run the deterministic PDF clause analyzer on uploaded contract text
 * and emit an audit log entry. No Claude fallback here — callers wire
 * the LLM pass separately.
 */
export async function analyzeUploadedPDF(
  input: AnalyzeUploadedPDFInput,
): Promise<ClauseAnalysis> {
  const session = await requireFacility()

  const analysis = analyzePDFContract(input.pdfText)

  await logAudit({
    userId: session.user.id,
    action: "prospective.pdf_analyzed",
    entityType: "pdf_analysis",
    metadata: {
      fileName: input.fileName ?? null,
      textLength: input.pdfText.length,
      overallRiskScore: analysis.overallRiskScore,
      foundCount: analysis.findings.filter((f) => f.found).length,
      missingHighRiskCount: analysis.missingHighRiskCategories.length,
    },
  })

  return serialize(analysis)
}

// ─── compareStoredProposals (placeholder) ───────────────────────────

/**
 * Compare stored `ContractChangeProposal` rows scored as
 * "proposal_analysis". Until that kind is populated by a later
 * subsystem we return an empty comparison (the pure compareProposals
 * supports zero inputs). The facility ownership check still runs so
 * the route remains auth-scoped.
 */
export async function compareStoredProposals(
  proposalIds: string[],
): Promise<ComparisonResult> {
  await requireFacility()
  void proposalIds // reserved for future persisted-proposal lookup
  return serialize(compareProposals([]))
}
