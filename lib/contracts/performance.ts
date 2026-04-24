/**
 * Contract performance analytics — v0 spec §9.
 * Pure functions. Mirrors lib/v0-spec/contract-performance.ts so the
 * oracle can parity-check both sides of the comparison.
 */

import {
  calculateCumulative,
  calculateMarginal,
  type RebateMethodName,
  type TierLike,
} from "@/lib/rebates/calculate"

export interface RebateUtilizationResult {
  actualRebate: number
  maxPossibleRebate: number
  utilizationPct: number
  missedRebate: number
  additionalSpendForMaxTier: number
}

/**
 * Rebate utilization — how much of the top-tier rebate potential the
 * contract has captured.
 *
 *   actual  = engine(method) on the actual spend + tier set
 *   max     = actualSpend × topTier.rebateValue  (as if every dollar
 *             earned the top-tier rate)
 *   util%   = actual / max × 100
 *   missed  = max - actual
 *
 * For **retroactive cumulative** contracts, once the top tier is
 * achieved, engine(cumulative) returns actualSpend × topRate — so
 * actual == max → utilization = 100%, missed = $0. That's correct by
 * definition of retroactive: your whole spend really does earn at the
 * top rate once you cross the threshold.
 *
 * For **marginal** contracts, lower-tier slices always earn at their
 * own lower rate, so actual < max whenever any spend lands below the
 * top tier — utilization < 100%, missed > 0. This is the case Charles
 * flagged: "hit tier 1 a bunch, didn't max it out" is only true under
 * marginal math. Pre-W1 this function hardcoded cumulative, which made
 * marginal contracts look falsely maxed-out.
 */
export function calculateRebateUtilization(
  actualSpend: number,
  tiers: TierLike[],
  method: RebateMethodName = "cumulative",
): RebateUtilizationResult {
  const sorted = [...tiers].sort(
    (a, b) => Number(a.spendMin) - Number(b.spendMin),
  )
  const maxTier = sorted[sorted.length - 1]
  if (!maxTier) {
    return {
      actualRebate: 0,
      maxPossibleRebate: 0,
      utilizationPct: 0,
      missedRebate: 0,
      additionalSpendForMaxTier: 0,
    }
  }
  const maxPossibleRebate = actualSpend * (Number(maxTier.rebateValue) / 100)
  const actual =
    method === "marginal"
      ? calculateMarginal(actualSpend, tiers)
      : calculateCumulative(actualSpend, tiers)
  return {
    actualRebate: actual.rebateEarned,
    maxPossibleRebate,
    utilizationPct:
      maxPossibleRebate > 0
        ? (actual.rebateEarned / maxPossibleRebate) * 100
        : 0,
    missedRebate: maxPossibleRebate - actual.rebateEarned,
    additionalSpendForMaxTier: Math.max(
      0,
      Number(maxTier.spendMin) - actualSpend,
    ),
  }
}

/**
 * Vendor-spend concentration — Herfindahl-Hirschman Index.
 *   HHI = Σ (sharePct)²
 * Bands: <1500 low · <2500 moderate · else high. (US DOJ/FTC.)
 */
export interface ConcentrationResult {
  hhi: number
  level: "low" | "moderate" | "high"
  topVendorSharePct: number
  top3SharePct: number
}

export function calculateSpendConcentration(
  vendorSpends: Array<{ vendorId: string; spend: number }>,
): ConcentrationResult {
  const total = vendorSpends.reduce((s, v) => s + v.spend, 0)
  if (total <= 0) {
    return { hhi: 0, level: "low", topVendorSharePct: 0, top3SharePct: 0 }
  }
  const shares = vendorSpends
    .map((v) => (v.spend / total) * 100)
    .sort((a, b) => b - a)
  const hhi = shares.reduce((s, v) => s + v * v, 0)
  const level: ConcentrationResult["level"] =
    hhi < 1500 ? "low" : hhi < 2500 ? "moderate" : "high"
  return {
    hhi,
    level,
    topVendorSharePct: shares[0] ?? 0,
    top3SharePct: shares.slice(0, 3).reduce((s, v) => s + v, 0),
  }
}

/**
 * Renewal risk composite — weighted 0-100 score. v0 §9.
 * Weights:
 *   daysToExpiration     20%
 *   compliance           25%
 *   priceVariance        20%
 *   vendor responsiveness 15%
 *   rebate utilization   10%
 *   open issues          10%
 * Bands: <30 low · <60 medium · else high.
 */
export interface RenewalRiskInput {
  daysRemaining: number
  compliancePct: number
  avgPriceVariancePct: number
  avgResponseTimeHours: number
  rebateUtilizationPct: number
  openIssues: number
}

export interface RenewalRiskResult {
  riskScore: number
  riskLevel: "low" | "medium" | "high"
}

export function calculateRenewalRisk(
  input: RenewalRiskInput,
): RenewalRiskResult {
  const weights = {
    daysToExpiration: 0.2,
    compliance: 0.25,
    priceVariance: 0.2,
    responsiveness: 0.15,
    rebateUtilization: 0.1,
    issues: 0.1,
  }
  const scores = {
    daysToExpiration:
      input.daysRemaining < 30
        ? 100
        : input.daysRemaining < 60
          ? 75
          : input.daysRemaining < 90
            ? 50
            : 25,
    compliance: 100 - input.compliancePct,
    priceVariance: Math.min(Math.abs(input.avgPriceVariancePct) * 10, 100),
    responsiveness: Math.min((input.avgResponseTimeHours / 24) * 100, 100),
    rebateUtilization: 100 - input.rebateUtilizationPct,
    issues: Math.min(input.openIssues * 10, 100),
  }
  const riskScore =
    scores.daysToExpiration * weights.daysToExpiration +
    scores.compliance * weights.compliance +
    scores.priceVariance * weights.priceVariance +
    scores.responsiveness * weights.responsiveness +
    scores.rebateUtilization * weights.rebateUtilization +
    scores.issues * weights.issues
  const riskLevel: RenewalRiskResult["riskLevel"] =
    riskScore < 30 ? "low" : riskScore < 60 ? "medium" : "high"
  return { riskScore, riskLevel }
}
