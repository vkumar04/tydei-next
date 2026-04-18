/**
 * Unified rebate engine — dispatcher.
 *
 * `calculateRebate(config, periodData, options)` is the single entry
 * point. All 8 type-specific engines are LIVE as of subsystem 8.
 */
import type {
  EngineOptions,
  PeriodData,
  RebateConfig,
  RebateResult,
} from "./types"
import { zeroResult } from "./types"
import { calculateSpendRebate } from "./spend-rebate"
import { calculateVolumeRebate } from "./volume-rebate"
import { calculateTierPriceReduction } from "./tier-price-reduction"
import { calculateMarketSharePriceReduction } from "./market-share-price-reduction"
import { calculateMarketShareRebate } from "./market-share-rebate"
import { calculateCarveOut } from "./carve-out"
import { calculateCapitated } from "./capitated"
import { calculateTieInCapital } from "./tie-in-capital"

export type { RebateConfig, RebateResult, PeriodData, EngineOptions } from "./types"

export function calculateRebate(
  config: RebateConfig,
  periodData: PeriodData,
  options?: EngineOptions,
): RebateResult {
  const periodLabel = options?.periodLabel ?? null

  switch (config.type) {
    case "SPEND_REBATE":
      return calculateSpendRebate(config, periodData, options)
    case "VOLUME_REBATE":
      return calculateVolumeRebate(config, periodData, options)
    case "TIER_PRICE_REDUCTION":
      return calculateTierPriceReduction(config, periodData, options)
    case "MARKET_SHARE_PRICE_REDUCTION":
      return calculateMarketSharePriceReduction(config, periodData, options)
    case "CARVE_OUT":
      return calculateCarveOut(config, periodData, options)
    case "MARKET_SHARE_REBATE":
      return calculateMarketShareRebate(config, periodData, options)
    case "CAPITATED":
      return calculateCapitated(config, periodData, options)
    case "TIE_IN_CAPITAL":
      return calculateTieInCapital(config, periodData, options)
    default: {
      // Exhaustiveness check — should be unreachable with typed input.
      const fallback = zeroResult("SPEND_REBATE", periodLabel)
      fallback.errors.push(
        `Unknown config type: ${(config as { type?: string }).type ?? "undefined"}`,
      )
      return fallback
    }
  }
}
