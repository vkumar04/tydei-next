/**
 * Charles iMessage 2026-04-20 N14 — projected-year-end rebate.
 *
 * "Rebate earned YTD does not make sense a lot because many rebates
 *  are earned on the last day of the year, it should be the projected
 *  rebate there. Should be the rebate they are trending toward based
 *  on historic spend."
 *
 * Pure reducer. Given trailing-12-month spend (as a proxy for the
 * contract's annual run rate) + the contract's tier ladder, returns
 * the rebate that would be EARNED over a full year at current pace.
 * Callers subtract the YTD-already-earned number to show how much
 * more is coming at the current trajectory.
 *
 * Reserves CLAUDE.md's "rebates NEVER auto-computed for display"
 * rule — this helper is ONLY called where the UI labels the value as
 * a PROJECTION. Never route an earned/collected tile through it.
 *
 * Units convention: `tierRate` is integer percent (3 = 3%) matching
 * the engine boundary. Callers who start from Prisma fractions should
 * use `computeRebateFromPrismaTiers` and then subtract, rather than
 * calling this helper directly.
 */
import {
  calculateCumulative,
  calculateMarginal,
  type RebateMethodName,
  type TierLike,
} from "@/lib/rebates/calculate"
import {
  forecastAnnualSpend,
  type AnnualSpendForecast,
} from "@/lib/forecasting/annualize-spend"
import type { SeasonalPoint } from "@/lib/forecasting/seasonal-factors"

export interface ProjectedRebateInput {
  /** Spend over the trailing 12 months. Serves as a pace estimate. */
  rolling12Spend: number
  /** Rebate already earned YTD. Subtracted to get "more to earn" number. */
  rebateEarnedYTD: number
  tiers: TierLike[]
  method?: RebateMethodName
  /**
   * Optional monthly-spend history. When supplied, engine runs on the
   * forecaster's (point, low, high) bands instead of just rolling-12
   * as a single number — gives the UI confidence to show a range when
   * the trend is noisy (low r²).
   */
  spendHistory?: readonly SeasonalPoint[]
}

export interface ProjectedRebateResult {
  /** Full-year projection given current pace, run through the engine. */
  projectedFullYear: number
  /** projectedFullYear − rebateEarnedYTD, clamped ≥ 0. */
  projectedRemaining: number
  /** Sum of YTD earned + projected-remaining. Handy one-tile summary. */
  projectedTotalAtYearEnd: number
  /**
   * When spendHistory is provided: 95% confidence band on the
   * full-year projection. Null when no history given OR when the fit
   * is effectively a point (flat data, r² = 0).
   */
  confidence?: {
    low: number
    high: number
    r2: number
    trend: AnnualSpendForecast["trend"]
    growthRatePercent: number
  } | null
}

export function computeProjectedRebate(
  input: ProjectedRebateInput,
): ProjectedRebateResult {
  const method: RebateMethodName = input.method ?? "cumulative"
  const engine = method === "marginal" ? calculateMarginal : calculateCumulative
  const projectedFullYear = engine(
    Math.max(0, input.rolling12Spend),
    input.tiers,
  ).rebateEarned
  const projectedRemaining = Math.max(
    0,
    projectedFullYear - input.rebateEarnedYTD,
  )

  // Confidence band: when a spend history is available, run the
  // forecaster across the history, then re-run the engine on the low /
  // high ends of the forecast to get bounds on the rebate projection.
  // Skipped when no history or when the forecast has zero uncertainty.
  let confidence: ProjectedRebateResult["confidence"] = null
  if (input.spendHistory && input.spendHistory.length > 0) {
    const forecast = forecastAnnualSpend({ series: input.spendHistory })
    const rebateLow = engine(Math.max(0, forecast.low), input.tiers).rebateEarned
    const rebateHigh = engine(
      Math.max(0, forecast.high),
      input.tiers,
    ).rebateEarned
    if (rebateLow !== rebateHigh) {
      confidence = {
        low: rebateLow,
        high: rebateHigh,
        r2: forecast.r2,
        trend: forecast.trend,
        growthRatePercent: forecast.growthRatePercent,
      }
    }
  }

  return {
    projectedFullYear,
    projectedRemaining,
    projectedTotalAtYearEnd: input.rebateEarnedYTD + projectedRemaining,
    confidence,
  }
}
