"use server"

/**
 * Charles audit suggestion (v0-port): Rebate Forecast pipeline.
 * Takes the contract's monthly spend history → linear+seasonal
 * forecast → projects through the contract's tier ladder to
 * produce per-month rebate predictions.
 */

import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import {
  linearRegression,
  seasonalDecompose,
} from "@/lib/analysis/forecasting"
import { requireContractScope } from "@/lib/actions/analytics/_scope"
import { withTelemetry } from "@/lib/actions/analytics/_telemetry"

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

export async function getRebateForecast(
  contractId: string,
  forecastMonths = 12,
): Promise<RebateForecast> {
  return withTelemetry(
    "getRebateForecast",
    { contractId, forecastMonths },
    async () => {
      try {
        return await _getRebateForecastImpl(contractId, forecastMonths)
      } catch (err) {
        console.error("[getRebateForecast]", err, { contractId, forecastMonths })
        throw new Error("Rebate forecast is unavailable for this contract.")
      }
    },
  )
}

async function _getRebateForecastImpl(
  contractId: string,
  forecastMonths: number,
): Promise<RebateForecast> {
  const scope = await requireContractScope(contractId)

  const contract = await prisma.contract.findFirstOrThrow({
    where: { id: contractId },
    select: {
      vendorId: true,
      effectiveDate: true,
      terms: {
        select: {
          termType: true,
          tiers: {
            select: { tierNumber: true, spendMin: true, rebateValue: true },
            orderBy: { spendMin: "asc" },
          },
        },
        // Charles 2026-04-26 #81: load every term — the forecast was
        // hard-pinning to terms[0] (no orderBy), which silently picked
        // a price_reduction or volume_rebate term whose tier ladder
        // doesn't apply to dollar spend, producing a flat $0 forecast
        // even when the contract had a spend-rebate term that would
        // project real numbers. We now filter to spend-based rebate
        // terms below and use the lowest-threshold ladder.
        orderBy: { createdAt: "asc" },
      },
    },
  })

  // Pull last 24 months of vendor spend.
  const today = new Date()
  const since = new Date(today)
  since.setMonth(since.getMonth() - 24)
  const cog = await prisma.cOGRecord.findMany({
    where: {
      facilityId: { in: scope.cogScopeFacilityIds },
      vendorId: contract.vendorId,
      transactionDate: { gte: since, lte: today },
    },
    select: { transactionDate: true, extendedPrice: true },
  })

  // Bucket by YYYY-MM.
  const monthly = new Map<string, number>()
  for (const r of cog) {
    const d = new Date(r.transactionDate)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    monthly.set(key, (monthly.get(key) ?? 0) + Number(r.extendedPrice))
  }
  const sortedKeys = Array.from(monthly.keys()).sort()
  const values = sortedKeys.map((k) => monthly.get(k) ?? 0)

  if (values.length < 3) {
    return serialize({
      history: [],
      forecast: [],
      trend: "stable" as const,
      growthRatePct: 0,
      confidencePct: 0,
    })
  }

  const { slope, intercept, r2 } = linearRegression(values)
  const seasonal = seasonalDecompose(values)
  const meanValue = values.reduce((a, b) => a + b, 0) / values.length

  // Annualized growth rate vs historical mean.
  const growthRatePct = meanValue > 0 ? (slope / meanValue) * 100 * 12 : 0
  const trend: RebateForecast["trend"] =
    growthRatePct > 5
      ? "increasing"
      : growthRatePct < -5
        ? "decreasing"
        : "stable"

  // Tier helper — cumulative method matches tydei's spend-rebate
  // engine default.
  //
  // Charles 2026-04-26 #81: pick the first SPEND-based rebate term
  // with tiers. Volume / market_share / price_reduction terms have
  // tier thresholds in non-dollar units and would force the forecast
  // to $0 (cumulative YTD spend never crosses a 5,300,000-unit volume
  // threshold). Falls through to the contract's first term if none
  // are spend-based, preserving prior behavior for contracts where
  // the only rebate is an unusual type.
  const SPEND_BASED_TERM_TYPES = new Set([
    "spend_rebate",
    "growth_rebate",
    "tie_in",
    "carve_out",
  ])
  const spendTerm =
    contract.terms.find(
      (t) => SPEND_BASED_TERM_TYPES.has(t.termType) && t.tiers.length > 0,
    ) ??
    contract.terms.find((t) => t.tiers.length > 0) ??
    contract.terms[0]
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

  // Walk history first.
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

  // Forecast.
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

  return serialize({
    history,
    forecast,
    trend,
    growthRatePct: Math.round(growthRatePct * 10) / 10,
    confidencePct: Math.round(Math.max(0, r2) * 100),
  })
}
