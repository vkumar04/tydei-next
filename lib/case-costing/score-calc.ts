/**
 * Case costing — surgeon score + margin calculations.
 *
 * Reference: docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4.0
 * (§6 scoring + §4 margin formulas, canonical).
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
}

export interface SurgeonScoreResult {
  payorMixScore: number
  spendScore: number
  overallScore: number
  color: ScoreColor
}

/**
 * Compute surgeon scores from payor mix + avg spend.
 *
 * Formulas (canonical §6):
 *   payorMixScore = (commercialOrPrivate / totalPayors) × 100
 *                   (0 when totalPayors = 0)
 *   spendScore    = clamp(100 - (avgSpendPerCase / 500), 0, 100)
 *   overallScore  = round((payorMixScore + spendScore) / 2)
 *
 * Color:
 *   ≥75 → green
 *   ≥50 → amber
 *   <50 → red
 */
export function calculateSurgeonScores(input: ScoreInput): SurgeonScoreResult {
  const payorMixScore =
    input.totalPayors > 0
      ? (input.commercialOrPrivatePayors / input.totalPayors) * 100
      : 0

  const spendScore = Math.max(
    0,
    Math.min(100, 100 - input.avgSpendPerCase / 500),
  )

  const overallScore = Math.round((payorMixScore + spendScore) / 2)

  let color: ScoreColor
  if (overallScore >= 75) color = "green"
  else if (overallScore >= 50) color = "amber"
  else color = "red"

  return { payorMixScore, spendScore, overallScore, color }
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
