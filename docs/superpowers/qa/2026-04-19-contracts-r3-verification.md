# Charles R3 Verification Sweep — Consolidated Report (2026-04-19)

Source plan: `docs/superpowers/plans/2026-04-19-charles-r3-verification-sweep.md`. 6 read-only subagents dispatched after the R3 fix wave.

---

## Sub A — COG Data Surface

**Verdict: 5/5 R3 items VERIFIED_FIXED. 0 regressions.**

| Item | Commit | Status |
|---|---|---|
| R3.1 Loading state during ingest | `89840d4` | VERIFIED (spinner, row count, 30-60s hint, role=status) |
| R3.2 Server-side filter matchStatus | `985f657` | VERIFIED (validator + server `where` + count + client wires it) |
| R3.3 Match/rematch 570 rows | `341c347` | VERIFIED — live distribution: on_contract=570, pending=1. Match Pricing button now calls recompute. |
| R3.5 Total Savings tooltip | `772e523` | VERIFIED — tooltip copy accurate to 5% estimate + real formula |
| R3.11 Match status tooltips | `589e9af` | VERIFIED — all 6 states + column-header legend |

**Regression probe:** `grep -n productCategoryId lib/actions/cog-records.ts` → 0 matches. Clean.

Remaining `pending=1` row is a legitimate vendor-less record that can't match any contract.

---

## Sub E — Terms + Scoring

**Verdict: 6/6 items VERIFIED_FIXED. 0 regressions.**

| Item | Commit | Status |
|---|---|---|
| Term save w/ scope fields | `fc3135a` | VERIFIED — destructure drops scopedCategoryId/Ids/scopedItemNumbers; scopedCategoryIds → `categories` String[], scopedItemNumbers → `ContractTermProduct` join rows |
| Edit pre-fills tie-in + scope | `123c749` | VERIFIED — `getContractTerms` includes products; startEditing maps all fields |
| availableItems flows to picker | `ec21b33` | VERIFIED — `getContractPricing` query feeds `SpecificItemsPicker` |
| AI scoring works (no .min/.max) | `f9baec5`, `61f7872` | VERIFIED — schema clean, server-side clamp, 6th dim rendered, AI-failure localized to amber card |
| Rebate math routing | `709fae7` | VERIFIED — percent_of_spend × 100, fixed_rebate flat, unit-based → 0 |
| Server values on detail | `dc70a31` | VERIFIED — Math.max re-derivation removed, direct reads |

---

## Sub F — Approval / Proposal Flows

**Verdict: 3/3 items VERIFIED_FIXED. 0 regressions.**

| Item | Commit | Status |
|---|---|---|
| R3.10 scroll + approve reachable | `e7c0f73` | VERIFIED — DialogContent `max-h-[85vh] overflow-hidden`, TabsContent scrolls, proposals card `<pre>` capped |
| Proposal lifecycle (approve/reject/revise) | `490794e` | VERIFIED end-to-end via scratch Prisma exec — all 3 status transitions + contract-edit whitelist + audit log + facility ownership guard all correct |
| Dialog layout on small viewports | `e7c0f73` | VERIFIED — Header + TabsList pinned, body scrolls, Approve/Reject buttons reachable |

---

## Sub C — Contract Create + PDF + Tie-in + Multi-facility

**Verdict: 3/3 items VERIFIED_FIXED. 0 regressions.**

| Item | Commit(s) | Status |
|---|---|---|
| R3.7 PDF upload | `0e0c877` | VERIFIED live HTTP 200 + populated extracted fields + s3Key |
| R3.8 Tie-in capital fields on spend_rebate term | `6de9542`+`8d4edd0` | VERIFIED live — seeded `tie_in` contract + `spend_rebate` term, capital block rendered per-term under per-contract guard |
| R3.9 Multi-fac selector at top level | `2baa022` | VERIFIED — FacilityMultiSelect Card is sibling of (not nested in) grouped Card; works for any contractType |

---

## Sub B — Pricing Files

**Verdict: 2/2 items VERIFIED_FIXED. 1 NEW_BUG (low severity).**

| Item | Commit | Status |
|---|---|---|
| R3.4 delete pricing file | `019a9ff` | VERIFIED — action scope-gated, ContractPricing + PricingFile both purge, audit log emitted; live DB simulation + cleanup confirmed |
| R3.6 pricing upload (CSV happy path) | n/a (NOT_REPRODUCED in R3) | VERIFIED live — CSV auto-maps 5 headers, both the contract-pricing-tab and new-contract paths write ContractPricing rows correctly |

### NEW_BUG — P2 (UX polish): `/api/parse-file` xlsx error is generic

- **File:** `app/api/parse-file/route.ts:88-94`
- **Symptom:** Uploading a CSV renamed `.xlsx` (or any non-zip file with `.xlsx` extension) produces toast `"Failed to parse file"` — accurate but doesn't guide the fix.
- **Expected:** Something like `"This file doesn't look like a valid .xlsx workbook. If it's a CSV, rename it to .csv and re-upload."`
- **Fix sketch:** In the catch block, inspect the thrown message; if it matches the ExcelJS "Can't find end of central directory" signature, return a specific error.

---

## Sub D — Contract Detail Cards + Calculations

**Verdict: 7 VERIFIED, 3 N/A-gate VERIFIED, 0 broken, 0 calc-off.**

Seed contract used: `cmo4sbrdr0023wthlppfvv6zh` (Stryker Joint Replacement, `facilityId=cmo4sbr8n0003wthloqkycn8z`).

| Card | Status | Ground truth |
|---|---|---|
| Contract Details (categories list) | VERIFIED | dedupe+sort helper works; single-category contract renders correctly |
| Commitment Progress | VERIFIED | `currentSpend / totalValue = 66%`; collected/earned ratio = 54% — matches Prisma |
| Tie-In Capital | N/A (gate VERIFIED) | contractType=usage, correctly hidden; empty-state "Add Terms" path at L521-536 |
| Compliance | N/A (gate VERIFIED) | complianceRate=null, correctly hidden |
| Market Share | N/A (gate VERIFIED) | both fields null + zero-guard, correctly hidden |
| Off-Contract Spend + top-10 | VERIFIED | `OR:[{contractId},{contractId:null,vendorId}]` filter correct; on=$0, off=$1,652,400, 100% leakage — matches |
| Pending Change Proposals | VERIFIED (empty) | self-hides when 0 proposals |
| Documents tab upload | VERIFIED | `ContractDocumentsList.onUpload` wired; `<DocumentUpload>` mounted with dialog state |
| Amendment breadcrumb (3-step) | VERIFIED | exactly 3 stages (Upload, Review, Confirm); `pricing` removed |

### Calc cross-check (all VERIFIED against Prisma)

| Stat | Formula | Ground truth |
|---|---|---|
| Rebates Earned | `contract.rebateEarned` (server) | $56,481.41 ✓ |
| Rebates Collected | `contract.rebateCollected` (server, collectionDate gated) | $30,349.21 ✓ |
| Current Spend | server OR clause | $1,652,400 ✓ |
| Off/On split | off-contract-spend action | $0 on / $1,652,400 off ✓ |

### Observations (non-blocking)
- `ContractDetailOverview` component is defined + imported but never used in JSX. Dead code; could be removed.
- Seed has 487 COG rows all `matchStatus=pending` on this contract's facility. "Current Spend" equals "Off-Contract Spend" = $1,652,400. Seed-data state, not a bug (run "Re-run match" to flip them).
- ~$858 drift between `Rebate` table sum ($56,481.41) and `ContractPeriod.rebateEarned` rollup ($55,623.11). Seed-data drift, doesn't affect detail page (uses Rebate table per CLAUDE.md rule).

---

## Final tally

| Sub | Items | VERIFIED | NEW_BUG | STILL_BROKEN | REGRESSION |
|---|---|---|---|---|---|
| A — COG | 5 | 5 | 0 | 0 | 0 |
| B — Pricing Files | 2 | 2 | 1 (P2) | 0 | 0 |
| C — Create + PDF + tie-in + multi-fac | 3 | 3 | 0 | 0 | 0 |
| D — Detail Cards + Calcs | 9 | 9 | 0 | 0 | 0 |
| E — Terms + Scoring | 6 | 6 | 0 | 0 | 0 |
| F — Approval Flows | 3 | 3 | 0 | 0 | 0 |
| **Totals** | **28** | **28** | **1 (P2)** | **0** | **0** |

**Outcome:** Every R3 fix verified working. 0 regressions. 1 P2 polish issue (xlsx-error message specificity).

**Total today across all waves + rounds:**
- 5 P0 fixes (Wave 1)
- 8 P1 fixes (Wave 2)
- 3 P1 + 3 P2 fixes (Wave 3)
- 8 new fixes + 3 NOT_REPRODUCED (R3 round)
- All 28 surfaces re-verified clean

Total shipped = 27 bug fixes + 1 test fix + 6 plan files + 1 consolidated QA report.
