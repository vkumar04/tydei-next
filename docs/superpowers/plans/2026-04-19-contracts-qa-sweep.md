# Contracts Full QA Sweep — Read-Only Audit Plan

> **For agentic workers:** READ-ONLY. Do not modify any code. Each subagent produces a structured Markdown bug report and commits nothing.

**Goal:** Surface every rendering, calculation, and upload bug across the 6 facility contracts sub-surfaces. Produce a consolidated bug list we can triage + fix in follow-up waves.

**Scope:** `/dashboard/contracts` (list), `/new` (create), `/[id]` (detail), `/[id]/edit`, `/[id]/terms`, `/[id]/score`. Includes every upload (contract PDF, amendment PDF, document + re-index, pricing file) and every displayed calculation.

**Working DB:** `postgresql://tydei:tydei_dev_password@localhost:5432/tydei`. Demo facility = `cmo4sbr8p0004wthl91ubwfwb`. Demo login: `demo-facility@tydei.com` / `demo-facility-2024`.

**Output file:** each subagent returns a Markdown report inline. I consolidate all 6 into `docs/superpowers/qa/2026-04-19-contracts-sweep.md`.

---

## Shared procedure every subagent follows

1. Start a prod-like server: `PORT=3002 bun run start &` (after `bun run build` if stale).
2. Log in via `curl` to `/api/auth/sign-in/email` and save cookie to `/tmp/c.txt`.
3. For each flow in your scope:
   a. **Render check** — HTTP-fetch the page, save HTML, grep for `"digest"`, error banners, unexpected empty-state markers where data should exist.
   b. **Source cross-read** — open the relevant component + server action + engine files; note any shape or semantics mismatch.
   c. **Prisma ground truth** — run a direct `prisma.*.findMany/findUnique/aggregate` from a scratch `.ts` run via `bun` to get the raw inputs the action consumes.
   d. **Hand-compute expected value** — for every numeric shown on screen, compute the expected value from the Prisma data. Compare to the HTTP-returned value.
   e. **Flag deltas** — any inconsistency between rendered / action-returned / Prisma-sourced / hand-computed is a bug.
4. For every upload flow: execute the upload via `curl` or direct server-action call with a real fixture; confirm the persisted Prisma row; re-fetch the page; verify the displayed result.

## Shared bug-report format

```markdown
### BUG-<sub-surface>-<n>: <short name>
- **Severity:** P0 (broken, blocks the flow) / P1 (wrong data / calc off) / P2 (UX, cosmetic, dead code)
- **Page / flow:** route + user action
- **Symptom:** what the user sees
- **Root cause:** file:line + 1-line explanation (or "unclear — needs deeper investigation")
- **Expected:** computed value or intended behavior
- **Actual:** observed value or behavior
- **Fix sketch:** 1-2 lines
- **Repro:** exact command sequence
```

At the end of each report, include:
- **Summary counts:** P0=N, P1=N, P2=N
- **Surfaces passing cleanly:** list
- **Commands run:** list of shell commands executed (for audit trail)

---

## Subagent 1 — Contracts List

**Routes in scope:** `/dashboard/contracts`

**UI features to audit:**
- Per-row checkbox column (commit `289606b`)
- Sticky "Compare (N)" toolbar + `<CompareModal>` (commits `dc26a37` + `289606b`)
- 3-way facility scope filter — URL-bound Tabs (commit `9a90547`)
- Download CSV button + `buildContractsCSV` (commit `938b32d`)
- Scope column (Single / Multi-facility / Grouped / Shared, commit `30fd77c`)
- Multi-category list filter audit (commit `3017402` noted no filter exists — verify)
- Pending Contracts tab (existing)
- Stats cards top of page

**Calculations to verify:**
- `getContractStats` → total contracts count, totalValue sum, totalRebates sum
- `getContractMetricsBatch` per row → spend (COG precedence), rebate (Rebate rows + ContractPeriod fallback, filtered by `payPeriodEnd <= today` + `collectionDate` gate), totalValue passthrough
- Compare modal values — each metric in the compare table must match what row renders

**Uploads:** none direct on this page.

---

## Subagent 2 — Contract Create (`/new`)

**Routes in scope:** `/dashboard/contracts/new`

**UI features to audit:**
- 3-mode entry tabs (PDF default per commit `a8d0049`, Manual, AI)
- `<ExtractedReviewCard>` (commit `6c87174`) rendering in both PDF + AI tabs
- Multi-facility selector + `FacilityMultiSelect` (commit `831da90`)
- Grouped-vendor picker (UI-only deferral, commit `dc26a37`)
- Tie-in capital contract picker (commit `e608c40`)
- Suggest-from-COG button (commit `a091102`)
- Multi-category Popover (existing) + pricing-file categories auto-merge (commit `3017402`)

**Uploads to exercise:**
- **Contract PDF upload** via `/api/ai/extract-contract`
  - With a real small PDF fixture (find one in `tests/fixtures/` or generate minimal PDF)
  - Assert extract returns populated fields
  - Assert 502 with clear error when AI unavailable (no env key) — per commit `a1ec9d2` demo-mode was removed
- **Pricing-file upload during create flow**
  - 2-row CSV fixture: vendorItemNo / description / listPrice / contractPrice / category
  - Confirm `PricingFile` row + `ContractPricing` rows written to Prisma
  - Categories merged into form `categoryIds`
  - Items show up on the form's pricing-items state

**Calculations to verify:**
- Suggest-from-COG: vendor's last-12-month `extendedPrice` sum → `totalValue` and `annualValue`
  - Hand-compute from `prisma.cOGRecord.aggregate({where:{vendorId,facilityId,transactionDate:>=12mo},_sum:{extendedPrice}})`
- `createContract` mutation — verify it writes ContractFacility rows, `tieInCapitalContractId`, categoryIds[], etc., matching form input
- Field-level validator correctness (dates, totals non-negative, vendor required)

---

## Subagent 3 — Contract Detail (`/[id]`)

**Routes in scope:** `/dashboard/contracts/[id]` (pick any active contract id from demo seed)

**UI features to audit:**
- Overview tab Cards: Contract Details, Commitment Progress, **Tie-In Capital** (when `contractType=tie_in`, commit `6de9542`), **Compliance** (when `complianceRate != null`, commit `122c7a3`), **Market Share** (when both fields set, commit `09160e6`), **Off-Contract Spend** + top-10 (commit `ebc2ce4`), **Pending Change Proposals** (commit `490794e`)
- Categories rendering — all, not just primary (commit `8607b50`)
- Performance tab — `<ContractPerformanceCharts>` (commit `d2a002b`): monthly spend AreaChart + quarterly rebate BarChart
- Amendment 4-stage breadcrumb (commit `d3910a3`)
- Documents tab

**Uploads to exercise:**
- **Document upload** on Documents tab — any existing `ContractDocument` model form
  - POST a small PDF; verify `ContractDocument` row written with correct `contractId`, `s3Key` (if any), `effectiveDate`
  - Confirm doc appears in the table on page refresh
- **Re-index for AI** button (commit `416e670`)
  - Click invokes `/api/ai/index-document` with `{documentId, rawText}`
  - Verify `ContractDocumentPage` rows written; verify `Contract.indexStatus`/`indexedAt` updated
- **Amendment PDF upload** — walk all 4 stages (upload → review → pricing → confirm)
  - Verify each stage advances per `nextStage()` helper (commit `d3910a3`)
  - Verify `updateContract` is called with the extracted diff at confirm
  - Verify the contract row reflects the changes after refresh

**Calculations to verify:**
- Commitment Progress: `(currentMarketShare / marketShareCommitment) * 100` and `(rebateCollected / rebateEarned) * 100`
- `rebateEarned`: sum of `Rebate.rebateEarned` where `payPeriodEnd <= today`
- `rebateCollected`: sum where `collectionDate != null`
- Compliance Card: `contract.complianceRate` directly (no engine yet)
- Market-share ratio color thresholds (≥80 emerald / ≥60 amber / <60 red)
- Off-contract spend: `prisma.cOGRecord.aggregate({facilityId, vendorId, isOnContract:true/false})` split; top-10 by `groupBy(vendorItemNo)` sum
- Performance charts: monthly = `extendedPrice` sum per `YYYY-MM`, quarterly = per-period rebate sums from `ContractPeriod`
- Tie-in Capital display: capitalCost as currency, interestRate × 100 as %, termMonths as "N months"

---

## Subagent 4 — Contract Edit (`/[id]/edit`)

**Routes in scope:** `/dashboard/contracts/[id]/edit`

**UI features to audit:**
- Edit form renders with existing contract values pre-filled
- All fields mutable (vendor, categories, dates, values, commitment, etc.)
- Multi-facility toggle works (doesn't silently drop join rows)
- Save → `updateContract` → navigates/refreshes detail correctly

**Uploads:** any pricing-file replace/append flow on edit (if present).

**Calculations to verify:**
- `updateContract` merge semantics — does it preserve unspecified fields, or does it null them?
- `categoryIds` replacement — does it `deleteMany + createMany` the join rows?
- Annual-value recompute when totalValue or dates change (per the v0 auto-derive pattern — check if this is wired)
- If editing fields that feed into score, does the page show the stale score (OK, score is read-only, but document)

---

## Subagent 5 — Contract Terms (`/[id]/terms`)

**Routes in scope:** `/dashboard/contracts/[id]/terms`

**UI features to audit:**
- `<ContractTermsEntry>` (shared component) renders with existing terms
- Term-type dropdown includes all 15 `TermType` enum values (commit `a1ec9d2` added po_rebate/carve_out/payment_rebate)
- Rebate method Select uses plain-English labels (commit `c5ea3b8`)
- Specific-Items picker shows items when `appliesTo=specific_items` (commit `d3b0ad1`)
- Specific-Category multi-select (commit `3017402`)
- Tie-in capital fields visible when `contractType=tie_in` (commit `6de9542`)
- `TERM_TYPE_DEFINITIONS` tooltip renders next to Term Type field (commit `f0747f8`)
- Add tier / remove tier flows
- Save → `updateContractTerm` persistence

**Uploads:** none direct.

**Calculations to verify:**
- `computeRebateFromPrismaTiers` for percent_of_spend: confirm 100× scaling applied (commit `97a6554`) — a tier with `rebateValue=0.02` and spend=$100k should produce $2,000, not $20
- Cumulative vs Marginal correctness: test cases from the spec
  - Cumulative $750K @ tier 3 (3%) → $22,500
  - Marginal $500K @ 2% + $250K @ 3% → $17,500
- Tier sort order by `tierNumber` preserved through form save
- `scopedCategoryIds` round-trips through form
- `scopedItemNumbers` round-trips through form
- Tie-in field persistence (capitalCost / interestRate / termMonths)

---

## Subagent 6 — Contract Score (`/[id]/score`)

**Routes in scope:** `/dashboard/contracts/[id]/score`

**UI features to audit:**
- Page renders without error when `ANTHROPIC_API_KEY` missing
- Rule-based radar visible (commit `4f011d1` + `0ea0165` 6 dims)
- Benchmark overlay (commit `f6e4b8c` + seed patch `0ba667b`)
- AI score-deal route `/api/ai/score-deal`
  - If env key set → returns populated AI analysis
  - If env key missing → must fail gracefully (500/502 with error state, not crash the page)

**Uploads:** none direct.

**Calculations to verify:**
- `computeContractScoreLive` (commit `241c793`) — read-only, doesn't persist
- All 6 component scores:
  - `commitmentScore` — commitmentMet function
  - `complianceScore` — complianceRate → engine
  - `rebateEfficiencyScore` — rebatesEarned / totalContractValue
  - `timelinessScore` — daysUntilExpiration gradient
  - `varianceScore` — variance count heuristic
  - `priceCompetitivenessScore` (commit `0ea0165`) — `clamp(0, 100, 100 - |avgVariancePercent|)` from `InvoicePriceVariance`
- Overall weighted score: `0.20+0.20+0.20+0.15+0.15+0.10 = 1.0`
- scoreBand thresholds (A/B/C/D/F boundaries)
- Benchmark lookup returns the right `ContractType` key (commit `f6e4b8c`)

---

## Wave tasks for subagent dispatch

- [ ] **Task 1:** Dispatch all 6 subagents in parallel. Each gets the shared procedure + its surface-specific scope.
- [ ] **Task 2:** Wait for all 6 to return their reports.
- [ ] **Task 3:** Consolidate reports into `docs/superpowers/qa/2026-04-19-contracts-sweep.md`.
- [ ] **Task 4:** Triage — group by severity and root cause. Share with user for approval before fix waves.

---

## Self-Review

- **Placeholder scan:** every subagent has a concrete list of features/calcs/uploads — no "verify everything" hand-waves.
- **Consistency:** all six share the same shared procedure + bug-report format.
- **Scope:** read-only; no fix path in this plan — fixes land in follow-up plans after triage.
- **Ambiguity:** each bug report entry specifies severity + root cause + repro, so no fix will start from "this looked off."
