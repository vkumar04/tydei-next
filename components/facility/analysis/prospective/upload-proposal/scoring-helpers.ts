/**
 * Pure scoring helpers for the proposal analyzer (extracted verbatim from
 * upload-proposal-tab.tsx). No React, no server actions — just the term
 * filter, price-vs-market conversion, scoring-input mapper, and variant
 * derivation the upload flow feeds into the deal-score engine.
 */

import type { AnalyzeProposalInput } from "@/lib/actions/prospective-analysis"
import type { PricingFileAnalysis } from "@/lib/prospective-analysis/pricing-file-analysis"
import type { ContractVariant } from "@/lib/contracts/clause-risk-analyzer"

export const CONTRACT_VARIANT_OPTIONS: {
  value: ContractVariant
  label: string
}[] = [
  { value: "USAGE_SPEND", label: "Usage — Spend tiers" },
  { value: "USAGE_VOLUME", label: "Usage — Volume tiers" },
  { value: "USAGE_CARVEOUT", label: "Usage — Carve-out" },
  { value: "USAGE_MARKET_SHARE", label: "Usage — Market share" },
  { value: "USAGE_CAPITATED", label: "Usage — Capitated" },
  { value: "USAGE_TIEIN", label: "Usage — Tie-in" },
  { value: "CAPITAL_PURCHASE", label: "Capital — Purchase" },
  { value: "CAPITAL_LEASE", label: "Capital — Lease" },
  { value: "CAPITAL_TIEIN", label: "Capital — Tie-in" },
  { value: "SERVICE_MAINTENANCE", label: "Service — Maintenance" },
  { value: "SERVICE_FULL", label: "Service — Full-service" },
  { value: "GPO", label: "GPO" },
  { value: "PRICING_ONLY", label: "Pricing only" },
]

export interface ExtractedContract {
  contractName: string
  vendorName: string
  contractType: string
  effectiveDate: string
  expirationDate: string
  totalValue?: number
  description?: string
  terms: {
    termName: string
    termType: string
    tiers: {
      tierNumber: number
      spendMin?: number
      spendMax?: number
      rebateValue?: number
    }[]
  }[]
}

/**
 * Spend-dollar rebate terms — the family whose tiers feed BOTH the proposal
 * score's top-tier rate AND the 12-month lookback projection. Broadened from
 * the original 3-value set so the AI's varied spend-rebate labels (percent_of_
 * spend, spend_based, usage, "Spend Rebate", …) aren't silently dropped — that
 * was why proposal tiers "weren't being picked up like contracts" (Vick
 * 2026-06-22). market_share / volume / carve-out / fixed / per-procedure tiers
 * stay EXCLUDED: they store %/count thresholds or pay per-SKU, not spend
 * dollars (the recurring type-confusion class).
 */
const SPEND_DOLLAR_TERM_TYPES = new Set([
  "spend_rebate",
  "growth_rebate",
  "percent_of_spend",
  "spend_based",
  "usage",
  "",
])
export function isSpendDollarTerm(termType: string | null | undefined): boolean {
  const norm = String(termType ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
  return SPEND_DOLLAR_TERM_TYPES.has(norm)
}

/**
 * Proposal price competitiveness fed to the scoring engine (audit P1#6 — was
 * hardcoded 0). The engine's `priceVsMarket` is POSITIVE when cheaper (a
 * discount → higher competitiveness; sign locked by scoring.test.ts). The
 * price file's `avgVariancePercent` is (proposed − current)/current, which is
 * NEGATIVE when cheaper — so NEGATE it into a savings%. Returns 0 when no
 * COG-matched price file has been analyzed.
 */
export function priceVsMarketFromAnalysis(
  analysis: PricingFileAnalysis | null,
): number {
  if (!analysis || analysis.summary.itemsWithCOGMatch <= 0) return 0
  return -(Math.round(analysis.summary.avgVariancePercent * 10) / 10)
}

/**
 * Map AI-extracted contract data to a scoring input with reasonable
 * fallbacks. Users can re-enter via the manual tab if any field needs
 * refinement — this path optimizes for "drop a PDF, see a verdict".
 */
export function buildScoringInput(
  extracted: ExtractedContract,
  currentSpend: number,
  /**
   * Proposal price vs the facility's current COG price, as a percent —
   * POSITIVE = cheaper than current = better score (the engine's convention,
   * sign locked by scoring.test.ts; `priceVsMarketFromAnalysis` above already
   * negated the raw variance). Sourced from the uploaded price file's
   * COG-matched variance when available; 0 when no price file has been
   * analyzed (audit P1#6 — was hardcoded 0).
   */
  priceVsMarketPct = 0,
): AnalyzeProposalInput {
  const proposedAnnualSpend = extracted.totalValue ?? currentSpend * 1
  // Only spend-dollar terms contribute the top-tier rate / min-spend — a
  // market_share 50% tier must not masquerade as a spend rebate rate (kept in
  // lockstep with the lookback's extractedTiers filter below).
  const spendTiers = extracted.terms
    .filter((t) => isSpendDollarTerm(t.termType))
    .flatMap((t) => t.tiers)
  const topTierRate =
    spendTiers.map((t) => t.rebateValue ?? 0).reduce((max, v) => (v > max ? v : max), 0) || 0

  const topTierMinSpend =
    spendTiers.map((t) => t.spendMin ?? 0).reduce((max, v) => (v > max ? v : max), 0) || 0

  // Contract duration in years — rough parse; clamp to [1, 20] so a
  // hallucinated / mis-parsed date range can't drive a 500-year term.
  let termYears = 3
  if (extracted.effectiveDate && extracted.expirationDate) {
    const start = new Date(extracted.effectiveDate).getTime()
    const end = new Date(extracted.expirationDate).getTime()
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      const parsed = Math.round((end - start) / (365.25 * 24 * 3600 * 1000))
      termYears = Math.min(20, Math.max(1, parsed))
    }
  }

  return {
    proposedAnnualSpend,
    currentSpend,
    priceVsMarket: priceVsMarketPct,
    minimumSpend: topTierMinSpend,
    proposedRebateRate: topTierRate,
    termYears,
    exclusivity: false,
    marketShareCommitment: null,
    minimumSpendIsHighPct:
      currentSpend > 0 ? topTierMinSpend > currentSpend * 0.8 : false,
    priceProtection: false,
    paymentTermsNet60Or90: false,
    volumeDiscountAbove5Percent: false,
  }
}

/**
 * Auto-derive the clause-analyzer variant from the extracted contract so
 * the user doesn't have to know the taxonomy (review of the old UI: the
 * upfront "Contract variant" select was a major usability complaint).
 */
export function deriveContractVariant(extracted: ExtractedContract): ContractVariant {
  const termTypes = new Set(
    (extracted.terms ?? []).map((t) => String(t.termType ?? "").trim()),
  )
  switch (extracted.contractType) {
    case "capital":
      return "CAPITAL_PURCHASE"
    case "tie_in":
      return "CAPITAL_TIEIN"
    case "service":
      return "SERVICE_MAINTENANCE"
    case "grouped":
      return "GPO"
    case "pricing_only":
      return "PRICING_ONLY"
    default:
      if (termTypes.has("market_share")) return "USAGE_MARKET_SHARE"
      if (termTypes.has("carve_out")) return "USAGE_CARVEOUT"
      if (termTypes.has("volume_rebate")) return "USAGE_VOLUME"
      return "USAGE_SPEND"
  }
}
