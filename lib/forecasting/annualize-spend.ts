/**
 * Forecast the facility's annualized spend from a monthly-spend series.
 *
 * Combines linear regression (long-run trend) with optional seasonal
 * decomposition (monthly multipliers) and returns a point estimate +
 * 95% confidence band + `r²` so the UI can decide whether to show the
 * range vs a single number.
 *
 * Pure function. Zero I/O. Uses UTC month semantics.
 */
import { linearRegression } from "@/lib/forecasting/linear-regression"
import {
  calculateSeasonalFactors,
  type SeasonalPoint,
} from "@/lib/forecasting/seasonal-factors"

export interface AnnualSpendForecast {
  /** Point estimate of the next 12 months of spend. */
  point: number
  /** Lower bound of the 95% confidence interval. Clamped ≥ 0. */
  low: number
  /** Upper bound of the 95% confidence interval. */
  high: number
  /** 0–1. Closer to 1 = tighter fit; use to decide whether to show the range. */
  r2: number
  /**
   * Annualized growth rate implied by the regression slope, expressed
   * as percent of the historical mean. Positive = spend trending up.
   */
  growthRatePercent: number
  trend: "increasing" | "decreasing" | "stable"
}

export interface AnnualSpendForecastInput {
  /** Monthly-spend series. Newest last. */
  series: readonly SeasonalPoint[]
  /** Whether to apply seasonal factors. Default true; automatically
   *  disabled when fewer than 12 months of history. */
  useSeasonality?: boolean
  /** Months ahead to forecast. Default 12. */
  horizonMonths?: number
}

export function forecastAnnualSpend(
  input: AnnualSpendForecastInput,
): AnnualSpendForecast {
  const series = [...input.series].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  )
  if (series.length === 0) {
    return {
      point: 0,
      low: 0,
      high: 0,
      r2: 0,
      growthRatePercent: 0,
      trend: "stable",
    }
  }
  if (series.length === 1) {
    // Single data point → project it forward as a flat line.
    const v = series[0]!.value
    return {
      point: v * (input.horizonMonths ?? 12),
      low: 0,
      high: v * (input.horizonMonths ?? 12) * 2,
      r2: 0,
      growthRatePercent: 0,
      trend: "stable",
    }
  }

  const startDate = new Date(series[0]!.date)
  const xy = series.map((p) => {
    const d = new Date(p.date)
    const monthsDiff =
      (d.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
      (d.getUTCMonth() - startDate.getUTCMonth())
    return { x: monthsDiff, y: p.value }
  })

  const { slope, intercept, r2 } = linearRegression(xy)
  const lastX = xy[xy.length - 1]!.x

  const useSeasons =
    (input.useSeasonality ?? true) && series.length >= 12
  const seasonalFactors = useSeasons
    ? calculateSeasonalFactors(series)
    : new Map<number, number>()

  const horizon = input.horizonMonths ?? 12
  let point = 0
  let low = 0
  let high = 0
  const lastDate = new Date(series[series.length - 1]!.date)

  for (let i = 1; i <= horizon; i++) {
    const futureDate = new Date(lastDate)
    futureDate.setUTCMonth(futureDate.getUTCMonth() + i)
    const x = lastX + i
    let predicted = slope * x + intercept

    if (useSeasons && seasonalFactors.size > 0) {
      const factor = seasonalFactors.get(futureDate.getUTCMonth()) ?? 1
      predicted *= factor
    }
    predicted = Math.max(0, predicted)

    // Confidence band widens with horizon: stdError scales with (1-r²)
    // and grows 5% per month into the future (same shape as the v0
    // forecaster — empirically defensible, not a tight statistical CI).
    const uncertainty = Math.sqrt(1 - r2) * predicted * (1 + i * 0.05)
    point += predicted
    low += Math.max(0, predicted - uncertainty * 1.96)
    high += predicted + uncertainty * 1.96
  }

  // Growth rate: annualized percent change from the historical mean.
  const avgHistorical =
    series.reduce((s, p) => s + p.value, 0) / series.length
  const growthRatePercent =
    avgHistorical > 0 ? (slope / avgHistorical) * 100 * 12 : 0

  const trend: AnnualSpendForecast["trend"] =
    growthRatePercent > 5
      ? "increasing"
      : growthRatePercent < -5
        ? "decreasing"
        : "stable"

  return {
    point,
    low,
    high,
    r2,
    growthRatePercent,
    trend,
  }
}
