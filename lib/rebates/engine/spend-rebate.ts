/**
 * Unified rebate engine — SPEND_REBATE (subsystem 2).
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md §4.2
 *
 * Pure function: given a SpendRebateConfig and a PeriodData snapshot,
 * returns a standardized RebateResult. Applies spend-basis filtering,
 * optional growth-baseline math, then dispatches to the cumulative or
 * marginal tier calculator. Does NOT perform true-up — that's layered on
 * by the CAPITATED and TIE_IN_CAPITAL callers.
 *
 * ─── Audit fixes applied ──────────────────────────────────────
 * [A1] EXCLUSIVE boundary handled by determineTier (shared util).
 * [A2]/[A3] Marginal bracketing / boundary via calculateMarginalRebate.
 * [A4] amountToNextTier reported against TOTAL spend, not growth-adjusted,
 *      so alerts show the real dollar gap the facility faces.
 */
import { sortTiersAscending } from "./shared/sort-tiers"
import { calculateCumulativeRebate } from "./shared/cumulative"
import { calculateMarginalRebate } from "./shared/marginal"
import { determineTier } from "./shared/determine-tier"
import type {
  EngineOptions,
  PeriodData,
  PurchaseRecord,
  RebateResult,
  RebateTier,
  SpendRebateConfig,
  TierResult,
} from "./types"
import { zeroResult } from "./types"

/**
 * Filter purchases per `spendBasis` and sum their extendedPrice.
 * Returns the eligible dollar total BEFORE any baseline subtraction.
 */
function computeEligibleSpend(
  config: SpendRebateConfig,
  periodData: PeriodData,
): number {
  switch (config.spendBasis) {
    case "ALL_SPEND":
      return periodData.totalSpend
    case "REFERENCE_NUMBER": {
      const refs = new Set(config.referenceNumbers ?? [])
      return sumExtendedPrice(
        periodData.purchases.filter((p) => refs.has(p.referenceNumber)),
      )
    }
    case "PRODUCT_CATEGORY": {
      const target = config.productCategory ?? null
      if (target === null) return 0
      return sumExtendedPrice(
        periodData.purchases.filter((p) => p.productCategory === target),
      )
    }
    case "MULTI_CATEGORY": {
      const cats = new Set(config.categories ?? [])
      return sumExtendedPrice(
        periodData.purchases.filter(
          (p) => p.productCategory !== null &&
                 p.productCategory !== undefined &&
                 cats.has(p.productCategory),
        ),
      )
    }
    default: {
      // Exhaustiveness guard.
      const _never: never = config.spendBasis
      void _never
      return 0
    }
  }
}

function sumExtendedPrice(purchases: PurchaseRecord[]): number {
  return purchases.reduce((acc, p) => acc + p.extendedPrice, 0)
}

/**
 * Compute distance from TOTAL spend to the next tier's thresholdMin.
 * Uses the total (pre-baseline) spend per [A4] so downstream alerts
 * reflect the real dollar gap, not a growth-adjusted figure that would
 * under-report how much more spend is required.
 *
 * Returns null when the achieved tier is already the top tier.
 */
function computeAmountToNextTier(
  achievedTier: RebateTier,
  tiers: RebateTier[],
  totalSpend: number,
): number | null {
  const sorted = sortTiersAscending(tiers)
  const idx = sorted.findIndex((t) => t.tierNumber === achievedTier.tierNumber)
  if (idx < 0 || idx === sorted.length - 1) return null
  const nextTier = sorted[idx + 1]!
  return Math.max(0, nextTier.thresholdMin - totalSpend)
}

export function calculateSpendRebate(
  config: SpendRebateConfig,
  periodData: PeriodData,
  options?: EngineOptions,
): RebateResult {
  const periodLabel = options?.periodLabel ?? periodData.periodLabel ?? null
  const warnings: string[] = []

  // ── Edge case: no tiers configured ─────────────────────────────
  if (config.tiers.length === 0) {
    const result = zeroResult("SPEND_REBATE", periodLabel)
    result.warnings.push(
      "Spend rebate has no tiers configured; returning zero rebate",
    )
    return result
  }

  // ── 1. Eligible spend (pre-baseline, per spendBasis filter) ────
  const eligibleSpendRaw = computeEligibleSpend(config, periodData)
  const eligibleSpend = Math.max(0, eligibleSpendRaw)

  // ── 2. Apply baseline / growth adjustment ──────────────────────
  let adjustedSpend = eligibleSpend
  switch (config.baselineType) {
    case "NONE":
      adjustedSpend = eligibleSpend
      break
    case "PRIOR_YEAR_ACTUAL": {
      const baseline = periodData.priorYearActualSpend
      if (baseline == null) {
        if (config.growthOnly === true) {
          warnings.push(
            "Growth-only spend rebate is missing baseline; falling back to full eligible spend",
          )
          adjustedSpend = eligibleSpend
        } else {
          // Non-growth-only, baseline missing → treat as no adjustment but
          // surface a warning so callers notice the data gap.
          warnings.push(
            "PRIOR_YEAR_ACTUAL baseline is missing; evaluating on full eligible spend",
          )
          adjustedSpend = eligibleSpend
        }
      } else {
        adjustedSpend = Math.max(0, eligibleSpend - baseline)
      }
      break
    }
    case "NEGOTIATED_FIXED": {
      const baseline = config.negotiatedBaseline
      if (baseline == null) {
        if (config.growthOnly === true) {
          warnings.push(
            "Growth-only spend rebate is missing baseline; falling back to full eligible spend",
          )
          adjustedSpend = eligibleSpend
        } else {
          warnings.push(
            "NEGOTIATED_FIXED baseline is missing; evaluating on full eligible spend",
          )
          adjustedSpend = eligibleSpend
        }
      } else {
        adjustedSpend = Math.max(0, eligibleSpend - baseline)
      }
      break
    }
    default: {
      const _never: never = config.baselineType
      void _never
      break
    }
  }

  // ── 3. Dispatch to cumulative / marginal calculator ────────────
  let rebateAmount = 0
  let tier: RebateTier | null = null
  let bracketBreakdown: TierResult["bracketBreakdown"] | undefined

  if (config.method === "CUMULATIVE") {
    const { rebate, tier: achieved } = calculateCumulativeRebate(
      adjustedSpend,
      config.tiers,
      config.boundaryRule,
    )
    rebateAmount = rebate
    tier = achieved
  } else {
    const { totalRebate, brackets } = calculateMarginalRebate(
      adjustedSpend,
      config.tiers,
      config.boundaryRule,
    )
    rebateAmount = totalRebate
    // For marginal, the "achieved tier" is whatever determineTier returns
    // against the adjusted spend — needed for amountToNextTier lookups.
    tier = determineTier(adjustedSpend, config.tiers, config.boundaryRule)
    bracketBreakdown = brackets
  }

  // ── 4. Build TierResult (amountToNextTier uses TOTAL spend [A4]) ─
  let tierResult: TierResult | null = null
  if (tier !== null) {
    tierResult = {
      tier,
      thresholdReached: adjustedSpend,
      rebateAmount,
      amountToNextTier: computeAmountToNextTier(
        tier,
        config.tiers,
        periodData.totalSpend,
      ),
      bracketBreakdown:
        config.method === "MARGINAL" ? bracketBreakdown : undefined,
    }
  }

  // ── 5. Assemble result ─────────────────────────────────────────
  return {
    type: "SPEND_REBATE",
    rebateEarned: rebateAmount,
    priceReductionValue: 0,
    eligibleSpend,
    tierResult,
    trueUpAdjustment: 0,
    warnings,
    errors: [],
    periodLabel,
  }
}
