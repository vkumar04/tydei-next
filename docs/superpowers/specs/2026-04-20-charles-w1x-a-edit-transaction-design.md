# Charles W1.X-A — Edit / delete collected ledger entries

**Date:** 2026-04-20
**Author:** Vick (via superpowers brainstorming)
**Reporter:** Charles (iMessage screenshots, 2026-04-20)

## Problem

On the contract detail **Transactions tab**, rows in the Contract
Transactions table have **no edit affordance at all** — no row click, no
pencil icon, no row-level action menu. A user who keys the wrong amount
or collection date on "Log Collected Rebate" has no way to correct it
short of running the recompute and losing the manual entry, or asking
an engineer to hand-edit the database.

Charles (iMessage, 2026-04-20 11:13 AM): *"Can't edit a collected
entry."*

## Root cause

`components/contracts/contract-transactions.tsx` L524-586 — `TransactionTable`
renders rows as pure display. No `<TableRow onClick>`, no trailing
actions column, no delete button. `lib/actions/contract-periods.ts`
exports `createContractTransaction` but **no** `updateContractTransaction`
or `deleteContractTransaction`.

## Approach — full CRUD

### UX

- Each row in `TransactionTable` gets a trailing "actions" cell with a
  `...` `DropdownMenu`. Menu items:
  - **Edit** — opens a new `EditTransactionDialog` seeded with the row's
    current field values.
  - **Uncollect** — shown only when `collectionDate` is set and
    `rebateCollected > 0`. Clears `collectionDate` and `rebateCollected`,
    leaving `rebateEarned` and the row intact. This is the "user stamped
    the wrong period as collected" recovery path.
  - **Delete** — destructive; removes the `Rebate` row. **Disabled** (with
    tooltip) for engine-generated rows, detectable by notes containing
    `[auto-accrual]`. Engine-generated earned amounts are re-derivable from
    tier terms + spend via Recompute, so delete is safe there too — but
    we hide it so the user uses the "Recompute Earned Rebates" button
    (the correct mental model) instead of manual deletion.

### Edit dialog

`EditTransactionDialog` is a near-clone of `TransactionDialog` (rename
title, description, and submit button). Dispatches on the row's shape:

- **Rebate-collected row** (has `collectionDate`): edit `rebateCollected`,
  `collectionDate`, optional `quantity`, row notes (mapped to description
  field). Does NOT edit `rebateEarned` — earned is the engine's domain.
- **Credit/payment row** (no `rebateEarned`, type in `credit|payment`):
  edit amount, date, description.

Post-W1.P every visible ledger row is a `Rebate` row, so there's only
one Prisma model to update.

### Server actions

In `lib/actions/contract-periods.ts`:

```ts
export async function updateContractTransaction(input: {
  id: string
  contractId: string
  rebateCollected?: number
  collectionDate?: string | null    // null = uncollect
  quantity?: number | null
  notes?: string
}): Promise<void>

export async function deleteContractTransaction(input: {
  id: string
  contractId: string
}): Promise<void>
```

Both guard with `requireFacility()` + `contractOwnershipWhere(contractId, facility.id)`
before touching the `Rebate` row. On success they invalidate the same
four React Query keys `createContractTransaction` invalidates
(`contract-periods`, `contractPeriods`, `contractRebates`,
`queryKeys.contracts.detail`) so the summary cards + list refresh.

### Guardrails

- **Never** edit `rebateEarned` from this UI. Earned is an accrual the
  engine owns; editing it breaks the single-source rule (CLAUDE.md).
- **Never** delete an auto-accrual row. Uncollect is the escape hatch.
- Optimistic UI is out of scope — the dialogs await and refetch.

## Tests

- `lib/actions/__tests__/contract-periods-update.test.ts`:
  - Updating a user-logged collection changes `rebateCollected` +
    `collectionDate` and nothing else.
  - Uncollect sets `collectionDate:null` + `rebateCollected:0` and leaves
    `rebateEarned` untouched.
  - Delete removes the row; running the query afterwards returns one
    fewer `Rebate`.
  - Cross-facility write blocked (requireFacility mismatch throws).
- One React Testing Library render confirming the `...` menu appears
  per row and Uncollect is hidden when `collectionDate == null`.

## Files

- `components/contracts/contract-transactions.tsx` — add actions column,
  new `EditTransactionDialog`, wire to new mutations.
- `lib/actions/contract-periods.ts` — add `updateContractTransaction` +
  `deleteContractTransaction`.
- `lib/actions/__tests__/contract-periods-update.test.ts` — new test.

## Out of scope

- Editing earned amounts (engine domain; user has Recompute).
- Bulk edit / bulk delete.
- Audit log for edits/deletes (Rebate table has no audit trail today;
  separate spec if needed).
