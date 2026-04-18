"use server"

/**
 * Financial-analysis server actions.
 *
 * Wires the pure engines in `lib/financial-analysis/*` onto Prisma-backed
 * contract data. Each action:
 *
 *   1. Enforces facility scope via `requireFacility` + the shared
 *      `contractOwnershipWhere` predicate.
 *   2. Loads the contract + any indexed PDF text needed for clause risk.
 *   3. Delegates the math to the pure engines (ROI, clause-risk
 *      adjustment, narrative builder).
 *   4. Serializes Decimals/Dates before returning to the client.
 *
 * Reference: docs/superpowers/specs/2026-04-18-financial-analysis-rewrite.md
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import {
  computeCapitalROI,
  type CapitalROIResult,
} from "@/lib/financial-analysis/roi"
import {
  adjustNPVForClauseRisk,
  type AdjustedNPV,
  type ClauseFindingForRisk,
} from "@/lib/financial-analysis/clause-risk-adjustment"
import {
  buildFinancialAnalysisNarrative,
  type AnalysisNarrative,
} from "@/lib/financial-analysis/narrative"
import { analyzePDFContract } from "@/lib/prospective-analysis/pdf-clause-analyzer"

// ─── Types ───────────────────────────────────────────────────────

export interface AnalyzeCapitalContractInput {
  contractId: string
  discountRate: number
  taxRate: number
  annualSpend: number
  rebateRate: number
  growthRatePerYear: number
  marketDeclineRate: number
  payUpfront: boolean
}

export interface AnalyzeCapitalContractResult {
  roi: CapitalROIResult
  narrative: AnalysisNarrative
  riskAdjustedNPV: AdjustedNPV | null
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Compute contract term length in whole years from effective/expiration
 * dates. Rounds to the nearest whole year (minimum 1). Uses UTC-safe
 * millisecond diff so timezone drift doesn't flip the year count at
 * midnight.
 */
function contractYears(effective: Date, expiration: Date): number {
  const ms = expiration.getTime() - effective.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 1
  const years = ms / (365.25 * 24 * 60 * 60 * 1000)
  return Math.max(1, Math.round(years))
}

/**
 * Convert the full clause analysis findings into the subset the
 * clause-risk-adjustment engine consumes. We pass through category,
 * found, riskLevel, favorability + a stable findingId the UI can link
 * to (category name is unique per document, so we reuse it).
 */
function toClauseFindingsForRisk(
  findings: Array<{
    category: string
    found: boolean
    riskLevel: "low" | "medium" | "high"
    favorability: "facility" | "neutral" | "vendor"
  }>,
): ClauseFindingForRisk[] {
  return findings.map((f) => ({
    category: f.category,
    found: f.found,
    riskLevel: f.riskLevel,
    favorability: f.favorability,
    findingId: f.category,
  }))
}

// ─── analyzeCapitalContract ──────────────────────────────────────

/**
 * Produce the full financial-analysis payload for a capital contract:
 *
 *   - ROI (NPV, IRR, depreciation, rebates, price-lock cost, cashflows).
 *   - Clause-risk-adjusted NPV when the contract has an indexed PDF
 *     document whose pages contain any clause findings (otherwise null).
 *   - Deterministic narrative (headline, verdict, bullets, risks, cta)
 *     that the UI can render directly without an LLM call.
 *
 * Scope: the contract must belong to (or be shared with) the caller's
 * active facility — non-matches raise via `findFirstOrThrow`.
 */
export async function analyzeCapitalContract(
  input: AnalyzeCapitalContractInput,
): Promise<AnalyzeCapitalContractResult> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(input.contractId, facility.id),
    select: {
      id: true,
      name: true,
      totalValue: true,
      effectiveDate: true,
      expirationDate: true,
      vendor: { select: { name: true } },
      documents: {
        where: { indexStatus: "indexed" },
        select: {
          id: true,
          pages: {
            select: { text: true },
            orderBy: { pageNumber: "asc" },
          },
        },
      },
    },
  })

  const capitalCost = Number(contract.totalValue ?? 0)
  const years = contractYears(contract.effectiveDate, contract.expirationDate)

  const roi = computeCapitalROI({
    capitalCost,
    years,
    discountRate: input.discountRate,
    payUpfront: input.payUpfront,
    taxRate: input.taxRate,
    annualSpend: input.annualSpend,
    rebateRate: input.rebateRate,
    growthRatePerYear: input.growthRatePerYear,
    marketDeclineRate: input.marketDeclineRate,
  })

  // ─── Clause risk adjustment (optional) ──────────────────────────
  //
  // Only applied when the contract has at least one indexed document
  // with page text AND the clause analyzer surfaces at least one
  // found clause (otherwise the "adjustment set" collapses to just
  // the always-on missing-clause defaults, which would misleadingly
  // penalize contracts whose PDFs simply haven't been indexed yet).
  let riskAdjustedNPV: AdjustedNPV | null = null
  const pdfText = contract.documents
    .flatMap((d) => d.pages.map((p) => p.text))
    .join("\n\n")
  if (pdfText.length > 0) {
    const analysis = analyzePDFContract(pdfText)
    const hasAnyFound = analysis.findings.some((f) => f.found)
    if (hasAnyFound) {
      const findings = toClauseFindingsForRisk(analysis.findings)
      riskAdjustedNPV = adjustNPVForClauseRisk(roi.npv, findings)
    }
  }

  const narrative = buildFinancialAnalysisNarrative({
    contractName: contract.name,
    vendorName: contract.vendor?.name ?? "Unknown vendor",
    capitalCost,
    years,
    npv: roi.npv,
    irr: roi.irr,
    discountRate: input.discountRate,
    totalRebate: roi.totalRebate,
    totalTaxSavings: roi.totalTaxSavings,
    totalOpportunityCost: roi.totalOpportunityCost,
    riskAdjustedNPV: riskAdjustedNPV?.riskAdjustedNPV ?? null,
    clauseRiskAdjustmentPercent:
      riskAdjustedNPV?.totalAdjustmentPercent ?? null,
  })

  return serialize({
    roi,
    narrative,
    riskAdjustedNPV,
  })
}
