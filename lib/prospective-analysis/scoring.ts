/**
 * Prospective analysis — proposal scoring engine (spec §subsystem-0,
 *
 * PURE FUNCTION: takes a ProposalInput, returns 5-dimension scores +
 * weighted overall score (all in 0..10). No IO, no prisma imports.
 *
 * Formulas (verbatim from canonical §3):
 *   savingsPercent            = ((currentSpend - proposedAnnualSpend) / currentSpend) × 100
 *   costSavingsScore          = clamp(savingsPercent / 2, 0, 10)
 *   priceCompetitivenessScore = clamp(5 + priceVsMarket / 4, 0, 10)
 *                               (priceVsMarket is POSITIVE when cheaper/a discount
 *                                → higher score; negative = priced above the
 *                                reference. Sign locked by scoring.test.ts.)
 *   rebateAttainabilityScore  = clamp((currentSpend / minimumSpend) × 5, 0, 10)
 *   lockInRiskScore           = max(0, 10 - lockInPenalty)
 *                               penalties additive:
 *                                 termYears > 3        → 2
 *                                 exclusivity          → 3
 *                                 marketShare > 70%    → 2
 *                                 minimum > 80% spend  → 2
 *   tcoScore                  = min(10, 6
 *                                 + (priceProtection          ? 2 : 0)
 *                                 + (paymentTermsNet60Or90    ? 1 : 0)
 *                                 + (volumeDiscountAbove5Pct  ? 1 : 0))
 *
 *   overall = 0.30×costSavings + 0.20×priceCompetitive + 0.20×rebateAttain
 *           + 0.15×lockInRisk + 0.15×tco
 *
 * Edge cases:
 *   currentSpend = 0  → costSavingsScore = 0 (cannot compute ratio safely)
 *   minimumSpend = 0  → rebateAttainabilityScore = 10 (trivially attainable)
 */

import { clamp } from "@/lib/math/clamp"

export interface ProposalInput {
  // Spend / pricing
  proposedAnnualSpend: number
  currentSpend: number // baseline vendor spend at this facility
  priceVsMarket: number // -10..+10, % discount vs reference (POSITIVE = cheaper)
  // Rebate
  minimumSpend: number
  proposedRebateRate: number // top-tier rate as percent
  // Lock-in factors
  termYears: number
  exclusivity: boolean
  marketShareCommitment: number | null // percent 0-100, null if none
  minimumSpendIsHighPct: boolean // true when min > 80% of current total spend
  // TCO
  priceProtection: boolean
  paymentTermsNet60Or90: boolean
  volumeDiscountAbove5Percent: boolean
}

export interface ProposalScores {
  costSavings: number
  priceCompetitiveness: number
  rebateAttainability: number
  lockInRisk: number
  tco: number
  overall: number
}

// Weights (sum to 1.0). Exported so tests and UI bars stay in sync.
export const SCORE_WEIGHTS = {
  costSavings: 0.3,
  priceCompetitiveness: 0.2,
  rebateAttainability: 0.2,
  lockInRisk: 0.15,
  tco: 0.15,
} as const

export function calculateProposalScores(input: ProposalInput): ProposalScores {
  // Cost savings — percent saved vs current spend, halved, clamped 0..10.
  const costSavings =
    input.currentSpend > 0
      ? clamp(
          (((input.currentSpend - input.proposedAnnualSpend) /
            input.currentSpend) *
            100) /
            2,
          0,
          10,
        )
      : 0

  // Price competitiveness — POSITIVE priceVsMarket means cheaper than the
  // reference (a discount), so it pushes the score UP from the neutral 5.
  const priceCompetitiveness = clamp(5 + input.priceVsMarket / 4, 0, 10)

  // Rebate attainability — ratio of current spend to minimum required.
  // If there's no minimum, the rebate is trivially attainable (10).
  const rebateAttainability =
    input.minimumSpend > 0
      ? clamp((input.currentSpend / input.minimumSpend) * 5, 0, 10)
      : 10

  // Lock-in risk — additive penalty; higher score = less risk.
  const lockInPenalty =
    (input.termYears > 3 ? 2 : 0) +
    (input.exclusivity ? 3 : 0) +
    (input.marketShareCommitment != null && input.marketShareCommitment > 70
      ? 2
      : 0) +
    (input.minimumSpendIsHighPct ? 2 : 0)
  const lockInRisk = Math.max(0, 10 - lockInPenalty)

  // TCO — baseline 6, boosted by favorable terms, capped at 10.
  const tco = Math.min(
    10,
    6 +
      (input.priceProtection ? 2 : 0) +
      (input.paymentTermsNet60Or90 ? 1 : 0) +
      (input.volumeDiscountAbove5Percent ? 1 : 0),
  )

  const overall =
    SCORE_WEIGHTS.costSavings * costSavings +
    SCORE_WEIGHTS.priceCompetitiveness * priceCompetitiveness +
    SCORE_WEIGHTS.rebateAttainability * rebateAttainability +
    SCORE_WEIGHTS.lockInRisk * lockInRisk +
    SCORE_WEIGHTS.tco * tco

  return {
    costSavings,
    priceCompetitiveness,
    rebateAttainability,
    lockInRisk,
    tco,
    overall,
  }
}
