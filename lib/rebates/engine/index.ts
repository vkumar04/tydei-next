/**
 * Unified rebate engine — type barrel only.
 *
 * Historically this file exported a `calculateRebate(config, periodData,
 * options)` dispatcher that fanned out to 8 per-type engines. As of the
 * resolution to the 2026-04-19 engine-parameter coverage audit
 * (docs/superpowers/audits/2026-04-19-engine-param-coverage.md), the
 * dispatcher was removed: no server action or component ever called it,
 * and only two of its eight `RebateType` branches were even reachable
 * from the Prisma-to-engine bridge. Display-path code uses
 * `lib/contracts/rebate-accrual-schedule.ts` and
 * `lib/rebates/calculate.ts#computeRebateFromPrismaTiers` directly.
 *
 * Per-type engine calculators (`spend-rebate.ts`, `volume-rebate.ts`,
 * `tier-price-reduction.ts`, etc.) remain exported from their own
 * modules — callers that want one should import it by path, not through
 * this barrel. This file now exists only to re-export the shared
 * configuration/result types so downstream code doesn't need to know
 * which file each type lives in.
 */
export type {
  EngineOptions,
  PeriodData,
  RebateConfig,
  RebateResult,
} from "./types"
