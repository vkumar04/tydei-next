# Unified Rebate Engine — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps in those plans use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18 (revised)
**Branch:** continue in `contracts-rewrite-00-schema`
**Status:** Design approved by Vick. Supersedes the earlier `rebate-term-types-extension` spec which scoped v1 to carve_out + po_rebate only. This spec is now the **authoritative unified engine** covering all 8 rebate types from Charles's reference implementation, with the full set of audit fixes locked in.
**Brainstormed via:** superpowers:brainstorming
**Related specs:**
- Supersedes: v1 carve_out + po_rebate scope (folded into this spec)
- Required dependency: `2026-04-18-platform-data-model-reconciliation.md` (vendor resolve + facility scope)
- Referenced by: every page that displays rebate / price-reduction numbers (contracts, renewals, rebate-optimizer, case-costing, reports, dashboard)

**Goal:** Ship a single typed rebate engine covering all 8 contract structures healthcare facilities use. One `calculateRebate(config, periodData, options)` entry point. One standardized `RebateResult`. Ten documented audit fixes baked in. Supersedes the three rebate sub-engines already shipped in contracts-rewrite (subsystems 1 / 3) — those get retrofitted to use this unified engine as part of the follow-up `contracts-rewrite-09-audit-fixes` subsystem.

**Architecture:** Pure engine module `lib/rebates/engine/` containing:
- One file per rebate type (spend, volume, tier-price-reduction, market-share-rebate, market-share-price-reduction, capitated, carve-out, tie-in-capital)
- Shared utilities (`determineTier`, `calculateCumulativeRebate`, `calculateMarginalRebate`, `resolveBaseline`, `filterPurchasesByBasis`, `computePriceReductionLines`)
- Standardized `RebateResult` type + typed configs per strategy
- Dispatcher `calculateRebate` routing by `config.type`
- `buildTieInAmortizationSchedule` separately for contract-activation-time use
- Zero stateful side effects — callers pass in `PeriodData`, engine returns `RebateResult`

**Tech Stack (unchanged):** TypeScript strict, Vitest, Prisma 7 (for engine callers, not the engine itself). Engine is pure — zero Prisma imports.

---

## 1. Scope

### In scope — all 8 rebate types, fully implemented

1. **Spend Rebate** (dollar-one or growth-based; cumulative/marginal tiers; all-spend / reference-number / category / multi-category basis)
2. **Volume Rebate** (CPT-occurrence based; tiered or flat per-occurrence; growth variant)
3. **Tier-Based Price Reduction** (spend-triggered unit-price drop; retroactive or forward-only)
4. **Market Share Rebate** (vendor category share % triggers rebate; rate applied to vendor spend, not the share %)
5. **Market Share Price Reduction** (share % triggers unit-price drop)
6. **Capitated Pricing** (grouped reference numbers + period cap; optional embedded rebate + price reduction)
7. **Carve-Out** (per-reference-number rates: percent-of-spend OR fixed-per-unit)
8. **Tie-In Capital** (equipment capital cost amortized via rebate stream + true-up; shortfall bill-immediately or carry-forward)

Plus:
- Standardized `RebateResult` across all types
- `AmortizationEntry` + `buildTieInAmortizationSchedule` for contract-activation-time schedule
- Dispatcher entry point `calculateRebate(config, periodData, options)`
- Audit fixes [A1]-[A10] documented + tested

### Audit fixes baked in

- **[A1]** `determineTier` EXCLUSIVE path: scan-to-end (no early break). Always returns highest qualifying tier.
- **[A2]** `calculateMarginalRebate`: no cent-rounding. Bracket capacity = `nextMin - currentMin` exactly.
- **[A3]** `calculateMarginalRebate`: INCLUSIVE boundary handled naturally by bracket capacity.
- **[A4]** `amountToNextTier` uses `totalSpend` (pre-growth-adjustment) so alerts show real dollar distance.
- **[A5]** Volume rebate: dedup prefers `caseId + cptCode` over `purchaseDate + cptCode`; `growthAmount` unit clarified as occurrences.
- **[A6]** Market share rebate: separates % threshold lookup from dollar rebate calculation. Marginal uses proportional spend bucketing across share % brackets.
- **[A7]** Tier + market-share price reductions: removed single `effectiveUnitPrice` (meaningless across mixed prices). Added `PriceReductionLineResult[]` with per-purchase breakdown.
- **[A8]** Capitated sub-rebate: pre-filters purchases and passes `spendBasis: 'ALL_SPEND'` to sub-calculators (no double-filter).
- **[A9]** `allocateRebatesToProcedures`: guards against zero reimbursement (no NaN). Adds `priceReductionAllocation` + `totalContractBenefit` + `vendorPriceReductionAllocations`.
- **[A10]** True-up sign convention standardized: positive = facility owed more; negative = over-accrued. Across all 8 types.

### Out of scope

- **AI-narrated rebate explanations** — pure engine, no LLM. Rendering pages (rebate-optimizer, contracts) may layer AI narratives on top of engine output.
- **Persisted amortization schedule** — the engine builds the schedule; storing it is a caller concern (typically in `RebateAccrual` or a new `AmortizationSchedule` row — out of scope for the engine spec, tracked in contracts-rewrite follow-up if schema expansion needed).
- **Historical rebate backfill** under the new engine — existing `Rebate` rows keep their numbers; only new calculations route through this engine.
- **Multi-term composition** beyond the existing capitated + sub-engine pattern (e.g., spend rebate stacked with market-share bonus simultaneously). Capitated handles the one documented case; others are a future spec.

### Non-goals (preserved)

- No Prisma imports in the engine. Zero stateful side effects.
- No new schema. Callers map `ContractTerm` / `ContractTier` rows to `RebateConfig` and pass in.

---

## 2. Translation notes

| Canonical (Charles's doc) pattern | Tydei-adapted equivalent |
|---|---|
| In-memory `PurchaseRecord[]` | Same shape; populated by server action from Prisma (COG records + case supplies + PO lines) |
| `PeriodData` with `priorAccruals / priorYearActualSpend / totalCategorySpend` | Same shape; callers precompute these from `ContractPeriod`, `RebateAccrual`, and cross-vendor COG aggregates |
| `RebateConfig` discriminated union | Same; callers map `ContractTerm.termType` + tiers + fields to the appropriate config shape |
| `calculateRebate` entry point | Same; lives in `lib/rebates/engine/index.ts` and replaces the old `computeRebateFromPrismaTiers` facade. `computeRebateFromPrismaTiers` stays as a backward-compat wrapper that builds a `SpendRebateConfig` from the term + calls the unified engine. |
| Charles's example `contractPrice` threshold field | Tydei's `ContractTier` already has `spendMin`/`rebateValue`; extras like `reducedPrice` / `priceReductionPercent` / `fixedRebateAmount` are additive on `ContractTier` (schema addition in subsystem 0) |
| Charles's `ContractPricingLookup` | Overlaps with our `ContractPricing` table + `COGRecord.contractPrice` enrichment (COG rewrite subsystem 0); engine just accepts the shape, doesn't care about storage |

---

## 3. Data model changes

**Small additive extensions to `ContractTier`** so terms can express the full engine's capabilities:

```prisma
model ContractTier {
  // ... existing fields (termId, tierNumber, tierName, spendMin, spendMax,
  //                     rebateType, rebateValue, etc.)

  // Engine additions (all nullable / defaulted):
  fixedRebateAmount      Decimal? @db.Decimal(14, 2)   // fixed-dollar rebate at this tier
  reducedPrice           Decimal? @db.Decimal(12, 4)   // absolute reduced unit price
  priceReductionPercent  Decimal? @db.Decimal(5, 4)    // decimal (0.10 = 10% off)
}
```

**Small additive extension to `ContractTerm`** to carry the boundary rule + capitated config shape:

```prisma
enum TierBoundaryRule {
  exclusive                   // boundary dollar belongs to HIGHER tier
  inclusive                   // boundary dollar belongs to LOWER tier
}

enum PriceReductionTrigger {
  retroactive
  forward_only
}

enum TrueUpShortfallHandling {
  bill_immediately
  carry_forward
}

model ContractTerm {
  // ... existing (rebateMethod, termType, etc.)

  boundaryRule           TierBoundaryRule?        // for tiered terms
  priceReductionTrigger  PriceReductionTrigger?   // for price-reduction terms
  shortfallHandling      TrueUpShortfallHandling? // for tie-in-capital terms
  negotiatedBaseline     Decimal? @db.Decimal(14, 2)  // for growth-based spend/volume
  growthOnly             Boolean  @default(false)
  periodCap              Decimal? @db.Decimal(14, 2)  // for capitated
  fixedRebatePerOccurrence Decimal? @db.Decimal(12, 2)  // for volume
  capitalCost            Decimal? @db.Decimal(14, 2)  // for tie-in-capital
  interestRate           Decimal? @db.Decimal(6, 4)   // for tie-in-capital
  termMonths             Int?                          // for tie-in-capital
  cptCodes               String[] @default([])         // for volume
  groupedReferenceNumbers String[] @default([])        // for capitated
  referenceNumbers       String[] @default([])         // for reference-number-basis terms
  categories             String[] @default([])         // for category-basis terms
  marketShareVendorId    String?                       // for market-share terms
  marketShareCategory    String?                       // for market-share terms
}
```

**New model `ContractAmortizationSchedule`** — optional, persists the schedule output of `buildTieInAmortizationSchedule` for audit + true-up:

```prisma
model ContractAmortizationSchedule {
  id          String   @id @default(cuid())
  contractId  String
  termId      String
  periodNumber Int
  openingBalance Decimal @db.Decimal(14, 2)
  interestCharge Decimal @db.Decimal(14, 2)
  principalDue   Decimal @db.Decimal(14, 2)
  amortizationDue Decimal @db.Decimal(14, 2)
  closingBalance Decimal @db.Decimal(14, 2)

  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)
  term     ContractTerm @relation(fields: [termId], references: [id], onDelete: Cascade)

  @@unique([termId, periodNumber])
  @@map("contract_amortization_schedule")
}
```

All schema changes are additive + nullable-default. Existing contracts continue to work via the backward-compat `computeRebateFromPrismaTiers` wrapper.

---

## 4. Subsystems — priority-ordered

### Subsystem 0 — Engine scaffolding + types + schema migration (P0)

**Priority:** P0 — blocks every engine subsystem.

**Files:**
- Modify: `prisma/schema.prisma` — new enums (TierBoundaryRule, PriceReductionTrigger, TrueUpShortfallHandling); additive fields on ContractTier + ContractTerm; new ContractAmortizationSchedule model
- Create: `lib/rebates/engine/types.ts` — all TypeScript interfaces (RebateType enum, TierMethod, TierBoundaryRule, BaselineType, SpendBasis, RebateTier, 8 config types, PurchaseRecord, PeriodData, TierResult, PriceReductionLineResult, CarveOutLineResult, RebateResult, AmortizationEntry, EngineOptions)
- Create: `lib/rebates/engine/index.ts` — `calculateRebate(config, periodData, options)` dispatcher (stub — filled in by subsequent subsystems)
- Create: `lib/rebates/engine/__tests__/types.test.ts` — type-level smoke tests

**Acceptance:**
- `bunx prisma validate` → valid
- `bun run db:push` → in sync, zero data-loss warnings
- `bunx prisma generate` → Zod types regenerate
- Dispatcher compiles; returns zero-rebate `RebateResult` with `errors: ["Unknown config type"]` for unhandled types
- `bunx tsc --noEmit` → 0 errors

**Plan detail:** On-demand — `00-types-scaffolding-plan.md`.

---

### Subsystem 1 — Shared utilities (P0)

**Priority:** P0.

**Files:**
- Create: `lib/rebates/engine/shared/sort-tiers.ts` — `sortTiersAscending`
- Create: `lib/rebates/engine/shared/determine-tier.ts` — `determineTier(value, tiers, boundaryRule)` with **[A1]** fix
- Create: `lib/rebates/engine/shared/cumulative.ts` — `calculateCumulativeRebate`
- Create: `lib/rebates/engine/shared/marginal.ts` — `calculateMarginalRebate` with **[A2]** no cent-rounding + **[A3]** INCLUSIVE natural handling
- Create: `lib/rebates/engine/shared/baseline.ts` — `resolveBaseline` with warning-on-missing behavior
- Create: `lib/rebates/engine/shared/filter-basis.ts` — `filterPurchasesByBasis` for ALL_SPEND / REFERENCE_NUMBER / PRODUCT_CATEGORY / MULTI_CATEGORY
- Create: `lib/rebates/engine/shared/price-reduction-lines.ts` — `computePriceReductionLines(purchases, tier)` returning `PriceReductionLineResult[]` ([A7])
- Create: `lib/rebates/engine/shared/tier-result.ts` — `buildTierResult`
- Create: `lib/rebates/engine/shared/__tests__/` — one test file per utility

**Acceptance:**
- [A1] Edge-case tests for EXCLUSIVE at boundary ($50K spend, tier starts at $50K → tier 2)
- [A2] Marginal with non-round thresholds ($33.33 / $66.67) produces exact bracket sums
- [A3] INCLUSIVE boundary ($50K spend, tier starts at $50K → stays in tier 1) works without special casing
- [A7] Price reduction lines return per-purchase breakdown; `effectiveUnitPrice` is per-line, not aggregate

**Plan detail:** On-demand — `01-shared-utilities-plan.md`.

---

### Subsystem 2 — Spend rebate engine (P0)

**Priority:** P0 — shipped retrofits depend on this.

**Files:**
- Create: `lib/rebates/engine/spend-rebate.ts`
- Create: `lib/rebates/engine/__tests__/spend-rebate.test.ts`

**Covers:**
- Cumulative + marginal methods
- Growth-only via PRIOR_YEAR_ACTUAL or NEGOTIATED_FIXED baseline
- Four spend bases (ALL_SPEND / REFERENCE_NUMBER / PRODUCT_CATEGORY / MULTI_CATEGORY)
- [A4] `amountToNextTier` uses `totalSpend`, not growth-adjusted spend
- [A10] Standardized true-up sign convention

**Acceptance:**
- Spec worked examples: $75K cumulative with Bronze/Silver/Gold tiers → Silver rebate
- Growth-based: $100K total, $60K baseline → rebate calculated on $40K growth spend
- `amountToNextTier` reflects real dollar distance from `totalSpend` → next threshold
- Missing baseline warns but doesn't throw

**Plan detail:** On-demand — `02-spend-rebate-plan.md`.

---

### Subsystem 3 — Volume rebate engine (P1)

**Priority:** P1.

**Files:**
- Create: `lib/rebates/engine/volume-rebate.ts`
- Create: `lib/rebates/engine/__tests__/volume-rebate.test.ts`

**Covers:**
- CPT-occurrence counting
- [A5] Dedup prefers `caseId + cptCode`; falls back to `purchaseDate + cptCode` when caseId missing
- Tier-based OR fixed-per-occurrence rebate
- Growth variant via baseline; [A5] clarifies baseline units (occurrences)

**Acceptance:**
- Same case + same CPT on multiple purchases → 1 occurrence
- Fixed-per-occurrence mode returns `occurrences × rate`; no tier lookup
- Growth: 50 occurrences this period, 30 prior → tier eval on 20 occurrences

**Plan detail:** On-demand — `03-volume-rebate-plan.md`.

---

### Subsystem 4 — Tier + market-share price reductions (P1)

**Priority:** P1.

**Files:**
- Create: `lib/rebates/engine/tier-price-reduction.ts`
- Create: `lib/rebates/engine/market-share-price-reduction.ts`
- Create: `lib/rebates/engine/__tests__/tier-price-reduction.test.ts`
- Create: `lib/rebates/engine/__tests__/market-share-price-reduction.test.ts`

**Covers:**
- Tier achieved by `totalSpend` (for tier price reduction) or `marketSharePercent` (for market-share price reduction)
- [A7] Per-line `PriceReductionLineResult[]` with `effectiveUnitPrice` computed per purchase
- FORWARD_ONLY trigger warns caller to pre-filter purchases by threshold-crossing date
- `rebateEarned` = 0 for both (price reductions aren't cash rebates); `priceReductionValue` populated

**Acceptance:**
- Mixed unit-price purchases in a single period return per-line breakdown (not a single aggregate "effective price")
- `priceReductionValue` equals sum of `totalLineReduction` across lines
- FORWARD_ONLY emits a warning on every call

**Plan detail:** On-demand — `04-price-reductions-plan.md`.

---

### Subsystem 5 — Market share rebate (P1)

**Priority:** P1.

**Files:**
- Create: `lib/rebates/engine/market-share-rebate.ts`
- Create: `lib/rebates/engine/__tests__/market-share-rebate.test.ts`

**Covers:**
- Market share % = `vendorSpend / totalCategorySpend × 100`
- [A6] Separates % threshold lookup (find tier by %) from dollar rebate calc (apply rate to `vendorSpend`, not to %)
- Cumulative: full vendorSpend × achieved rate
- Marginal: proportional bucketing across share % brackets → each bucket's proportional vendorSpend × its rate
- Error (not warning) when `totalCategorySpend` missing or zero — the number is load-bearing

**Acceptance:**
- Tier at 40% share, 45% actual, $100K vendor spend, 3% rate → $3K rebate
- Marginal tiers 20%/30%/40% with rates 1%/2%/3%, at 45% share with $100K vendor spend → bucketed rebate calculation
- Missing `totalCategorySpend` returns `RebateResult` with populated `errors`

**Plan detail:** On-demand — `05-market-share-rebate-plan.md`.

---

### Subsystem 6 — Capitated (P1)

**Priority:** P1.

**Files:**
- Create: `lib/rebates/engine/capitated.ts`
- Create: `lib/rebates/engine/__tests__/capitated.test.ts`

**Covers:**
- Group spend filter by `groupedReferenceNumbers`
- `capitatedSpend` = actual group spend; `capExceededBy` = max(0, actual - cap)
- `eligibleSpend` = min(actual, cap)
- [A8] Pre-filter purchases + pass `spendBasis: 'ALL_SPEND'` to sub-calculators (spend rebate / price reduction)
- Merges warnings from sub-engines

**Acceptance:**
- Group spend $100K / cap $80K → capExceededBy $20K, eligibleSpend $80K, warning on overage
- Sub-rebate with cumulative tiers applied to capped eligibleSpend
- Sub-price-reduction applies to filtered purchases only

**Plan detail:** On-demand — `06-capitated-plan.md`.

---

### Subsystem 7 — Carve-out (P1)

**Priority:** P1.

**Files:**
- Create: `lib/rebates/engine/carve-out.ts`
- Create: `lib/rebates/engine/__tests__/carve-out.test.ts`

**Covers:**
- Per-line config: `PERCENT_OF_SPEND` or `FIXED_PER_UNIT`
- Aggregates spend + units per `referenceNumber`
- Returns `carveOutLines` with per-line breakdown
- Warns when required field missing (rebatePercent or rebatePerUnit)

**Acceptance:**
- Three carve-out lines with mixed rate types sum correctly
- Missing field warning without throwing
- `eligibleSpend` = sum across all carve-out line spends

**Plan detail:** On-demand — `07-carve-out-plan.md`.

---

### Subsystem 8 — Tie-in capital + amortization (P1)

**Priority:** P1.

**Files:**
- Create: `lib/rebates/engine/tie-in-capital.ts`
- Create: `lib/rebates/engine/amortization.ts` — `buildTieInAmortizationSchedule(config): AmortizationEntry[]`
- Create: `lib/rebates/engine/__tests__/tie-in-capital.test.ts`
- Create: `lib/rebates/engine/__tests__/amortization.test.ts`

**Covers:**
- Full amortization schedule builder (PMT formula) for monthly/quarterly/annual periods
- Per-period true-up: `rebateEarned` vs `scheduledAmortizationDue + carriedForwardShortfall`
- `shortfallHandling`: BILL_IMMEDIATELY (warning on shortfall, caller handles billing) or CARRY_FORWARD (carry into next period)
- Nested rebate engine (spend / volume / carve-out / market-share-rebate) for earning calculation
- [A10] True-up adjustment sign convention

**Acceptance:**
- $250K capital, 5% interest, 36 months quarterly → correct periodic payment
- Spend rebate inside tie-in, $100K eligible spend, 3% rate → $3K rebate, shortfall = amortization - $3K
- CARRY_FORWARD accumulates across multiple periods
- Schedule persists to `ContractAmortizationSchedule` via the caller (not the engine)

**Plan detail:** On-demand — `08-tie-in-capital-plan.md`.

---

### Subsystem 9 — Dispatcher + entry point (P0 for final wire-up)

**Priority:** P0 — ships the unified `calculateRebate` function after all engines land.

**Files:**
- Modify: `lib/rebates/engine/index.ts` — dispatcher switches on `config.type`, routes to the 8 engine functions, returns typed `RebateResult`
- Modify: `lib/rebates/calculate.ts` (existing facade from contracts-rewrite subsystem 1) — add a `computeRebateFromPrismaTerm(term, periodData)` wrapper that builds a `RebateConfig` from a Prisma `ContractTerm` + tiers and calls `calculateRebate`
- Create: `lib/rebates/engine/__tests__/dispatcher.test.ts` — covers all 8 type routings + error case

**Acceptance:**
- Dispatcher hits every engine for its type
- Unknown type returns `RebateResult` with populated `errors`, never throws
- Backward-compat wrapper `computeRebateFromPrismaTiers` unchanged in signature; internally delegates to `calculateRebate` with a `SpendRebateConfig`

**Plan detail:** On-demand — `09-dispatcher-plan.md`.

---

### Subsystem 10 — Audit-fix retrofit into contracts-rewrite shipped engine (P0, separate follow-up)

**Priority:** P0 — fixes silent-wrong-number potential in the shipped rebate engine.

**Files:**
- Modify: `lib/rebates/calculate.ts` (existing) — replace `applyTiers` internal logic with the new dispatcher
- Modify: any call sites still using the old pattern — `lib/actions/dashboard.ts`, contracts engines from contracts-rewrite subsystems 2/3/4
- Add regression tests matching Charles's [A1]-[A10] worked examples

**Acceptance:**
- Every test that passed before the retrofit still passes after
- New tests covering the [A1]-[A10] audit cases pass
- `bun run db:seed` + qa-sanity unchanged
- `bun run build` succeeds

**Plan detail:** On-demand — `10-audit-fix-retrofit-plan.md`.

---

## 5. Execution model

**Sequencing:**

```
Subsystem 0 (schema + types + scaffolding)
  ↓
Subsystem 1 (shared utilities)
  ↓
Subsystem 2 (spend rebate)
  ↓                              ↘
Subsystem 3 (volume)  Subsystem 4 (price reductions)  Subsystem 5 (market share rebate)
  ↓                    ↓                                ↓
Subsystem 6 (capitated)  Subsystem 7 (carve-out)  Subsystem 8 (tie-in)
  ↓                       ↓                        ↓
         Subsystem 9 (dispatcher — after all engines land)
                ↓
         Subsystem 10 (audit-fix retrofit into shipped code)
```

Subsystems 3-5 and 6-8 parallelize after 2 lands.

**Per-subsystem cadence:** TDD plan → worktree → subagent-driven execution → verify → merge.

**Global verification:**

```bash
bunx tsc --noEmit
bun run lint
bun run test
bun run test lib/rebates/engine/__tests__/
bun run build
bun run db:seed
```

---

## 6. Acceptance (whole unified engine)

- All 10 subsystems merged.
- `calculateRebate(config, periodData, options)` correctly dispatches to all 8 engines.
- `buildTieInAmortizationSchedule` produces correct PMT-style schedules.
- All [A1]-[A10] audit-fix test cases pass.
- `RebateResult` populated consistently across all 8 types.
- Backward-compat `computeRebateFromPrismaTiers` unchanged signature; shipped contracts-rewrite subsystems 1-7 continue working.
- `bunx tsc --noEmit` → 0 errors.
- `bun run test` → all passing.
- `bun run db:seed` → 10/10 QA sanity passing.
- `bun run build` → compiled.

---

## 7. Known risks

1. **Retrofit regression.** Subsystem 10 changes shipped code paths. Mitigation: comprehensive regression test sweep + golden-file tests against current numeric outputs before retrofit lands.
2. **Schema migration scope.** ContractTerm gains 11 new fields; ContractTier gains 3. All nullable-default, all additive — safe, but watch for Prisma client regeneration time.
3. **Marginal market-share bucketing correctness.** [A6] is subtle. Mitigation: subsystem 5 includes 6+ worked examples with hand-computed expected values.
4. **Tie-in shortfall carry-forward correctness.** Multi-period interactions. Mitigation: subsystem 8 tests run 12 consecutive periods with mixed shortfall/surplus sequences.
5. **Sign convention drift.** [A10] fixes a potential source; platform-data-model-reconciliation's sign-convention audit already verified callers in the shipped code. Tests cover every RebateResult field's sign.
6. **Contract term → config mapping ambiguity.** A `ContractTerm` row must unambiguously map to exactly one RebateConfig type. Mitigation: `computeRebateFromPrismaTerm` has an exhaustive `termType → configType` switch; unknown combinations throw with a clear error.

---

## 8. Out of scope (explicit)

- AI narratives on rebate output
- Persisted amortization schedule (schema exists; writing/reading is caller's concern)
- Historical Rebate table backfill
- Multi-term composition beyond capitated sub-engines (e.g., spend rebate + market-share bonus stacked)
- Non-SPEND_REBATE backward-compat wrappers (callers that need the other 7 types migrate to `calculateRebate` directly)

---

## 9. How to iterate

1. Start with subsystem 0 (schema + types + scaffolding).
2. Generate per-subsystem plan via superpowers:writing-plans.
3. Execute via superpowers:subagent-driven-development.
4. Verify acceptance; merge to main.
5. Proceed to next subsystem.

Per-subsystem plans land in `docs/superpowers/plans/`. This design spec stays as the anchor doc.
