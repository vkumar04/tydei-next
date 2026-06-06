/**
 * Tie-in CAPITAL shortfall carry-forward waterfall (E2, Charles 2026-06-06).
 *
 * Pure logic that mirrors the runtime carry-forward the engine in
 * `lib/rebates/engine/tie-in-capital.ts` performs one period at a time via
 * `options.carriedForwardShortfall`. The engine evaluates a single period; this
 * module folds the whole schedule into a per-period waterfall so it can be
 * persisted to `ContractTieInShortfallLedger` and audited.
 *
 * Sign convention matches the engine's [A10]:
 *   periodShortfall = scheduledDue - rebateEarned
 *     > 0 → shortfall (facility owes more; carries forward under carry_forward)
 *     < 0 → over-accrual (earned more than scheduled; nothing carries)
 *
 * No rounding here — callers persist Decimal(14,2) and read back via Number().
 */

export interface ShortfallPeriodInput {
  periodNumber: number
  /** amortizationDue for this period, BEFORE any carry-in. */
  scheduledDueBase: number
  rebateEarned: number
}

export interface ShortfallPeriodRow {
  periodNumber: number
  /** base + carriedForwardBalance (carry_forward) or just base (bill_immediately). */
  scheduledDue: number
  rebateEarned: number
  /** scheduledDue - rebateEarned (can be negative = over-accrual). */
  periodShortfall: number
  /** carry-forward balance coming INTO this period (0 for period 1 / bill_immediately). */
  carriedForwardBalance: number
  /** carry-forward AFTER this period (>=0; only positive shortfall carries). */
  runningBalance: number
}

/**
 * Build the carry-forward waterfall. Only positive shortfall carries to the
 * next period when handling === "carry_forward"; with "bill_immediately" the
 * shortfall is billed and nothing carries (carriedForwardBalance stays 0).
 */
export function buildShortfallWaterfall(
  periods: ShortfallPeriodInput[],
  handling: "carry_forward" | "bill_immediately",
): ShortfallPeriodRow[] {
  const rows: ShortfallPeriodRow[] = []
  let carriedForwardBalance = 0

  for (const period of periods) {
    if (handling === "bill_immediately") {
      // Shortfall is billed each period; nothing carries in or out.
      const scheduledDue = period.scheduledDueBase
      const periodShortfall = scheduledDue - period.rebateEarned
      rows.push({
        periodNumber: period.periodNumber,
        scheduledDue,
        rebateEarned: period.rebateEarned,
        periodShortfall,
        carriedForwardBalance: 0,
        runningBalance: 0,
      })
      continue
    }

    // carry_forward
    const scheduledDue = period.scheduledDueBase + carriedForwardBalance
    const periodShortfall = scheduledDue - period.rebateEarned
    const runningBalance = Math.max(0, periodShortfall)
    rows.push({
      periodNumber: period.periodNumber,
      scheduledDue,
      rebateEarned: period.rebateEarned,
      periodShortfall,
      carriedForwardBalance,
      runningBalance,
    })
    carriedForwardBalance = runningBalance
  }

  return rows
}
