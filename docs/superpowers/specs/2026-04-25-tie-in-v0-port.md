# Tie-in v0 port — spec

**Status:** in-progress
**Origin:** v0 prototype `tie-in-contract-details.tsx` has a more granular tie-in model than tydei-next. User direction: match v0's visible outputs.

## What v0 has that tydei-next doesn't

| Feature | v0 | tydei-next (today) |
|---|---|---|
| Multi-item capital | `LeasedServiceItem[]` per contract — multiple equipment items, each with own description/serial/cost/rate/payment type | One consolidated capital block on `Contract` (capitalCost, interestRate, termMonths) |
| Per-item serial number | Yes (`serialNumber` field) | No |
| Per-item payment type | `'fixed' \| 'variable'` — fixed = even split, variable = manual amounts | Implicit via `amortizationShape` on the contract |
| Materialized payment schedule | Always a `PaymentPeriod[]` on each item | Computed PMT for symmetrical, only stored for `custom` |
| Rebate term grouping | 3 explicit buckets (volumeRebate / poRebate / spendRebate) | Flat `terms[]` distinguished by `termType` enum |
| Contract metadata | description, itemNumber, initialSales | None of these — just capitalCost |

## Decision matrix

After researching real-world capital-lease tracking patterns (ASC 842 / IFRS 16 lease accounting, GHX / Vizient contract models), per-asset tracking is the industry norm:
- Each piece of equipment depreciates independently
- Each can have different financing terms (master lease with multiple sub-leases at blended rates)
- Asset management requires serial-number tracking
- Audit trails attach to the asset, not the contract

So the right long-term shape is **relational line-item table**, not a JSON blob on the contract. JSON loses queryability for inevitable downstream features (per-asset reporting, asset transfer between facilities, depreciation schedules).

## Approach — phased

### Phase 1 (this commit) — data model + read API + display
1. New `ContractCapitalLineItem` table with the v0 shape (description, itemNumber, serialNumber, contractTotal, initialSales, interestRate, paymentType, paymentCadence).
2. Helper `getContractCapitalLineItems(contractId)` returns either the line items OR a synthetic single item built from `Contract.capitalCost/interestRate/termMonths` (backward compat).
3. Capital Amortization card renders the line items as an itemized list above the aggregated schedule (matches v0 visual).
4. Schedule aggregation: `getContractCapitalSchedule` sums per-item PMTs — `financedPrincipal` becomes the sum of `(contractTotal − initialSales)` across items.

### Phase 2 (deferred) — write-side UI
5. Contract create/edit form gets an "Add Capital Item" button (matches v0's `addLeasedService`).
6. Vendor submission form same.
7. Backfill script that converts old single-item contracts to one line item explicitly (one-time, safe to re-run).

### Phase 3 (deferred) — rebate term grouping
v0 buckets rebate terms by category (volume / po / spend). tydei-next's flat `terms[]` is technically richer but the v0 grouping renders better in the UI. Deferred — pure visual reorganization, no schema change.

## Backward compat

- Existing contracts with `Contract.capitalCost > 0` and no line items still render correctly via the synthetic-item fallback.
- `Contract.capitalCost / downPayment / interestRate / termMonths / paymentCadence / amortizationShape` columns stay (unchanged) for the legacy path; the line items table layers on top.
- The aggregation engine reads the line items if present, falls back to the contract-level fields if not.
- Vendors submitting via the old path keep working.

## Why not a JSON column?

- Loses queryability: "show me all capital deals expiring in Q2 by serial number" requires SQL, not JSON traversal.
- Indexable vs not: serial-number lookup needs an index.
- Schema validation: zod + Prisma both validate cleanly; JSON validation is bespoke.
- Easier migration story: each item gets its own audit history.

## What this spec defers

- Per-item amortization-row materialization (the `paymentSchedule: PaymentPeriod[]` v0 shape). For now, schedule is computed PMT — same as the current tydei behavior, just per-item now.
- Asset depreciation curves (straight-line vs declining-balance). Out of scope.
- Asset transfer between contracts. Out of scope.
- The `'fixed' | 'variable'` payment-type distinction: reuses tydei's existing `amortizationShape` enum (`symmetrical` ≈ fixed, `custom` ≈ variable).
