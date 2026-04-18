/**
 * Unified rebate engine — TIE_IN_CAPITAL (subsystem 8).
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md §4.8
 *
 * Pure function: given a TieInCapitalConfig and PeriodData for a single
 * period, returns a RebateResult with the current-period amortization
 * schedule row attached and a signed true-up adjustment ([A10]) vs the
 * earned rebate computed by the nested sub-engine.
 *
 * ─── Behavior ─────────────────────────────────────────────────
 * 1. Build the full amortization schedule in memory (not persisted).
 * 2. Select the schedule row for `options.periodNumber` (1-indexed, default 1).
 *    When the period exceeds schedule length, return a zero-rebate result
 *    with a warning — caller has over-run the term and should not charge
 *    the facility further.
 * 3. Invoke the nested rebateEngine (spend / volume / carve-out /
 *    market-share-rebate) to produce `rebateEarned`.
 * 4. Compute scheduledDue = amortizationDue + carriedForwardShortfall.
 * 5. Apply [A10] sign convention:
 *      trueUpAdjustment = scheduledDue - rebateEarned
 *        > 0  → shortfall: facility owes MORE
 *        < 0  → over-accrual: facility earned more than scheduled
 *        = 0  → exact match
 * 6. shortfallHandling decides the warning text:
 *      BILL_IMMEDIATELY → "Period N shortfall $X — bill facility"
 *      CARRY_FORWARD    → "Period N shortfall $X carried forward"
 *    The caller is responsible for actually billing or for passing the
 *    shortfall into the next period's `carriedForwardShortfall`.
 *
 * ─── Nested engine dispatch ───────────────────────────────────
 * To avoid a cyclic import (dispatcher → this file → dispatcher), we do a
 * local switch on `config.rebateEngine.type` and call the leaf engines
 * directly. `TieInCapitalConfig.rebateEngine` already restricts to the
 * four types this file supports.
 */
import { buildTieInAmortizationSchedule } from "./amortization"
import { calculateCarveOut } from "./carve-out"
import { calculateMarketShareRebate } from "./market-share-rebate"
import { calculateSpendRebate } from "./spend-rebate"
import { calculateVolumeRebate } from "./volume-rebate"
import type {
  AmortizationEntry,
  EngineOptions,
  PeriodData,
  RebateResult,
  TieInCapitalConfig,
} from "./types"
import { zeroResult } from "./types"

export interface TieInCapitalOptions extends EngineOptions {
  /** 1-indexed period in the amortization schedule. Default: 1. */
  periodNumber?: number
  /** Shortfall dollars carried in from the prior period (CARRY_FORWARD). Default: 0. */
  carriedForwardShortfall?: number
}

function evaluateNestedEngine(
  config: TieInCapitalConfig["rebateEngine"],
  periodData: PeriodData,
  options?: EngineOptions,
): RebateResult {
  switch (config.type) {
    case "SPEND_REBATE":
      return calculateSpendRebate(config, periodData, options)
    case "VOLUME_REBATE":
      return calculateVolumeRebate(config, periodData, options)
    case "CARVE_OUT":
      return calculateCarveOut(config, periodData, options)
    case "MARKET_SHARE_REBATE":
      return calculateMarketShareRebate(config, periodData, options)
    default: {
      // Exhaustiveness guard — should never fire given the union above.
      const _never: never = config
      void _never
      return zeroResult("SPEND_REBATE", options?.periodLabel ?? null)
    }
  }
}

export function calculateTieInCapital(
  config: TieInCapitalConfig,
  periodData: PeriodData,
  options?: TieInCapitalOptions,
): RebateResult {
  const periodLabel = options?.periodLabel ?? periodData.periodLabel ?? null
  const periodNumber = options?.periodNumber ?? 1
  const carriedForwardShortfall = options?.carriedForwardShortfall ?? 0

  // ── 1. Build schedule in memory ────────────────────────────────
  const schedule = buildTieInAmortizationSchedule({
    capitalCost: config.capitalCost,
    interestRate: config.interestRate,
    termMonths: config.termMonths,
    period: config.period,
  })

  // ── 2. Locate current-period row ───────────────────────────────
  if (periodNumber < 1 || periodNumber > schedule.length) {
    const result = zeroResult("TIE_IN_CAPITAL", periodLabel)
    result.warnings.push(
      `Period ${periodNumber} exceeds schedule length ${schedule.length}; returning zero result`,
    )
    return result
  }

  const amortizationEntry: AmortizationEntry = schedule[periodNumber - 1]!

  // ── 3. Nested rebate calculation ───────────────────────────────
  const subResult = evaluateNestedEngine(config.rebateEngine, periodData, {
    periodLabel,
    verbose: options?.verbose,
  })

  const rebateEarned = subResult.rebateEarned
  const priceReductionValue = subResult.priceReductionValue ?? 0
  const eligibleSpend = subResult.eligibleSpend

  // ── 4. True-up adjustment ([A10]) ──────────────────────────────
  const scheduledDue = amortizationEntry.amortizationDue + carriedForwardShortfall
  const trueUpAdjustment = scheduledDue - rebateEarned

  // ── 5. Warnings per shortfallHandling ──────────────────────────
  const warnings: string[] = [...subResult.warnings]
  const errors: string[] = [...subResult.errors]

  if (trueUpAdjustment > 0) {
    // Format shortfall to 2 decimal places for human-readable warning.
    const shortfallText = trueUpAdjustment.toFixed(2)
    if (config.shortfallHandling === "BILL_IMMEDIATELY") {
      warnings.push(
        `Period ${periodNumber} shortfall $${shortfallText} — bill facility`,
      )
    } else {
      // CARRY_FORWARD — caller must pass this on the next period evaluation.
      warnings.push(
        `Period ${periodNumber} shortfall $${shortfallText} carried forward`,
      )
    }
  }

  return {
    type: "TIE_IN_CAPITAL",
    rebateEarned,
    priceReductionValue,
    eligibleSpend,
    tierResult: subResult.tierResult ?? null,
    amortizationEntry,
    trueUpAdjustment,
    warnings,
    errors,
    periodLabel,
  }
}
