# Charles W1.W — 17-bug cluster plan (2026-04-20)

Triage ledger in the conversation. Fixes clustered to minimize file overlap so subagents can run in parallel and commits cherry-pick cleanly.

## W1.W-D — Tie-in regressions (W1.T cascade, urgent)

- D1: Tie-in page empty ("nothing is showing up").
- D2: Capital vs usage contract-type confused.
- D3: Tie-in contracts have no capital anymore — W1.T migration may have orphaned existing rows.
- D4: Term type selector doesn't change anything on edit.

**Action:** DB probe to find orphaned tie-in contracts; fix migration or add a safe re-migration; wire the capital-entry card to render when `contractType === "tie_in"` on both create and edit; verify term type changes persist on save.

## W1.W-A — COG table + auto-derive

- A1: Missing multiplier/quantity columns on COG table — verify presence + visibility.
- A2: Duplicate detection over-aggressive — rule: ALL listed columns must match to be a dup.
- A3a: "Suggest from COG" should run automatically on form open, not require a button click.
- A3b: Contract Total = lifetime (effective → expiration); Annual = trailing 12mo. Current impl conflates.
- C4: "Everything still off contract" — COG matching falling through; verify matching rules.

## W1.W-B — Rebate math

- B1: Annual evaluation-period terms should emit ONE Rebate row at period-end, not monthly.
- B2: Cumulative rebate method broken — audit and fix.
- B3: Tier-progress card should show % to BASELINE (first-tier threshold), not % to top of current tier.

## W1.W-C — Ledger UX + labels

- C1: Collecting a rebate should UPDATE the existing earned row (add `collectionDate`, `rebateCollected`), not create a new row. Ledger must show Earned / Collected / Outstanding per period.
- C2: "Spend by Period" chart labels — add "Monthly spend on this contract" subtitle; annotate axis.
- C3: "Letter score" missing context — add tooltip/label explaining what it represents.

## W1.W-E — Contract creation

- E1: Double-click submit creates two contracts — disable + block duplicate submits.
- E2: AI extraction misses tier rebates on usage contracts — fix the extraction mapper.
- E3: Mid-edit contract-type change from price-only → usage+rebate drops the rebate in persist — debug form-state roundtrip.

## Cherry-pick order

D first (urgent W1.T cascade), then A, B, C, E in parallel.
