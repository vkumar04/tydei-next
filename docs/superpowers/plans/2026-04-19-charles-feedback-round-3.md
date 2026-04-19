# Charles Feedback Round 3 — Investigate + Fix

> **For agentic workers:** Each task is an investigate-and-fix — subagent first confirms the bug reproduces (rule out stale build / cache), then fixes or reports "already resolved."

**Goal:** Fix the 11 items Charles flagged after QA waves 1-3 shipped. Charles is testing live; speed matters.

**Dispatch:** 11 parallel subagents in isolated worktrees. Each repros first, then fixes if reproduces.

---

## Subagent rubric (every task)

1. Start a prod-like server (build first) or use the live `bun run dev` if already running. Note which.
2. Log in as `demo-facility@tydei.com / demo-facility-2024`.
3. **Reproduce the bug**. If can't reproduce → report `NOT_REPRODUCED` with which commit likely fixed it and stop.
4. If reproduces → read relevant source, identify root cause, implement the minimal fix, write a regression test if server-side.
5. `bunx tsc --noEmit` → 0 errors before commit.
6. Commit with `fix(<area>): ...` message. Don't push.
7. Report branch + SHA + files + test output + brief root-cause explanation.

Prisma hand-compute permitted for calc bugs. No schema migrations without flagging.

---

## Tasks

### Task 1: COG import slow → add progress feedback

Charles: "Frozen here with COG import now" → "Got it it just took a while."

- **Symptom:** User thinks the import is frozen because it takes >10s with no feedback.
- **Likely cause:** Blocking UI during `ingestCOGRecordsCSV` with no progress indicator.
- **Scope:** `components/facility/cog/cog-import-dialog.tsx` — the import stage needs a clear loading state (spinner + "Importing N records..." message) and ideally a progress indication if the action can be chunked.
- **Fix sketch:** If no progress state exists during ingest: add `stage === "importing"` with Loader + row-count display. If the ingest action can return streaming updates, wire that; otherwise just show the expected duration ("Importing 500+ rows — this can take 30s").

### Task 2: Match-status filter doesn't paginate across all pages

Charles: "When you filter here for a match status or anything all of it from all pages should populate."

- **Symptom:** Filters on COG data table (match status, vendor, etc.) only apply to the current page; other pages still show unfiltered data.
- **Likely cause:** Client-side filtering of the current page slice instead of server-side filtering with refetch.
- **Scope:** `components/facility/cog/cog-records-table.tsx` or equivalent. `lib/actions/cog-records.ts::getCOGRecords` (or wherever the query is).
- **Fix sketch:** Push the filter state through the server action's `where` clause; invalidate+refetch on filter change; reset pagination to page 1.

### Task 3: Match + Rematch pricing buttons don't match anything

Charles: "I used both matching and rematching pricing buttons and nothing was matched to a contract."

- **Symptom:** Buttons fire, server responds, but `cOGRecord.matchStatus` stays `pending` and `contractId` stays null.
- **Likely cause:** Either (a) the match cascade resolver (`lib/cog/match.ts::resolveContractForCOG`, shipped today in `2d1a7cb`) isn't actually being called by the button handler, OR (b) the lookups (`pricingByVendorItem`, `activeContractsByVendor`) aren't being populated correctly.
- **Scope:** `components/facility/cog/cog-data-client.tsx` (Re-run match button + backfill handler), `lib/actions/cog-import/backfill.ts`, `lib/cog/recompute.ts::recomputeMatchStatusesForVendor`.
- **Fix sketch:** Scratch-bun script calling `recomputeMatchStatusesForVendor()` directly — confirm it writes status changes to Prisma. If yes, the button handler isn't calling it. If no, the cascade input maps are empty.

### Task 4: Can't delete a pricing file

Charles: "No longer can delete the pricing file from here."

- **Symptom:** Delete action either doesn't exist or fails silently.
- **Scope:** Pricing-file list component on the new-contract page or contract detail. `lib/actions/pricing-files.ts::deletePricingFile` (if exists).
- **Fix sketch:** Add (or unhide) a delete button + wire it to the server action. If the action exists but isn't exposed, add it to the UI. Check for a regression — this may have worked pre-QA-waves.

### Task 5: "Total savings" calculation unclear

Charles: "Not sure what that total savings number is or how it is calculating."

- **Symptom:** UX — number is visible but user can't tell what inputs produced it.
- **Scope:** `components/facility/cog/cog-enrichment-stats-panel.tsx` or similar stats card on `/dashboard/cog-data`.
- **Fix sketch:** Add a tooltip or helper text next to "Total Savings" explaining: `sum(contractPrice × qty − actualPrice × qty)` across on-contract rows. Include a link to the underlying query or show the formula on hover.

### Task 6: Pricing-file upload broken

Charles: "Loading pricing files just started to break now also."

- **Symptom:** Uploading a pricing file fails (where? create flow? detail page?).
- **Scope:** `lib/actions/imports/pricing-import.ts` + pricing upload handler in `components/contracts/new-contract-client.tsx` or `cog-data-client.tsx`.
- **Fix sketch:** Repro with a 2-row CSV. If fails, inspect the error + trace. Common causes post-QA: schema drift from today's Wave 1.2 destructure changes, or column-alias regression.

### Task 7: PDF contract upload still broken (regression)

Charles: "Can't upload PDFs for contracts."

- **Note:** We shipped `0e0c877` today routing PDF extraction through `extractedContractSchema`. Charles says still broken.
- **Scope:** `app/api/ai/extract-contract/route.ts` + `components/contracts/ai-extract-dialog.tsx`.
- **Fix sketch:** Repro with a real PDF. If fails, capture the full response. Possible causes: `extractedContractSchema` also has a union-count issue, `ANTHROPIC_API_KEY` env mismatch between dev + Charles's build, or the dialog itself is erroring before the upload fires.

### Task 8: Tie-in contracts don't allow capital + usage-spend terms together

Charles: "The Tie in contract stuff is not allowing for all of the capital information we discussed to be filled in along with the usage spend contract stuff."

- **Note:** We shipped `6de9542` today adding tie-in `capitalCost` / `interestRate` / `termMonths` fields to the term form — but only when `contractType === "tie_in"`.
- **Symptom:** User wants to create a tie-in contract with a `spend_rebate` term AND have the tie-in capital fields visible on the same term.
- **Scope:** `components/contracts/contract-terms-entry.tsx` — the tie-in block's render guard.
- **Fix sketch:** The guard is `contractType === "tie_in"`, not `term.termType === "fixed_fee"`. Contracts with `contractType = tie_in` should see the capital block on ALL terms (usage + capital), not just fixed-fee terms. Confirm current guard; if it's gated on term type, fix to gate on contract type only (already intended). If it's correctly gated on contract type but still not showing, check caller wiring of the `contractType` prop.

### Task 9: Multi-facility selector doesn't show

Charles: "Grouped contract is here but Multi facility is not."

- **Note:** We shipped `831da90` + `dc26a37` today wiring both. Charles says grouped renders, multi-facility doesn't.
- **Scope:** `components/contracts/contract-form.tsx` — both toggles should be siblings. If grouped shows and multi-fac doesn't, the conditional render for multi-fac is wrong.
- **Fix sketch:** Read the form. Ensure `<Switch>` for `isMultiFacility` + `<FacilityMultiSelect>` are un-gated when toggled on, not hidden behind another condition.

### Task 10: Contract approval UI has no scroll / next step

Charles: "The UI here does not allow you to scroll or do the next step on a contract approval."

- **Symptom:** Approval flow is locked (dialog overflow? modal height clamped?).
- **Scope:** The contract approval flow (likely `components/contracts/contract-change-proposals-card.tsx` — shipped `490794e` today — or the `ContractChangeProposalsCard` dialog). Could also be the Pending Contracts tab approval flow.
- **Fix sketch:** Repro the approval flow on a seeded proposal. If the dialog / panel truncates with no scroll: add `overflow-y-auto max-h-[80vh]` to the content region. If the "Next" button is absent: check whether the approval action is wired and button rendered.

### Task 11: "Out of scope" match status is ambiguous

Charles: "Not sure what out of scope here then?"

- **Symptom:** UX — user doesn't understand what "out of scope" means as a COG match status.
- **Scope:** `components/facility/cog/cog-columns.tsx` (match status badge) + any legend/tooltip.
- **Fix sketch:** Add a tooltip or help icon explaining the 6 match statuses:
  - `pending` — not yet analyzed
  - `on_contract` — matches an active contract
  - `off_contract_item` — vendor's on contract, but this specific item isn't
  - `out_of_scope` — vendor isn't under any contract at all
  - `unknown_vendor` — vendor name unresolved
  - `price_variance` — matches a contract but price differs materially

---

## Commits land as they complete

No wave synchronization. Each subagent cherry-picks individually via the controller as it reports back.
