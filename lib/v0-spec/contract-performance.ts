/**
 * v0 spec — Contract performance metrics.
 * Source: docs/contract-calculations.md §9.
 */
import { v0Cumulative, type V0Tier } from "./rebate-math"

/**
 * Rebate utilization: actual rebate ÷ max possible rebate (if all spend
 * were at the top tier's rate) × 100.
 */
export interface V0RebateUtilization {
  actualRebate: number
  maxPossibleRebate: number
  utilizationPct: number
  missedRebate: number
  additionalSpendForMaxTier: number
}

export function v0RebateUtilization(
  actualSpend: number,
  tiers: V0Tier[],
): V0RebateUtilization {
  const sorted = [...tiers].sort((a, b) => a.spendMin - b.spendMin)
  const maxTier = sorted[sorted.length - 1]!
  const maxPossibleRebate = actualSpend * (maxTier.rebateValue / 100)
  const actual = v0Cumulative(actualSpend, tiers)
  return {
    actualRebate: actual.rebateEarned,
    maxPossibleRebate,
    utilizationPct:
      maxPossibleRebate > 0 ? (actual.rebateEarned / maxPossibleRebate) * 100 : 0,
    missedRebate: maxPossibleRebate - actual.rebateEarned,
    additionalSpendForMaxTier: Math.max(0, maxTier.spendMin - actualSpend),
  }
}

/**
 * Herfindahl-Hirschman Index for vendor concentration.
 *   HHI = Σ (sharePct)²
 * Bands: <1500 low, <2500 moderate, else high.
 */
export interface V0Concentration {
  hhi: number
  level: "low" | "moderate" | "high"
  topVendorSharePct: number
  top3SharePct: number
}
export function v0SpendConcentration(
  vendorSpends: Array<{ vendorId: string; spend: number }>,
): V0Concentration {
  const total = vendorSpends.reduce((s, v) => s + v.spend, 0)
  if (total <= 0) {
    return { hhi: 0, level: "low", topVendorSharePct: 0, top3SharePct: 0 }
  }
  const shares = vendorSpends
    .map((v) => (v.spend / total) * 100)
    .sort((a, b) => b - a)
  const hhi = shares.reduce((s, v) => s + v * v, 0)
  const level: V0Concentration["level"] =
    hhi < 1500 ? "low" : hhi < 2500 ? "moderate" : "high"
  return {
    hhi,
    level,
    topVendorSharePct: shares[0] ?? 0,
    top3SharePct: shares.slice(0, 3).reduce((s, v) => s + v, 0),
  }
}

/**
 * Renewal risk score (0-100, higher = more risk).
 * Weighted composite per docs §9:
 *   daysToExpiration  20%
 *   complianceRate    25%
 *   priceVarianceAvg  20%
 *   vendorResponsiveness 15%
 *   rebateUtilization 10%
 *   issueCount        10%
 */
export interface V0RenewalRiskInput {
  daysRemaining: number
  compliancePct: number
  avgPriceVariancePct: number
  avgResponseTimeHours: number
  rebateUtilizationPct: number
  openIssues: number
}
export interface V0RenewalRisk {
  riskScore: number
  riskLevel: "low" | "medium" | "high"
}
export function v0RenewalRisk(input: V0RenewalRiskInput): V0RenewalRisk {
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
  const riskLevel: V0RenewalRisk["riskLevel"] =
    riskScore < 30 ? "low" : riskScore < 60 ? "medium" : "high"
  return { riskScore, riskLevel }
}
