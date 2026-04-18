/**
 * Unified rebate engine — MARKET_SHARE_REBATE (subsystem 5).
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md §4.5
 *
 * Pure function: given a MarketShareRebateConfig and a PeriodData snapshot,
 * returns a standardized RebateResult. Tier achievement is driven by
 * `marketSharePercent = (vendorCategorySpend / totalCategorySpend) × 100`;
 * dollar math is always applied to `vendorCategorySpend`, NEVER to the
 * share percentage.
 *
 * ─── Audit fixes applied ──────────────────────────────────────
 * [A1] determineTier (shared util) handles EXCLUSIVE/INCLUSIVE boundaries
 *      on the market-share % threshold.
 *
 * [A6] CRITICAL — Market share rebate SEPARATES two concerns:
 *        1. Threshold lookup — the tier whose `thresholdMin..thresholdMax`
 *           range (expressed in share %) contains `marketSharePercent`.
 *        2. Dollar calculation — the tier's `rebateValue` (a percent) is
 *           applied to `vendorCategorySpend`, NOT to the share percentage.
 *
 *      Example: 45% share, tier 2 covers 40-50% at rebateValue = 3%,
 *      vendorCategorySpend = $100K → rebate = $100K × 3% = $3,000.
 *
 *      Marginal method uses proportional spend bucketing across share %
 *      brackets: each bracket's dollar share of vendorCategorySpend is
 *      `(thresholdMax - thresholdMin) / 100` of the vendor spend. That
 *      portion is multiplied by the bracket's rate; brackets above the
 *      achieved marketSharePercent are excluded and the top bracket (or
 *      achieved bracket) is clamped to the remainder up to the share %.
 *
 * ─── Edge-case decisions (documented per spec §4.5 deliverables) ─
 *   • Missing/zero totalCategorySpend → fatal ERROR (share % undefined).
 *   • Missing vendorCategorySpend → fatal ERROR (numerator undefined).
 *   • vendorCategorySpend = 0 (explicit) → treated the same as "missing"
 *     per the deliverables: fatal error "vendorCategorySpend required".
 *     Rationale: a zero numerator implies no in-category activity so the
 *     rebate math is not meaningful; upstream callers should pre-filter.
 *   • marketSharePercent > 100% (vendorCategorySpend > totalCategorySpend)
 *     → DATA ERROR. We do NOT clamp silently. Push a WARNING describing
 *     the data inconsistency; the share % value is still used for tier
 *     lookup / marginal capping (clamped to 100 only for marginal bucket
 *     math so brackets don't sum to more than 100% of vendor spend).
 *     Dollar calc continues to use the raw vendorCategorySpend so the
 *     cumulative arm remains accurate.
 */
import { sortTiersAscending } from "./shared/sort-tiers"
import { determineTier } from "./shared/determine-tier"
import type {
  EngineOptions,
  MarketShareRebateConfig,
  PeriodData,
  RebateResult,
  RebateTier,
  TierResult,
} from "./types"
import { zeroResult } from "./types"

/**
 * [A6] Marginal bucketed calculation across share % brackets.
 *
 * For each tier bracket:
 *   bracketSharePoints = min(thresholdMax, marketSharePercent) - thresholdMin
 *   bracketSpend        = (bracketSharePoints / 100) × vendorCategorySpend
 *   bracketRebate       = bracketSpend × (rebateValue / 100)
 *
 * Only brackets up to and including the achieved marketSharePercent
 * contribute. The top tier (thresholdMax === null) is treated as open at
 * the top; its cap is taken from `marketSharePercent` itself (bounded to
 * 100 for sanity when the caller supplies a >100% data error).
 */
function calculateMarginalMarketShareRebate(
  marketSharePercent: number,
  vendorCategorySpend: number,
  tiers: RebateTier[],
): {
  totalRebate: number
  brackets: Array<{
    tierNumber: number
    bracketSpend: number
    bracketRate: number
    bracketRebate: number
  }>
} {
  if (tiers.length === 0 || vendorCategorySpend <= 0 || marketSharePercent <= 0) {
    return { totalRebate: 0, brackets: [] }
  }

  // Guard: clamp the bracket-math ceiling to 100% so a data-error
  // >100% share doesn't cause double-counting. The caller already
  // surfaced the >100% warning; dollar math must still stay sane.
  const effectiveSharePercent = Math.min(100, marketSharePercent)

  const sorted = sortTiersAscending(tiers)
  const brackets: Array<{
    tierNumber: number
    bracketSpend: number
    bracketRate: number
    bracketRebate: number
  }> = []
  let totalRebate = 0

  for (const tier of sorted) {
    const low = tier.thresholdMin
    // Open-ended top bracket: cap by effectiveSharePercent itself.
    const high = tier.thresholdMax ?? effectiveSharePercent

    // Skip brackets entirely above the achieved share %.
    if (low >= effectiveSharePercent) break

    // Only count up to the achieved share %. Bracket portion is the
    // share-point span within the bracket that has actually been earned.
    const bracketCeiling = Math.min(high, effectiveSharePercent)
    const bracketSharePoints = Math.max(0, bracketCeiling - low)
    if (bracketSharePoints <= 0) continue

    // [A6] Convert share points → dollar portion of vendorCategorySpend.
    const bracketSpend = (bracketSharePoints / 100) * vendorCategorySpend

    const bracketRebate =
      tier.fixedRebateAmount != null
        ? tier.fixedRebateAmount
        : (bracketSpend * tier.rebateValue) / 100

    totalRebate += bracketRebate
    brackets.push({
      tierNumber: tier.tierNumber,
      bracketSpend,
      bracketRate: tier.rebateValue,
      bracketRebate,
    })
  }

  return { totalRebate, brackets }
}

/**
 * Distance (in share-percent points) from the achieved tier to the next
 * tier's thresholdMin. Returns null when achieved tier is already the top.
 */
function computeAmountToNextTier(
  achievedTier: RebateTier,
  tiers: RebateTier[],
  marketSharePercent: number,
): number | null {
  const sorted = sortTiersAscending(tiers)
  const idx = sorted.findIndex((t) => t.tierNumber === achievedTier.tierNumber)
  if (idx < 0 || idx === sorted.length - 1) return null
  const nextTier = sorted[idx + 1]!
  return Math.max(0, nextTier.thresholdMin - marketSharePercent)
}

export function calculateMarketShareRebate(
  config: MarketShareRebateConfig,
  periodData: PeriodData,
  options?: EngineOptions,
): RebateResult {
  const periodLabel = options?.periodLabel ?? periodData.periodLabel ?? null
  const warnings: string[] = []

  // ── Edge case: no tiers configured ─────────────────────────────
  if (config.tiers.length === 0) {
    const result = zeroResult("MARKET_SHARE_REBATE", periodLabel)
    result.warnings.push(
      "Market share rebate has no tiers configured; returning zero rebate",
    )
    return result
  }

  // ── 1. Fatal: totalCategorySpend missing or zero ───────────────
  // Per spec §4.5: share % is undefined without a denominator → ERROR.
  const totalCategorySpend = periodData.totalCategorySpend ?? 0
  if (totalCategorySpend <= 0) {
    const result = zeroResult("MARKET_SHARE_REBATE", periodLabel)
    result.errors.push(
      "totalCategorySpend required for market share rebate",
    )
    return result
  }

  // ── 2. Fatal: vendorCategorySpend missing or zero ──────────────
  // Per decision above: a zero/missing numerator is treated as fatal.
  const vendorCategorySpendRaw = periodData.vendorCategorySpend
  if (vendorCategorySpendRaw == null || vendorCategorySpendRaw <= 0) {
    const result = zeroResult("MARKET_SHARE_REBATE", periodLabel)
    result.errors.push(
      "vendorCategorySpend required for market share rebate",
    )
    return result
  }

  const vendorCategorySpend = vendorCategorySpendRaw
  const marketSharePercent =
    (vendorCategorySpend / totalCategorySpend) * 100

  // ── 3. Data-sanity: marketSharePercent > 100 ──────────────────
  // Surface as a warning but continue. Marginal math clamps internally.
  if (marketSharePercent > 100) {
    warnings.push(
      `Market share calculated at ${marketSharePercent.toFixed(2)}% (>100%): vendorCategorySpend exceeds totalCategorySpend — likely data error`,
    )
  }

  // ── 4. Determine achieved tier against marketSharePercent ─────
  const tier = determineTier(
    marketSharePercent,
    config.tiers,
    config.boundaryRule,
  )

  // ── 5. Dispatch: cumulative vs marginal ───────────────────────
  let rebateAmount = 0
  let bracketBreakdown: TierResult["bracketBreakdown"] | undefined

  if (config.method === "CUMULATIVE") {
    // [A6] Cumulative: achieved tier's rate × vendorCategorySpend.
    //     NEVER × marketSharePercent. The share % drives tier lookup only.
    if (tier !== null) {
      if (tier.fixedRebateAmount != null) {
        rebateAmount = tier.fixedRebateAmount
      } else {
        rebateAmount = vendorCategorySpend * (tier.rebateValue / 100)
      }
    }
  } else {
    // [A6] Marginal: bucket vendorCategorySpend proportionally across
    //     share-% brackets. See calculateMarginalMarketShareRebate.
    const { totalRebate, brackets } = calculateMarginalMarketShareRebate(
      marketSharePercent,
      vendorCategorySpend,
      config.tiers,
    )
    rebateAmount = totalRebate
    bracketBreakdown = brackets
  }

  // ── 6. Build TierResult ───────────────────────────────────────
  let tierResult: TierResult | null = null
  if (tier !== null) {
    tierResult = {
      tier,
      thresholdReached: marketSharePercent,
      rebateAmount,
      amountToNextTier: computeAmountToNextTier(
        tier,
        config.tiers,
        marketSharePercent,
      ),
      bracketBreakdown:
        config.method === "MARGINAL" ? bracketBreakdown : undefined,
    }
  }

  // ── 7. Assemble result ────────────────────────────────────────
  return {
    type: "MARKET_SHARE_REBATE",
    rebateEarned: rebateAmount,
    priceReductionValue: 0,
    // eligibleSpend reflects the vendor's in-category spend (the dollar
    // base against which the tier rate is applied).
    eligibleSpend: vendorCategorySpend,
    tierResult,
    trueUpAdjustment: 0,
    warnings,
    errors: [],
    periodLabel,
  }
}
