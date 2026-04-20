# Charles W1.X-D — Contracts list vs detail parity (collapse dual-source reducers)

**Date:** 2026-04-20
**Author:** Vick (via superpowers brainstorming)
**Reporter:** Charles (iMessage screenshots, 2026-04-20)

## Problem

Charles (iMessage, 2026-04-20 11:13 AM): *"rebate earned vs collected not
matching on the list screen vs in the contract."*

The contracts list row and the contract detail header disagree on the
same numbers. Per the CLAUDE.md invariants table these surfaces are
supposed to share a single canonical reducer — they don't, consistently.

## Root cause

`components/contracts/contract-columns.tsx` L304-353 defines two
columns with **dual-source fallbacks**:

```ts
// Spend column
accessorFn: (row) => row.currentSpend ?? row.metricsSpend ?? 0

// Earned column
accessorFn: (row) => row.metricsRebate ?? Number(row.rebateEarned ?? 0)
```

- `rebateEarned` / `currentSpend` come from `getContracts` — in-memory
  reducers that go through the canonical `sumEarnedRebatesYTD` /
  `sumCollectedRebates` helpers (per the invariants table).
- `metricsRebate` / `metricsSpend` come from `getContractMetricsBatch` —
  **Prisma-side** aggregates with the comment *"keep in sync"* at
  `lib/actions/contracts.ts:697`.

Two DB paths purporting to compute the same invariant, with a
"keep in sync" comment, is exactly the drift hazard the invariants
table is meant to prevent. Charles's screenshot is the drift
materializing.

The column accessor **prefers** `metricsRebate` when present, so the
canonical helper's number is overridden by the drifting Prisma
aggregate whenever both load. The detail header always uses the
canonical helper. ⇒ list drifts, detail doesn't.

## Approach — collapse to one source + CI guardrail

### Step 0 — Diagnostic

Short script `scripts/diagnose-contracts-list-parity.ts`:

- For every contract on the demo facility, call both `getContracts()`
  (per row) and `getContract(id)` and compare `rebateEarned`,
  `rebateCollected`, `currentSpend`, `totalValue` per contract.
- Print a table of drift: `contractId | field | list | detail | delta`.
- Write output to `docs/superpowers/diagnostics/2026-04-20-w1x-d-parity.md`.

Diagnostic tells us which path is the right one (which is very likely
the canonical helper path, since it's the one the invariants table
blesses) and how widespread the drift is.

### Step 1 — Collapse sources

- `lib/actions/contracts.ts`: **delete** the `rebateEarned` / `rebateCollected` /
  rebate-aggregation code paths from `getContractMetricsBatch`. Keep any
  fields that aren't redundant (score, etc.) — but if the batch's *only*
  remaining purpose was rebates+spend, delete the function entirely and
  remove its callers.
- `components/contracts/contract-columns.tsx`: drop the `?? metricsRebate`
  and `?? metricsSpend` fallbacks. Columns read `rebateEarned` and
  `currentSpend` only.
- `components/contracts/contracts-list-client.tsx`: if the client calls
  `getContractMetricsBatch` to hydrate the deleted fields, remove that
  call. Server-side `getContracts` already populates `rebateEarned` +
  `currentSpend` via the canonical helpers.

### Step 2 — CI drift guard

New `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`:

- Seed a contract with mixed earned/collected Rebate rows + COG spend.
- Call `getContracts()` and `getContract(id)` in the same transaction.
- Assert the three invariant numbers match **to the cent**:
  - `rebateEarned` (YTD)
  - `rebateCollected` (lifetime)
  - `currentSpend` (trailing 12mo)
- Extended case: advance the clock across year boundary and re-run so
  the YTD cutoff is exercised.

Also update the CLAUDE.md invariants table to note that
`getContractMetricsBatch` no longer exists (or no longer owns rebate
math), and that `lib/actions/contracts.ts` is the single source for
list-row metrics.

## Tests

- `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts` — new,
  per above.
- Existing `contract-metrics-batch.test.ts` — delete OR narrow to the
  fields that remain in `getContractMetricsBatch`.
- Existing `get-contracts-current-spend.test.ts` — should still pass;
  extend if the canonical path gains a new invariant.

## Files

- `scripts/diagnose-contracts-list-parity.ts` — new.
- `docs/superpowers/diagnostics/2026-04-20-w1x-d-parity.md` — new (output).
- `lib/actions/contracts.ts` — delete drifting aggregates.
- `components/contracts/contract-columns.tsx` — remove dual-source
  accessors.
- `components/contracts/contracts-list-client.tsx` — remove batch call if
  orphaned.
- `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts` — new.
- `CLAUDE.md` — update invariants table note if the batch disappears.

## Out of scope

- Touching `sumEarnedRebatesYTD` / `sumCollectedRebates` themselves —
  they're already canonical.
- Other surfaces in the invariants table (dashboard, reports) — they
  already use the canonical helpers; re-asserting parity there is a
  follow-up if this one catches drift.
