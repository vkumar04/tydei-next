/**
 * Per-period running remaining capital balance for tie-in / capital report
 * tables. The report shows an arbitrary date window, so a forward sum from
 * capitalCost can't reconcile with the contract's CURRENT remaining balance.
 * Instead we ANCHOR the most-recent period's ending balance to
 * `capitalRemainingBalance` (the header figure) and add each later period's
 * capital paydown back as we walk to older periods — so the "Balance" column
 * always reconciles with the header Capital Balance regardless of window.
 *
 * Per-period capital paydown ≈ `paymentActual + rebateEarned` (on a tie-in the
 * earned rebate is applied to capital). Vick 2026-06-22 "balance not coming
 * over".
 *
 * Returns one ending balance per input period, in the SAME order as `periods`.
 */
export interface CapitalBalancePeriod {
  /** ISO date string — used only to order periods chronologically. */
  periodStart: string
  paymentActual: number
  rebateEarned: number
}

export function computeRunningCapitalBalances(
  periods: CapitalBalancePeriod[],
  capitalRemainingBalance: number,
): number[] {
  const chronological = periods
    .map((_, i) => i)
    .sort((a, b) => periods[a].periodStart.localeCompare(periods[b].periodStart))

  const ending = new Array<number>(periods.length).fill(capitalRemainingBalance)
  let running = capitalRemainingBalance
  // Walk newest → oldest: newest ends at the current remaining balance; each
  // older period ended higher by the paydown(s) that happened after it.
  for (let k = chronological.length - 1; k >= 0; k--) {
    const idx = chronological[k]
    ending[idx] = running
    running += periods[idx].paymentActual + periods[idx].rebateEarned
  }
  return ending
}
