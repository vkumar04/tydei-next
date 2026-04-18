/**
 * Unified rebate engine — VOLUME_REBATE (subsystem 3).
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md §4.3
 *
 * Pure function: given a VolumeRebateConfig and a PeriodData snapshot,
 * returns a standardized RebateResult. Counts CPT-code occurrences among
 * purchases (deduplicated per [A5]), optionally applies an occurrence-
 * denominated baseline, then either:
 *   - multiplies by a fixed-per-occurrence rate (no tier lookup), OR
 *   - dispatches to the cumulative or marginal tier calculator.
 *
 * Does NOT perform true-up — that's layered on by the CAPITATED and
 * TIE_IN_CAPITAL callers.
 *
 * ─── Audit fixes applied ──────────────────────────────────────
 * [A1] EXCLUSIVE boundary handled by determineTier (shared util).
 * [A2]/[A3] Marginal bracketing / boundary via calculateMarginalRebate.
 * [A4] amountToNextTier reported against TOTAL occurrences (pre-baseline)
 *      so alerts show the real volume gap the facility faces.
 * [A5] Dedup prefers `caseId + cptCode`; falls back to `YYYY-MM-DD(purchaseDate) + cptCode`
 *      when caseId is missing. Baselines (priorYearActualSpend and
 *      negotiatedBaseline) are interpreted as OCCURRENCES, not dollars —
 *      the PeriodData field name is re-used for convenience.
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
  TierResult,
  VolumeRebateConfig,
} from "./types"
import { zeroResult } from "./types"

/**
 * Format a Date as YYYY-MM-DD using UTC components. Used as the
 * fallback-dedup component when a purchase has no caseId.
 */
function formatDateKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const d = String(date.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/**
 * Count CPT occurrences across purchases with [A5] dedup semantics.
 *
 * [A5] Dedup key preference:
 *   1. `caseId + cptCode` — same case + same CPT = 1 occurrence no matter
 *      how many line items (e.g. a lens + lens inserter both billed under
 *      the same case should count once).
 *   2. When `caseId` is missing, fall back to `YYYY-MM-DD + cptCode`.
 *      This approximates "same procedure on same day" without cross-day
 *      collisions.
 *
 * Purchases whose cptCode is null/undefined or not in `cptCodes` are
 * ignored entirely.
 */
function countCptOccurrences(
  purchases: PurchaseRecord[],
  cptCodes: string[],
): number {
  if (cptCodes.length === 0) return 0
  const allowed = new Set(cptCodes)
  const seen = new Set<string>()

  for (const purchase of purchases) {
    const cpt = purchase.cptCode
    if (cpt == null) continue
    if (!allowed.has(cpt)) continue

    // [A5] Prefer caseId when present; otherwise fall back to a
    // date-based key so same-day duplicates still collapse.
    const key =
      purchase.caseId != null && purchase.caseId !== ""
        ? `case:${purchase.caseId}|cpt:${cpt}`
        : `date:${formatDateKey(purchase.purchaseDate)}|cpt:${cpt}`

    seen.add(key)
  }

  return seen.size
}

/**
 * Compute distance from TOTAL occurrences to the next tier's thresholdMin.
 * Uses total (pre-baseline) occurrences per [A4] — alerts should reflect
 * the real volume gap, not a growth-adjusted figure.
 *
 * Returns null when the achieved tier is already the top tier.
 */
function computeAmountToNextTier(
  achievedTier: RebateTier,
  tiers: RebateTier[],
  totalOccurrences: number,
): number | null {
  const sorted = sortTiersAscending(tiers)
  const idx = sorted.findIndex((t) => t.tierNumber === achievedTier.tierNumber)
  if (idx < 0 || idx === sorted.length - 1) return null
  const nextTier = sorted[idx + 1]!
  return Math.max(0, nextTier.thresholdMin - totalOccurrences)
}

export function calculateVolumeRebate(
  config: VolumeRebateConfig,
  periodData: PeriodData,
  options?: EngineOptions,
): RebateResult {
  const periodLabel = options?.periodLabel ?? periodData.periodLabel ?? null
  const warnings: string[] = []

  // ── Edge case: no CPT codes configured ─────────────────────────
  if (config.cptCodes.length === 0) {
    const result = zeroResult("VOLUME_REBATE", periodLabel)
    result.warnings.push(
      "Volume rebate has no cptCodes configured; returning zero rebate",
    )
    return result
  }

  // ── Edge case: no tiers AND no fixed-per-occurrence rate ───────
  // Without either, there's no way to translate occurrences into dollars.
  if (
    config.tiers.length === 0 &&
    (config.fixedRebatePerOccurrence == null)
  ) {
    const result = zeroResult("VOLUME_REBATE", periodLabel)
    result.warnings.push(
      "Volume rebate has no tiers and no fixedRebatePerOccurrence configured; returning zero rebate",
    )
    return result
  }

  // ── 1. Count CPT occurrences ([A5] dedup) ──────────────────────
  const totalOccurrences = countCptOccurrences(
    periodData.purchases,
    config.cptCodes,
  )

  // ── 2. Apply baseline / growth adjustment ([A5] baselines in occurrences) ─
  let adjustedOccurrences = totalOccurrences
  switch (config.baselineType) {
    case "NONE":
      adjustedOccurrences = totalOccurrences
      break
    case "PRIOR_YEAR_ACTUAL": {
      // [A5] priorYearActualSpend is re-used here as PRIOR-YEAR OCCURRENCES,
      // not dollars. Caller is responsible for populating it with an
      // occurrence count when config.type is VOLUME_REBATE.
      const baseline = periodData.priorYearActualSpend
      if (baseline == null) {
        if (config.growthOnly === true) {
          warnings.push(
            "Growth-only volume rebate is missing baseline; falling back to full occurrence count",
          )
          adjustedOccurrences = totalOccurrences
        } else {
          warnings.push(
            "PRIOR_YEAR_ACTUAL baseline is missing; evaluating on full occurrence count",
          )
          adjustedOccurrences = totalOccurrences
        }
      } else {
        adjustedOccurrences = Math.max(0, totalOccurrences - baseline)
      }
      break
    }
    case "NEGOTIATED_FIXED": {
      // [A5] negotiatedBaseline is in occurrences for VOLUME_REBATE.
      const baseline = config.negotiatedBaseline
      if (baseline == null) {
        if (config.growthOnly === true) {
          warnings.push(
            "Growth-only volume rebate is missing baseline; falling back to full occurrence count",
          )
          adjustedOccurrences = totalOccurrences
        } else {
          warnings.push(
            "NEGOTIATED_FIXED baseline is missing; evaluating on full occurrence count",
          )
          adjustedOccurrences = totalOccurrences
        }
      } else {
        adjustedOccurrences = Math.max(0, totalOccurrences - baseline)
      }
      break
    }
    default: {
      const _never: never = config.baselineType
      void _never
      break
    }
  }

  // ── 3a. Fixed-per-occurrence path (no tier lookup) ─────────────
  if (config.fixedRebatePerOccurrence != null) {
    const rate = config.fixedRebatePerOccurrence
    const rebateAmount = adjustedOccurrences * rate

    // Synthesize a tier row so downstream consumers get a consistent
    // TierResult shape. tierNumber = 0 signals "not a real tier".
    const syntheticTier: RebateTier = {
      tierNumber: 0,
      tierName: "FIXED_PER_OCCURRENCE",
      thresholdMin: 0,
      thresholdMax: null,
      rebateValue: rate,
    }

    const tierResult: TierResult = {
      tier: syntheticTier,
      thresholdReached: adjustedOccurrences,
      rebateAmount,
      amountToNextTier: null,
    }

    return {
      type: "VOLUME_REBATE",
      rebateEarned: rebateAmount,
      priceReductionValue: 0,
      eligibleSpend: 0,
      tierResult,
      trueUpAdjustment: 0,
      warnings,
      errors: [],
      periodLabel,
    }
  }

  // ── 3b. Tier path (cumulative / marginal) ──────────────────────
  let rebateAmount = 0
  let tier: RebateTier | null = null
  let bracketBreakdown: TierResult["bracketBreakdown"] | undefined

  if (config.method === "CUMULATIVE") {
    const { rebate, tier: achieved } = calculateCumulativeRebate(
      adjustedOccurrences,
      config.tiers,
      config.boundaryRule,
    )
    rebateAmount = rebate
    tier = achieved
  } else {
    const { totalRebate, brackets } = calculateMarginalRebate(
      adjustedOccurrences,
      config.tiers,
      config.boundaryRule,
    )
    rebateAmount = totalRebate
    // For marginal, the "achieved tier" is whatever determineTier returns
    // against the adjusted occurrences — needed for amountToNextTier lookups.
    tier = determineTier(adjustedOccurrences, config.tiers, config.boundaryRule)
    bracketBreakdown = brackets
  }

  // ── 4. Build TierResult (amountToNextTier uses TOTAL occurrences [A4]) ─
  let tierResult: TierResult | null = null
  if (tier !== null) {
    tierResult = {
      tier,
      thresholdReached: adjustedOccurrences,
      rebateAmount,
      amountToNextTier: computeAmountToNextTier(
        tier,
        config.tiers,
        totalOccurrences,
      ),
      bracketBreakdown:
        config.method === "MARGINAL" ? bracketBreakdown : undefined,
    }
  }

  // ── 5. Assemble result ─────────────────────────────────────────
  return {
    type: "VOLUME_REBATE",
    rebateEarned: rebateAmount,
    priceReductionValue: 0,
    eligibleSpend: 0,
    tierResult,
    trueUpAdjustment: 0,
    warnings,
    errors: [],
    periodLabel,
  }
}
