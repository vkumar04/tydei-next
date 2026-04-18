/**
 * Unified rebate engine — CAPITATED (subsystem 6).
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md §4.6
 *
 * Pure function: given a CapitatedConfig and a PeriodData snapshot, returns
 * a standardized RebateResult. Capitated terms wrap a sub-engine (optional
 * SpendRebate or TierPriceReduction) whose evaluation is bounded by a
 * per-period spend cap applied to a ring-fenced group of reference numbers.
 *
 * ─── Behavior ─────────────────────────────────────────────────
 * 1. Pre-filter `periodData.purchases` to only those whose referenceNumber
 *    is in `config.groupedReferenceNumbers`.
 * 2. `groupSpend` = Σ filtered.extendedPrice
 *    `eligibleSpend` = min(groupSpend, config.periodCap)
 *    `capExceededBy` = max(0, groupSpend - periodCap)
 *      → when > 0, emit a warning describing the overage.
 * 3. If no embedded rebate: return a zero-cash/zero-reduction result with
 *    the capped eligibleSpend populated.
 * 4. If embedded rebate present: normalize it so the sub-engine treats the
 *    pre-filtered slice as ALL_SPEND (prevents double-filter — see [A8]),
 *    build a sub-PeriodData whose `purchases` are the filtered slice and
 *    whose `totalSpend` is clamped to `eligibleSpend`, then dispatch to
 *    the appropriate sub-engine. Sub-warnings are prepended with
 *    "Embedded: " so callers can distinguish wrapper vs sub-engine
 *    diagnostics.
 *
 * ─── Audit fix applied ────────────────────────────────────────
 * [A8] Capitated pre-filters its purchases by `groupedReferenceNumbers` and
 *      must NOT let the sub-engine re-filter by reference number (which
 *      would reduce the already-filtered slice further). We force
 *      `spendBasis: 'ALL_SPEND'` on the sub-config and null out any
 *      referenceNumbers / categories / productCategory fields.
 *
 * ─── Circular import note ─────────────────────────────────────
 * We do NOT import `calculateRebate` from './index' — index.ts imports this
 * file, and that would create a cycle. Instead we inline-dispatch on
 * `embeddedRebate.type` since the union is narrow (two cases).
 */
import { calculateSpendRebate } from "./spend-rebate"
import { calculateTierPriceReduction } from "./tier-price-reduction"
import type {
  CapitatedConfig,
  EngineOptions,
  PeriodData,
  PurchaseRecord,
  RebateResult,
  SpendRebateConfig,
  TierPriceReductionConfig,
} from "./types"

/**
 * [A8] Strip spend-basis filtering fields from an embedded SpendRebateConfig
 * so the sub-engine evaluates the entire pre-filtered slice.
 */
function normalizeEmbeddedSpendConfig(
  embedded: SpendRebateConfig,
): SpendRebateConfig {
  return {
    ...embedded,
    spendBasis: "ALL_SPEND",
    referenceNumbers: undefined,
    categories: undefined,
    productCategory: null,
  }
}

/**
 * [A8] Same normalization for an embedded TierPriceReductionConfig.
 */
function normalizeEmbeddedPriceReductionConfig(
  embedded: TierPriceReductionConfig,
): TierPriceReductionConfig {
  return {
    ...embedded,
    spendBasis: "ALL_SPEND",
    referenceNumbers: undefined,
    categories: undefined,
    productCategory: null,
  }
}

/**
 * Build a sub-PeriodData snapshot for the embedded sub-engine.
 *
 * The sub-engine sees only the ring-fenced purchases, and its totalSpend
 * is clamped to `eligibleSpend` (= min(groupSpend, periodCap)) so any
 * ALL_SPEND math upstream of per-purchase iteration respects the cap.
 */
function buildSubPeriodData(
  filtered: PurchaseRecord[],
  eligibleSpend: number,
  periodData: PeriodData,
): PeriodData {
  return {
    purchases: filtered,
    totalSpend: eligibleSpend,
    totalCategorySpend: periodData.totalCategorySpend ?? null,
    vendorCategorySpend: periodData.vendorCategorySpend ?? null,
    priorAccruals: periodData.priorAccruals ?? null,
    priorYearActualSpend: periodData.priorYearActualSpend ?? null,
    periodLabel: periodData.periodLabel ?? null,
  }
}

export function calculateCapitated(
  config: CapitatedConfig,
  periodData: PeriodData,
  options?: EngineOptions,
): RebateResult {
  const periodLabel = options?.periodLabel ?? periodData.periodLabel ?? null
  const warnings: string[] = []

  // ── 1. Pre-filter to ring-fenced purchases ─────────────────────
  const groupedRefs = new Set(config.groupedReferenceNumbers)
  const filtered: PurchaseRecord[] = periodData.purchases.filter((p) =>
    groupedRefs.has(p.referenceNumber),
  )

  // ── 2. Compute group spend + cap math ──────────────────────────
  const groupSpend = filtered.reduce((acc, p) => acc + p.extendedPrice, 0)
  const eligibleSpend = Math.min(groupSpend, config.periodCap)
  const capExceededBy = Math.max(0, groupSpend - config.periodCap)

  if (capExceededBy > 0) {
    warnings.push(
      `Group spend $${groupSpend} exceeded period cap $${config.periodCap} by $${capExceededBy}`,
    )
  }

  // ── 3. No embedded rebate → return capped-only shell ───────────
  if (config.embeddedRebate == null) {
    return {
      type: "CAPITATED",
      rebateEarned: 0,
      priceReductionValue: 0,
      eligibleSpend,
      tierResult: null,
      trueUpAdjustment: 0,
      warnings,
      errors: [],
      periodLabel,
    }
  }

  // ── 4. Dispatch to embedded sub-engine ─────────────────────────
  const subPeriodData = buildSubPeriodData(filtered, eligibleSpend, periodData)
  const embedded = config.embeddedRebate

  // Inline-dispatch to avoid circular import with index.ts.
  // The union is narrow (SpendRebateConfig | TierPriceReductionConfig).
  if (embedded.type === "SPEND_REBATE") {
    const subConfig = normalizeEmbeddedSpendConfig(embedded)
    const subResult = calculateSpendRebate(subConfig, subPeriodData, options)

    for (const w of subResult.warnings) {
      warnings.push(`Embedded: ${w}`)
    }

    return {
      type: "CAPITATED",
      rebateEarned: subResult.rebateEarned,
      priceReductionValue: subResult.priceReductionValue,
      eligibleSpend,
      tierResult: subResult.tierResult ?? null,
      trueUpAdjustment: 0,
      warnings,
      errors: subResult.errors,
      periodLabel,
    }
  }

  if (embedded.type === "TIER_PRICE_REDUCTION") {
    const subConfig = normalizeEmbeddedPriceReductionConfig(embedded)
    const subResult = calculateTierPriceReduction(subConfig, subPeriodData, options)

    for (const w of subResult.warnings) {
      warnings.push(`Embedded: ${w}`)
    }

    const result: RebateResult = {
      type: "CAPITATED",
      rebateEarned: subResult.rebateEarned,
      priceReductionValue: subResult.priceReductionValue,
      eligibleSpend,
      tierResult: subResult.tierResult ?? null,
      trueUpAdjustment: 0,
      warnings,
      errors: subResult.errors,
      periodLabel,
    }
    if (subResult.priceReductionLines !== undefined) {
      result.priceReductionLines = subResult.priceReductionLines
    }
    return result
  }

  // Exhaustiveness guard — unreachable with typed input.
  const _never: never = embedded
  void _never
  return {
    type: "CAPITATED",
    rebateEarned: 0,
    priceReductionValue: 0,
    eligibleSpend,
    tierResult: null,
    trueUpAdjustment: 0,
    warnings,
    errors: ["Unknown embedded rebate type"],
    periodLabel,
  }
}
