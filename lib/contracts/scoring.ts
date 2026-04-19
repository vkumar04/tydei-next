/**
 * Contract scoring engine — computes a 0-100 health score per contract
 * from rollup inputs (commitment, compliance, rebates, timeliness,
 * price-variance severity, price competitiveness). Produces a letter-grade
 * band for UI.
 *
 * Spec: docs/superpowers/specs/2026-04-18-contracts-list-closure.md
 * subsystem 4 — the Contract.score column.
 * Wave 3 Task 3 adds the 6th dimension (price competitiveness) derived
 * from the absolute average of InvoicePriceVariance.variancePercent.
 *
 * Pure function, no I/O, no Prisma. Callers pass pre-aggregated inputs.
 *
 * Weights (Wave 3):
 *   commitment           20%
 *   compliance           20%
 *   rebateEfficiency     20%
 *   timeliness           15%
 *   variance             15%
 *   priceCompetitiveness 10%
 *
 * Banding:
 *   >= 90 A   >= 80 B   >= 70 C   >= 60 D   else F
 */

export interface ContractScoringInput {
  commitmentMet: number // 0-100+ percent
  complianceRate: number // 0-100 (on-contract purchases / total)
  rebatesEarned: number
  totalContractValue: number
  daysUntilExpiration: number // negative if already expired
  /** Optional price-variance severity rollup — more major variances = lower score. */
  majorVarianceCount?: number | null
  totalVarianceCount?: number | null
  /**
   * Optional average of |variancePercent| across the contract's
   * InvoicePriceVariance rows. When null/undefined, the engine treats
   * price competitiveness as perfect (no data → no penalty).
   */
  averageVariancePercent?: number | null
}

export interface ContractScoreResult {
  overallScore: number // 0-100
  components: {
    commitmentScore: number
    complianceScore: number
    rebateEfficiencyScore: number
    timelinessScore: number
    varianceScore: number
    priceCompetitivenessScore: number
  }
  band: "A" | "B" | "C" | "D" | "F"
}

const WEIGHTS = {
  commitment: 0.2,
  compliance: 0.2,
  rebateEfficiency: 0.2,
  timeliness: 0.15,
  variance: 0.15,
  priceCompetitiveness: 0.1,
} as const

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

function timelinessFromDays(daysUntilExpiration: number): number {
  if (daysUntilExpiration < 0) return 0
  if (daysUntilExpiration >= 180) return 100
  if (daysUntilExpiration >= 90) return 85
  if (daysUntilExpiration >= 30) return 60
  return 30
}

function varianceFromCounts(
  majorVarianceCount: number | null | undefined,
  totalVarianceCount: number | null | undefined,
): number {
  // No variances at all (null or 0) => perfect score.
  if (
    totalVarianceCount === null ||
    totalVarianceCount === undefined ||
    totalVarianceCount <= 0
  ) {
    return 100
  }
  const major = majorVarianceCount ?? 0
  const ratio = major / totalVarianceCount
  return clamp(100 * (1 - ratio), 0, 100)
}

function priceCompetitivenessFromVariance(
  averageVariancePercent: number | null | undefined,
): number {
  if (averageVariancePercent === null || averageVariancePercent === undefined) {
    return 100
  }
  return clamp(100 - Math.abs(averageVariancePercent), 0, 100)
}

function bandFor(score: number): ContractScoreResult["band"] {
  if (score >= 90) return "A"
  if (score >= 80) return "B"
  if (score >= 70) return "C"
  if (score >= 60) return "D"
  return "F"
}

export function calculateContractScore(
  input: ContractScoringInput,
): ContractScoreResult {
  const commitmentScore = clamp(input.commitmentMet, 0, 100)
  const complianceScore = clamp(input.complianceRate, 0, 100)

  const rebateEfficiencyScore =
    input.totalContractValue > 0
      ? clamp((input.rebatesEarned / input.totalContractValue) * 1000, 0, 100)
      : 0

  const timelinessScore = timelinessFromDays(input.daysUntilExpiration)
  const varianceScore = varianceFromCounts(
    input.majorVarianceCount,
    input.totalVarianceCount,
  )
  const priceCompetitivenessScore = priceCompetitivenessFromVariance(
    input.averageVariancePercent,
  )

  const overallRaw =
    commitmentScore * WEIGHTS.commitment +
    complianceScore * WEIGHTS.compliance +
    rebateEfficiencyScore * WEIGHTS.rebateEfficiency +
    timelinessScore * WEIGHTS.timeliness +
    varianceScore * WEIGHTS.variance +
    priceCompetitivenessScore * WEIGHTS.priceCompetitiveness

  const overallScore = clamp(overallRaw, 0, 100)

  return {
    overallScore,
    components: {
      commitmentScore,
      complianceScore,
      rebateEfficiencyScore,
      timelinessScore,
      varianceScore,
      priceCompetitivenessScore,
    },
    band: bandFor(overallScore),
  }
}
