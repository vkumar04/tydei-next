/**
 * Unified rebate engine — TIER_PRICE_REDUCTION (subsystem 4).
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md §4.4
 *
 * Pure function: given a TierPriceReductionConfig and a PeriodData
 * snapshot, returns a standardized RebateResult populated with
 * `priceReductionValue` and `priceReductionLines[]`. Tier achievement is
 * driven by filtered eligibleSpend (same spendBasis filter as the spend
 * engine). `rebateEarned` is always 0 — price reductions are not cash
 * rebates; they reduce invoiced cost at the purchase line.
 *
 * ─── Audit fixes applied ──────────────────────────────────────
 * [A1] determineTier (shared util) handles EXCLUSIVE/INCLUSIVE boundaries.
 * [A7] Per-line PriceReductionLineResult[] — no single aggregate
 *      effectiveUnitPrice. `priceReductionValue` is the sum of per-line
 *      `totalLineReduction` across all filtered purchases.
 */
import { determineTier } from "./shared/determine-tier"
import { computePriceReductionLines } from "./shared/price-reduction-lines"
import type {
  EngineOptions,
  PeriodData,
  PriceReductionLineResult,
  PurchaseRecord,
  RebateResult,
  TierPriceReductionConfig,
  TierResult,
} from "./types"
import { zeroResult } from "./types"

/**
 * Filter purchases by `spendBasis`. Returns the eligible purchase subset
 * (mirrors spend-rebate's logic; kept local so this engine is
 * self-contained while the shared `filter-basis` utility lands).
 */
function filterPurchasesByBasis(
  config: TierPriceReductionConfig,
  periodData: PeriodData,
): PurchaseRecord[] {
  switch (config.spendBasis) {
    case "ALL_SPEND":
      return periodData.purchases
    case "REFERENCE_NUMBER": {
      const refs = new Set(config.referenceNumbers ?? [])
      return periodData.purchases.filter((p) => refs.has(p.referenceNumber))
    }
    case "PRODUCT_CATEGORY": {
      const target = config.productCategory ?? null
      if (target === null) return []
      return periodData.purchases.filter((p) => p.productCategory === target)
    }
    case "MULTI_CATEGORY": {
      const cats = new Set(config.categories ?? [])
      return periodData.purchases.filter(
        (p) =>
          p.productCategory !== null &&
          p.productCategory !== undefined &&
          cats.has(p.productCategory),
      )
    }
    default: {
      const _never: never = config.spendBasis
      void _never
      return []
    }
  }
}

function sumExtendedPrice(purchases: PurchaseRecord[]): number {
  return purchases.reduce((acc, p) => acc + p.extendedPrice, 0)
}

export function calculateTierPriceReduction(
  config: TierPriceReductionConfig,
  periodData: PeriodData,
  options?: EngineOptions,
): RebateResult {
  const periodLabel = options?.periodLabel ?? periodData.periodLabel ?? null
  const warnings: string[] = []

  // ── Edge case: no tiers configured ─────────────────────────────
  if (config.tiers.length === 0) {
    const result = zeroResult("TIER_PRICE_REDUCTION", periodLabel)
    result.warnings.push(
      "Tier price reduction has no tiers configured; returning zero reduction",
    )
    return result
  }

  // ── 1. Filter purchases + compute eligibleSpend ────────────────
  const filteredPurchases = filterPurchasesByBasis(config, periodData)
  const eligibleSpend = Math.max(0, sumExtendedPrice(filteredPurchases))

  // ── 2. Determine achieved tier against eligibleSpend ──────────
  const tier = determineTier(eligibleSpend, config.tiers, config.boundaryRule)

  let priceReductionLines: PriceReductionLineResult[] = []
  let priceReductionValue = 0
  let tierResult: TierResult | null = null

  if (tier !== null) {
    // [A7] FORWARD_ONLY: engine applies the reduction to every supplied
    // purchase. The caller is responsible for pre-filtering to only
    // purchases that occurred AFTER the threshold-crossing date; we
    // warn loudly so the contract is visible in result diagnostics.
    if (config.trigger === "FORWARD_ONLY") {
      warnings.push(
        "FORWARD_ONLY trigger: caller must pre-filter purchases by threshold-crossing date. Engine applies reduction to all supplied purchases.",
      )
    }

    // [A7] Per-purchase line breakdown — never a single aggregate
    // effectiveUnitPrice across mixed unit prices.
    priceReductionLines = computePriceReductionLines(filteredPurchases, tier)
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
      thresholdReached: eligibleSpend,
      // Price reductions don't produce a cash rebate; rebateAmount mirrors
      // the reduction value so downstream dashboards can plot "benefit".
      rebateAmount: priceReductionValue,
      // Distance-to-next-tier is out of scope for price reductions;
      // callers who want this can inspect config.tiers directly.
      amountToNextTier: null,
    }
  }

  // ── 3. Assemble result ─────────────────────────────────────────
  return {
    type: "TIER_PRICE_REDUCTION",
    rebateEarned: 0,
    priceReductionValue,
    eligibleSpend,
    tierResult,
    priceReductionLines,
    trueUpAdjustment: 0,
    warnings,
    errors: [],
    periodLabel,
  }
}
