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
  /** Percent, e.g. 4 = 4%; 0 for a flat-dollar tier. Map Prisma rows with
   *  `toEngineRebateUnits` (lib/rebates/calculate.ts). */
  rebateValue: number
  /** Flat dollars on tier qualification. When set the engine short-circuits to
   *  it instead of the percent math. */
  fixedRebateAmount?: number | null
}

export interface AccrualPeriodInput {
  periodNumber: number
  projectedSpend: number
}

export interface AccrualPeriodProjection {
  periodNumber: number
  projectedSpend: number
  /** Gross running spend — display basis; never reduced by cap or baseline. */
  cumulativeSpend: number
  /** `projectedSpend` after the period cap and the pro-rated growth baseline.
   *  Mirrors `EvaluationPeriodBucket.qualifyingSpend`. */
  qualifyingSpend: number
  /** Running sum of `qualifyingSpend` — what tier lookup runs against. */
  cumulativeQualifyingSpend: number
  /** Dollars removed by the growth baseline; 0 when not growth-based. */
  growthBaselineApplied: number
  /** Dollars removed by `periodCap`; 0 when uncapped. */
  capApplied: number
  /** Tier number (1-indexed) achieved at cumulativeQualifyingSpend; 0 if none. */
  achievedTier: number
  /** Percent rate applied for this period's projected rebate. 0 for a
   *  flat-dollar tier, which has no percent rate — render the dollars. */
  rebateAccrualPercent: number
  /** Dollar rebate projected for this period: the delta vs the prior cumulative
   *  for a percent tier, and the flat amount itself for a flat-dollar tier,
   *  which is a per-period payout. */
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
    fixedRebateAmount: t.fixedRebateAmount ?? null,
  }))
}

function toEngineBoundary(rule: AccrualBoundaryRule): TierBoundaryRule {
  return rule === "exclusive" ? "EXCLUSIVE" : "INCLUSIVE"
}

/** Per-period eligibility narrowing from `ContractTerm`. Every option defaults
 *  to the un-narrowed arithmetic, so an omitting caller is unchanged. */
export interface AccrualQualifyingSpendOptions {
  /** `ContractTerm.spendBaseline`, in annual dollars; pro-rated by
   *  `periodMonths / 12`. */
  spendBaseline?: number | null
  /** `ContractTerm.growthOnly` — gates the baseline subtraction. */
  growthOnly?: boolean
  /** Spend ceiling for one `periodProjections` entry, applied before the
   *  baseline. A spend ceiling, not a rebate ceiling. */
  periodCap?: number | null
  /** Width of one `periodProjections` entry in months. Default 12. */
  periodMonths?: number
}

/** `ContractTerm.periodCap` is per evaluation period; a year-stepping
 *  projection needs it per year. */
export function annualizePeriodCap(
  periodCap: number | null | undefined,
  evaluationPeriod: string,
  termYears: number,
): number | null {
  if (periodCap === null || periodCap === undefined) return null
  const cap = Number(periodCap)
  if (!Number.isFinite(cap) || cap < 0) return null
  switch (evaluationPeriod) {
    case "monthly":
      return cap * 12
    case "quarterly":
      return cap * 4
    case "semi_annual":
      return cap * 2
    // One ceiling for the whole term, spread evenly across it.
    case "lifetime":
      return termYears > 0 ? cap / termYears : cap
    default:
      return cap
  }
}

export function projectRebateAccrualSchedule(
  input: {
    tiers: AccrualTier[]
    periodProjections: AccrualPeriodInput[]
    method: AccrualMethod
    boundaryRule: AccrualBoundaryRule
  } & AccrualQualifyingSpendOptions,
): AccrualPeriodProjection[] {
  const {
    tiers,
    periodProjections,
    method,
    boundaryRule,
    spendBaseline = null,
    growthOnly = false,
    periodCap = null,
    periodMonths = 12,
  } = input

  if (periodProjections.length === 0) return []

  const rebateTiers = toRebateTiers(tiers)
  const engineBoundary = toEngineBoundary(boundaryRule)

  const baseline = spendBaseline ?? 0
  const proRatedBaseline =
    growthOnly && baseline > 0 ? baseline * (periodMonths / 12) : 0
  const eligibilityCap = periodCap != null && periodCap >= 0 ? periodCap : null

  let cumulativeSpend = 0
  let cumulativeQualifyingSpend = 0
  let priorCumulativeRebate = 0

  const out: AccrualPeriodProjection[] = []

  for (const period of periodProjections) {
    cumulativeSpend += period.projectedSpend

    // Cap clamps spend first, then the baseline comes off the capped figure.
    // The max(0, …) is per period and the slices accumulate, so a shortfall
    // year cannot offset a growth year.
    const cappedSpend =
      eligibilityCap === null
        ? period.projectedSpend
        : Math.min(period.projectedSpend, eligibilityCap)
    const capApplied = period.projectedSpend - cappedSpend
    const qualifyingSpend =
      proRatedBaseline > 0
        ? Math.max(0, cappedSpend - proRatedBaseline)
        : cappedSpend
    const growthBaselineApplied = cappedSpend - qualifyingSpend
    cumulativeQualifyingSpend += qualifyingSpend

    const tier = determineTier(
      cumulativeQualifyingSpend,
      rebateTiers,
      engineBoundary,
    )
    const achievedTier = tier ? tier.tierNumber : 0
    const rebateAccrualPercent = tier ? tier.rebateValue : 0

    let cumulativeRebate: number
    if (method === "cumulative") {
      const result = calculateCumulativeRebate(
        cumulativeQualifyingSpend,
        rebateTiers,
        engineBoundary,
      )
      cumulativeRebate = result.rebate
    } else {
      const result = calculateMarginalRebate(
        cumulativeQualifyingSpend,
        rebateTiers,
        engineBoundary,
      )
      cumulativeRebate = result.totalRebate
    }

    // A flat-dollar tier pays its amount ONCE PER PERIOD, so the delta model
    // does not apply: the engine short-circuits to a constant, and subtracting
    // the prior cumulative would pay it in the qualifying period and $0 for
    // every period after. The canonical writer (buildEvaluationPeriodAccruals)
    // runs the engine per evaluation window and takes rebateEarned whole —
    // this matches it, so the DCF projection and the accrual timeline agree.
    let projectedRebate: number
    if (tier?.fixedRebateAmount != null) {
      projectedRebate = cumulativeRebate
    } else {
      projectedRebate = cumulativeRebate - priorCumulativeRebate
      priorCumulativeRebate = cumulativeRebate
    }

    out.push({
      periodNumber: period.periodNumber,
      projectedSpend: period.projectedSpend,
      cumulativeSpend,
      qualifyingSpend,
      cumulativeQualifyingSpend,
      growthBaselineApplied,
      capApplied,
      achievedTier,
      rebateAccrualPercent,
      projectedRebate,
    })
  }

  return out
}
