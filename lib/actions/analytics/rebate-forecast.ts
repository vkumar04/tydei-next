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
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"

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
      additionalVendorIds: true,
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
      // Carve-out rate source (Charles 2026-06-06): every carved-out
      // pricing row, keyed by vendorItemNo. Used to derive the flat
      // effective rate the forecast engine applies.
      pricingItems: {
        where: { carveOutPercent: { not: null } },
        select: { vendorItemNo: true, carveOutPercent: true },
      },
    },
  })

  // Pull last 24 months of vendor spend.
  const today = new Date()
  const since = new Date(today)
  since.setMonth(since.getMonth() - 24)
  // Group-drift guard: a grouped/tie-in contract spans several vendors.
  // Scoping to the primary vendorId alone drops the group's spend.
  const vendorIds = contractVendorIds(contract)
  const cog = await prisma.cOGRecord.findMany({
    where: {
      facilityId: { in: scope.cogScopeFacilityIds },
      vendorId: { in: vendorIds },
      transactionDate: { gte: since, lte: today },
    },
    select: {
      transactionDate: true,
      extendedPrice: true,
      vendorItemNo: true,
      manufacturerNo: true,
    },
  })

  // rate lookups keyed by lowercased vendorItemNo and (fallback)
  // manufacturerNo — mirrors the matcher's precedence so a carve-out
  // purchase matched cross-vendor by manufacturerNo still contributes its
  // rebate to the effective-rate numerator.
  const rateByItem = new Map<string, number>()
  const rateByMfr = new Map<string, number>()
  for (const p of contract.pricingItems) {
    if (p.carveOutPercent != null) {
      const rate = Number(p.carveOutPercent)
      rateByItem.set(p.vendorItemNo.toLowerCase(), rate)
      // ContractPricing does not have a manufacturerNo column in the
      // current schema; the cast mirrors recompute.ts line 104 which
      // uses the same workaround while the field is pending migration.
      const mfr = (p as { manufacturerNo?: string | null }).manufacturerNo
      if (mfr) rateByMfr.set(mfr.toLowerCase(), rate)
    }
  }

  // Bucket by YYYY-MM and, in the same pass, sum trailing total spend and
  // trailing carve-out rebate so we can derive a single flat effective rate.
  const monthly = new Map<string, number>()
  let trailingTotalSpend = 0
  let trailingCarveRebate = 0
  for (const r of cog) {
    const spend = Number(r.extendedPrice)
    const d = new Date(r.transactionDate)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    monthly.set(key, (monthly.get(key) ?? 0) + spend)
    trailingTotalSpend += spend
    const rate =
      (r.vendorItemNo ? rateByItem.get(r.vendorItemNo.toLowerCase()) : undefined) ??
      (r.manufacturerNo ? rateByMfr.get(r.manufacturerNo.toLowerCase()) : undefined)
    if (rate !== undefined) trailingCarveRebate += spend * rate
  }

  // Carve-out style = has carve-out pricing rows AND no spend-based tier
  // ladder that would take precedence (matches the engine's term priority).
  // Note: "tie_in" is a ContractType, not a TermType; spend_rebate is the
  // only spend-based TermType that carries a tier ladder in the DB.
  const hasTieredSpendTerm = contract.terms.some(
    (t) => t.termType === "spend_rebate" && t.tiers.length > 0,
  )
  const carveOutEffectiveRate =
    !hasTieredSpendTerm && rateByItem.size > 0 && trailingTotalSpend > 0
      ? trailingCarveRebate / trailingTotalSpend
      : 0

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
    carveOutEffectiveRate,
  })

  return serialize(result)
}
