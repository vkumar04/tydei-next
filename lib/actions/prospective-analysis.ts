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
import {
  analyzePDFContract as analyzePDFContractCanonical,
  type PDFContractAnalysisResult,
  type ContractClause as CanonicalContractClause,
  type UserSide,
  type ContractVariant,
} from "@/lib/contracts/clause-risk-analyzer"
import { extractClauses } from "@/lib/contracts/clause-extractor"
import { computeRebateFromPrismaTiers } from "@/lib/rebates/calculate"
import { normalizeAIRebateValue } from "@/lib/contracts/rebate-value-normalize"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"
import { getTrailing12MonthWindow } from "@/lib/dates/trailing-window"

// ─── Re-exported types for callers ──────────────────────────────────
//
// MUST use the `export type { X } from "module"` form, never a local
// `export type { X }` clause. Turbopack's server-action transform
// (Next 16, prod build) registers every name in a local export clause
// as a runtime server reference — `registerServerReference(ProposalScores,…)`
// — which throws `ReferenceError: ProposalScores is not defined` at
// module evaluation and broke EVERY action in this file in prod
// (Charles "Analysis is still broken", 2026-06-09, digest 3119269338).
// The from-form is erased correctly (verified against the compiled
// chunk for rebate-optimizer-engine.ts which already used it).

export type { ProposalScores } from "@/lib/prospective-analysis/scoring"
export type { DynamicRebateTier } from "@/lib/prospective-analysis/rebate-tiers"
export type { Recommendation } from "@/lib/prospective-analysis/recommendation"
export type { ComparisonResult } from "@/lib/prospective-analysis/comparison"
export type { SpendPatternAnalysis } from "@/lib/prospective-analysis/cog-spend-analyzer"
export type { ClauseAnalysis } from "@/lib/prospective-analysis/pdf-clause-analyzer"
export type {
  PDFContractAnalysisResult,
  ContractClause as CanonicalContractClause,
  UserSide,
  ContractVariant,
} from "@/lib/contracts/clause-risk-analyzer"

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
  const session = await requireFacility()
  try {
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
  } catch (err) {
    console.error("[analyzeProposal]", err, {
      facilityId: session.facility.id,
    })
    throw err
  }
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
  try {
  const { start: twelveMonthsAgo } = getTrailing12MonthWindow()

  const [cogRows, pricingRows, facilityCategoryGroups] = await Promise.all([
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
    prisma.cOGRecord.groupBy({
      by: ["category"],
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

  // Denominator for `categoryMarketShare` = facility spend in the VENDOR'S
  // categories (canonicalized), not the whole facility (bug-bash E-C3 — the
  // all-spend denominator diluted the share so `tieInRiskFlag` almost never
  // fired). Vendors with only uncategorized rows fall back to total facility
  // spend, the pre-fix behavior.
  const vendorCategories = new Set(
    cogRows
      .map((r) => canonicalizeCategoryName(r.category))
      .filter((c) => c !== ""),
  )
  const categoryTotalSpend12Mo = facilityCategoryGroups
    .filter(
      (g) =>
        vendorCategories.size === 0 ||
        vendorCategories.has(canonicalizeCategoryName(g.category)),
    )
    .reduce((s, g) => s + Number(g._sum.extendedPrice ?? 0), 0)

  const analysis = analyzeCOGSpendPatterns({
    vendorId,
    purchases,
    pricingFile,
    categoryTotalSpend12Mo,
  })

  return serialize(analysis)
  } catch (err) {
    console.error("[getVendorCOGPatterns]", err, {
      facilityId: facility.id,
      vendorId,
    })
    throw err
  }
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
  try {
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
  } catch (err) {
    console.error("[analyzeUploadedPDF]", err, {
      facilityId: session.facility.id,
      fileName: input.fileName ?? null,
      textLength: input.pdfText.length,
    })
    throw err
  }
}

// ─── analyzeUploadedPDFCanonical ────────────────────────────────────

export interface AnalyzeUploadedPDFCanonicalInput {
  /** Pre-extracted, pre-categorized clauses. Caller owns the upstream
   *  extraction (regex, Claude, manual). */
  clauses: CanonicalContractClause[]
  side: UserSide
  contractVariant: ContractVariant
  contractName: string
}

/**
 * Run the canonical Charles-spec analyzer (24 categories, RiskLevel
 * with CRITICAL, per-variant REQUIRED_CLAUSES, MISSING_CLAUSE_SUGGESTIONS,
 * cross-clause regulatory checks, side-aware concerns).
 *
 * Wiring overview (added 2026-05-04):
 *  - UI extractor: `lib/contracts/clause-extractor.ts` converts pdfText
 *    → `CanonicalContractClause[]` via a single Sonnet pass.
 *  - UI surfacing: the Upload Proposal tab now exposes side +
 *    contractVariant selectors (`canonical-clause-analyzer-panel.tsx`)
 *    and renders the rich result alongside the legacy panel.
 *  - This action remains the structured "clauses-in, result-out" path
 *    so callers with their own extractors (or persisted clauses) can
 *    skip the LLM hop. See `extractAndAnalyzeUploadedPDFCanonical`
 *    below for the bundled extract + analyze entry point.
 */
export async function analyzeUploadedPDFCanonical(
  input: AnalyzeUploadedPDFCanonicalInput,
): Promise<PDFContractAnalysisResult> {
  const session = await requireFacility()
  try {
    const result = analyzePDFContractCanonical(
      input.clauses,
      input.side,
      input.contractVariant,
      input.contractName,
    )

    await logAudit({
      userId: session.user.id,
      action: "prospective.pdf_analyzed_canonical",
      entityType: "pdf_analysis",
      metadata: {
        contractName: input.contractName,
        side: input.side,
        contractVariant: input.contractVariant,
        clauseCount: input.clauses.length,
        overallRiskScore: result.overallRiskScore,
        overallRiskLevel: result.overallRiskLevel,
        criticalFlagCount: result.criticalFlags.length,
        missingClauseCount: result.missingClauses.length,
      },
    })

    return serialize(result)
  } catch (err) {
    console.error("[analyzeUploadedPDFCanonical]", err, {
      facilityId: session.facility.id,
      contractName: input.contractName,
      side: input.side,
      contractVariant: input.contractVariant,
      clauseCount: input.clauses.length,
    })
    throw err
  }
}

// ─── extractAndAnalyzeUploadedPDFCanonical ─────────────────────────

export interface ExtractAndAnalyzeCanonicalInput {
  /** Plain PDF text (post `extractPdfText`). Truncated to 50KB inside
   *  the extractor — caller can pass the full string. */
  pdfText: string
  side: UserSide
  contractVariant: ContractVariant
  contractName: string
}

export interface ExtractAndAnalyzeCanonicalResult {
  analysis: PDFContractAnalysisResult
  /** Number of clauses the LLM picked up — surfaced in toasts so users
   *  can sanity-check that extraction worked. */
  extractedClauseCount: number
  /** True when the input exceeded the 50KB extractor cap. */
  truncated: boolean
}

/**
 * One-shot: extract clauses with the Sonnet-backed extractor, then
 * run the canonical analyzer. The Upload Proposal tab calls this so
 * the user only sees a single round-trip.
 *
 * Per CLAUDE.md AI-action error-path rule: failures log
 * `[extractAndAnalyzeUploadedPDFCanonical]` with context and re-throw
 * a user-facing message naming the action + failure kind.
 */
export async function extractAndAnalyzeUploadedPDFCanonical(
  input: ExtractAndAnalyzeCanonicalInput,
): Promise<ExtractAndAnalyzeCanonicalResult> {
  const session = await requireFacility()
  try {
    const extracted = await extractClauses({
      pdfText: input.pdfText,
      contractName: input.contractName,
    })

    const analysis = analyzePDFContractCanonical(
      extracted.clauses,
      input.side,
      input.contractVariant,
      input.contractName,
    )

    await logAudit({
      userId: session.user.id,
      action: "prospective.pdf_extracted_and_analyzed_canonical",
      entityType: "pdf_analysis",
      metadata: {
        contractName: input.contractName,
        side: input.side,
        contractVariant: input.contractVariant,
        textLength: input.pdfText.length,
        extractedClauseCount: extracted.clauses.length,
        truncated: extracted.truncated,
        overallRiskScore: analysis.overallRiskScore,
        overallRiskLevel: analysis.overallRiskLevel,
        criticalFlagCount: analysis.criticalFlags.length,
        missingClauseCount: analysis.missingClauses.length,
      },
    })

    return serialize({
      analysis,
      extractedClauseCount: extracted.clauses.length,
      truncated: extracted.truncated,
    })
  } catch (err) {
    console.error("[extractAndAnalyzeUploadedPDFCanonical]", err, {
      facilityId: session.facility.id,
      contractName: input.contractName,
      side: input.side,
      contractVariant: input.contractVariant,
      textLength: input.pdfText.length,
    })
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Clause extractor failed: ${reason}`)
  }
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

// ─── getVendorLookbackComparison (Charles 2026-06-10) ───────────────

export interface LookbackExtractedTier {
  tierNumber: number
  /** Spend threshold in dollars as the AI extracted it. */
  spendMin: number
  /** Raw AI rebate value — may be "3" meaning 3%; normalized server-side. */
  rebateValue: number
}

export interface LookbackExistingContract {
  id: string
  name: string
  status: string
  expirationDate: string | null
  annualValue: number | null
  /** Lifetime earned via the canonical helper (explicit Rebate rows). */
  lifetimeEarned: number
  /** Lifetime contract-stamped COG spend. */
  lifetimeSpend: number
  /** lifetimeEarned ÷ lifetimeSpend × 100 — null when spend is 0. */
  effectiveRatePct: number | null
  /** Highest percent_of_spend tier across the contract's terms (display %). */
  topTierRatePct: number | null
}

export interface VendorLookbackComparison {
  vendorId: string | null
  vendorName: string | null
  /** Trailing-12-month COG spend for the vendor at this facility. */
  trailing12moSpend: number
  /**
   * PROJECTION — what the proposal's extracted tier ladder would have paid
   * on the trailing-12-month spend. Never an earned figure; surfaces must
   * label it as a projection (CLAUDE.md rebates rule).
   */
  predicted: {
    tierAchieved: number
    rebatePercent: number
    annualRebate: number
  } | null
  existingContracts: LookbackExistingContract[]
}

/**
 * Charles 2026-06-10 ("When entering a PDF hard to know what the pricing
 * would be ... should do a 12 month look back and predict what rebates etc
 * would be and compare to other contracts from that vendor if they exist"):
 * resolve the proposal's vendor (id wins; else case-insensitive name match —
 * vendor names are never compared raw, see project memory), pull the
 * trailing-12-month COG spend, run the extracted tier ladder through the
 * projection engine, and summarize the vendor's existing contracts at this
 * facility for side-by-side comparison.
 */
export async function getVendorLookbackComparison(input: {
  vendorId?: string | null
  vendorName?: string | null
  extractedTiers: LookbackExtractedTier[]
  rebateMethod?: "cumulative" | "marginal"
}): Promise<VendorLookbackComparison> {
  const { facility } = await requireFacility()
  try {
    // ── Resolve the vendor ────────────────────────────────────────────
    let vendor: { id: string; name: string } | null = null
    if (input.vendorId) {
      vendor = await prisma.vendor.findUnique({
        where: { id: input.vendorId },
        select: { id: true, name: true },
      })
    }
    if (!vendor && input.vendorName?.trim()) {
      const raw = input.vendorName.trim()
      vendor = await prisma.vendor.findFirst({
        where: { name: { equals: raw, mode: "insensitive" } },
        select: { id: true, name: true },
      })
      if (!vendor) {
        // Review R3: tolerate suffix drift in BOTH directions — extracted
        // "Arthrex, Inc." must find DB "Arthrex" too. Strip common corporate
        // suffixes and retry exact-insensitive.
        const stripped = raw
          .replace(/[,.]?\s*(incorporated|inc|llc|corp(oration)?|co|ltd)\.?$/i, "")
          .trim()
        if (stripped && stripped.toLowerCase() !== raw.toLowerCase()) {
          vendor = await prisma.vendor.findFirst({
            where: { name: { equals: stripped, mode: "insensitive" } },
            select: { id: true, name: true },
          })
        }
        if (!vendor) {
          // Review R3: contains is ambiguous ("Stryker" matches "Stryker
          // Ortho" AND "Stryker Endoscopy") — accept ONLY a single match;
          // otherwise return the null-vendor shell rather than scoping the
          // projection to an arbitrary vendor.
          const candidates = await prisma.vendor.findMany({
            where: {
              name: { contains: stripped || raw, mode: "insensitive" },
            },
            select: { id: true, name: true },
            take: 2,
          })
          if (candidates.length === 1) vendor = candidates[0]
        }
      }
    }
    if (!vendor) {
      return serialize({
        vendorId: null,
        vendorName: input.vendorName ?? null,
        trailing12moSpend: 0,
        predicted: null,
        existingContracts: [],
      })
    }

    // ── Trailing-12-month lookback spend ──────────────────────────────
    const { start: windowStart, end: windowEnd } = getTrailing12MonthWindow()
    const spendAgg = await prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: vendor.id,
        transactionDate: { gte: windowStart, lte: windowEnd },
      },
      _sum: { extendedPrice: true },
    })
    const trailing12moSpend = Number(spendAgg._sum.extendedPrice ?? 0)

    // ── Projection: extracted ladder × lookback spend ─────────────────
    // normalizeAIRebateValue folds "3" → 0.03; the projection engine scales
    // fractions ×100 at the Prisma boundary (CLAUDE.md rebate-units rule).
    const tiers = input.extractedTiers
      .filter((t) => Number.isFinite(t.spendMin) && Number.isFinite(t.rebateValue))
      .map((t) => ({
        tierNumber: t.tierNumber,
        spendMin: t.spendMin,
        spendMax: null,
        rebateValue: normalizeAIRebateValue("percent_of_spend", t.rebateValue),
        rebateType: "percent_of_spend" as const,
      }))
      // Review R1: a non-percent tier (e.g. a flat $30,000 fixed rebate the
      // extractor mislabeled) normalizes to 0 and would silently project 0%
      // if it became the applicable tier — drop zero-rate tiers from the
      // ladder instead of letting them poison the projection.
      .filter((t) => t.rebateValue > 0)
    const predicted =
      tiers.length > 0 && trailing12moSpend > 0
        ? (() => {
            const r = computeRebateFromPrismaTiers(
              trailing12moSpend,
              tiers as unknown as Parameters<
                typeof computeRebateFromPrismaTiers
              >[1],
              { method: input.rebateMethod ?? "cumulative" },
            )
            return r.tierAchieved > 0
              ? {
                  tierAchieved: r.tierAchieved,
                  rebatePercent: r.rebatePercent,
                  annualRebate: r.rebateEarned,
                }
              : null
          })()
        : null

    // ── Existing contracts at this facility (group-aware) ─────────────
    // Ownership via the canonical helper (primary OR contractFacilities
    // share) — a bare `facilityId` dropped shared contracts, so the lookback
    // claimed "no existing contracts" for them (bug-bash E-C1). The two OR
    // groups are AND-composed so they can't collide.
    const contracts = await prisma.contract.findMany({
      where: {
        AND: [
          contractsOwnedByFacility(facility.id),
          {
            OR: [
              { vendorId: vendor.id },
              { additionalVendorIds: { has: vendor.id } },
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        status: true,
        expirationDate: true,
        annualValue: true,
        rebates: {
          select: { rebateEarned: true, payPeriodEnd: true },
        },
        terms: {
          select: {
            tiers: { select: { rebateValue: true, rebateType: true } },
          },
        },
      },
      orderBy: { expirationDate: "desc" },
      take: 10,
    })
    // Review R4: earned counts only CLOSED periods (payPeriodEnd ≤ today),
    // so the effective-rate denominator must stop at each contract's last
    // closed period too — all-time spend on an active contract systematically
    // understates its effective rate and flatters the new proposal.
    const today = new Date()
    const spendMap = new Map<string, number>(
      await Promise.all(
        contracts.map(async (c): Promise<[string, number]> => {
          const closedEnds = c.rebates
            .map((r) => r.payPeriodEnd)
            .filter((d): d is Date => d != null && d.getTime() <= today.getTime())
          const lastClosed =
            closedEnds.length > 0
              ? new Date(Math.max(...closedEnds.map((d) => d.getTime())))
              : null
          const agg = await prisma.cOGRecord.aggregate({
            where: {
              facilityId: facility.id,
              contractId: c.id,
              ...(lastClosed
                ? { transactionDate: { lte: lastClosed } }
                : {}),
            },
            _sum: { extendedPrice: true },
          })
          return [c.id, Number(agg._sum?.extendedPrice ?? 0)]
        }),
      ),
    )

    const existingContracts: LookbackExistingContract[] = contracts.map((c) => {
      const lifetimeEarned = sumEarnedRebatesLifetime(c.rebates)
      const lifetimeSpend = spendMap.get(c.id) ?? 0
      const topTierFraction = c.terms
        .flatMap((t) => t.tiers)
        .filter((t) => t.rebateType === "percent_of_spend")
        .map((t) => Number(t.rebateValue ?? 0))
        .reduce((max, v) => (v > max ? v : max), 0)
      return {
        id: c.id,
        name: c.name,
        status: String(c.status),
        expirationDate: c.expirationDate
          ? c.expirationDate.toISOString()
          : null,
        annualValue: c.annualValue == null ? null : Number(c.annualValue),
        lifetimeEarned,
        lifetimeSpend,
        effectiveRatePct:
          lifetimeSpend > 0 ? (lifetimeEarned / lifetimeSpend) * 100 : null,
        topTierRatePct: topTierFraction > 0 ? topTierFraction * 100 : null,
      }
    })

    return serialize({
      vendorId: vendor.id,
      vendorName: vendor.name,
      trailing12moSpend,
      predicted,
      existingContracts,
    })
  } catch (err) {
    console.error("[getVendorLookbackComparison]", err, {
      facilityId: facility.id,
      vendorId: input.vendorId ?? null,
      vendorName: input.vendorName ?? null,
    })
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Lookback comparison failed: ${reason}`)
  }
}
