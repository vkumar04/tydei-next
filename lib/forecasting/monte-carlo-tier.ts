/**
 * Monte Carlo tier probability — roadmap track 6.
 *
 * Given a monthly-spend history + tier ladder, bootstraps many
 * annualized-spend samples and reports the probability distribution
 * of year-end tier qualification + rebate percentiles.
 *
 * Procurement teams want "what's the chance we hit tier 2 by year-end"
 * not just a point estimate. This helper produces that distribution
 * using bootstrap resampling — no normality assumptions, no fragile
 * variance estimates.
 *
 * Algorithm per iteration:
 *   1. Sample N months (with replacement) from the history.
 *   2. Annualize: multiply mean × 12 to get a synthetic annual spend.
 *   3. Run the tier engine on that synthetic spend.
 *   4. Record (tier reached, rebate).
 *
 * Aggregate:
 *   - P(tier k) = count_k / iterations for each tier in the ladder,
 *     plus "no tier" (below-baseline).
 *   - Rebate percentiles: 5th / 50th / 95th across all iterations.
 *   - Expected rebate: mean across all iterations.
 *
 * Pure function, seeded PRNG for determinism. No DB, no side effects.
 */
import {
  calculateCumulative,
  calculateMarginal,
  type RebateMethodName,
  type TierLike,
} from "@/lib/rebates/calculate"

export interface MonteCarloInput {
  /** Monthly spend history (any length; more is better). */
  monthlySpend: readonly number[]
  /** Tier ladder. */
  tiers: readonly TierLike[]
  /** Cumulative or marginal. Default cumulative. */
  method?: RebateMethodName
  /** How many iterations to run. Default 1000. */
  iterations?: number
  /** Seed for the PRNG so tests reproduce. Default 1. */
  seed?: number
}

export interface MonteCarloResult {
  /** Map from tierNumber (0 = no tier) to probability [0,1]. */
  tierProbability: Map<number, number>
  /** 5th percentile annualized rebate across iterations. */
  rebateP5: number
  /** Median annualized rebate. */
  rebateP50: number
  /** 95th percentile annualized rebate. */
  rebateP95: number
  /** Mean annualized rebate across iterations. */
  expectedRebate: number
  iterations: number
}

function makePrng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor(p * sorted.length)),
  )
  return sorted[idx]!
}

export function monteCarloTierProbability(
  input: MonteCarloInput,
): MonteCarloResult {
  const iterations = input.iterations ?? 1000
  const method: RebateMethodName = input.method ?? "cumulative"
  const engine = method === "marginal" ? calculateMarginal : calculateCumulative

  const history = input.monthlySpend
  if (history.length === 0 || input.tiers.length === 0) {
    return {
      tierProbability: new Map([[0, 1]]),
      rebateP5: 0,
      rebateP50: 0,
      rebateP95: 0,
      expectedRebate: 0,
      iterations,
    }
  }

  const rng = makePrng(input.seed ?? 1)
  const tierCounts = new Map<number, number>()
  const rebates: number[] = []

  // Each iteration: sample 12 months with replacement from history,
  // mean × 12 → synthetic annual spend. Run engine, record outcome.
  for (let iter = 0; iter < iterations; iter++) {
    let monthlyMeanSum = 0
    for (let m = 0; m < 12; m++) {
      const idx = Math.floor(rng() * history.length)
      monthlyMeanSum += history[idx]!
    }
    const annualSpend = monthlyMeanSum // sum of 12 sampled months = annual
    const result = engine(Math.max(0, annualSpend), input.tiers as TierLike[])
    tierCounts.set(result.tierAchieved, (tierCounts.get(result.tierAchieved) ?? 0) + 1)
    rebates.push(result.rebateEarned)
  }

  const tierProbability = new Map<number, number>()
  for (const [tier, count] of tierCounts) {
    tierProbability.set(tier, count / iterations)
  }

  rebates.sort((a, b) => a - b)
  const sum = rebates.reduce((s, v) => s + v, 0)
  return {
    tierProbability,
    rebateP5: percentile(rebates, 0.05),
    rebateP50: percentile(rebates, 0.5),
    rebateP95: percentile(rebates, 0.95),
    expectedRebate: sum / rebates.length,
    iterations,
  }
}
