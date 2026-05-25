# Recompute creates duplicate rebate rows on tie-in contracts — root-cause spec

**Date:** 2026-05-24
**Bug:** #16 (cluster F)
**Status:** root cause identified; plan pending

## Reproduction
Reference contract from screenshots: **Second Amendment to the Directed Rebate Agreement** (Zimmer Biomet). `contractType = "tie_in"`. Each click of "Recompute Earned Rebates" on the Transactions tab adds another row per evaluation window. Screenshot shows e.g. 3 rows for `Apr 1, 2025 – May 31, 2026` at $467,615 — one with collectionDate (the original auto-stamp), two without.

## Root cause

Every auto-accrual delete filter gates on `collectionDate: null` to preserve user-logged collections. For tie-in contracts, `recompute-accrual.ts:560` sets `autoStampCollectionForTieIn = true`, which auto-stamps `collectionDate = periodEnd` on every inserted row (Charles 2026-04-23: "tie-in retires capital on earn, not collect"). The auto-stamped rows therefore look "user-collected" to every delete filter and survive Recompute. The duplicate-skip path (`preservedKeys` line 537-542) handles the steady-state case, but ANY drift in period boundaries between runs (term edit, expirationDate edit, time advancing into a new month for monthly cadence) causes the keys to mismatch and new rows insert alongside the surviving old ones.

### Six locations affected

| File | Line | Filter |
|---|---|---|
| `lib/actions/contracts/recompute-accrual.ts` | 187 | future-row purge |
| `lib/actions/contracts/recompute-accrual.ts` | 207 | main spend-writer pre-delete |
| `lib/contracts/recompute/threshold.ts` | 311 | threshold dispatcher (market_share, compliance_rebate) |
| `lib/contracts/recompute/volume.ts` | 524 + 781 | volume dispatcher (two entry points) |
| `lib/contracts/recompute/po.ts` | 207 | PO dispatcher |
| `lib/contracts/recompute/invoice.ts` | 206 | invoice dispatcher |
| `lib/contracts/recompute/carve-out.ts` | 115 + 212 | carve-out dispatcher (two entry points) |

All six use `where: { contractId, collectionDate: null, notes: { startsWith: <prefix> } }`. All six fail the same way on tie-in contracts.

## Fix

For tie-in contracts, every auto-accrual row is by definition system-stamped (per the Charles 2026-04-23 design: vendor applies credit directly, no user "log collection" workflow). The `collectionDate: null` gate protects nothing on tie-in and should be dropped.

Approach: thread `isTieIn: boolean` from `recompute-accrual.ts` into each dispatcher's params. Each delete filter drops the `collectionDate: null` clause when `isTieIn === true`. The main spend-writer delete and future-purge in `recompute-accrual.ts` do the same.

### Edge case: real cash collections on tie-in

Not in scope. If a future workflow allows a user to mark a tie-in rebate as cash-collected (rather than capital-applied), that path would need an explicit `userCollected: true` marker so the delete filter could distinguish. For today's behaviour (every collection on a tie-in is system-stamped), the contractType check is sufficient.

## Test plan

1. **Idempotency test** (`lib/actions/contracts/__tests__/recompute-accrual-idempotent-tie-in.test.ts`):
   - Build a tie-in contract fixture with one spend_rebate term, annual evaluation.
   - Stub the supporting Prisma calls (COG records, capital line items).
   - Call `recomputeAccrualForContract(contractId)` twice.
   - Assert the row count returned by the SECOND call equals the row count from the FIRST call (idempotent).
   - Assert no row pair shares the same `(payPeriodStart, payPeriodEnd)` after the second run.

2. **Non-tie-in preservation guard**:
   - Build a non-tie-in contract fixture.
   - Insert a user-logged collected row (collectionDate set, notes prefixed `[auto-accrual]`).
   - Call recompute.
   - Assert the user-logged row is preserved (not deleted).

3. **Dispatcher coverage**: parameterize the idempotency test across all six entry points (threshold/volume/po/invoice/carve-out) where feasible. Threshold is the most important since it fires on the screenshot's contract.

## Out of scope

- The dependency-graph reason WHY `preservedKeys` drift happened on the screenshot's contract (period-boundary computation across runs) — fixed downstream by this change because old rows are deleted, so `preservedKeys` no longer needs to be perfect.
- Audit trail for the deleted rows (the `deleted` count in the result already reports the number).
- Schema-level `userCollected` boolean (future work if real cash collections on tie-in become a thing).
