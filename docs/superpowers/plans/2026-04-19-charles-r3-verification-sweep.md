# Charles R3 Verification Sweep — Post-Fix QA

> **For agentic workers:** READ-ONLY. Dispatch in parallel worktrees. Produce structured bug reports. Do not modify code.

**Goal:** Verify every R3 fix actually landed correctly + catch regressions from Wave 1/2/3 fixes. Charles is testing live — report anything that still doesn't work, any new bug introduced.

**Also:** Sub6 (R3.6) flagged an unrelated regression — `lib/actions/cog-records.ts::getCOGStats` throws because a `cOGRecord.aggregate` call references `productCategoryId` that no longer exists on COGRecord (saw in dev logs). Include in audit.

**Scope:** 6 subagents in parallel, one per surface. Each repros the exact Charles-R3 scenarios + adjacent flows + checks for regressions.

---

## Shared procedure

1. Use the existing dev server on port 3000 (don't spawn a new one).
2. Log in as `demo-facility@tydei.com / demo-facility-2024`, save cookie.
3. For each task-item: repro the exact fix scenario end-to-end, then probe related flows.
4. Bug format from prior QA report. Report `VERIFIED_FIXED` / `REGRESSION` / `NEW_BUG` / `STILL_BROKEN` per item.

---

## Subagent assignments

### Sub A — COG data surface (R3.1, R3.2, R3.3, R3.5, R3.11)
- R3.1: confirm new loading state renders during >10s ingest
- R3.2: filter by match status — assert the result count across all pages matches `prisma.cOGRecord.count({where})`
- R3.3: click "Re-run match" — assert 570 rows transition from `pending/off_contract_item` to `on_contract`; click "Match Pricing" button (if present) — same verification
- R3.5: tooltip on Total Savings renders + copy explains 5% estimate + real per-record formula
- R3.11: tooltips on match status column render for all 6 values
- **Regression check:** grep `lib/actions/cog-records.ts` for `productCategoryId` usage — if `getCOGStats` still references it, flag as P0 (it's throwing in prod per dev logs).
- Commit `989840d4 → 019a9ff` range all on `/dashboard/cog-data` and related

### Sub B — Pricing files surface (R3.4, R3.6)
- R3.4: delete a pricing file via the new Trash button. Verify the row disappears + `PricingFile` + related `ContractPricing` rows both purged from Prisma.
- R3.6: upload the 2-row CSV fixture via the new-contract create flow AND via the detail-page pricing tab. Verify `ContractPricing` rows written + categories merged.
- Probe: upload a malformed file (CSV renamed .xlsx) — confirm the error is user-facing + useful, not a raw SDK leak.
- Commit `019a9ff` range

### Sub C — Contract create + PDF + tie-in + multi-fac (R3.7, R3.8, R3.9)
- R3.7: upload a real PDF via the new-contract AI/PDF tab. Confirm 200 + populated `extracted` fields. Confirm the form auto-fills.
- R3.8: create a `tie_in` contract; add a `spend_rebate` term; verify the Tie-In Capital Schedule block renders on that term + round-trips to DB.
- R3.9: toggle `isMultiFacility` on a non-grouped contract; verify `<FacilityMultiSelect>` renders + selections persist through create.
- Probe: grouped + multi-fac toggled together — both selectors render.
- Commit `2baa022` range

### Sub D — Contract detail cards (detail page from QA report)
- Market-share card, compliance card, off-contract-spend card, tie-in capital card (empty state), contract-change-proposals card.
- Verify each card's numbers match `prisma` ground truth (hand-compute).
- Verify the Documents tab upload button renders + works (BUG-detail-3 fix).
- Verify the amendment 4-stage breadcrumb renders correctly with Pricing stage removed (now 3 breadcrumb steps).

### Sub E — Contract terms + scoring (terms page + score page)
- Terms page: scope picker (specific items + specific categories) — save a term with both; verify it round-trips on re-load.
- Save a term on a `tie_in` contract with capital fields — verify persistence.
- Score page: confirm AI score renders (not error card); confirm all 6 rule-based radar axes + benchmark overlay visible.
- Rebate math: pick a contract with real rebates; verify `rebateEarned` on the detail page = `prisma.rebate.aggregate({where: {contractId, payPeriodEnd ≤ today}})`.

### Sub F — Approval + proposal flows (R3.10)
- R3.10: scroll behavior + approve button in both the Pending Contracts dialog AND the ContractChangeProposals card.
- Seed a pending proposal if none exists; walk the approve / reject / revise paths; verify Prisma status flips correctly.

---

## Output

Each subagent returns the same structured report format as the first QA sweep:

- **Item-by-item status:** VERIFIED_FIXED / REGRESSION / NEW_BUG / STILL_BROKEN
- **Per STILL_BROKEN or NEW_BUG:** severity + root cause + repro
- **Commands run** list
- **Summary counts**

I consolidate all 6 into `docs/superpowers/qa/2026-04-19-contracts-r3-verification.md` and triage.
