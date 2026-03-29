"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { linearRegression, seasonalDecompose } from "@/lib/analysis/forecasting"
import { serialize } from "@/lib/serialize"

// ─── Types ───────────────────────────────────────────────────────

export interface ForecastPoint {
  period: string
  actual: number | null
  forecast: number | null
  lower: number | null
  upper: number | null
}

export interface ForecastResult {
  data: ForecastPoint[]
  trend: number
  r2: number
}

// ─── Spend Forecast ─────────────────────────────────────────────

export async function getSpendForecast(input: {
  facilityId: string
  contractId?: string
  periods: number
}): Promise<ForecastResult> {
  await requireFacility()
  const { facilityId, contractId, periods } = input

  const where: Record<string, unknown> = { facilityId }
  if (contractId) where.contractId = contractId

  const periodData = await prisma.contractPeriod.findMany({
    where,
    orderBy: { periodStart: "asc" },
  })

  const values = periodData.map((p) => Number(p.totalSpend))
  const labels = periodData.map((p) => p.periodStart.toISOString().slice(0, 7))

  return serialize(buildForecast(labels, values, periods))
}

// ─── Rebate Forecast ────────────────────────────────────────────

export async function getRebateForecast(input: {
  facilityId: string
  contractId?: string
  periods: number
}): Promise<ForecastResult> {
  await requireFacility()
  const { facilityId, contractId, periods } = input

  const where: Record<string, unknown> = { facilityId }
  if (contractId) where.contractId = contractId

  const periodData = await prisma.contractPeriod.findMany({
    where,
    orderBy: { periodStart: "asc" },
  })

  const values = periodData.map((p) => Number(p.rebateEarned))
  const labels = periodData.map((p) => p.periodStart.toISOString().slice(0, 7))

  return serialize(buildForecast(labels, values, periods))
}

// ─── Helpers ────────────────────────────────────────────────────

function buildForecast(
  labels: string[],
  values: number[],
  forecastPeriods: number
): ForecastResult {
  if (values.length < 3) {
    return { data: [], trend: 0, r2: 0 }
  }

  const { slope, intercept, r2 } = linearRegression(values)
  const seasonal = seasonalDecompose(values)

  const actual: ForecastPoint[] = labels.map((label, i) => ({
    period: label,
    actual: values[i],
    forecast: null,
    lower: null,
    upper: null,
  }))

  const lastDate = new Date(labels[labels.length - 1] + "-01")
  const forecasted: ForecastPoint[] = []

  for (let i = 1; i <= forecastPeriods; i++) {
    const idx = values.length + i - 1
    const baseValue = slope * idx + intercept
    const seasonalFactor = seasonal[idx % seasonal.length] ?? 0
    const forecast = Math.max(0, baseValue + seasonalFactor)
    const margin = forecast * 0.1

    const forecastDate = new Date(lastDate)
    forecastDate.setMonth(forecastDate.getMonth() + i)

    forecasted.push({
      period: forecastDate.toISOString().slice(0, 7),
      actual: null,
      forecast: Math.round(forecast * 100) / 100,
      lower: Math.round((forecast - margin) * 100) / 100,
      upper: Math.round((forecast + margin) * 100) / 100,
    })
  }

  return {
    data: [...actual, ...forecasted],
    trend: Math.round(slope * 100) / 100,
    r2: Math.round(r2 * 1000) / 1000,
  }
}
