/**
 * Unified rebate engine — type barrel + canonical dispatcher.
 *
 * This module exposes:
 *   - The shared engine types (`RebateConfig`, `RebateResult`, etc.).
 *   - A single `calculateRebate(config, periodData, options)` dispatcher
 *     that routes to the per-type calculator based on `config.type`.
 *
 * History: a previous version of this file removed the dispatcher when
 * it had no callers (see audit 2026-04-19). Charles canonical engine
 * spec calls for a single entry point — restored here so callers can
 * route via type without each importing the per-type file. Per-type
 * calculators are still exported from their own modules; new code
 * should prefer `calculateRebate` to keep call sites uniform.
 *
 * Cycle note: tie-in-capital and capitated already inline-dispatch
 * their nested sub-engines to avoid importing this dispatcher (which
 * would import them in turn). Do not import the dispatcher from any
 * per-type calculator.
 */
import { calculateCapitated } from "./capitated"
import { calculateCarveOut } from "./carve-out"
import { calculateMarketSharePriceReduction } from "./market-share-price-reduction"
import { calculateMarketShareRebate } from "./market-share-rebate"
import { calculateSpendRebate } from "./spend-rebate"
import { calculateTieInCapital } from "./tie-in-capital"
import { calculateTierPriceReduction } from "./tier-price-reduction"
import { calculateVolumeRebate } from "./volume-rebate"
import type {
  EngineOptions,
  PeriodData,
  RebateConfig,
  RebateResult,
} from "./types"
import { zeroResult } from "./types"

export type {
  EngineOptions,
  PeriodData,
  RebateConfig,
  RebateResult,
} from "./types"

/**
 * Route a `RebateConfig` to its per-type calculator.
 *
 * Returns a standardized `RebateResult` per Charles's canonical spec.
 * This is the single entry point new callers should use; importing
 * per-type calculators directly is still supported but discouraged.
 *
 * Example:
 *   const cfg = buildRebateConfigFromPrisma(term)
 *   if (cfg) {
 *     const result = calculateRebate(cfg, periodData)
 *     // use result.rebateEarned, result.warnings, etc.
 *   }
 */
export function calculateRebate(
  config: RebateConfig,
  periodData: PeriodData,
  options?: EngineOptions,
): RebateResult {
  switch (config.type) {
    case "SPEND_REBATE":
      return calculateSpendRebate(config, periodData, options)
    case "VOLUME_REBATE":
      return calculateVolumeRebate(config, periodData, options)
    case "TIER_PRICE_REDUCTION":
      return calculateTierPriceReduction(config, periodData, options)
    case "MARKET_SHARE_REBATE":
      return calculateMarketShareRebate(config, periodData, options)
    case "MARKET_SHARE_PRICE_REDUCTION":
      return calculateMarketSharePriceReduction(config, periodData, options)
    case "CAPITATED":
      return calculateCapitated(config, periodData, options)
    case "CARVE_OUT":
      return calculateCarveOut(config, periodData, options)
    case "TIE_IN_CAPITAL":
      return calculateTieInCapital(config, periodData, options)
    default: {
      // Exhaustiveness guard — every RebateConfig variant must be
      // handled above. If a new type lands and this assertion fires,
      // the build will fail.
      const _never: never = config
      void _never
      return zeroResult("SPEND_REBATE", options?.periodLabel ?? null)
    }
  }
}
