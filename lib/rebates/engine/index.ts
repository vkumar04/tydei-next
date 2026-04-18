/**
 * Unified rebate engine — dispatcher.
 *
 * `calculateRebate(config, periodData, options)` is the single entry
 * point. Dispatches to the 8 type-specific engines. Subsystem 2-8 will
 * implement the actual engines — this stub currently returns a
 * zero-rebate RebateResult with `errors: ["engine not yet implemented"]`
 * for any type.
 *
 * This lets downstream callers type against the unified API today; as
 * each engine ships, it wires into this dispatcher.
 */
import type {
  EngineOptions,
  PeriodData,
  RebateConfig,
  RebateResult,
} from "./types"
import { zeroResult } from "./types"
import { calculateSpendRebate } from "./spend-rebate"

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
    case "TIER_PRICE_REDUCTION":
    case "MARKET_SHARE_REBATE":
    case "MARKET_SHARE_PRICE_REDUCTION":
    case "CAPITATED":
    case "CARVE_OUT":
    case "TIE_IN_CAPITAL": {
      const result = zeroResult(config.type, periodLabel)
      result.errors.push(`Engine for ${config.type} not yet implemented`)
      return result
    }
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
