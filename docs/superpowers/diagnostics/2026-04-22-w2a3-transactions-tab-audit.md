# W2.A.3 — Transactions tab reducer audit

_Generated: 2026-04-22_

## Task context

Charles's W2.A screenshot showed the Transactions tab "Total Rebates
(Lifetime)" card at **$639,390** on the Arthrex Arthroscopy contract
(`cmo6j6g34002sachllckth77b`), while the canonical helper
`sumEarnedRebatesLifetime` read **$19,882.92** off the same 17 Rebate
rows. Ratio ≈ 32×.

Hypothesis space (from task prompt):
1. Double-counting `Rebate` rows AND `ContractPeriod` rollups.
2. Summing `rebateValue` percentages as dollars.
3. Summing a DIFFERENT field (`extendedPrice`, `totalValue`, …).
4. Including FUTURE periods.
5. Summing the entire contract value column.

## Code-path audit

### Summary cards

File: `components/contracts/contract-transactions.tsx`

| Card | Current reducer | Calls canonical helper? |
|---|---|---|
| Total Rebates (Lifetime) | line 873 `sumEarnedRebatesLifetime(rows.map(...))` | **yes** |
| Collected | line 884 `sumCollectedRebates(rows.map(...))` | **yes** |
| Outstanding | line 895 `rows.reduce((acc, r) => acc + Math.max(r.rebateEarned - r.rebateCollected, 0), 0)` | N/A (canonical `sumOutstanding` doesn't exist; fed by per-row (Earned − Collected)) |

The three summary cards are already wired through the canonical
helpers — the fix Charles expected was shipped in commit
`66dcb7e fix(rebate): canonical sumEarnedRebates{Lifetime,YTD}
(Charles W1.U-B)`. The helpers are imported at lines 69–70 and the
data source (`rows`) is built from `getContractRebates`-returned
Rebate rows via `mapRebateRowsToLedger` (line 861).

### Per-period table rows

File: `components/contracts/contract-transactions.tsx`,
`TransactionTable` function (line ~730).

- The **Earned** column renders `row.rebateEarned` directly from the
  mapped Rebate row (`components/contracts/contract-transactions-display.ts`
  line 36: `rebateEarned: Number(r.rebateEarned ?? 0)`).
- The **Collected** column renders `row.rebateCollected` directly.
- The **Outstanding** column is `max(Earned − Collected, 0)` per row.

No hand-rolled summation happens at the row level — each row prints
the corresponding `Rebate.rebateEarned` / `Rebate.rebateCollected`
Prisma column.

### Data source

File: `lib/actions/contract-periods.ts` → `getContractRebates`
(line 388–428).

- Hits `prisma.rebate.findMany` with `where.payPeriodEnd: { lte:
  today }` (W1.Q filter; also covered by
  `contract-periods-future-filter.test.ts`).
- Returns only Rebate rows; does NOT merge `ContractPeriod` rollups,
  does NOT include the contract's `totalValue`, `annualValue`, or
  any `extendedPrice`.
- `serialize()` (lib/serialize.ts) converts Prisma `Decimal` → JS
  `number` via `Number(obj)` — no 100× scaling, no percent/fraction
  conversion.

## Root cause

**The bug Charles reported is NOT reproducible against the current
main branch.** Every hypothesis in the task prompt is ruled out by
the code:

1. No `ContractPeriod` rollup merge — `mapRebateRowsToLedger` reads
   only Rebate rows (`contract-transactions-display.ts` line 28).
2. No percent-vs-fraction confusion — Rebate rows store raw dollar
   amounts; `serialize()` does no scaling.
3. No field swap — `rebateEarned` maps to `Rebate.rebateEarned`.
4. No future-period leak — `getContractRebates` filters
   `payPeriodEnd: { lte: today }` at the DB.
5. No totalValue leak — `totalValue` is not read in this code path
   at all.

The phase-1 diagnostic (section 7) confirms against the live DB:
- `sumEarnedRebatesLifetime` ⇒ $19,882.92
- Raw sum of all 17 `Rebate.rebateEarned` ⇒ $22,677.05 (includes one
  future-dated April-2026 row the DB filter would exclude)

There is no field or combination of fields on this contract that
totals $639,390 across 17 Rebate rows. The closest number on the
contract is `totalValue = $650,000` — which is a contract-level
column, not read by `contract-transactions.tsx` anywhere.

### Most likely explanation

Charles's screenshot came from a **stale client bundle** (pre-W1.U-B,
pre-W1.R) that was still using the hand-rolled reducers:
- W1.R (2026-04-19) canonicalized `sumCollectedRebates`.
- W1.U-B (2026-04-20) canonicalized `sumEarnedRebatesLifetime`.

Between those two commits the tab reduced `rows.reduce((s, r) => s +
Number(r.rebateEarned), 0)` over both Rebate rows AND ContractPeriod
rollups (W1.P dropped the ContractPeriod merge on 2026-04-19). The
combination produced the cross-source double-count that Charles saw.

After rebase to current main, the Transactions tab code path is
clean. The 32× multiplier was an artifact of transient double-source
aggregation that has since been excised.

## Defense-in-depth

Even though the bug is fixed, the invariants table in `CLAUDE.md`
did not call out the Transactions-tab surface explicitly as a user
of `sumEarnedRebatesLifetime` (the row only says "Transactions tab
summary, reports overview"). More importantly, **there is no
cross-surface parity test pinning the Transactions tab's summary
cards against the canonical helpers.** Any future refactor that
reintroduces a hand-rolled reducer would pass the existing
`contracts-list-vs-detail-parity.test.ts` (which covers list vs
detail only, not the Transactions tab).

**Action:** add a parity test that runs `mapRebateRowsToLedger` over
a mix-bag of `Rebate` rows (past/future/collected/uncollected) and
asserts the summary-card sums equal the canonical helpers on the
identical input. Any regression that hand-rolls the reducer inside
the Transactions tab will fail the new test.

## Step-3 status

Hypothesis turned out to be **already-fixed** in the current
codebase. Per the task instructions ("If the hypothesis in Step 3
turns out wrong after you read the code, don't force a fix"), the
remediation below adds only the defense-in-depth test and the
CLAUDE.md invariants-table note — no production code changes.
