/**
 * Case costing — surgeon score + margin + auxiliary helpers.
 *
 * Reference: docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4.0
 * plus v0 spec (docs/contract-calculations.md §8 +
 * docs/facility-case-costing-functionality.md).
 *
 * Pure functions — no DB, no side effects.
 */

export type ScoreColor = "green" | "amber" | "red"

export interface ScoreInput {
  /** Count of payors classified as commercial/private. */
  commercialOrPrivatePayors: number
  /** Total distinct payor types observed. */
  totalPayors: number
  /** Average per-case spend in dollars. */
  avgSpendPerCase: number
  /**
   * % of cases with BMI < 40. Optional because the source data may not
   * carry BMI; when omitted v0 defaults this dimension to 80 per spec.
   */
  bmiUnder40Pct?: number | null
  /**
   * % of cases with patient age < 65. Optional; v0 default 70 when
   * missing.
   */
  ageUnder65Pct?: number | null
  /**
   * Average case time in minutes. Optional; when omitted time score is
   * 0 (v0 formula: `100 − avgCaseTime/5`).
   */
  avgCaseTimeMinutes?: number | null
}

export interface SurgeonScoreResult {
  payorMixScore: number
  spendScore: number
  bmiScore: number
  ageScore: number
  timeScore: number
  overallScore: number
  color: ScoreColor
}

const clamp100 = (v: number): number => Math.max(0, Math.min(100, v))

/**
 * Compute surgeon scores — v0 5-dimension formula
 * (docs/contract-calculations.md §8 + facility-case-costing §14).
 *
 *   payorMixScore = (commercialOrPrivate / totalPayors) × 100
 *                   (0 when totalPayors = 0)
 *   bmiScore      = clamp(bmiUnder40Pct ?? 80, 0, 100)
 *   ageScore      = clamp(ageUnder65Pct ?? 70, 0, 100)
 *   spendScore    = max(0, 100 − avgSpendPerCase / 500)
 *   timeScore     = max(0, 100 − (avgCaseTimeMinutes ?? 0) / 5)
 *   overallScore  = round(mean(payor, bmi, age, spend, time))
 *
 * Color:
 *   ≥75 → green · ≥50 → amber · else red.
 *
 * Pre-alignment (tydei): 2-dimension mean (payor + spend) only, no
 * bmi/age/time. Callers that don't supply the new dims get v0's
 * documented defaults so existing surfaces render stable numbers.
 */
export function calculateSurgeonScores(input: ScoreInput): SurgeonScoreResult {
  const payorMixScore =
    input.totalPayors > 0
      ? (input.commercialOrPrivatePayors / input.totalPayors) * 100
      : 0
  const bmiScore = clamp100(input.bmiUnder40Pct ?? 80)
  const ageScore = clamp100(input.ageUnder65Pct ?? 70)
  const spendScore = Math.max(0, 100 - input.avgSpendPerCase / 500)
  const timeScore = Math.max(
    0,
    100 - (input.avgCaseTimeMinutes ?? 0) / 5,
  )
  const overallScore = Math.round(
    (payorMixScore + bmiScore + ageScore + spendScore + timeScore) / 5,
  )
  let color: ScoreColor
  if (overallScore >= 75) color = "green"
  else if (overallScore >= 50) color = "amber"
  else color = "red"
  return {
    payorMixScore,
    bmiScore,
    ageScore,
    spendScore,
    timeScore,
    overallScore,
    color,
  }
}

// ─── Margin (canonical §4) ───────────────────────────────────────

export interface MarginInput {
  totalSpend: number
  totalReimbursement: number
}

export interface MarginResult {
  grossMargin: number
  marginPct: number
  trend: "UP" | "DOWN"
}

/**
 * Compute gross margin + percent + trend direction.
 *
 *   grossMargin = totalReimbursement - totalSpend
 *   marginPct   = (grossMargin / totalReimbursement) × 100
 *                 (0 when reimbursement = 0)
 *   trend       = marginPct ≥ 30 ? "UP" : "DOWN"
 */
export function calculateMargin(input: MarginInput): MarginResult {
  const grossMargin = input.totalReimbursement - input.totalSpend
  const marginPct =
    input.totalReimbursement > 0
      ? (grossMargin / input.totalReimbursement) * 100
      : 0
  const trend: "UP" | "DOWN" = marginPct >= 30 ? "UP" : "DOWN"
  return { grossMargin, marginPct, trend }
}

// ─── v0 Auxiliary helpers ────────────────────────────────────────
// All from docs/contract-calculations.md §8 + facility-case-costing §12-16.

/** 2% per tier step, capped at 10 tiers / 20%. */
export function defaultTierRebatePct(tierNumber: number): number {
  if (tierNumber < 0) return 0
  return Math.min(tierNumber, 10) * 2
}

/**
 * Payment multiplier applied to totalSpend when estimating
 * reimbursement. Cardiac 1.2, spine 1.3, everything else 1.35.
 */
export function specialtyPaymentMultiplier(
  specialty: "orthopedic" | "spine" | "cardiac" | "general" | string,
): number {
  if (specialty === "cardiac") return 1.2
  if (specialty === "spine") return 1.3
  return 1.35
}

/** Case-mix-index-adjusted spend: rawAvgSpend / CMI (CMI>1 = complex). */
export function cmiAdjustedSpend(
  rawAvgSpend: number,
  caseMixIndex: number,
): number {
  if (caseMixIndex <= 0) return rawAvgSpend
  return rawAvgSpend / caseMixIndex
}

/** Variance vs peer average: ((surgeonAvg − peerAvg) / peerAvg) × 100. */
export function peerVariancePct(
  surgeonAvg: number,
  peerAvg: number,
): number {
  if (peerAvg <= 0) return 0
  return ((surgeonAvg - peerAvg) / peerAvg) * 100
}
