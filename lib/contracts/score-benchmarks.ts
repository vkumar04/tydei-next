import type { ContractType } from "@prisma/client"
import type { ContractScoreResult } from "@/lib/contracts/scoring"

/**
 * Peer-median benchmarks per contract type. Placeholder values until real
 * industry data is ingested (separate spec). Surface every dimension the
 * scoring engine emits so the radar can overlay both series in the same
 * shape — match the keys returned by `lib/contracts/scoring.ts`.
 */
export type ScoreBenchmark = ContractScoreResult["components"]

const PLACEHOLDER_BENCHMARK: ScoreBenchmark = {
  commitmentScore: 70,
  complianceScore: 80,
  rebateEfficiencyScore: 65,
  timelinessScore: 85,
  varianceScore: 75,
  // priceCompetitivenessScore — median overcharge typically ≤10pct → ~90
  priceCompetitivenessScore: 90,
}

const BENCHMARKS: Partial<Record<ContractType, ScoreBenchmark>> = {
  usage: PLACEHOLDER_BENCHMARK,
  capital: { ...PLACEHOLDER_BENCHMARK, commitmentScore: 50, rebateEfficiencyScore: 55 },
  service: { ...PLACEHOLDER_BENCHMARK, commitmentScore: 60, rebateEfficiencyScore: 60 },
  tie_in: { ...PLACEHOLDER_BENCHMARK, complianceScore: 75 },
  grouped: { ...PLACEHOLDER_BENCHMARK, commitmentScore: 75, rebateEfficiencyScore: 70 },
  pricing_only: { ...PLACEHOLDER_BENCHMARK, rebateEfficiencyScore: 30, commitmentScore: 40 },
}

export function getScoreBenchmark(contractType: ContractType): ScoreBenchmark {
  return BENCHMARKS[contractType] ?? PLACEHOLDER_BENCHMARK
}
