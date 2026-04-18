/**
 * Prospective analysis — recommendation engine (spec §subsystem-0,
 * docs/superpowers/specs/2026-04-18-prospective-analysis-rewrite.md §4.3).
 *
 * PURE FUNCTION: takes scores + commitment flags, returns verdict +
 * negotiation points + risks. No IO, no prisma imports.
 *
 * Verdict thresholds:
 *   overall >= 7.5 → accept
 *   overall >= 5   → negotiate
 *   else           → decline
 *
 * Negotiation / risk rules inferred from which dimensions scored low
 * and which lock-in penalties applied.
 */

import type { ProposalScores } from "./scoring"

export interface Recommendation {
  verdict: "accept" | "negotiate" | "decline"
  negotiationPoints: string[]
  risks: string[]
}

export interface RecommendationCommitments {
  termYears: number
  exclusivity: boolean
  marketShareCommitment: number | null
  minimumSpendIsHighPct: boolean
}

// Thresholds for verdicts and for which low scores trigger specific
// advice; exported so tests can assert against canonical values.
export const VERDICT_ACCEPT_THRESHOLD = 7.5
export const VERDICT_NEGOTIATE_THRESHOLD = 5
export const LOW_SCORE_THRESHOLD = 5 // costSavings / rebate / lockIn
export const TCO_LOW_THRESHOLD = 7
export const HIGH_MARKET_SHARE_THRESHOLD = 70

// Points always included regardless of score (canonical §4.3).
export const ALWAYS_INCLUDE_POINTS: ReadonlyArray<string> = [
  "Review top 10 SKUs for price alignment",
  "Consider multi-year commitment only for rate lock",
]

export function generateRecommendation(
  scores: ProposalScores,
  commitments: RecommendationCommitments,
): Recommendation {
  const negotiationPoints: string[] = [...ALWAYS_INCLUDE_POINTS]
  const risks: string[] = []

  // Dimension-specific negotiation points.
  if (scores.costSavings < LOW_SCORE_THRESHOLD) {
    negotiationPoints.push(
      "Target 5-10% better pricing on high-volume items",
    )
  }

  if (scores.rebateAttainability < LOW_SCORE_THRESHOLD) {
    negotiationPoints.push(
      "Reduce minimum spend threshold to match historic spend",
    )
  }

  if (scores.tco < TCO_LOW_THRESHOLD) {
    negotiationPoints.push(
      "Request net-60 payment terms + price protection clause",
    )
  }

  // Lock-in risks — only surface when lockInRisk is low.
  if (scores.lockInRisk < LOW_SCORE_THRESHOLD) {
    if (commitments.exclusivity) {
      risks.push("Exclusivity clause limits future vendor flexibility")
    }
    if (commitments.termYears > 3) {
      risks.push(
        `Multi-year term (${commitments.termYears}y) — pricing may become uncompetitive`,
      )
    }
    if (
      commitments.marketShareCommitment != null &&
      commitments.marketShareCommitment > HIGH_MARKET_SHARE_THRESHOLD
    ) {
      risks.push(
        `High market-share commitment (${commitments.marketShareCommitment}%) reduces vendor diversity`,
      )
    }
    if (commitments.minimumSpendIsHighPct) {
      risks.push(
        "Minimum spend threshold above 80% of current — hard to exit",
      )
    }
  }

  let verdict: Recommendation["verdict"]
  if (scores.overall >= VERDICT_ACCEPT_THRESHOLD) {
    verdict = "accept"
  } else if (scores.overall >= VERDICT_NEGOTIATE_THRESHOLD) {
    verdict = "negotiate"
  } else {
    verdict = "decline"
  }

  return { verdict, negotiationPoints, risks }
}
