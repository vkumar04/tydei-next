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

---

## 9. v0 Parity Gaps

Source: 2026-04-19 audit of v0 prototype at `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/`.
These subsystems are **additive** to sections 1-8 above — they capture user-facing v0
behavior that isn't already covered by the original engine subsystems 1-7. Some items
are blocked by those engines landing first; dependencies are noted per entry.

Sequencing groups these into 3 waves (see `docs/superpowers/plans/` once generated):
- **Wave 1** (no engine deps): 9.1, 9.2, 9.5, 9.11
- **Wave 2** (standalone workflows): 9.4, 9.6, 9.7, 9.8, 9.12
- **Wave 3** (engine-dependent / nice-to-have): 9.3, 9.9, 9.10

### Subsystem 9.1 — Compare modal wired to "Compare (N)" button

**Priority:** P1 (visible UX gap)

**Why this exists:** v0's contracts list lets the user multi-select contracts and view
them side-by-side. Tydei has the modal component (`components/contracts/compare-modal.tsx`,
shipped commit `dc26a37`) but the button on the list page renders only inside the
Compare tab — selecting contracts from the main list and getting to the modal isn't
obvious. v0 puts the action inline next to each row.

**v0 reference:** `app/dashboard/contracts/page.tsx` line ~440 — `GitCompare` icon
trigger on each row + compare-mode toggle.

**Files (tydei):**
- Modify: `components/contracts/contracts-list-client.tsx` — surface a sticky
  "Compare (N)" toolbar at the top of the list whenever ≥2 rows are selected, in
  addition to the existing in-tab button.
- Modify: `components/contracts/contract-columns.tsx` — add a per-row checkbox
  column (currently selection lives only in the Compare tab).
- Test: `components/contracts/__tests__/compare-rows.test.ts` — already exists,
  no test additions required.

**Approach:**
1. Add a `selection` column to the column defs with a Checkbox bound to
   `selectedForCompare` state.
2. Lift `selectedForCompare` to the list client root (it's already there).
3. Render a sticky toolbar above the table that's visible when
   `selectedForCompare.length >= 2`, with the same `Compare (N)` button + a
   `Clear selection` button.

**Acceptance:**
- Selecting 2+ rows on the All Contracts tab shows a sticky "Compare" toolbar.
- Clicking it opens the existing `<CompareModal />` populated with the picks.
- Test: `bunx vitest run components/contracts/__tests__/compare-rows.test.ts` passes.
- Type check: `bunx tsc --noEmit` clean.

**Known risks:**
- Existing contract-columns is shared across multiple list views; selection column
  may bleed into the Compare tab inappropriately. Gate behind a `selectable: boolean`
  prop on the columns helper.
- Sticky toolbar competing with the existing filter bar — z-index ordering.

**Dependencies:** none.

---

### Subsystem 9.2 — 3-way facility scope filter (this / all / shared)

**Priority:** P1

**Why this exists:** v0 lets the user toggle list scope across "this facility",
"all I have access to", and "shared / multi-facility contracts only". Tydei's
list ships single-facility scope only.

**v0 reference:** `app/dashboard/contracts/page.tsx` lines 71-78 — radio toggle
with the three modes wired to the contracts query.

**Files (tydei):**
- Modify: `lib/validators/contracts.ts` — extend `ContractFilters` with
  `facilityScope: z.enum(["this", "all", "shared"]).optional().default("this")`.
- Modify: `lib/actions/contracts.ts::getContracts` — branch the `where` clause:
  - `this`: existing `contractsOwnedByFacility(facility.id)`
  - `all`: drop the facility filter (auth still required, cross-facility view)
  - `shared`: `{isMultiFacility: true, OR: [{facilityId: facility.id}, {contractFacilities: {some: {facilityId: facility.id}}}]}`
- Modify: `components/contracts/contracts-list-client.tsx` — Tabs/RadioGroup
  above the filter bar bound to a `facilityScope` URL param.
- Test: new `lib/actions/__tests__/get-contracts-scope.test.ts` — three cases
  (this / all / shared), mocked prisma.

**Approach:**
1. Schema-side validator + action change first (TDD: write the action test).
2. UI radio wired to URL param + TanStack Query key (so refresh preserves state).
3. Default selection "this" — matches today's behavior.

**Acceptance:**
- Toggling the radio re-runs the contracts query with the new scope.
- "this" returns the current owned set (regression check).
- "shared" returns only `isMultiFacility=true` rows the facility participates in.
- "all" returns every contract the user can see.
- Test: `bunx vitest run lib/actions/__tests__/get-contracts-scope.test.ts` passes (3 cases).

**Known risks:**
- "all" must still respect auth — a facility user shouldn't see *every* contract
  in the system, only ones they can read. Confirm with `requireFacility()` first
  and verify the `where` doesn't accidentally leak.

**Dependencies:** none.

---

### Subsystem 9.3 — PDF entry-mode tab + preview-before-save on contract create

**Priority:** P2

**Why this exists:** v0's create page exposes three explicit entry modes
(Manual | PDF | Paste). Tydei has the PDF/AI extraction wired, but the user
arrives on Manual by default and must discover the AI button. v0's UX flips
the default — PDF first, with a preview step.

**v0 reference:** `app/dashboard/contracts/new/page.tsx` lines 1-50 — three-tab
selector + dedicated review pane.

**Files (tydei):**
- Modify: `components/contracts/new-contract-client.tsx` — promote the entry-mode
  Tabs (currently exists but not the landing surface). Default tab = `pdf`.
- Modify: `components/contracts/ai-extract-dialog.tsx` — surface the parsed
  contract preview *inside* the page (not a modal) so the user can edit before
  hitting Save.
- Test: `components/contracts/__tests__/new-contract-tab-routing.test.tsx` —
  asserts default tab + that AI extract no longer routes to manual.

**Approach:**
1. Set `entryMode` initial state to `"pdf"`.
2. Move the `<AIExtractDialog>` content into an inline panel rendered when
   `entryMode === "pdf"`.
3. After extraction, populate the form fields and stay on the PDF tab with an
   editable preview card.

**Acceptance:**
- `/dashboard/contracts/new` lands on the PDF tab.
- Uploading a PDF runs extraction and populates the form *inline* without
  bouncing to Manual.
- Test passes.

**Known risks:**
- Existing users have muscle memory for Manual default — soft-launch with a
  feature flag if any production users complain.

**Dependencies:** none.

---

### Subsystem 9.4 — Off-contract spend panel

**Priority:** P1

**Why this exists:** v0's contract detail surfaces "off-contract spend" — the
$ amount of vendor purchases that *didn't* match this contract. Today, tydei
shows on-contract spend only; the user can't see leakage at the contract level.

**v0 reference:** `app/dashboard/contracts/[id]/page.tsx` lines ~650-700.

**Files (tydei):**
- Create: `lib/actions/contracts/off-contract-spend.ts` — server action
  returning `{onContract: number, offContract: number, offContractItems: Array<{vendorItemNo, description, totalSpend}>}` for a contract.
- Create: `components/contracts/off-contract-spend-card.tsx` — Card with the
  two totals + a top-10 list of off-contract items.
- Modify: `components/contracts/contract-detail-client.tsx` — render the card
  on the Overview tab below the existing performance section.
- Test: `lib/actions/contracts/__tests__/off-contract-spend.test.ts` — mocked
  prisma covering all-on / all-off / mixed cases.

**Approach:**
1. Aggregate `prisma.cOGRecord` for the contract's vendor at this facility,
   grouped by `isOnContract` flag.
2. For off-contract rows, group by `vendorItemNo` and pick the top 10 by spend.
3. Card renders both totals + the top-10 table. Empty state when off-contract
   total is 0.

**Acceptance:**
- Card visible on contract Overview tab when COG records exist.
- Numbers match `prisma.cOGRecord.aggregate({where:{contractId},_sum:{extendedPrice}})`
  (on-contract) and the inverse (off-contract).
- Empty state when contract has zero COG matches.
- Test passes.

**Known risks:**
- "Off-contract" requires COG enrichment to have run (`backfillCOGEnrichment`).
  Pre-enrichment, every record is `isOnContract=false`. Document this in the
  card's empty state.

**Dependencies:** Subsystem 4 (compliance engine) shares the matcher; this can
land independently using existing `isOnContract` flag.

---

### Subsystem 9.5 — Market-share progress bar (current vs commitment)

**Priority:** P1

**Why this exists:** Schema has `Contract.currentMarketShare` and
`marketShareCommitment` (both `Decimal?`); UI surfaces neither. v0 shows a
progress bar on the contract detail with the % met.

**v0 reference:** `app/dashboard/contracts/[id]/page.tsx` lines ~520-540.

**Files (tydei):**
- Modify: `components/contracts/contract-detail-client.tsx` — render a
  Card below "Commitment Progress" when both fields are non-null. Use the
  existing shadcn `Progress` (already imported).
- Test: visual smoke only (no new test — the rendering is trivial).

**Approach:**
1. Conditional Card with the two numbers + a Progress bar
   `(currentMarketShare / marketShareCommitment) * 100`.
2. Color the bar emerald when ≥80%, amber 60-80%, red <60% — matches the
   compliance card pattern from commit `122c7a3`.

**Acceptance:**
- Card renders when both fields populated.
- Card hidden when either is null (no broken state).
- Type check clean.

**Known risks:** none.

**Dependencies:** none.

---

### Subsystem 9.6 — Contract-period selector for multi-year contracts

**Priority:** P2

**Why this exists:** Multi-year contracts have multiple `ContractPeriod` rows;
v0 shows a dropdown on the detail page so the user can scope the displayed
metrics to a specific period. Today tydei always shows aggregated totals.

**v0 reference:** `app/dashboard/contracts/[id]/page.tsx` lines ~450-480.

**Files (tydei):**
- Modify: `components/contracts/contract-detail-client.tsx` — add a
  period-selector `<Select>` above the metrics row when
  `contract.periods.length >= 2`. Default = "All periods".
- Modify: relevant data-fetching hooks (e.g. `useContract`,
  `getContractMetricsBatch` consumer) to accept an optional `periodId` filter.
- Modify: `lib/actions/contracts.ts::getContract` — when `periodId` is provided,
  limit the included `rebates` and `cogRecords` queries to that period's date
  range.
- Test: new test asserting period-scoped totals match unscoped totals when
  "All periods" is selected.

**Approach:**
1. Read `prisma.contractPeriod.findMany({where:{contractId}, orderBy:{periodStart:"asc"}})`
   in `getContract` (likely already loaded; verify).
2. Plumb `periodId` through the relevant queries.
3. UI selector + state + URL param.

**Acceptance:**
- Selector visible only on multi-period contracts.
- Choosing a period filters the displayed totals to its date range.
- "All periods" returns to current behavior.

**Known risks:**
- `Rebate.payPeriodStart`/`payPeriodEnd` may not align cleanly with
  `ContractPeriod.periodStart`/`periodEnd` — pick a join convention upfront
  (e.g. include rebate when `payPeriodEnd` falls within the period).

**Dependencies:** none.

---

### Subsystem 9.7 — Amendment multi-step flow integration

**Priority:** P2

**Why this exists:** v0 wraps amendment uploads in a 4-stage modal
(Upload → Review changes → Pricing updates → Confirm). Tydei has
`<AmendmentExtractor>` (commit `3e3ad63` verified the 4 stages exist) but the
trigger from the contract detail page lands on the upload step only — the
review/pricing/confirm flow needs end-to-end smoke testing and the "Add
Amendment" button placement should match v0.

**v0 reference:** `app/dashboard/contracts/[id]/page.tsx` lines ~70-82 +
`components/contracts/amendment-extractor.tsx`.

**Files (tydei):**
- Modify: `components/contracts/contract-detail-client.tsx` — confirm the
  `<AmendmentExtractor>` is wired with `onApplied` invalidating the contract
  query, and the entry button sits next to "Edit Contract" (currently it
  exists but copy may differ).
- Modify: `components/contracts/amendment-extractor.tsx` — add a stage
  indicator (1 → 2 → 3 → 4) header so the user knows where they are.
- Test: end-to-end smoke of the 4 stages with a mock PDF (no AI call —
  use `getDemoExtractedData` shape directly... oh wait, that file's been
  removed. Use a fixture JSON in tests.)

**Approach:**
1. Add stage breadcrumb to the dialog header.
2. Verify each stage transition wires `onChangeStage` correctly.
3. Add a Vitest test feeding a fixture extraction JSON and asserting all 4
   stages render their expected components.

**Acceptance:**
- Stage indicator visible at the top of the dialog.
- Test asserting 4-stage progression passes.
- "Add Amendment" button placement matches v0.

**Known risks:**
- AI extraction failures should still leave the user at stage 1 with a clear
  error, not an empty stage 2.

**Dependencies:** none.

---

### Subsystem 9.8 — ContractChangeProposal workflow

**Priority:** P1

**Why this exists:** Schema has `ContractChangeProposal` (vendor proposes an
edit, facility reviews). UI is missing — vendors can't submit changes today,
and facilities have no "review proposed changes" surface. v0 has it via
localStorage but the workflow concept is the same.

**v0 reference:** `lib/contract-change-proposals-store.ts` (CRUD store) +
`app/dashboard/contracts/[id]/page.tsx` lines ~500+ (approve/reject/revision
buttons on the facility side).

**Files (tydei):**
- Create: `lib/actions/contracts/proposals.ts` — three server actions:
  `submitContractChangeProposal(contractId, changes, notes)` (vendor),
  `approveContractChangeProposal(proposalId)` (facility — applies changes),
  `requestProposalRevision(proposalId, notes)` (facility — sends back),
  `rejectContractChangeProposal(proposalId, notes)` (facility).
- Create: `components/contracts/contract-change-proposals-card.tsx` — visible
  on contract detail when proposals exist for the contract; shows pending
  count + per-proposal review row.
- Modify: vendor edit flow to wrap an edit in a proposal submission.
- Modify: `components/contracts/contract-detail-client.tsx` — render the new
  card above the Overview tab when `pendingProposals.length > 0`.
- Test: `lib/actions/contracts/__tests__/proposals.test.ts` — cover submit /
  approve (verifies fields applied) / revise / reject paths with mocked prisma.

**Approach:**
1. Server actions first, with Vitest TDD covering the four flows.
2. Facility detail page: query `getPendingProposalsForContract(contractId)` +
   render the review card.
3. Vendor edit: out of scope per "no vendor for now" — leave a TODO note in
   the spec so the schema-side server actions exist when vendor work resumes.

**Acceptance:**
- Submit creates a `ContractChangeProposal` row with `status=pending`.
- Approve flips status to `approved` and applies the change to the contract.
- Revise flips status to `needs_revision` and stores the revision notes.
- Reject flips status to `rejected`.
- Facility detail page shows pending proposals with action buttons.
- Tests pass.

**Known risks:**
- "Apply" must compose well with existing `updateContract` validation —
  reuse the validator instead of bypassing it.
- Approving may race against another approval; use Prisma transaction.

**Dependencies:** none on the facility side. Vendor submission UI deferred
until vendor portal work resumes.

---

### Subsystem 9.9 — Industry benchmarks radar on score page

**Priority:** P2

**Why this exists:** v0's score page overlays a peer-hospital benchmark on the
radar so the user can see "your contract scores 82, peer median is 75". Tydei
has only the rule-based radar (commit `4f011d1`) — no benchmark comparison.

**v0 reference:** `app/dashboard/contracts/[id]/score/page.tsx` lines 51-52
+ `getIndustryBenchmarks()` / `isIndustryBenchmarksImported()`.

**Files (tydei):**
- Decide: ship a static seed benchmark file vs a new `IndustryBenchmark` Prisma
  model. **Recommend static seed first** at `lib/contracts/score-benchmarks.ts`
  (median per dimension by contract type) — promote to DB when real data
  arrives.
- Modify: `components/contracts/contract-score-radar.tsx` — accept an optional
  `benchmark` prop; render a second translucent Radar series.
- Modify: `app/dashboard/contracts/[id]/score/page.tsx` — pass a benchmark
  lookup based on `contract.contractType`.
- Test: `lib/contracts/__tests__/score-benchmarks.test.ts` — assert lookup
  returns the right shape for each contract type.

**Approach:**
1. Static seed first — get the visualization in front of users; iterate on
   data sourcing later.
2. Lookup function takes `contractType`, returns the same `components` shape
   as `ContractScoreResult`.
3. Render two-series radar with legend.

**Acceptance:**
- Score page radar shows two overlaid series (this contract vs peer median).
- Legend identifies which is which.
- Test passes.

**Known risks:**
- Seed values are placeholders — make that explicit in the radar tooltip
  ("Peer median based on aggregated industry data — placeholder until real
  benchmarks ingested").

**Dependencies:** none.

---

### Subsystem 9.10 — 6th score dimension (extend `ContractScoreResult.components`)

**Priority:** P2

**Why this exists:** v0 score has 6 axes; tydei's rule-based scorer
(`lib/contracts/scoring.ts`) returns 5 components today
(`commitmentScore / complianceScore / rebateEfficiencyScore / timelinessScore
/ varianceScore`). The 6th axis in v0 is a **price competitiveness** score
(actual prices vs market median).

**v0 reference:** v0 page derives 6 dimensions from contract + benchmark data.

**Files (tydei):**
- Modify: `lib/contracts/scoring.ts` — add `priceCompetitivenessScore: number`
  to `ContractScoreResult["components"]`. Initial implementation: 100 - average
  positive variance % across the contract's invoice line items, clamped 0-100.
- Modify: `lib/actions/contracts/scoring.ts::loadAndScoreContract` — query
  `prisma.invoicePriceVariance` for the contract and feed the average to
  `calculateContractScore`.
- Modify: `components/contracts/contract-score-radar.tsx` — add the 6th axis.
- Test: `lib/contracts/__tests__/scoring.test.ts` — add cases for the new
  component.

**Approach:**
1. Engine change first (TDD).
2. Score-loading action plumbing.
3. Radar UI updates automatically (driven by the components map).

**Acceptance:**
- `ContractScoreResult.components` returns 6 keys.
- Radar shows 6 axes.
- Engine tests cover happy path + zero-variance + heavy-overcharge cases.

**Known risks:**
- `InvoicePriceVariance` may be empty for many contracts (variance engine still
  lands per Subsystem 5). Default to 100 when no variance data — better than
  punishing contracts that haven't been audited yet.

**Dependencies:** Subsystem 5 (price variance engine) for real signal.
Pre-engine, falls back to default-100.

---

### Subsystem 9.11 — `lib/contract-definitions.ts` centralized tooltips

**Priority:** P2

**Why this exists:** v0 centralizes term/rebate/tier definitions in one file
that powers tooltips across the contracts surface. Tydei has the same labels
inlined in components — drift risk.

**v0 reference:** `lib/contract-definitions.ts` + `components/contracts/definition-tooltip.tsx`.

**Files (tydei):**
- Create: `lib/contract-definitions.ts` — exports
  `CONTRACT_TYPE_DEFINITIONS`, `REBATE_TYPE_DEFINITIONS`,
  `TIER_STRUCTURE_DEFINITIONS`, `PERFORMANCE_PERIOD_DEFINITIONS` as readonly
  records keyed by enum value.
- Create: `components/contracts/definition-tooltip.tsx` — small wrapper that
  renders a `?` icon + Tooltip with the matched definition.
- Modify: existing form components to consume the constants instead of
  inlined strings.
- Test: `lib/contracts/__tests__/contract-definitions.test.ts` — assert every
  Prisma enum value has a definition entry (catches drift when new term types
  ship).

**Approach:**
1. Extract every inline term-type/rebate-type description from
   `components/contracts/contract-terms-entry.tsx` and similar.
2. Move into the new constants file.
3. Replace inline strings with constant lookups + tooltips.
4. Test asserts coverage.

**Acceptance:**
- Every TermType / RebateType enum value has a definition entry.
- Tooltips render on hover next to the field labels.
- Adding a new enum value without a definition fails the coverage test.

**Known risks:**
- Coverage test must import the Prisma enum at runtime to enumerate values —
  use `Object.values(TermType)` from `@prisma/client`.

**Dependencies:** none.

---

### Subsystem 9.12 — Multi-category audit & fixes

**Priority:** P1

**Why this exists:** Architecture supports multi-category (
`ContractProductCategory` join + `categoryIds` validator + Popover checkbox UI
+ create/update actions persist all ids). User feedback says "feels like one
at a time." Audit each surface that may consume only the primary
`productCategory`:

1. **List filter** — does the category filter dropdown match contracts whose
   *any* category contains the pick, or only the primary `productCategoryId`?
2. **Per-tier scope** (`contract-terms-entry.tsx`) — currently single-select
   when `appliesTo === "specific_category"`. v0 (per spec preface) is the
   same, but multi-select would be more useful for terms scoped to multiple
   categories.
3. **AI extraction** — when the model returns multiple categories from a PDF,
   does `handleAIExtract` populate the multi-select correctly, or only the
   first match?
4. **Pricing-file extraction** — auto-merge categories from pricing rows into
   the form's `categoryIds` (v0 does this at lines 466-484 of
   `new/page.tsx`).
5. **Detail page badges** — already shipped (Bug 7, commit `8607b50`);
   regression-check this still works after wave-1 churn.

**v0 reference:** `app/dashboard/contracts/new/page.tsx` lines 116-126
(extract unique categories from pricing file) and 466-484 (match
multi-categories from PDF extraction).

**Files (tydei):**
- Audit: `components/contracts/contracts-list-client.tsx` filter logic —
  modify to match against any category in `contract.contractCategories[]`.
- Audit + fix: `components/contracts/contract-terms-entry.tsx` "Specific
  Category" picker — convert to multi-select when scope = `specific_category`,
  persist `scopedCategoryIds: string[]` (validator + action change).
- Audit: `components/contracts/new-contract-client.tsx::handleAIExtract` —
  ensure it merges every extracted category into `categoryIds`.
- Audit: pricing-file upload flow — append unique categories to `categoryIds`
  on import.
- Test: extend `lib/actions/__tests__/contract-metrics-batch.test.ts` (or new
  test) — assert filtering by a non-primary category matches the contract.

**Approach:**
1. Inventory each surface listed above with a quick read pass.
2. Fix each in its own commit (small surface changes, easy to review).
3. Add tests where the fix involves a server action change.

**Acceptance:**
- List category filter matches by any category, not just primary.
- Term form's "Specific Category" picker accepts multiple.
- AI extract auto-populates all returned categories.
- Pricing-file import merges its categories into the contract.
- Detail page badges still render every category.
- Tests pass.

**Known risks:**
- Schema migration may be needed to convert
  `ContractTerm.scopedCategoryId: String?` to `scopedCategoryIds: String[]`
  (additive — keep the old column for a release or two).

**Dependencies:** none.

---
