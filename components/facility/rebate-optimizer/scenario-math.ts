/**
 * Scenario evaluation helpers — client-side.
 *
 * The new engine action (`lib/actions/rebate-optimizer-engine.ts`) exposes
 * a precomputed `RebateOpportunity` shape with the next-tier threshold and
 * rebate rates, but not the full tier ladder. These helpers reconstruct
 * a 2-point ladder (current-tier + next-tier) from that shape and compute
 * projected rebate for an arbitrary spend amount.
 *
 * Pure functions only — no React, no Prisma.
 */

import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer-engine"

export interface ScenarioEvaluation {
  /** Input spend the scenario was evaluated against. */
  projectedSpend: number
  /** Delta vs current spend (clamped to 0 for display). */
  spendDelta: number
  /** Tier number reached at projectedSpend. */
  projectedTierNumber: number | null
  /** Rebate rate applied at projectedSpend (%). */
  projectedRate: number
  /** Rebate earned at projectedSpend. */
  projectedRebate: number
  /** Current rebate at current spend. */
  currentRebate: number
  /** Rebate delta (projected − current), floored at 0. */
  rebateDelta: number
  /** True when projectedSpend crosses into (or past) the next tier. */
  reachesNextTier: boolean
  /** Gap to next tier (0 if already past). */
  gapToNextTier: number
}

/**
 * Evaluate a scenario against an opportunity's 2-tier ladder.
 *
 * Uses a cumulative-style calculation — tier rate × total spend. This
 * matches the shape the server engine returns (`currentRebate` /
 * `projectedRebate` are both cumulative on the opportunity). Marginal
 * method would require the full tier ladder which isn't exposed; we
 * approximate with cumulative for the scenario preview.
 */
export function evaluateScenario(
  opp: RebateOpportunity,
  projectedSpend: number,
): ScenarioEvaluation {
  const safeSpend = Number.isFinite(projectedSpend) && projectedSpend >= 0
    ? projectedSpend
    : 0

  const reachesNextTier = safeSpend >= opp.nextTierThreshold
  const projectedRate = reachesNextTier
    ? opp.nextRebateRate
    : opp.currentRebateRate
  const projectedTierNumber = reachesNextTier
    ? opp.nextTierNumber
    : opp.currentTierNumber
  const projectedRebate = (safeSpend * projectedRate) / 100
  const currentRebate = opp.currentRebate
  const rebateDelta = Math.max(0, projectedRebate - currentRebate)
  const spendDelta = Math.max(0, safeSpend - opp.currentSpend)
  const gapToNextTier = reachesNextTier
    ? 0
    : Math.max(0, opp.nextTierThreshold - safeSpend)

  return {
    projectedSpend: safeSpend,
    spendDelta,
    projectedTierNumber,
    projectedRate,
    projectedRebate,
    currentRebate,
    rebateDelta,
    reachesNextTier,
    gapToNextTier,
  }
}

/**
 * Build a sensitivity series — rebate as a function of spend — across the
 * interesting range. The range spans from 0 through 1.5 × next-tier
 * threshold so the tier step-up is clearly visible.
 *
 * Includes synthetic points exactly at each tier threshold so the chart
 * renders a clean step at the breakpoint rather than a slanted slope
 * across two sample points.
 */
export interface SensitivityPoint {
  spend: number
  rebate: number
  /** True when this point lies at a tier threshold (used to render dots). */
  isBreakpoint: boolean
  tierNumber: number | null
}

export function buildSensitivitySeries(
  opp: RebateOpportunity,
  sampleCount = 40,
): SensitivityPoint[] {
  const maxSpend = Math.max(opp.nextTierThreshold * 1.5, opp.currentSpend * 1.25)
  const thresholds = new Set<number>([0, opp.nextTierThreshold, maxSpend])

  // Current-tier lower bound (approximate — the opportunity only knows the
  // next threshold and current rate, so we anchor at 0 for the lower leg).
  const points: SensitivityPoint[] = []
  const step = maxSpend / sampleCount

  for (let i = 0; i <= sampleCount; i++) {
    const spend = i * step
    const { projectedRebate, projectedTierNumber } = evaluateScenario(opp, spend)
    points.push({
      spend,
      rebate: projectedRebate,
      isBreakpoint: thresholds.has(spend),
      tierNumber: projectedTierNumber,
    })
  }

  // Ensure the threshold point itself is included (avoids the step being
  // missed by sample granularity).
  for (const threshold of thresholds) {
    if (threshold <= 0) continue
    const exists = points.some((p) => Math.abs(p.spend - threshold) < 0.5)
    if (exists) continue
    const { projectedRebate, projectedTierNumber } = evaluateScenario(
      opp,
      threshold,
    )
    points.push({
      spend: threshold,
      rebate: projectedRebate,
      isBreakpoint: true,
      tierNumber: projectedTierNumber,
    })
  }

  points.sort((a, b) => a.spend - b.spend)
  return points
}
