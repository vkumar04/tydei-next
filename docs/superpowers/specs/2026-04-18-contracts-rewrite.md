# Contracts Rewrite — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each subsystem below. Each subsystem gets its own per-subsystem TDD plan generated on demand (see "Execution model"). Steps in those plans use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** `contracts-rewrite` (create via worktree before execution)
**Status:** Design approved by Vick · no code touched yet
**Supersedes:** `2026-04-12-v0-parity-design.md`, `2026-04-14-v0-parity-full-port.md` (both retrospective; route-level parity landed, this doc closes contract *calculation* and *UX* gaps)

**Goal:** Make the 6 tydei-next contracts pages match the v0/Lovable prototype and the calculation spec at `~/Downloads/b_G9ilmDWDNaR/docs/contract-calculations.md`, fixing silent-wrong-number bugs and unimplemented engines.

**Architecture:** Ship the contracts rewrite as **8 vertically-sliced subsystems**, sequenced by impact. Each subsystem is independently mergeable: lands behind the existing feature flag surface, passes typecheck + build, and makes at least one page more correct. No "big bang" migration. All calculation logic consolidates into `lib/contracts/` with a single engine per concern; UI clients in `components/facility/contracts/` and `components/contracts/` call pure functions, no business logic in components.

**Tech stack (unchanged):** Next.js 16, Prisma 7, Better Auth, Tailwind v4, shadcn/ui, TanStack Query, react-hook-form + Zod, Bun, Gemini via `@ai-sdk/google`. Reference: `CLAUDE.md` + `docs/superpowers/specs/2026-04-14-v0-parity-full-port.md` acceptance criteria (delete after supersede; copied below).

---

## 1. Scope

### In scope

6 contract pages and the engines behind them:

| Route | Client component | Current state |
|---|---|---|
| `/dashboard/contracts` | `components/contracts/contracts-list-client.tsx` | Renders; missing compare mode + facility filter polish |
| `/dashboard/contracts/new` | `components/facility/contracts/contract-create-client.tsx` | Renders; missing AI/Manual/PDF entry selector and tie-in UI |
| `/dashboard/contracts/[id]` | `components/contracts/contract-detail-client.tsx` | Renders; missing off-contract spend, market share, multi-step amendment flow |
| `/dashboard/contracts/[id]/edit` | `components/facility/contracts/contract-edit-client.tsx` | Renders; no recompute-on-term-change trigger |
| `/dashboard/contracts/[id]/score` | `components/facility/contracts/contract-score-client.tsx` | Renders; score dimensions stubbed, benchmarks absent, price variance + true margin absent |
| `/dashboard/contracts/[id]/terms` | `components/facility/contracts/contract-terms-page-client.tsx` | Renders; tier progress + accrual schedule absent |

### Out of scope (this initiative)

- Vendor-portal contracts pages (covered under v0-parity full port; no calculation bugs flagged there).
- Admin-portal payor-contracts table (separate domain — healthcare payor rates, not vendor rebate contracts).
- Rebate-optimizer (reads the new engines; update is trivial after subsystems 2-3 land).
- Case-costing / surgeon scorecards (spec section 8 — separate initiative).

### Non-goals (preserved)

- No stack swaps. No data-model regression — additive Prisma migrations only.
- No debug-route ports, no AI model swap.
- No unilateral refactor of unrelated files touched incidentally.

### Cross-cutting rule: rebates are **never** auto-computed for display

Earned and collected rebate values shown in the UI (contracts list, contract
detail, dashboard cards, reports overview, vendor performance) come **only**
from explicit `Rebate` rows or `ContractPeriod` rollups. Engines like
`computeRebateFromPrismaTiers` are reserved for **projection** surfaces —
tier progress, "what-if" rebate-optimizer scenarios, accrual estimates that
are clearly labeled as projections. Never use them to fill in `rebateEarned`
when no `Rebate` row exists; the correct value in that case is `$0`.

This applies to:
- `getContract`, `getContractMetricsBatch`, `getContractStats`
- Dashboard KPI + charts (`getDashboardKPISummary`, `getDashboardCharts`)
- Reports overview (`getReportsOverview`)
- Any future contracts surface that displays an "earned rebate" number

If a downstream surface needs a projection, name it explicitly
(`projectedRebate`, `tierProgressEstimate`) and render it in a separate
slot from real earned/collected.

---

## 2. File structure

**New files (all under `lib/contracts/` — colocate engines, split by concern):**

- `lib/contracts/rebate-method.ts` — cumulative vs marginal tier math (subsystem 1)
- `lib/contracts/tier-progress.ts` — current/next tier, progress %, projected rebate (subsystem 2)
- `lib/contracts/accrual.ts` — monthly accrue / quarterly true-up / annual settlement (subsystem 3)
- `lib/contracts/compliance.ts` — purchase-by-purchase compliance + contract compliance rate (subsystem 4)
- `lib/contracts/price-variance.ts` — invoice line vs contract-price variance + severity (subsystem 5)
- `lib/contracts/true-margin.ts` — procedure margin with proportional rebate allocation (subsystem 6)
- `lib/contracts/tie-in.ts` — all-or-nothing + proportional bundle compliance (subsystem 7)
- `lib/contracts/__tests__/` — Vitest tests, one file per engine (pattern: `*.test.ts`)

**Modified files:**

- `lib/rebates/calculate.ts` — delegate to `rebate-method.ts` (keep `computeRebate`/`computeRebateFromPrismaTiers` as facade; add `method: 'cumulative' | 'marginal'` parameter, default `'cumulative'`)
- `prisma/schema.prisma` — additive columns + new models (see "Schema changes" below)
- `lib/actions/contracts.ts` — new server actions for tier progress, tie-in compliance, recalc-on-edit
- `lib/actions/contract-terms.ts` — add `rebateMethod` field on term save
- Six contracts page client components — wire new engines into existing sections; add missing UI sections

**Schema changes (batched into one migration, subsystem 0):**

- `ContractTerm.rebateMethod` — enum `rebate_method { cumulative, marginal }`, default `cumulative`
- `ContractTier.tierName` — optional `String?` (Bronze/Silver/Gold)
- `Contract.complianceRate` — `Decimal? @db.Decimal(5, 2)` (computed + cached; recomputed on period close)
- `Contract.currentMarketShare` — `Decimal? @db.Decimal(5, 2)`
- `Contract.marketShareCommitment` — `Decimal? @db.Decimal(5, 2)`
- **New model** `RebateAccrual`: `id`, `contractId`, `periodStart`, `periodEnd`, `granularity: accrual_granularity {monthly,quarterly,annual}`, `accruedAmount`, `trueUpAmount`, `status: accrual_status {pending,trued_up,settled}`
- **New model** `TieInBundle`: `id`, `primaryContractId`, `complianceMode: tie_in_mode {all_or_nothing, proportional}`, `bonusMultiplier Decimal?`
- **New model** `TieInBundleMember`: `id`, `bundleId`, `contractId`, `weightPercent Decimal`, `minimumSpend Decimal?`
- **New model** `InvoicePriceVariance`: `id`, `invoiceLineId`, `contractId`, `contractPrice`, `actualPrice`, `variancePercent`, `varianceDirection: variance_direction {overcharge,undercharge,at_price}`, `severity: variance_severity {minor,moderate,major}`, `detectedAt`

---

## 3. Subsystems — priority-ordered

Priority rubric:
- **P0** = silent-wrong-number bug (pages display incorrect values today)
- **P1** = feature missing vs prototype (visible UX gap)
- **P2** = polish / edge-case / formula completeness

Subsystems are sequenced so each builds on prior (engines before UI). Within a subsystem, tasks are TDD: test → run red → implement → run green → commit.

### Subsystem 0 — Schema migration (blocker for 3/5/7)

**Priority:** P0 (blocks three P0 subsystems)
**Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_contracts_rewrite/migration.sql`, `prisma/seed.ts`
**Approach:** One additive migration. No existing column types change. Backfill `ContractTerm.rebateMethod = 'cumulative'` (matches today's behavior). Seed script updated to set `rebateMethod` on new contracts.
**Acceptance:**
- `bunx prisma migrate dev --name contracts-rewrite` succeeds on clean DB
- `bun run db:seed` succeeds; no existing seeded contracts break
- `bunx tsc --noEmit` → 0 errors (generated Prisma types)
- New models + columns present in Prisma Studio

**Plan detail:** On-demand — will generate `2026-04-18-contracts-rewrite-00-schema-plan.md` when this subsystem is picked up.

---

### Subsystem 1 — Marginal rebate method (P0 — WRONG NUMBERS TODAY)

**Priority:** P0
**Spec reference:** Section 2.1.1 (Cumulative) + 2.1.2 (Marginal) in `contract-calculations.md`
**Why this is wrong today:** `lib/rebates/calculate.ts:49-65` only implements cumulative. Every page that displays rebate earned pulls from this function. If any seeded contract or any future contract is configured with marginal tiers, rebate numbers are silently wrong on the detail page, score page, terms page, dashboard, and vendor performance page.

**Files:**
- Create: `lib/contracts/rebate-method.ts`
- Create: `lib/contracts/__tests__/rebate-method.test.ts`
- Modify: `lib/rebates/calculate.ts` — add `method` parameter to `computeRebate` and `computeRebateFromPrismaTiers`; delegate to new module; keep signatures backward-compatible (default `method = 'cumulative'`)
- Modify: `lib/actions/contract-terms.ts` — accept `rebateMethod` on save
- Modify: `components/facility/contracts/contract-terms-entry.tsx` — add radio group: Cumulative / Marginal with inline explanation
- Modify: `components/facility/contracts/contract-terms-page-client.tsx` — surface chosen method in header; show worked example

**Approach:**
1. Write Vitest tests first covering both methods against the exact worked examples in spec section 2.1.1 ($75K cumulative @ 3% = $2,250) and 2.1.2 ($125K marginal across three brackets = $3,500).
2. Add edge tests: spend below tier 1 min, spend exactly at tier boundary, single-tier contract, spendMax missing on non-final tier (should error).
3. Implement `calculateCumulative(spend, tiers)` and `calculateMarginal(spend, tiers)` as pure functions. Shared sort-by-`spendMin` helper.
4. Update `lib/rebates/calculate.ts` facade to dispatch on method.
5. Wire UI: radio group on term entry form, stored method badge on terms page.

**Acceptance:**
- Both spec worked examples pass
- `bun run test lib/contracts/__tests__/rebate-method.test.ts` → all pass
- Switching method on a seeded contract recomputes periods on next save (triggered by subsystem 3's recompute action, but test the pure function here)
- Existing `computeRebate` callers unchanged in behavior (default `cumulative`)
- Terms page shows "Method: Marginal (bracket)" or "Method: Cumulative (whole-spend)" as a readable label

**Plan detail:** On-demand — `2026-04-18-contracts-rewrite-01-rebate-method-plan.md`.

---

### Subsystem 2 — Tier progression (P1)

**Priority:** P1
**Spec reference:** Section 3 (Tier Progression Logic)
**Why:** Terms page + score page should show "you're $12,500 from Silver → Gold, projected additional rebate $3,000". Currently terms page lists tier min/max statically; no progress affordance.

**Files:**
- Create: `lib/contracts/tier-progress.ts` — exports `calculateTierProgress(currentSpend, tiers)` returning `{ currentTier, nextTier | null, progressPercent, amountToNextTier, projectedAdditionalRebate }`
- Create: `lib/contracts/__tests__/tier-progress.test.ts`
- Modify: `components/facility/contracts/contract-terms-page-client.tsx` — add tier progress card above tier table (progress bar + "X to next tier" callout)
- Modify: `components/facility/contracts/contract-score-client.tsx` — tier progress row in "Rebate Structure" score dimension
- Modify: `lib/actions/contracts.ts` — server action `getTierProgress(contractId)` returning the computed struct

**Approach:** Pure function depends on subsystem 1 (tier math). Test-first against spec examples; test both cumulative and marginal method outcomes.

**Acceptance:**
- Contract with spend $75K on cumulative tiers (2%/3%/4% at $0/$50K/$100K) shows "Silver tier achieved · $25,000 to Gold · projected additional rebate $750"
- Tier 3 achieved (no next tier) shows "Top tier achieved" with null next-tier UI

**Plan detail:** On-demand — `02-tier-progress-plan.md`.

---

### Subsystem 3 — Rebate accrual schedule (P1)

**Priority:** P1
**Spec reference:** Section 2.2 (Rebate Accrual Schedule — monthly/quarterly/annual)
**Why:** Today we compute a single final rebate per `ContractPeriod`. Spec requires monthly accrual → quarterly true-up → annual settlement, each surfaced to the user so finance can forecast. Prototype detail page shows this.

**Files:**
- Create: `lib/contracts/accrual.ts` — three functions: `calculateMonthlyAccrual`, `calculateQuarterlyTrueUp`, `calculateAnnualSettlement` (signatures match spec section 2.2 verbatim)
- Create: `lib/contracts/__tests__/accrual.test.ts`
- Modify: `prisma/schema.prisma` — `RebateAccrual` model (landed in subsystem 0)
- Modify: `lib/actions/contracts.ts` — `recomputeAccruals(contractId)` server action; triggered on edit-save and on COG import of matching vendor
- Modify: `components/contracts/contract-detail-client.tsx` — new "Accrual Schedule" section showing accrued-to-date, last true-up, next settlement date
- Create: `components/facility/contracts/accrual-timeline.tsx` — horizontal timeline of accrual events

**Approach:** Depends on subsystem 1 (uses `computeRebate` for settlement total). `recomputeAccruals` runs inside a transaction, deletes + rewrites rows for the contract (simple + correct; accrual row count is O(months in period)).

**Acceptance:**
- Annual contract, spend pattern {$10K/mo for 6mo, $15K/mo for 6mo}, tier structure (2%/3%/4% at $0/$50K/$100K): monthly accruals at 2% for first 5 months, tier bumps to 3% on month 6 when cumulative hits $60K, quarterly true-ups show positive adjustment, annual settlement equals cumulative rebate on $150K at 4% = $6,000
- Detail page renders accrual timeline; each event is a row with granularity badge + amount

**Plan detail:** On-demand — `03-accrual-plan.md`.

---

### Subsystem 4 — Compliance rate + market share engine (P1)

**Priority:** P1
**Spec reference:** Section 5 (Compliance Rate Calculation); prototype detail page for market-share tracking
**Why:** `Contract.complianceRate`, `Contract.currentMarketShare`, `Contract.marketShareCommitment` are schema fields (added in subsystem 0) with no computation. Detail page shows compliance % and market share placeholders. Prototype shows live compliance % with breakdown (off-contract / expired / unapproved-item / price-variance / quantity-limit) AND live market share (`vendor_spend / category_total × 100`) with commitment-gap indicator. Bundled here because both metrics share the same purchase-order data source and recompute cadence.

**Files:**
- Create: `lib/contracts/compliance.ts` — `evaluatePurchaseCompliance(purchase, activeContracts)` returns `{ compliant: boolean, reasons: ComplianceViolation[] }`; `calculateComplianceRate(purchases, activeContracts)` aggregates
- Create: `lib/contracts/market-share.ts` — `calculateMarketShare(vendorSpend, categoryTotalSpend)` returns `{ currentMarketShare, commitmentMet, gap }` where `gap = commitment − current` (negative = exceeding)
- Create: `lib/contracts/__tests__/compliance.test.ts`, `market-share.test.ts`
- Modify: `lib/actions/contracts.ts` — `recomputeCompliance(contractId)` updates `Contract.complianceRate`, `currentMarketShare`; called on demand from detail page and after COG import
- Modify: `components/contracts/contract-detail-client.tsx` — compliance card with breakdown bar chart (shadcn Chart) + "drill into violations" table; market share card with progress bar toward commitment
- Create: `components/facility/contracts/compliance-breakdown.tsx`
- Create: `components/facility/contracts/market-share-card.tsx`

**Approach:** Pulls from `PurchaseOrder` + `InvoiceLine` joined against `ContractPricing` (compliance) and category-wide vendor spend (market share). Pure functions accept already-loaded data; server action does the loading + caching. Market share requires the contract to be scoped to a `productCategoryId` — if null, market-share card renders "not applicable".

**Acceptance:**
- Seeded contract with mix of on-contract / off-contract / expired-date purchases shows correct compliance % and violation breakdown
- Seeded contract with 30% commitment and actual 25% market share: card shows "25% / 30% · 5pp gap" with amber status
- Seeded contract with 30% commitment and 35% actual: card shows "35% / 30% · exceeding by 5pp" with green status
- `recomputeCompliance` idempotent: running twice gives same result

**Plan detail:** On-demand — `04-compliance-plan.md`.

---

### Subsystem 5 — Price variance detection (P1)

**Priority:** P1
**Spec reference:** Section 6 (Price Discrepancy Detection)
**Why:** Score page should highlight overcharges. Today: no variance logic anywhere. Prototype integrates price variance into both score page and detail page.

**Files:**
- Create: `lib/contracts/price-variance.ts` — `calculatePriceVariance(actualPrice, contractPrice)` returns `{ variancePercent, direction, severity, dollarImpact }`; `analyzePriceDiscrepancies(invoiceLines, contracts)` for batch
- Create: `lib/contracts/__tests__/price-variance.test.ts`
- Modify: `prisma/schema.prisma` — `InvoicePriceVariance` model (landed in subsystem 0)
- Modify: `lib/actions/invoices.ts` — on invoice line save, compute variance against matching `ContractPricing` row, upsert `InvoicePriceVariance`
- Modify: `components/facility/contracts/contract-score-client.tsx` — add "Price Variance" card to pricing-competitiveness score dimension
- Modify: `components/contracts/contract-detail-client.tsx` — "Price Anomalies" mini-table with top 5 overcharges

**Approach:** Severity thresholds from spec (±2% minor / ±5% moderate / ±10% major). Variance computed on line save, not at read time, so score page renders from cached `InvoicePriceVariance` rows.

**Acceptance:**
- Line with $105 actual vs $100 contract: 5% overcharge, moderate severity, $5 impact
- Score page shows variance count + total overcharge dollars on pricing score card

**Plan detail:** On-demand — `05-price-variance-plan.md`.

---

### Subsystem 6 — True margin analysis (P1)

**Priority:** P1
**Spec reference:** Section 7 (True Margin Analysis)
**Why:** Score page needs to show "contract improves procedure margin by X%". Today: no margin math.

**Files:**
- Create: `lib/contracts/true-margin.ts` — `allocateRebatesToProcedures(procedures, vendorSpend, vendorRebates)`; `calculateMargins(procedure, costs, rebateAllocation)` returns `{ standardMargin, trueMargin, rebateContribution }`
- Create: `lib/contracts/__tests__/true-margin.test.ts`
- Modify: `components/facility/contracts/contract-score-client.tsx` — add "True Margin" card to volume-alignment score dimension; mini bar chart of top procedures by margin improvement
- Modify: `lib/actions/contracts.ts` — `getTrueMarginForContract(contractId)` server action joining contract → vendor → surgeon-usage → procedure

**Approach:** Proportional allocation — procedure receives rebate share equal to its share of vendor spend. Pure calculation; slow query lives in the action, cached via TanStack Query.

**Acceptance:**
- Procedure using $10K of vendor X's $100K annual spend, $5K rebate: receives $500 allocation; standardMargin and trueMargin both computed
- Score page renders top 5 procedures by rebate contribution

**Plan detail:** On-demand — `06-true-margin-plan.md`.

---

### Subsystem 7 — Tie-in contract engine (P0 — TIE-IN IS A STUB)

**Priority:** P0
**Spec reference:** Section 4 (Tie-In Contract Calculations — all subsections)
**Why:** Schema has `Contract.tieInCapitalContractId` (single link) — no bundle table, no compliance engine, no UI. `contractType === 'tie_in'` is accepted by the form but downstream calculations ignore it. Prototype implements full bundle rebate math.

**Files:**
- Create: `lib/contracts/tie-in.ts` — `calculateTieInCompliance_AllOrNothing(bundle, memberSpends)`, `calculateTieInCompliance_Proportional(bundle, memberSpends)`, `calculateCrossVendorTieIn(bundle, memberSpends, facilityTotal)`
- Create: `lib/contracts/__tests__/tie-in.test.ts`
- Modify: `prisma/schema.prisma` — `TieInBundle`, `TieInBundleMember` models (landed in subsystem 0)
- Modify: `lib/actions/contracts.ts` — `getTieInBundle(contractId)`, `updateTieInBundle(...)`, `evaluateTieInCompliance(bundleId)`
- Create: `components/facility/contracts/tie-in-bundle-editor.tsx` — multi-contract picker with weight + minimum-spend inputs per member
- Modify: `components/facility/contracts/contract-create-client.tsx` — when `contractType === 'tie_in'` is chosen, render bundle editor
- Modify: `components/contracts/contract-detail-client.tsx` — when contract is bundle primary, show member list + compliance status badge per member + bundle total rebate

**Approach:** Bundle is its own table (1 primary + N members, with mode + weights). Engine is pure; server actions load spends for each member contract over the evaluation window and call the engine.

**Acceptance:**
- Bundle with 3 members, all-or-nothing mode, one member below minimum: compliance status = `non_compliant`, bonus = 0
- Bundle with proportional mode, weights {50%, 30%, 20%}, compliance per member {100%, 50%, 80%}: weighted compliance = 82%
- Cross-vendor bundle with all vendors compliant triggers facility bonus per spec section 4.3

**Plan detail:** On-demand — `07-tie-in-plan.md`.

---

### Subsystem 8 — Contracts page UX polish (P1 + P2)

**Priority:** P1 for compare mode + amendment flow + entry-mode selector; P2 for facility filter, tier names, rebate-type flexibility
**Spec reference:** Prototype files under `~/Downloads/b_G9ilmDWDNaR/app/dashboard/contracts/`

**Files:**
- Modify: `components/contracts/contracts-list-client.tsx` — multi-select row state, compare action button, facility filter dropdown (populate from `useContracts` result)
- Create: `app/dashboard/contracts/compare/page.tsx` + `components/contracts/contracts-compare-client.tsx` — side-by-side comparison of 2-4 contracts (terms, tiers, rebate earned, compliance)
- Modify: `app/dashboard/contracts/new/page.tsx` + `components/facility/contracts/contract-create-client.tsx` — `entryMode: 'ai' | 'manual' | 'pdf'` selector card with three tiles; dynamic import of AI flow / manual form / PDF extractor
- Modify: `components/contracts/contract-detail-client.tsx` — multi-step amendment dialog: upload → extract (calls existing `AmendmentExtractor`) → review diff → confirm → persist as `ContractChangeProposal`
- Modify: `components/facility/contracts/contract-edit-client.tsx` — on save, trigger `recomputeAccruals` + `recomputeCompliance` (subsystems 3 + 4)
- Modify: `components/facility/contracts/contract-terms-entry.tsx` — support non-percentage rebate types (fixed, per-unit, hybrid) — spec section 2 "Rebate Types & Formulas" table

**Acceptance:**
- Select 3 contracts from list → Compare button enables → compare page shows 3 columns
- New contract page shows 3-tile entry selector; each path lands a valid contract
- Amendment flow end-to-end: upload PDF → AI extract → diff review → accept → `ContractChangeProposal` row created
- Editing a term recomputes accruals + compliance (spot-check via Prisma Studio)

**Plan detail:** On-demand — `08-ux-polish-plan.md`.

---

### Subsystem 9 — Audit fixes retrofit from unified rebate engine (P0, follow-up)

**Priority:** P0 — added 2026-04-18 after Charles's unified engine doc landed. This subsystem retrofits the 10 audit fixes [A1]-[A10] from `2026-04-18-rebate-term-types-extension.md` (now the "Unified Rebate Engine" spec) into the rebate engine shipped in subsystems 1 + 3.

**Why this is P0 despite being a follow-up:** the shipped engine has silent-wrong-number potential that the audit fixes correct. Specifically:

- **[A1]** `applyTiers` EXCLUSIVE boundary behavior — the shipped version may early-break before finding the highest qualifying tier at the boundary dollar
- **[A2]** `calculateMarginal` in `lib/contracts/rebate-method.ts` uses `Math.min(remainingSpend, bracketCapacity)` which is correct, but needs a regression test matching Charles's worked examples with non-round thresholds
- **[A4]** `calculateTierProgress` from subsystem 2 — verify `amountToNextTier` uses `totalSpend` (pre-growth-adjustment) and not the eligibleSpend variant
- **[A10]** True-up sign convention across accrual / contracts-rewrite §3 — verify positive = facility owed more

**Files:**
- Modify: `lib/rebates/calculate.ts` — internals delegate to the new `calculateRebate` dispatcher from `lib/rebates/engine/index.ts` (once shipped via the unified-engine spec subsystem 9)
- Modify: `lib/contracts/rebate-method.ts` — add [A1]-[A3] regression tests covering Charles's worked examples
- Modify: `lib/contracts/tier-progress.ts` — verify [A4] behavior with a regression test
- Modify: `lib/contracts/accrual.ts` — verify [A10] sign convention with a regression test
- Add: golden-file tests capturing current numeric outputs *before* retrofit; re-run *after* retrofit to prove no regression (except where bugs are intentionally corrected)

**Dependency:** Depends on unified-rebate-engine spec subsystems 0-9 having landed. Cannot execute standalone — the dispatcher this retrofits against doesn't exist yet.

**Acceptance:**
- All shipped engine tests still pass.
- New regression tests for [A1]-[A10] pass.
- `bun run db:seed` qa-sanity unchanged.
- `bun run build` compiles.

**Plan detail:** On-demand — `09-audit-fixes-retrofit-plan.md`. This subsystem is also tracked as subsystem 10 of the unified-rebate-engine spec — either location's plan can drive execution.

---

## 4. Execution model

**Sequencing:**

```
Subsystem 0 (schema)
  ↓
Subsystem 1 (rebate method) — unblocks 2, 3
  ↓
Subsystem 2 (tier progress)  Subsystem 3 (accruals)
           ↓                              ↓
Subsystem 4 (compliance)     Subsystem 5 (price variance)
           ↓                              ↓
Subsystem 6 (true margin)    Subsystem 7 (tie-in)
                              ↓
                       Subsystem 8 (UX polish)
```

Subsystems 2–3, 4–5, 6–7 can run in parallel (different files, no shared state within a layer). Subsystem 8 lands last because it wires every prior engine into the UI.

**Per-subsystem cadence (applies to every one):**

1. Generate per-subsystem TDD plan file on demand (`docs/superpowers/plans/2026-04-18-contracts-rewrite-NN-<name>-plan.md`) — I run superpowers:writing-plans for each when you're ready to execute it.
2. Create worktree via superpowers:using-git-worktrees.
3. Execute via superpowers:subagent-driven-development (one fresh subagent per task, review between).
4. Run verification per "Acceptance" for that subsystem — REQUIRED SUB-SKILL: superpowers:verification-before-completion.
5. Code review via superpowers:code-reviewer before merge.
6. Merge to `main`, delete worktree.

**Global verification (run after every subsystem merges):**

```bash
bunx tsc --noEmit           # 0 errors
bun run lint                # 0 new errors
bun run test                # all pass
bun run build               # all routes emit
docker compose up -d && bun run db:push && bun run dev  # smoke test affected pages
```

---

## 5. Acceptance (whole rewrite)

- All 6 contract pages render correct numbers against seeded data (verify via Prisma Studio → page render round-trip).
- Both spec worked examples (cumulative $2,250 and marginal $3,500) pass in `rebate-method.test.ts`.
- All spec sections 2–7 have a test file + implementation; section 8 (surgeon scorecards) explicitly deferred.
- Zero new TypeScript errors in `bunx tsc --noEmit`.
- Smoke test: demo-facility@tydei.com session, visit all 6 pages, no console errors, all numbers render.
- `docs/v0-feature-ledger.md` tripwire passes (no feature regressions flagged by dom-diff).

---

## 6. Known risks

1. **Prisma migration on existing seeded data.** Mitigation: migration is additive-only; backfill `rebateMethod = 'cumulative'` preserves today's behavior exactly.
2. **Recompute storm on term save.** Editing a term triggers `recomputeAccruals` + `recomputeCompliance`; for a contract with 36 months of accrual history, that's ~40 writes. Mitigation: wrap in transaction, measure, add background job if p95 > 2s (out of scope for initial ship; acceptable for demo-scale).
3. **Tie-in bundle orphan cleanup.** If the primary contract of a bundle is deleted, bundle becomes dangling. Mitigation: `onDelete: Cascade` on `TieInBundle.primaryContractId` in the migration.
4. **Method switching on a contract with historical accruals.** If a user flips cumulative ↔ marginal mid-year, historical accrual rows are now wrong. Mitigation: subsystem 3's `recomputeAccruals` detects method change and rewrites from scratch.

---

## 7. Out of scope (explicitly deferred)

- Spec section 8 (Surgeon Scorecard) — separate case-costing initiative.
- Spec section 9 (Contract Performance Metrics dashboard) — covered by existing `/dashboard/analysis`.
- Spec section 10 (Alert Triggers) — existing alerts subsystem; enhancements tracked separately.
- Spec section 11 (Admin Time Savings) — marketing metric; no engineering work.
- Vendor-portal equivalent pages (`/vendor/contracts/*`) — mirror after this lands.
- Playwright visual-diff CI gates for contract pages — follow-up once subsystems 1–7 stabilize.

---

## 8. How to iterate

1. Pick a subsystem from the priority-ordered list.
2. Ask me to generate its detailed per-subsystem plan via superpowers:writing-plans.
3. Create worktree, execute per plan.
4. Verify, review, merge, proceed to next subsystem.

Per-subsystem plans land in `docs/superpowers/plans/` as they're generated. This design spec stays as the anchor doc.
