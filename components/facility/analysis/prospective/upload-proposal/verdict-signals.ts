import type { VendorLookbackComparison } from "@/lib/actions/prospective-analysis"
import type {
  VerdictLegalSignal,
  VerdictLookbackSignal,
  VerdictPricingSignal,
} from "@/lib/prospective-analysis/proposal-verdict"
import type { PricingFileAnalysis } from "@/lib/prospective-analysis/pricing-file-analysis"
import type { PDFContractAnalysisResult } from "@/lib/contracts/clause-risk-analyzer"

// ── Verdict-signal builders (bug-bash F-C3) ─────────────────────────
// One place adapts each live analysis object into the compact snapshot the
// verdict synthesizer consumes — used BOTH for the live verdict memo and for
// persisting onto the saved evaluation, so reload re-synthesizes identically.

export function pricingSignalFrom(
  analysis: PricingFileAnalysis | null,
): VerdictPricingSignal | null {
  if (!analysis) return null
  return {
    avgVariancePercent: analysis.summary.avgVariancePercent,
    potentialSavings: analysis.summary.potentialSavings,
    itemsWithCOGMatch: analysis.summary.itemsWithCOGMatch,
    totalItems: analysis.summary.totalItems,
    itemsAboveCOG: analysis.summary.itemsAboveCOG,
  }
}

export function lookbackSignalFrom(
  lookback: VendorLookbackComparison | null,
): VerdictLookbackSignal | null {
  if (!lookback || lookback.vendorId === null) return null
  const rates = lookback.existingContracts
    .map((c) => c.effectiveRatePct)
    .filter((r): r is number => r !== null)
  return {
    trailing12moSpend: lookback.trailing12moSpend,
    predictedAnnualRebate: lookback.predicted?.annualRebate ?? null,
    predictedRatePct: lookback.predicted?.rebatePercent ?? null,
    bestExistingEffectiveRatePct: rates.length > 0 ? Math.max(...rates) : null,
    hasExistingContracts: lookback.existingContracts.length > 0,
  }
}

export function legalSignalFrom(
  canonical: { analysis: PDFContractAnalysisResult } | null,
): VerdictLegalSignal | null {
  if (!canonical) return null
  return {
    overallRiskScore: canonical.analysis.overallRiskScore,
    overallRiskLevel: String(canonical.analysis.overallRiskLevel),
    criticalFlagCount: canonical.analysis.criticalFlags.length,
  }
}
