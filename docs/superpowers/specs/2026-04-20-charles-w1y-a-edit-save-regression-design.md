# Charles W1.Y-A — Contract edit save regression

**Date:** 2026-04-20
**Reporter:** Charles (iMessage 2026-04-20 11:38 AM)
**Prior attempt:** `19b38ab` — W1.W-E "edit-save" fix (did not fully resolve).

## Problem

*"The issue was still a saving issue when you try to change the contract — they are showing [as] saved for the beginning only."*

User edits a contract (terms, tiers, type, dates, etc.), clicks Save, and the UI reports success. On refresh, the form shows the **original/beginning** values — edits didn't persist. W1.W-E ("E3" in the commit body) addressed the case of flipping `contractType` from `pricing_only` → `usage` with a new term + tier. Charles's new report implies either:

- (a) a different field category is still lost on save (categories? scope? effective dates? amortization?); or
- (b) the fix applies on the happy path but a separate edit path (e.g., tie-in contract-level fields from W1.T) bypasses the persisting write.

## Approach

### Step 0 — Diagnostic

Script `scripts/diagnose-edit-save-regression.ts`:

- Pick Charles's reported contract (by id or by name match).
- Dump every scalar + relation field currently persisted.
- Instrument `updateContract` (or whichever action the edit form calls) to log the input payload on every call, including field-level diffs vs the existing row.
- Open the edit form in a dev build, change N fields representing different domains (scalars / tiers / categories / amortization), click Save, and capture the server-side log and the post-save DB snapshot.
- Write findings to `docs/superpowers/diagnostics/2026-04-20-w1y-a-edit-save.md`.

### Step 1 — Fix gated on diagnostic

Three candidate root-cause shapes; fix matches whichever the diagnostic proves:

- **Form serializer drops fields.** The edit form's `onSubmit` builds a payload that omits fields not touched in the UI, so the server gets an incomplete patch and doesn't update what's missing. Fix: send the full form state and have the server do the diff, OR send only dirty fields (reliable dirty-tracking).
- **Server action pattern-matches only on some fields.** E.g., only handles fields present in `createContractSchema` but drops the tie-in capital fields (added in W1.T, `lib/actions/contracts/tie-in.ts`). Fix: broaden the schema / union in the update pathway.
- **Optimistic cache not invalidated.** The form shows stale data because React Query serves an uninvalidated detail cache. Fix: add the detail-query key to the mutation's `onSuccess` invalidation list.

### Step 2 — Regression test (Charles-pattern)

`lib/actions/__tests__/contract-edit-save-regression.test.ts`:

- Seeded contract with populated tiers + categories + amortization + tie-in capital.
- Simulate an edit that changes ONE field in EACH domain (scalar, term, tier, category, amortization, capital).
- Call `updateContract`.
- Reload the contract and assert every changed field now reflects the new value AND every untouched field is unchanged.
- Name the test: `it("persists every field domain on a contract edit (Charles iMessage 2026-04-20)")`.

### Step 3 — Diagnostic-driven doc update

If the diagnostic shows that the edit path has multiple entry points (which W1.T's tie-in refactor suggests is possible), add a note in CLAUDE.md about the canonical edit action and how to register new field domains with it.

## Files (depending on diagnostic)

- `scripts/diagnose-edit-save-regression.ts`
- `docs/superpowers/diagnostics/2026-04-20-w1y-a-edit-save.md`
- `lib/actions/contracts.ts` (update action)
- `components/contracts/edit-contract-client.tsx`
- `components/contracts/contract-form.tsx`
- `lib/validators/contracts.ts`
- `lib/actions/__tests__/contract-edit-save-regression.test.ts`
- `CLAUDE.md` (if edit-path doc needed)

## Out of scope

- Audit logging for edits (separate spec if needed).
- Conflict resolution for concurrent edits.
