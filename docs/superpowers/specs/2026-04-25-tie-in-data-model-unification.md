# Tie-in data model unification — design

**Status:** proposal (needs product sign-off before implementation)
**Origin:** Charles audit suggestion #4 — closing the dual-mode tie-in shape that produced 4 silent regressions across audit rounds 4 + 11.

## Problem

Tie-in capital can currently be expressed in two ways:

1. **Single-row `tie_in`**: one Contract row with `contractType="tie_in"` carries both the rebate-earning terms AND the capital fields (`capitalCost`, `downPayment`, `interestRate`, `termMonths`, `paymentCadence`, `amortizationShape`). Its own `Rebate` rows retire its own capital balance.

2. **Separate-row `capital`**: one Contract row with `contractType="capital"` carries the capital fields. One or more separate Contract rows with `contractType="usage"` (or any rebate-earning type) carry `tieInCapitalContractId` pointing at the capital row. The usage rows' `Rebate` rows retire the capital row's balance.

Both ways were implemented incrementally; neither was deprecated. The result is split-brain logic everywhere capital math runs:

- `lib/actions/contracts/tie-in.ts` `getContractCapitalSchedule` has UNION fallback logic for "own + sibling" rebates with a legacy-compat branch for capital rows that have rebates wired directly to themselves.
- `sumRebateAppliedToCapital` accepts both `"tie_in"` and `"capital"` contract types.
- `revalidateCapitalRoutes` walks both directions of the tie-in graph (`tieInCapitalContractId` forward + sibling sweep).
- `getContractCapitalProjection` mirrors all of the above.

Round 4 + 11 audits each found a regression rooted in a missing branch. Each time, the fix was a UNION/fallback that doubled the surface area instead of consolidating it.

## Recommendation

**Pick mode 1 (single-row `tie_in`) as canonical and deprecate mode 2.**

Rationale:
- Most demo data uses mode 1; the seed script writes single-row tie-ins.
- Mode 1's math is simpler — paydown reads the contract's own rebates with no graph traversal.
- Mode 2 adds zero capability over mode 1 for the common case (one capital deal tied to one usage deal). The multi-usage case (one capital + N usage contracts) is rare in the demo data — and when it does come up, it's typically representable as a `grouped` contract with a single capital section.
- Mode 2 introduces the cross-tenant question of whose facility owns the capital row when the linked usage rows belong to multiple facilities. Mode 1 has a single facility owner.

## Migration

### Phase 1 — Schema additions (non-breaking)
Add `Contract.legacyCapitalLinkage Boolean @default(false)` to flag rows that participated in mode 2. Backfill `true` for any Contract row with non-null `tieInCapitalContractId` OR any `contractType="capital"` row that has at least one sibling pointing at it.

### Phase 2 — Convert mode 2 → mode 1
For each capital row with siblings:
1. Pick the largest-volume sibling usage row.
2. Copy capital fields from the capital row onto that usage row.
3. Set the usage row's `contractType="tie_in"`.
4. Re-point all other siblings' `tieInCapitalContractId` to the new tie_in row (or leave unchanged — they still reference the now-empty capital row, which is harmless once flagged).
5. Mark the original capital row `status="archived"` (don't delete — preserve audit trail).

### Phase 3 — Deprecate mode 2 in code
- `getContractCapitalSchedule` drops the sibling-aggregation branch + legacy-compat fallback (~40 lines).
- `getContractCapitalProjection` similarly.
- `sumRebateAppliedToCapital` accepts only `"tie_in"`.
- `revalidateCapitalRoutes` drops the capital→usage sibling sweep.
- Validators reject new contracts with `contractType="capital"` (or coerce to `"tie_in"` with capital fields required).
- Schema: `tieInCapitalContractId` removed in a follow-up migration once no live rows reference it.

### Phase 4 — UI updates
- Vendor + facility submission forms: drop the "capital" option from the contractType dropdown (or keep as an alias that auto-selects tie_in).
- Contract detail page: remove the "linked capital contract" surface; everything is on the same row now.

## Effort estimate

- Phase 1 (schema flag + backfill): 2 hours
- Phase 2 (data migration script + dry-run): 1 day
- Phase 3 (code deletion + tests): 1 day
- Phase 4 (UI cleanup): half a day
- Total: ~3 days, gated by Phase 2's product sign-off (any production data in mode 2 needs explicit conversion plan).

## Risk

- **Demo data drift**: if any prod tenant uses mode 2 contracts the migration must run for them too. The `legacyCapitalLinkage` flag from Phase 1 lets us audit which tenants are affected before touching their data.
- **Hidden mode-2 callers**: there may be analytics or external integrations reading `Contract.tieInCapitalContractId`. Phase 1 deploy gives a window to grep external surfaces.

## Decision needed

Product sign-off on:
1. Is mode 1 acceptable as the canonical shape?
2. Are any production tenants intentionally using mode 2 in a way mode 1 can't represent?
3. Acceptable to archive (not delete) the original capital rows in Phase 2?
