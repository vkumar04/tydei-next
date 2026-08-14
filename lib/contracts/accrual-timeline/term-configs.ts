/**
 * Prisma-term → engine `TermAccrualConfig` mapping for the accrual
 * timeline. Moved verbatim from `lib/actions/contracts/accrual.ts`
 * (2026-08-05 decomposition).
 */
import type {
  EvaluationPeriod,
  TermAccrualConfig,
} from "@/lib/contracts/accrual"
import type { TierLike, RebateMethodName } from "@/lib/rebates/calculate"
import { toEngineRebateUnits } from "@/lib/rebates/calculate"
import type { AccrualContract } from "./types"

// Charles W1.S — scale `rebateValue` by 100 at the Prisma boundary for
// `percent_of_spend` tiers. `ContractTier.rebateValue` is stored as a
// fraction (0.03 = 3%), but the rebate engine in
// `lib/rebates/calculate.ts` expects integer percent (3 = 3%).
// Without this scaling, the Accrual Timeline's Rate column rendered the
// raw fraction (e.g. "0.03%" for a 3% tier) and the Accrued column was
// 100× too small. Mirrors the convention in
// `lib/rebates/calculate.ts#computeRebateFromPrismaTiers` and
// `lib/contracts/tier-rebate-label.ts` — scale at the boundary, not in
// the engine. See CLAUDE.md "Rebate engine units" rule.
// Bug #16 (2026-05-08, Vick screenshots): the accrual-timeline rate
// column was rendering raw `tier.rebateValue` for `fixed_rebate`
// tiers, so a $50,000 / $500,000 flat rebate showed up as "50000%" /
// "500000%" in the Rate column and the Accrued column was billions
// of dollars. The legacy engine in `lib/rebates/calculate.ts`
// already short-circuits to `tier.fixedRebateAmount` when set
// (`shared/cumulative.ts:20`), but the mapper here never populated
// that field. For `fixed_rebate`, route the dollar value through
// `fixedRebateAmount` and force `rebateValue` to 0 so the engine's
// percent math returns 0 dollars on its own and the Rate column
// shows 0% (a fixed rebate has no percent rate by definition).
//
// For `fixed_rebate_per_unit` / `per_procedure_rebate` tiers, the
// spend-accrual timeline is the wrong surface to render them on
// (those rebates are unit-driven, not spend-driven), but until the
// timeline gets a per-rebate-type viewer we at least zero out the
// rate so it doesn't display absurd percentages — accrual on those
// termTypes is computed via the dedicated VOLUME / per-use writers
// in `lib/contracts/recompute/`, not this timeline.
// The rules above now live with the unit convention they enforce,
// `toEngineRebateUnits` in lib/rebates/calculate.ts, so every Prisma→engine
// tier mapper shares them. Unchanged in substance.

export function buildTermConfigs(
  termsWithTiers: AccrualContract["terms"],
): TermAccrualConfig[] {
  const termConfigs: TermAccrualConfig[] = termsWithTiers.map((term) => {
    const tiers: TierLike[] = term.tiers.map((t) => {
      const units = toEngineRebateUnits(t.rebateValue, t.rebateType)
      return {
        tierNumber: t.tierNumber,
        tierName: t.tierName ?? null,
        spendMin: Number(t.spendMin),
        spendMax: t.spendMax ? Number(t.spendMax) : null,
        rebateValue: units.rebateValue,
        fixedRebateAmount: units.fixedRebateAmount,
      }
    })
    const evaluationPeriod: EvaluationPeriod =
      term.evaluationPeriod === "monthly" ||
      term.evaluationPeriod === "quarterly" ||
      term.evaluationPeriod === "semi_annual" ||
      // bugs.rtfd 2026-06-13: lifetime accumulates over the whole contract.
      term.evaluationPeriod === "lifetime"
        ? term.evaluationPeriod
        : "annual"
    return {
      tiers,
      method: (term.rebateMethod ?? "cumulative") as RebateMethodName,
      evaluationPeriod,
      effectiveStart: term.effectiveStart ?? null,
      effectiveEnd: term.effectiveEnd ?? null,
      // 2026-06-09: thread the baseline like the writer does so the
      // retroactive period re-budget below applies the same
      // baseline-above math (Bug #22 rule: spendBaseline > 0 → tiers
      // evaluate max(0, periodSpend − proRatedBaseline)).
      spendBaseline:
        term.spendBaseline === null || term.spendBaseline === undefined
          ? null
          : Number(term.spendBaseline),
      baselineType: term.baselineType ?? null,
      // bugs.rtfd 2026-06-13 #1: gate baseline subtraction on growthOnly
      // so the timeline matches the writer (growth-only subtraction).
      growthOnly: term.growthOnly ?? false,
    }
  })
  return termConfigs
}
