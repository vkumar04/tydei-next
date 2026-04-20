# Charles W1.X-B — Accrual Timeline cumulative column

**Date:** 2026-04-20
**Author:** Vick (via superpowers brainstorming)
**Reporter:** Charles (iMessage screenshots, 2026-04-20)

## Problem

The contract detail **Accrual Timeline** table's **Cumulative** column:

- Matches the **Spend** column for every filled month (e.g. Jan $431,307
  / Cumulative $431,307; Feb $462,037 / Cumulative $462,037).
- Shows `—` for zero-spend trailing months (2025-06, 2025-07 in Charles's
  screenshot).

Expected: cumulative should accumulate month-over-month and carry
forward through zero-spend months.

Charles (iMessage, 2026-04-20 11:13 AM): *"Cumulative not coming up."*

## Root cause

`lib/actions/contracts/accrual.ts:227` — the final `rows.map` sets:

```ts
cumulativeSpend: totalSpend,
```

`totalSpend` is the SUM of the **current month's** contributions across
terms — i.e. the same thing the row's `spend` field holds, not a running
cumulative sum. So every row's `cumulativeSpend === spend`.

Zero-spend trailing months show `—` because the column falls into one of
two cases — either the row is emitted with `totalSpend = 0` (formats as
`$0`, not `—`; so the `—` is likely pixel noise / shared cell with an
adjacent empty row) or the row is skipped entirely by an upstream window
filter. Either way, fixing the running sum makes zero-spend months
render a useful carried-forward cumulative.

## Approach

### Fix

In `getAccrualTimeline` (`lib/actions/contracts/accrual.ts` L186-233),
introduce a running cumulative that accumulates across the `monthsTimeline`
loop iterations:

```ts
let runningCumulative = 0
const rows: MultiTermTimelineRow[] = monthsTimeline.map((month, i) => {
  // ... existing per-term loop that sums totalSpend / totalAccrued ...
  runningCumulative += totalSpend
  return {
    month,
    spend: totalSpend,
    cumulativeSpend: runningCumulative,
    accruedAmount: totalAccrued,
    // ... rest unchanged ...
  }
})
```

Semantics: **cumulative-since-contract-effective-start**. Evaluation-period
windows are out of scope — if a user later wants "cumulative within the
current eval window" we'll add a second column.

### Ripple checks

- `contract-accrual-timeline.tsx` already renders `formatCurrency(Number(row.cumulativeSpend))`
  unconditionally (L88-90) — no UI change needed.
- Footer `"Latest cumulative spend"` (L112) already reads `latest.cumulativeSpend`;
  with this fix it becomes the true lifetime cumulative.
- `recomputeAccrualForContract` does NOT depend on the `rows[].cumulativeSpend`
  field (it operates on its own `perTermResults`), so no downstream math
  moves.

## Tests

New file `lib/actions/__tests__/accrual-timeline-cumulative.test.ts`:

- Series `[Jan:$100, Feb:$0, Mar:$50]` with a 1-tier contract produces
  cumulatives `[$100, $100, $150]` (not `[$100, $0, $50]`).
- Zero-spend tail months after non-zero months carry the prior
  cumulative forward.
- First month's `cumulativeSpend === spend` (trivial case).

## Files

- `lib/actions/contracts/accrual.ts` — two-line change (`let runningCumulative`
  + assignment in return).
- `lib/actions/__tests__/accrual-timeline-cumulative.test.ts` — new.

## Out of scope

- Eval-period-window cumulative (separate column, separate design).
- Backfilling the Rebate ledger (the accrual timeline is computed on
  the fly; nothing is persisted with the wrong value).
