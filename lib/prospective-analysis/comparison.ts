/**
 * Prospective analysis — proposal comparison (spec §subsystem-4,
 * docs/superpowers/specs/2026-04-18-prospective-analysis-rewrite.md).
 *
 * PURE FUNCTION: takes N already-scored proposals and returns a
 * comparison matrix (best/worst per dimension, overall winner, savings
 * delta vs runner-up). No IO, no prisma imports, no deps on scoring.ts
 * or recommendation.ts (proposals arrive pre-scored).
 *
 * Tie-breaking: when two proposals tie on a score, the one with the
 * lexicographically-lower id wins (both for best/worst per-dimension
 * and for the overall recommendation). This keeps output deterministic
 * regardless of input order.
 */

export interface ProposalForComparison {
  id: string
  vendorName: string
  scores: {
    costSavings: number
    priceCompetitiveness: number
    rebateAttainability: number
    lockInRisk: number
    tco: number
    overall: number
  }
  proposedAnnualSpend: number
  proposedRebateRate: number
  termYears: number
  totalProjectedSavings: number
}

type ScoreKey = keyof ProposalForComparison["scores"]

export interface ComparisonResult {
  proposals: ProposalForComparison[]
  /** Per-dimension best + worst ids. */
  bestOnDimension: Record<ScoreKey, string>
  worstOnDimension: Record<ScoreKey, string>
  /** Overall winner (highest overall score). */
  recommendedProposalId: string | null
  /** Dollar-savings delta between recommended and runner-up (null when only 1 proposal). */
  savingsDeltaVsRunnerUp: number | null
}

const SCORE_KEYS: readonly ScoreKey[] = [
  "costSavings",
  "priceCompetitiveness",
  "rebateAttainability",
  "lockInRisk",
  "tco",
  "overall",
] as const

/**
 * Return the id with the best (or worst) score on the given dimension.
 * Ties break by lexicographically-lower id.
 */
function pickExtreme(
  proposals: ProposalForComparison[],
  key: ScoreKey,
  kind: "max" | "min",
): string {
  // Caller guarantees proposals.length >= 1.
  let winner = proposals[0]!
  for (let i = 1; i < proposals.length; i++) {
    const candidate = proposals[i]!
    const candidateScore = candidate.scores[key]
    const winnerScore = winner.scores[key]
    const strictlyBetter =
      kind === "max" ? candidateScore > winnerScore : candidateScore < winnerScore
    const tied = candidateScore === winnerScore
    if (strictlyBetter || (tied && candidate.id < winner.id)) {
      winner = candidate
    }
  }
  return winner.id
}

export function compareProposals(
  proposals: ProposalForComparison[],
): ComparisonResult {
  if (proposals.length === 0) {
    const empty = {} as Record<ScoreKey, string>
    return {
      proposals: [],
      bestOnDimension: empty,
      worstOnDimension: empty,
      recommendedProposalId: null,
      savingsDeltaVsRunnerUp: null,
    }
  }

  const bestOnDimension = {} as Record<ScoreKey, string>
  const worstOnDimension = {} as Record<ScoreKey, string>
  for (const key of SCORE_KEYS) {
    bestOnDimension[key] = pickExtreme(proposals, key, "max")
    worstOnDimension[key] = pickExtreme(proposals, key, "min")
  }

  const recommendedProposalId = bestOnDimension.overall

  let savingsDeltaVsRunnerUp: number | null = null
  if (proposals.length >= 2) {
    // Rank by overall desc, tie-break by id asc — same rule as pickExtreme.
    const ranked = [...proposals].sort((a, b) => {
      if (b.scores.overall !== a.scores.overall) {
        return b.scores.overall - a.scores.overall
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    const recommended = ranked[0]!
    const runnerUp = ranked[1]!
    savingsDeltaVsRunnerUp =
      recommended.totalProjectedSavings - runnerUp.totalProjectedSavings
  }

  return {
    proposals,
    bestOnDimension,
    worstOnDimension,
    recommendedProposalId,
    savingsDeltaVsRunnerUp,
  }
}
