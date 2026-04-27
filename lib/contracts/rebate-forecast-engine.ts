/**
 * Pure-function rebate-forecast engine.
 *
 * Extracted from `lib/actions/analytics/rebate-forecast.ts` so the math
 * is testable + oracle-able without going through `requireContractScope`
 * or Prisma. The server action handles auth + DB fetching, then hands a
 * windowed `monthlySpend` Map and `terms` array here for projection.
 *
 * No `"use server"` — this is a leaf module callable from anywhere
 * (including Vitest unit tests and `scripts/oracles/`).
 */
import {
  linearRegression,
  seasonalDecompose,
} from "@/lib/analysis/forecasting"

export interface RebateForecastPoint {
  period: string
  spend: number
  isForecast: boolean
  cumulativeYtdSpend: number
  achievedTier: number
  achievedRatePct: number
  rebateForPeriod: number
}

export interface RebateForecast {
  history: RebateForecastPoint[]
  forecast: RebateForecastPoint[]
  trend: "increasing" | "decreasing" | "stable"
  growthRatePct: number
  confidencePct: number
}

export interface ForecastTermLike {
  termType: string
  tiers: ReadonlyArray<{
    tierNumber: number
    spendMin: number | string | { toString(): string }
    rebateValue: number | string | { toString(): string }
  }>
}

const SPEND_BASED_TERM_TYPES = new Set([
  "spend_rebate",
  "growth_rebate",
  "tie_in",
  "carve_out",
])

export interface ComputeRebateForecastInput {
  /** YYYY-MM → spend $ for that month. Must contain at least 3 months
   *  for a meaningful projection; less returns an empty forecast. */
  monthlySpend: Map<string, number>
  /** Contract terms (in createdAt order). The engine picks the first
   *  spend-based term with tiers; falls back to first term with tiers,
   *  then the first term. */
  terms: ReadonlyArray<ForecastTermLike>
  /** How many months of forecast to project. Default 12. */
  forecastMonths?: number
}

export function computeRebateForecast(
  input: ComputeRebateForecastInput,
): RebateForecast {
  const { monthlySpend, terms } = input
  const forecastMonths = input.forecastMonths ?? 12

  const sortedKeys = Array.from(monthlySpend.keys()).sort()
  const values = sortedKeys.map((k) => monthlySpend.get(k) ?? 0)

  if (values.length < 3) {
    return {
      history: [],
      forecast: [],
      trend: "stable",
      growthRatePct: 0,
      confidencePct: 0,
    }
  }

  const { slope, intercept, r2 } = linearRegression(values)
  const seasonal = seasonalDecompose(values)
  const meanValue = values.reduce((a, b) => a + b, 0) / values.length

  const growthRatePct = meanValue > 0 ? (slope / meanValue) * 100 * 12 : 0
  const trend: RebateForecast["trend"] =
    growthRatePct > 5
      ? "increasing"
      : growthRatePct < -5
        ? "decreasing"
        : "stable"

  // Pick the first spend-based term with tiers; fall back gracefully.
  const spendTerm =
    terms.find(
      (t) => SPEND_BASED_TERM_TYPES.has(t.termType) && t.tiers.length > 0,
    ) ??
    terms.find((t) => t.tiers.length > 0) ??
    terms[0]
  const tiers = spendTerm?.tiers ?? []

  const projectTier = (cumulativeYtd: number) => {
    let achievedTier = 0
    let rate = 0
    for (const t of tiers) {
      if (cumulativeYtd >= Number(t.spendMin)) {
        achievedTier = t.tierNumber
        rate = Number(t.rebateValue)
      }
    }
    return { achievedTier, rate }
  }

  const buildPoint = (
    key: string,
    spend: number,
    isForecast: boolean,
    cumulative: number,
  ): RebateForecastPoint => {
    const { achievedTier, rate } = projectTier(cumulative)
    return {
      period: key,
      spend: Math.round(spend * 100) / 100,
      isForecast,
      cumulativeYtdSpend: Math.round(cumulative * 100) / 100,
      achievedTier,
      achievedRatePct: Math.round(rate * 10000) / 100,
      rebateForPeriod: Math.round(spend * rate * 100) / 100,
    }
  }

  const history: RebateForecastPoint[] = []
  let cumYtd = 0
  let lastYear = sortedKeys[0]?.slice(0, 4)
  for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i]
    const year = key.slice(0, 4)
    if (year !== lastYear) {
      cumYtd = 0
      lastYear = year
    }
    cumYtd += values[i]
    history.push(buildPoint(key, values[i], false, cumYtd))
  }

  const forecast: RebateForecastPoint[] = []
  const lastDate = new Date(sortedKeys[sortedKeys.length - 1] + "-01")
  let fcCumYtd = lastDate.getMonth() === 11 ? 0 : cumYtd
  let fcLastYear = lastDate.getFullYear()
  for (let i = 1; i <= forecastMonths; i++) {
    const idx = values.length + i - 1
    const baseValue = slope * idx + intercept
    const seasonalFactor = seasonal[idx % seasonal.length] ?? 0
    const multiplier = meanValue !== 0 ? 1 + seasonalFactor / meanValue : 1
    const spend = Math.max(0, baseValue * multiplier)

    const fcDate = new Date(lastDate)
    fcDate.setMonth(fcDate.getMonth() + i)
    if (fcDate.getFullYear() !== fcLastYear) {
      fcCumYtd = 0
      fcLastYear = fcDate.getFullYear()
    }
    fcCumYtd += spend
    const fcKey = `${fcDate.getFullYear()}-${String(fcDate.getMonth() + 1).padStart(2, "0")}`
    forecast.push(buildPoint(fcKey, spend, true, fcCumYtd))
  }

  return {
    history,
    forecast,
    trend,
    growthRatePct: Math.round(growthRatePct * 10) / 10,
    confidencePct: Math.round(Math.max(0, r2) * 100),
  }
}
