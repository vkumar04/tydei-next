/**
 * Unified rebate engine — CARVE_OUT (subsystem 7).
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md §4.7
 *
 * Pure function: given a CarveOutConfig and a PeriodData snapshot, returns
 * a standardized RebateResult. Carve-outs apply a per-reference-number
 * rate (PERCENT_OF_SPEND or FIXED_PER_UNIT) to purchases matching each
 * configured line. There are no tiers: each line is a flat rate applied
 * to the spend/units recorded under its reference number.
 *
 * ─── Behavior ─────────────────────────────────────────────────
 * - For each CarveOutLineConfig:
 *     1. Filter periodData.purchases by referenceNumber
 *     2. Sum extendedPrice → totalSpend, quantity → totalUnits
 *     3. Apply rate by rateType (type-narrowed switch):
 *          PERCENT_OF_SPEND: lineRebate = totalSpend × rebatePercent (decimal)
 *          FIXED_PER_UNIT : lineRebate = totalUnits × rebatePerUnit
 *     4. Surface a warning (non-fatal) when the required rate field is
 *        missing; the line contributes 0 rebate in that case.
 * - Aggregate:
 *     rebateEarned = Σ lineRebate
 *     eligibleSpend = Σ line totalSpend
 *
 * No tiers, no price reduction, no true-up — carve-out is intentionally
 * simple. Tie-in capital wraps this engine for amortization scenarios.
 */
import type {
  CarveOutConfig,
  CarveOutLineConfig,
  CarveOutLineResult,
  EngineOptions,
  PeriodData,
  PurchaseRecord,
  RebateResult,
} from "./types"

function aggregateLinePurchases(
  line: CarveOutLineConfig,
  purchases: PurchaseRecord[],
): { totalSpend: number; totalUnits: number } {
  let totalSpend = 0
  let totalUnits = 0
  for (const p of purchases) {
    if (p.referenceNumber !== line.referenceNumber) continue
    totalSpend += p.extendedPrice
    totalUnits += p.quantity
  }
  return { totalSpend, totalUnits }
}

function evaluateLine(
  line: CarveOutLineConfig,
  purchases: PurchaseRecord[],
): CarveOutLineResult {
  const { totalSpend, totalUnits } = aggregateLinePurchases(line, purchases)

  // Type-narrowed dispatch on rateType.
  switch (line.rateType) {
    case "PERCENT_OF_SPEND": {
      if (line.rebatePercent == null) {
        return {
          referenceNumber: line.referenceNumber,
          rateType: line.rateType,
          totalSpend,
          totalUnits,
          lineRebate: 0,
          warning: `Carve-out line ${line.referenceNumber}: rebatePercent required for PERCENT_OF_SPEND rate type`,
        }
      }
      return {
        referenceNumber: line.referenceNumber,
        rateType: line.rateType,
        totalSpend,
        totalUnits,
        lineRebate: totalSpend * line.rebatePercent,
      }
    }
    case "FIXED_PER_UNIT": {
      if (line.rebatePerUnit == null) {
        return {
          referenceNumber: line.referenceNumber,
          rateType: line.rateType,
          totalSpend,
          totalUnits,
          lineRebate: 0,
          warning: `Carve-out line ${line.referenceNumber}: rebatePerUnit required for FIXED_PER_UNIT rate type`,
        }
      }
      return {
        referenceNumber: line.referenceNumber,
        rateType: line.rateType,
        totalSpend,
        totalUnits,
        lineRebate: totalUnits * line.rebatePerUnit,
      }
    }
    default: {
      // Exhaustiveness guard — unreachable with typed input.
      const _never: never = line.rateType
      void _never
      return {
        referenceNumber: line.referenceNumber,
        rateType: line.rateType,
        totalSpend,
        totalUnits,
        lineRebate: 0,
        warning: `Carve-out line ${line.referenceNumber}: unknown rateType`,
      }
    }
  }
}

export function calculateCarveOut(
  config: CarveOutConfig,
  periodData: PeriodData,
  options?: EngineOptions,
): RebateResult {
  const periodLabel = options?.periodLabel ?? periodData.periodLabel ?? null
  const warnings: string[] = []
  const carveOutLines: CarveOutLineResult[] = []

  let rebateEarned = 0
  let eligibleSpend = 0

  for (const line of config.lines) {
    const lineResult = evaluateLine(line, periodData.purchases)
    carveOutLines.push(lineResult)
    rebateEarned += lineResult.lineRebate
    eligibleSpend += lineResult.totalSpend
    if (lineResult.warning !== undefined) {
      warnings.push(lineResult.warning)
    }
  }

  return {
    type: "CARVE_OUT",
    rebateEarned,
    priceReductionValue: 0,
    eligibleSpend,
    tierResult: null,
    carveOutLines,
    trueUpAdjustment: 0,
    warnings,
    errors: [],
    periodLabel,
  }
}
