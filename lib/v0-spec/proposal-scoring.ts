/**
 * v0 spec — Prospective vendor-proposal scoring (0-10 scales).
 * Source: docs/facility-prospective-analysis-functionality.md §17-25.
 */

/**
 * Cost-savings score (0-10).
 *   savingsPct = (currentSpend − proposedAnnual) / currentSpend × 100
 *   score      = clamp(savingsPct / 2, 0, 10)
 * Doc: 10% savings → 5.0; 20% → 10.0.
 */
export function v0CostSavingsScore(input: {
  currentSpend: number
  proposedAnnual: number
}): { savingsPct: number; score: number } {
  if (input.currentSpend <= 0) return { savingsPct: 0, score: 0 }
  const savingsPct =
    ((input.currentSpend - input.proposedAnnual) / input.currentSpend) * 100
  return { savingsPct, score: clamp010(savingsPct / 2) }
}

/**
 * Price-vs-market score (0-10). Midpoint 5.0 = at market; every 4%
 * below market adds 1 point.
 *   priceVsMarket = (benchmark − proposedAnnual) / benchmark × 100
 *   score         = clamp(5 + priceVsMarket / 4, 0, 10)
 */
export function v0PriceCompetitivenessScore(input: {
  benchmark: number
  proposedAnnual: number
}): number {
  if (input.benchmark <= 0) return 5
  const priceVsMarket =
    ((input.benchmark - input.proposedAnnual) / input.benchmark) * 100
  return clamp010(5 + priceVsMarket / 4)
}

/** Rebate attainability score: already-spend-of-minimum × 5, capped at 10. */
export function v0RebateAttainabilityScore(input: {
  currentSpend: number
  minimumSpend: number
}): number {
  if (input.minimumSpend <= 0) return 10
  const ratio = input.currentSpend / input.minimumSpend
  return clamp010(ratio * 5)
}

/**
 * Lock-in risk score (0-10, HIGHER = LESS risk).
 *   Start 10. Penalties:
 *     −2  contractLengthYears > 3
 *     −3  exclusivity required
 *     −2  marketSharePct > 70
 *     −2  minimumSpend > totalValue × 0.8
 */
export function v0LockInRiskScore(input: {
  contractLengthYears: number
  exclusivity: boolean
  marketSharePct: number
  minimumSpend: number
  totalValue: number
}): number {
  let penalty = 0
  if (input.contractLengthYears > 3) penalty += 2
  if (input.exclusivity) penalty += 3
  if (input.marketSharePct > 70) penalty += 2
  if (input.minimumSpend > input.totalValue * 0.8) penalty += 2
  return Math.max(0, 10 - penalty)
}

/**
 * Total-cost-of-ownership score (0-10).
 *   Base 6. +2 if priceProtection; +1 if Net 60/Net 90 terms;
 *   +1 if volumeDiscountPct > 5. Cap at 10.
 */
export function v0TcoScore(input: {
  priceProtection: boolean
  paymentTerms: "net30" | "net60" | "net90" | "other"
  volumeDiscountPct: number
}): number {
  let score = 6
  if (input.priceProtection) score += 2
  if (input.paymentTerms === "net60" || input.paymentTerms === "net90") score += 1
  if (input.volumeDiscountPct > 5) score += 1
  return clamp010(score)
}

/**
 * Weighted overall proposal score.
 *   costSavings × 0.30 + priceCompetitiveness × 0.20 +
 *   rebateAttainability × 0.20 + lockInRisk × 0.15 + tco × 0.15
 */
export function v0OverallProposalScore(scores: {
  costSavings: number
  priceCompetitiveness: number
  rebateAttainability: number
  lockInRisk: number
  tco: number
}): number {
  return (
    scores.costSavings * 0.3 +
    scores.priceCompetitiveness * 0.2 +
    scores.rebateAttainability * 0.2 +
    scores.lockInRisk * 0.15 +
    scores.tco * 0.15
  )
}

/**
 * Proposal recommendation:
 *   accept   if overall ≥ 7.5 AND risksCount ≤ 1
 *   decline  if overall < 4  OR  risksCount ≥ 4
 *   negotiate otherwise
 */
export type V0ProposalRecommendation = "accept" | "decline" | "negotiate"
export function v0ProposalRecommendation(input: {
  overall: number
  risksCount: number
}): V0ProposalRecommendation {
  if (input.overall >= 7.5 && input.risksCount <= 1) return "accept"
  if (input.overall < 4 || input.risksCount >= 4) return "decline"
  return "negotiate"
}

/**
 * Dynamic rebate tier thresholds derived from actual spend.
 *   Tier 1 = actualSpend × 0.5
 *   Tier 2 = actualSpend × 0.8
 *   Tier 3 = actualSpend × 1.0
 * Rebate rates: baseRebate − 1, baseRebate, baseRebate + 1.5.
 */
export interface V0DynamicTier {
  tierNumber: 1 | 2 | 3
  threshold: number
  rebatePct: number
}
export function v0DynamicTiers(input: {
  actualSpend: number
  baseRebatePct: number
}): V0DynamicTier[] {
  return [
    { tierNumber: 1, threshold: input.actualSpend * 0.5, rebatePct: input.baseRebatePct - 1 },
    { tierNumber: 2, threshold: input.actualSpend * 0.8, rebatePct: input.baseRebatePct },
    { tierNumber: 3, threshold: input.actualSpend * 1.0, rebatePct: input.baseRebatePct + 1.5 },
  ]
}

/**
 * Attainability score for a tier structure:
 *   ≥ tier2.threshold → 85
 *   ≥ tier1.threshold → 70
 *   else             → 50
 */
export function v0TierAttainabilityScore(input: {
  proposedSpend: number
  tier1Threshold: number
  tier2Threshold: number
}): number {
  if (input.proposedSpend >= input.tier2Threshold) return 85
  if (input.proposedSpend >= input.tier1Threshold) return 70
  return 50
}

function clamp010(v: number): number {
  return Math.max(0, Math.min(10, v))
}
