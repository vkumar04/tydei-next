/**
 * Projected rebate accrual schedule for a ContractTerm + its tiers.
 *
 * Pure helper: given a set of tiers and a period-by-period projection of
 * spend, returns the cumulative-spend trajectory + per-period projected
 * rebate. Supports both cumulative (total spend × achieved-tier rate) and
 * marginal (bracket-by-bracket) calculation methods.
 *
 * Delegates tier-lookup + rebate math to the shared rebate engine
 * (`lib/rebates/engine/shared/`) so contract projections stay consistent
 * with in-engine rebate evaluation.
 */

import { determineTier } from "@/lib/rebates/engine/shared/determine-tier"
import { calculateCumulativeRebate } from "@/lib/rebates/engine/shared/cumulative"
import { calculateMarginalRebate } from "@/lib/rebates/engine/shared/marginal"
import type {
  RebateTier,
  TierBoundaryRule,
} from "@/lib/rebates/engine/types"

export interface AccrualTier {
  spendMin: number
  spendMax: number | null
  /** Percent, e.g. 4 = 4%. */
  rebateValue: number
}

export interface AccrualPeriodInput {
  periodNumber: number
  projectedSpend: number
}

export interface AccrualPeriodProjection {
  periodNumber: number
  projectedSpend: number
  cumulativeSpend: number
  /** Tier number (1-indexed) achieved at cumulativeSpend; 0 if none. */
  achievedTier: number
  /** Percent rate applied for this period's projected rebate. */
  rebateAccrualPercent: number
  /** Dollar rebate projected for this period (delta vs prior cumulative). */
  projectedRebate: number
}

export type AccrualMethod = "cumulative" | "marginal"
export type AccrualBoundaryRule = "exclusive" | "inclusive"

/**
 * Convert the contract-shaped AccrualTier into the engine's RebateTier.
 * Assigns tierNumber in ascending spendMin order (1-indexed).
 */
function toRebateTiers(tiers: AccrualTier[]): RebateTier[] {
  const sorted = [...tiers].sort((a, b) => a.spendMin - b.spendMin)
  return sorted.map((t, idx) => ({
    tierNumber: idx + 1,
    thresholdMin: t.spendMin,
    thresholdMax: t.spendMax,
    rebateValue: t.rebateValue,
  }))
}

function toEngineBoundary(rule: AccrualBoundaryRule): TierBoundaryRule {
  return rule === "exclusive" ? "EXCLUSIVE" : "INCLUSIVE"
}

export function projectRebateAccrualSchedule(input: {
  tiers: AccrualTier[]
  periodProjections: AccrualPeriodInput[]
  method: AccrualMethod
  boundaryRule: AccrualBoundaryRule
}): AccrualPeriodProjection[] {
  const { tiers, periodProjections, method, boundaryRule } = input

  if (periodProjections.length === 0) return []

  const rebateTiers = toRebateTiers(tiers)
  const engineBoundary = toEngineBoundary(boundaryRule)

  let cumulativeSpend = 0
  let priorCumulativeRebate = 0

  const out: AccrualPeriodProjection[] = []

  for (const period of periodProjections) {
    cumulativeSpend += period.projectedSpend

    const tier = determineTier(cumulativeSpend, rebateTiers, engineBoundary)
    const achievedTier = tier ? tier.tierNumber : 0
    const rebateAccrualPercent = tier ? tier.rebateValue : 0

    let cumulativeRebate: number
    if (method === "cumulative") {
      const result = calculateCumulativeRebate(
        cumulativeSpend,
        rebateTiers,
        engineBoundary,
      )
      cumulativeRebate = result.rebate
    } else {
      const result = calculateMarginalRebate(
        cumulativeSpend,
        rebateTiers,
        engineBoundary,
      )
      cumulativeRebate = result.totalRebate
    }

    const projectedRebate = cumulativeRebate - priorCumulativeRebate
    priorCumulativeRebate = cumulativeRebate

    out.push({
      periodNumber: period.periodNumber,
      projectedSpend: period.projectedSpend,
      cumulativeSpend,
      achievedTier,
      rebateAccrualPercent,
      projectedRebate,
    })
  }

  return out
}
