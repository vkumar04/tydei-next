/**
 * Evaluation-period retroactive re-budget for the accrual timeline.
 * Moved verbatim from `lib/actions/contracts/accrual.ts` (2026-08-05
 * decomposition). Mutates `perTermResults[*].rows` in place — the same
 * arrays the row-assembly pass reads afterwards.
 */
import { buildEvaluationPeriodAccruals } from "@/lib/contracts/accrual"
import { calculateCumulative, calculateMarginal } from "@/lib/rebates/calculate"
import type { AccrualContract, PerTermResult } from "./types"

// 2026-06-09 (Charles "much larger rebate numbers vs performance" — prod
// audit Bug 1): the per-month tier walk is NOT retroactive. When
// cumulative spend crosses a tier mid-period, months already accrued at
// 0%/a lower rate were never trued up, so the timeline under-reported vs
// the persisted ledger on an IDENTICAL COG basis (live Arthrex:
// $96,264.06 shown vs $421,341.49 booked). The earlier annual-only
// re-budget summed the same under-counted monthly slices, so it didn't
// help. For EVERY non-monthly cadence, recompute each evaluation window
// through the WRITER's engine (buildEvaluationPeriodAccruals — whole-
// window spend, retroactive, baseline-aware) and re-budget the window's
// earned into its period-end month. Mid-window months keep their
// tier/rate progress columns with $0 accrued — matching the ledger,
// which books at period close. Timeline ≡ ledger by construction.
export function applyEvaluationRebudget(ctx: {
  perTermResults: PerTermResult[]
  termsWithTiers: AccrualContract["terms"]
  contract: AccrualContract
  end: Date
}): void {
  const { perTermResults, termsWithTiers, contract, end } = ctx
  const nowForBudget = new Date()
  for (const r of perTermResults) {
    if (r.config.evaluationPeriod === "monthly" || r.rows.length === 0) {
      continue
    }
    const term = termsWithTiers[r.termIndex]
    const windowAnchor = term.effectiveStart ?? contract.effectiveDate
    // bugs.rtfd 2026-06-13 #2: end-of-day the date-only end bounds so a
    // window ending on the same calendar day as the term/contract end
    // counts as complete (matches the recompute writer + threshold path).
    // Without it an annual term ending on a period boundary lost its
    // final window and the timeline showed $0.
    const endOfDayUTC = (d: Date) =>
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)
    const termWindowEnd = term.effectiveEnd
      ? new Date(
          Math.min(
            nowForBudget.getTime(),
            endOfDayUTC(term.effectiveEnd),
            endOfDayUTC(end),
          ),
        )
      : new Date(Math.min(nowForBudget.getTime(), endOfDayUTC(end)))
    // bugs.rtfd 2026-06-13 #1: growth-only baseline subtraction (matches
    // the recompute writer). "From dollar one" earns on full spend.
    const growthSubtract =
      r.config.growthOnly === true &&
      r.config.spendBaseline != null &&
      r.config.spendBaseline > 0
    const buckets = buildEvaluationPeriodAccruals(
      r.series,
      r.config.tiers,
      r.config.method,
      r.config.evaluationPeriod,
      windowAnchor,
      {
        boundedUntil: termWindowEnd,
        spendBaseline: growthSubtract ? (r.config.spendBaseline ?? null) : null,
        growthBased: growthSubtract,
      },
    )
    // Zero the per-month slices (tier/rate progress columns stay), then
    // land each completed window's retroactive earned on its period-end
    // month. Incomplete windows (periodEnd in the future) stay $0 — the
    // rebate isn't earned until the period closes, same as the ledger.
    for (let i = 0; i < r.rows.length; i++) {
      r.rows[i] = { ...r.rows[i], accruedAmount: 0 }
    }
    const rowIdxByMonth = new Map(r.rows.map((row, i) => [row.month, i]))
    let bucketedSpend = 0
    for (const b of buckets) {
      bucketedSpend += b.totalSpend
      if (b.rebateEarned <= 0) continue
      if (b.periodEnd.getTime() > nowForBudget.getTime()) continue
      const endKey = `${b.periodEnd.getUTCFullYear()}-${String(
        b.periodEnd.getUTCMonth() + 1,
      ).padStart(2, "0")}`
      const idx = rowIdxByMonth.get(endKey) ?? r.rows.length - 1
      r.rows[idx] = {
        ...r.rows[idx],
        accruedAmount: r.rows[idx].accruedAmount + b.rebateEarned,
        tierAchieved: b.tierAchieved,
        rebatePercent: b.rebatePercent,
        // bugs.rtfd 2026-06-13: carry the window's growth-baseline cut onto
        // its period-end month so the subtotal can render the basis.
        growthBaselineApplied:
          (r.rows[idx].growthBaselineApplied ?? 0) + b.growthBaselineApplied,
      }
    }
    // Open / partial TAIL window — the engine (like the writer) drops a
    // window whose natural end exceeds boundedUntil, so a contract that
    // expired mid-window (or whose current window is still running) would
    // show $0 for that stretch. Keep the 2026-04-25 display intent: show
    // the tail's accrued-TO-DATE on the latest in-range month. Closed
    // windows above stay ≡ ledger.
    const seriesSpend = r.series.reduce((s, m) => s + m.spend, 0)
    const tailSpend = Math.max(0, seriesSpend - bucketedSpend)
    if (tailSpend > 0 && r.rows.length > 0) {
      const widthMonths =
        r.config.evaluationPeriod === "quarterly"
          ? 3
          : r.config.evaluationPeriod === "semi_annual"
            ? 6
            : 12
      const proRated =
        growthSubtract && r.config.spendBaseline
          ? r.config.spendBaseline * (widthMonths / 12)
          : 0
      const tailTierSpend = Math.max(0, tailSpend - proRated)
      const res =
        r.config.method === "marginal"
          ? calculateMarginal(tailTierSpend, r.config.tiers)
          : calculateCumulative(tailTierSpend, r.config.tiers)
      if (res.rebateEarned > 0) {
        const last = r.rows.length - 1
        r.rows[last] = {
          ...r.rows[last],
          accruedAmount: r.rows[last].accruedAmount + res.rebateEarned,
          tierAchieved: res.tierAchieved,
          rebatePercent: res.rebatePercent,
          // Open/partial tail window: surface the baseline cut applied to
          // the to-date growth slice (same proRated basis as the engine).
          growthBaselineApplied:
            (r.rows[last].growthBaselineApplied ?? 0) +
            Math.max(0, tailSpend - tailTierSpend),
        }
      }
    }
  }
}
