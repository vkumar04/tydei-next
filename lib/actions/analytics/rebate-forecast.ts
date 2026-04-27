"use server"

/**
 * Charles audit suggestion (v0-port): Rebate Forecast pipeline.
 * Takes the contract's monthly spend history → linear+seasonal
 * forecast → projects through the contract's tier ladder to
 * produce per-month rebate predictions.
 */

import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import { requireContractScope } from "@/lib/actions/analytics/_scope"
import { withTelemetry } from "@/lib/actions/analytics/_telemetry"
import {
  computeRebateForecast,
  type RebateForecast as EngineRebateForecast,
  type RebateForecastPoint as EngineRebateForecastPoint,
} from "@/lib/contracts/rebate-forecast-engine"

// Re-exported from the pure engine so callers (UI, tests) keep
// importing from this action module. The engine owns the canonical
// shape — this file is a thin Prisma + auth wrapper.
export type RebateForecastPoint = EngineRebateForecastPoint
export type RebateForecast = EngineRebateForecast

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

  // Math is now in @/lib/contracts/rebate-forecast-engine. The action
  // owns auth + Prisma; the engine owns projection so it can be tested
  // and oracle'd without going through requireContractScope.
  const result = computeRebateForecast({
    monthlySpend: monthly,
    terms: contract.terms.map((t) => ({
      termType: t.termType,
      tiers: t.tiers,
    })),
    forecastMonths,
  })

  return serialize(result)
}
