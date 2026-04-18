/**
 * Unified rebate engine — MARKET_SHARE_PRICE_REDUCTION (subsystem 4).
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md §4.4
 *
 * Pure function: given a MarketSharePriceReductionConfig and a PeriodData
 * snapshot, returns a standardized RebateResult populated with
 * `priceReductionValue` and `priceReductionLines[]`. Tier achievement is
 * driven by `marketSharePercent = (vendorCategorySpend / totalCategorySpend) × 100`.
 * `rebateEarned` is always 0 — price reductions reduce invoiced cost at
 * the purchase line, not cash at period close.
 *
 * ─── Audit fixes applied ──────────────────────────────────────
 * [A1] determineTier (shared util) handles EXCLUSIVE/INCLUSIVE boundaries
 *      on the market-share % threshold.
 * [A6] Market-share price reduction evaluates the % threshold distinctly
 *      from dollar math — the share number drives tier lookup, not spend.
 * [A7] Per-line PriceReductionLineResult[] — no single aggregate
 *      effectiveUnitPrice. `priceReductionValue` is the sum of per-line
 *      `totalLineReduction` across the (category-filtered) purchase set.
 */
import { determineTier } from "./shared/determine-tier"
import { computePriceReductionLines } from "./shared/price-reduction-lines"
import type {
  EngineOptions,
  MarketSharePriceReductionConfig,
  PeriodData,
  PriceReductionLineResult,
  PurchaseRecord,
  RebateResult,
  TierResult,
} from "./types"
import { zeroResult } from "./types"

/**
 * Restrict the purchase set to the configured marketShareCategory (when
 * provided). A null/undefined category means "apply to every purchase in
 * the period" — callers that want tighter scoping set the field.
 */
function filterByMarketShareCategory(
  config: MarketSharePriceReductionConfig,
  purchases: PurchaseRecord[],
): PurchaseRecord[] {
  if (config.marketShareCategory == null) return purchases
  const target = config.marketShareCategory
  return purchases.filter((p) => p.productCategory === target)
}

export function calculateMarketSharePriceReduction(
  config: MarketSharePriceReductionConfig,
  periodData: PeriodData,
  options?: EngineOptions,
): RebateResult {
  const periodLabel = options?.periodLabel ?? periodData.periodLabel ?? null
  const warnings: string[] = []

  // ── Edge case: no tiers configured ─────────────────────────────
  if (config.tiers.length === 0) {
    const result = zeroResult("MARKET_SHARE_PRICE_REDUCTION", periodLabel)
    result.warnings.push(
      "Market share price reduction has no tiers configured; returning zero reduction",
    )
    return result
  }

  // ── 1. Fatal: totalCategorySpend missing or zero ───────────────
  // This is an ERROR (not a warning): share % is undefined without a
  // denominator, so there's no meaningful computation to surface.
  const totalCategorySpend = periodData.totalCategorySpend ?? 0
  if (totalCategorySpend <= 0) {
    const result = zeroResult("MARKET_SHARE_PRICE_REDUCTION", periodLabel)
    result.errors.push(
      "totalCategorySpend required for market share calculations",
    )
    return result
  }

  const vendorCategorySpend = periodData.vendorCategorySpend ?? 0
  const marketSharePercent =
    (Math.max(0, vendorCategorySpend) / totalCategorySpend) * 100

  // ── 2. Determine achieved tier against market-share % ─────────
  const tier = determineTier(
    marketSharePercent,
    config.tiers,
    config.boundaryRule,
  )

  // ── 3. Compute per-line reductions on category-filtered purchases
  const relevantPurchases = filterByMarketShareCategory(
    config,
    periodData.purchases,
  )

  let priceReductionLines: PriceReductionLineResult[] = []
  let priceReductionValue = 0
  let tierResult: TierResult | null = null

  if (tier !== null) {
    // [A7] FORWARD_ONLY: reduction applies to every supplied purchase.
    // Caller is responsible for pre-filtering to post-threshold
    // purchases; we warn so the contract is visible in diagnostics.
    if (config.trigger === "FORWARD_ONLY") {
      warnings.push(
        "FORWARD_ONLY trigger: caller must pre-filter purchases by threshold-crossing date. Engine applies reduction to all supplied purchases.",
      )
    }

    // [A7] Per-purchase line breakdown — never a single aggregate.
    priceReductionLines = computePriceReductionLines(relevantPurchases, tier)
    priceReductionValue = priceReductionLines.reduce(
      (acc, line) => acc + line.totalLineReduction,
      0,
    )

    if (tier.reducedPrice == null && tier.priceReductionPercent == null) {
      warnings.push(
        "Tier is missing both reducedPrice and priceReductionPercent — no reduction applied",
      )
    }

    tierResult = {
      tier,
      thresholdReached: marketSharePercent,
      rebateAmount: priceReductionValue,
      amountToNextTier: null,
    }
  }

  // ── 4. Assemble result ─────────────────────────────────────────
  return {
    type: "MARKET_SHARE_PRICE_REDUCTION",
    rebateEarned: 0,
    priceReductionValue,
    // eligibleSpend reflects the vendor's in-category spend feeding the
    // share numerator — useful downstream for dashboards.
    eligibleSpend: Math.max(0, vendorCategorySpend),
    tierResult,
    priceReductionLines,
    trueUpAdjustment: 0,
    warnings,
    errors: [],
    periodLabel,
  }
}
