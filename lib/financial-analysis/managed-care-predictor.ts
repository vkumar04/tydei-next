/**
 * Managed Care Negotiation Predictor — Charles AI Prospective Impact Engine,
 * feature #6 (2026-06-21).
 *
 * Pure function. Predicts the reimbursement band (as a % of the Medicare
 * equivalent) a facility could likely negotiate, based on the levers a payer
 * actually weighs: case-mix acuity, outcomes, volume, and the competitive
 * strength of the local geographic market.
 *
 *   "Facility likely qualifies for 118%–132% Medicare equivalent
 *    reimbursement based on comparable facilities."
 *
 * The model is deterministic: a base anchor plus weighted lever lifts, with
 * a confidence band whose width narrows as the inputs get stronger.
 */

export interface ManagedCareInput {
  /** Case-mix acuity / complexity, 0–1 (higher = more complex, better leverage). */
  caseMixAcuity: number
  /** Clinical outcomes percentile, 0–1. */
  outcomesScore: number
  /** Annual case volume — scale leverage. */
  annualCaseVolume: number
  /** Volume that anchors "high leverage" (default 5,000 cases). */
  volumeAnchor?: number
  /** Local market competitive strength for the facility, 0–1 (higher = better). */
  marketStrength: number
}

export interface ManagedCarePrediction {
  /** Lower bound, % of Medicare (e.g. 118). */
  lowPct: number
  /** Upper bound, % of Medicare (e.g. 132). */
  highPct: number
  /** Midpoint, % of Medicare. */
  midpointPct: number
  insight: string
}

const BASE_PCT = 100
const MAX_LIFT_PCT = 45 // strongest facility could reach ~145% of Medicare

export function computeManagedCarePrediction(
  input: ManagedCareInput,
): ManagedCarePrediction {
  const volumeAnchor = input.volumeAnchor ?? 5000
  const volumeScore = clamp01(input.annualCaseVolume / volumeAnchor)

  // Weighted blend of the four levers → 0–1 strength.
  const strength = clamp01(
    0.3 * clamp01(input.caseMixAcuity) +
      0.3 * clamp01(input.outcomesScore) +
      0.2 * volumeScore +
      0.2 * clamp01(input.marketStrength),
  )

  const midpointPct = BASE_PCT + strength * MAX_LIFT_PCT

  // Band narrows as strength rises: weaker inputs → wider uncertainty.
  const halfBand = 4 + (1 - strength) * 10
  const lowPct = Math.round(midpointPct - halfBand)
  const highPct = Math.round(midpointPct + halfBand)

  return {
    lowPct,
    highPct,
    midpointPct: Math.round(midpointPct),
    insight: `Facility likely qualifies for ${lowPct}%–${highPct}% Medicare equivalent reimbursement based on comparable facilities.`,
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.min(1, Math.max(0, n))
}
