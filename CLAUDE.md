# tydei-next — Claude Code instructions

## Default workflow: superpowers

For ANY non-trivial task in this repo (anything that touches more than one file or
introduces new behavior), default to the superpowers skills flow:

1. **brainstorming** — clarify scope by asking one question at a time, propose 2-3
   approaches, get explicit user approval on a design before writing code.
2. **writing-plans** — turn the approved design into a step-by-step plan with
   bite-sized tasks (each step 2-5 minutes, exact file paths, exact code).
3. **subagent-driven-development** — dispatch a fresh general-purpose subagent per
   task in an isolated git worktree, then cherry-pick the commit to main.

This applies to:
- New features (per-page rewrites, new server actions, new UI surfaces)
- Bug bashes that span more than one file
- v0-prototype parity work
- Any "make it look like X" or "build the rest of Y" request

**Trivial single-file edits** (rename a constant, fix a typo, tweak one prop) can
skip brainstorming and ship directly. Use judgment — when in doubt, brainstorm.

## Project conventions

- **Stack:** Next.js 16 App Router, React 19, Prisma 7, TypeScript strict, Vitest,
  TanStack Query, shadcn/ui, recharts, better-auth.
- **DB:** `postgresql://tydei:tydei_dev_password@localhost:5435/tydei` (local;
  the `docker-compose.yml` Postgres maps host **5435**→5432, since 5432 is often
  taken by other projects. The authoritative value is `.env`'s `DATABASE_URL` —
  trust it over this note). Start it with `docker compose up -d`.
  **Primary demo facility is "Lighthouse Surgical Center"** — it's what
  `scripts/qa-sanity.ts getDemoFacility()` targets and what the seed
  loads most COG/contracts against. "Lighthouse Community Hospital" is
  the secondary; easy to confuse — always match by `name`, never by
  hard-coded cuid. IDs regenerate on every `bun run db:seed`, so any
  literal `cmo6j6fx…`-style cuid you find in older notes is stale.
- **No `any` in TypeScript.** Strict mode is on; use proper types.
- **Server actions** live under `lib/actions/`. `"use server"` files can ONLY
  export async functions. `export interface` / `export type X = …` declarations
  are fine (erased), and so is the **from-form** type re-export
  (`export type { X } from "module"`). But a LOCAL clause
  `export type { X }` (no `from`) is **NOT** erased by Turbopack's prod
  server-action transform — it emits `registerServerReference(X, …)` which
  throws `ReferenceError: X is not defined` at module evaluation and kills
  EVERY action in the file (prod-only; dev works — Charles "Analysis is
  still broken" 2026-06-09, digest 3119269338). Guarded by
  `lib/actions/__tests__/use-server-async-export-scanner.test.ts`.
- **Prisma client:** `import { prisma } from "@/lib/db"`. Don't construct your own.
- **Auth gates:** `requireFacility()` / `requireVendor()` / `requireAdmin()` from
  `@/lib/actions/auth`. Use these, never raw session checks.
- **Facility scoping:** every query that reads contracts must use
  `contractsOwnedByFacility(facility.id)` from `@/lib/actions/contracts-auth.ts`.
  Single-row reads use `contractOwnershipWhere(id, facility.id)`.
- **Rebates are NEVER auto-computed for display.** Earned/collected rebate values
  on the contracts list, contract detail, dashboard, reports, etc. come from
  explicit `Rebate` rows or `ContractPeriod` rollups — never from
  `computeRebateFromPrismaTiers`. The tier engine is reserved for clearly-labeled
  *projection* surfaces (rebate-optimizer scenarios, tier-progress estimates).
  Earned counts only periods where `payPeriodEnd <= today`; collected counts
  only rows with a `collectionDate` set. (The 2026-04-18 contracts-rewrite /
  contracts-list-closure specs that documented this were deleted with all of
  `docs/` in `b70f641e` "remove docs/ in favor of the graphify knowledge
  graph" — the rule now lives here and in the graph: `/graphify query`.)
- **Canonical "Collected" aggregate:** every surface that renders a "Rebates
  Collected" number (contracts list, contract detail header card, contract
  Transactions tab summary card, dashboard, reports) MUST go through
  `sumCollectedRebates` in `lib/contracts/rebate-collected-filter.ts`. Do not
  hand-roll a `r.collectionDate ? ... : ...` reducer — the helper is the one
  place the filter lives so surfaces cannot drift. See Charles W1.R.
- **Rebate engine units (the ×100 is PER rebateType — NOT a blanket scale):**
  `ContractTier.rebateValue` is stored as a **fraction** (`0.02` = 2%) ONLY for
  `rebateType === "percent_of_spend"`. For every OTHER type the stored value is
  already a **dollar amount** and must NOT be multiplied by 100:
  - `percent_of_spend` → fraction; scale ×100 to the integer percent the engine
    wants (`0.02` → `2`).
  - `fixed_rebate` → flat dollar amount (e.g. `30000` = $30,000), used as-is.
  - `fixed_rebate_per_unit` / `per_procedure_rebate` → dollars **per unit**
    (e.g. `10` = $10/unit), used as-is; needs a unit count, so it can't be
    computed from spend alone.

  The one helper that owns this routing is
  **`scaleRebateValueForEngine(rebateValue, rebateType)`**
  (`lib/rebates/calculate.ts`): it returns `raw * 100` for `percent_of_spend`
  and `raw` unchanged for everything else. Route ALL Prisma→engine scaling
  through it — never blanket-multiply by 100 (that's what inflated a
  `fixed_rebate $30,000` to $3,000,000 and a `$10/unit` tier to $1,000/unit;
  Charles W1.S / W1.V, Medtronic regression).

  Two consumers:
  - **`computeRebateFromPrismaTiers`** (`lib/rebates/calculate.ts`) returns a
    `RebateResult` **object** (`.rebateEarned`, `.rebateCollected`,
    `.rebatePercent`, `.tierAchieved`) — **not a bare number**. It is
    spend-based: it computes `percent_of_spend` (scaled) and `fixed_rebate`
    (flat), but **returns `rebateEarned: 0` for the unit-based types** because
    spend alone can't price them. For a real per-unit number, build the config
    via `buildRebateConfigFromPrisma` (`lib/rebates/prisma-engine-bridge.ts`),
    which has the `ContractPeriod` unit rollups.
  - **`lib/contracts/tier-rebate-label.ts`** (display) applies the same
    per-type rule (`formatTierRebateLabel` / `formatPercent(rebateValue*100)`
    for percent only; unit suffix for the rest).

  Caveat: the ×100 is specifically for feeding the **integer-percent engine**
  (`computeRebate`/`calculateRebate`). If you instead multiply the fraction
  **directly** against a dollar spend yourself (`0.02 × $1,000 = $20`), do NOT
  scale — that path already uses the fraction (see
  `lib/actions/case-costing/surgeon-rebate-contribution.ts` `spend_pct`).

  (There is no `lib/contracts/rebate-method.ts`; only the label helper
  `lib/contracts/rebate-method-label.ts`.)
- **Plans live in `docs/superpowers/plans/`** as `YYYY-MM-DD-<topic>.md` (the
  only surviving `docs/` subdir). The old `docs/superpowers/specs/` directory —
  and the rest of `docs/` — was removed in `b70f641e` "remove docs/ in favor of
  the graphify knowledge graph." Design context now lives in the graphify graph
  under `graphify-out/` (query with `/graphify query "<question>"`,
  human-readable summary in `graphify-out/GRAPH_REPORT.md`). Do NOT write or
  cite `docs/superpowers/specs/...` paths — they no longer exist.
- **Worktrees** for parallel subagent work: `.claude/worktrees/agent-<id>/`.
  `.claude/` and `.worktrees/` are gitignored. Cherry-pick the subagent's commit
  by SHA from main; don't merge whole branches.

## Canonical reducers — invariants table

Every business invariant below has ONE helper that owns the filter. Every
surface that renders the number MUST call the helper. Do not hand-roll a
reducer on the same invariant — that's a drift hazard (see Charles W1.R and
W1.U-B for real-world cases where parallel reducers silently disagreed). When
you add a new surface, add a line to the "Used by" column. When you discover
a new invariant, add a row.

| Invariant | Canonical helper | File | Used by |
|---|---|---|---|
| Rebates Collected (lifetime) | `sumCollectedRebates` | `lib/contracts/rebate-collected-filter.ts` | contracts-list, contract-detail header, Transactions tab, dashboard, reports |
| Rebates Earned (lifetime) | `sumEarnedRebatesLifetime` | `lib/contracts/rebate-earned-filter.ts` | **contracts-list earned column** (Charles iMessage 2026-04-20 N13 "make that lifetime"), contract-detail Transactions tab "Total Rebates (Lifetime)" card (`components/contracts/contract-transactions.tsx` via `mapRebateRowsToLedger`), reports overview, proposal lookback comparison `getVendorLookbackComparison` (`lib/actions/prospective-analysis.ts`, 2026-06-10). Regression-guarded by `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts` "W2.A.3" block |
| Rebates Earned (YTD) | `sumEarnedRebatesYTD` | `lib/contracts/rebate-earned-filter.ts` | contract-detail "Earned (YTD)" card |
| COG in-term-scope | `buildCategoryWhereClause` / `buildUnionCategoryWhereClause` (pass `cogCategoryUniverse` from `facilityCogCategoryUniverse`) | `lib/contracts/cog-category-filter.ts` + `lib/contracts/cog-category-universe.ts` | `recomputeAccrualForContract`, `getAccrualTimeline`, contracts-list trailing-12mo cascade, contract-detail per-term scoped spend, `getContractPeriods`, `recompute/volume.ts` |
| Category-name match (case/word-order/plural insensitive) | `canonicalizeCategoryName` (JS boundary) + `expandCategoriesToCogVariants` (SQL `IN` boundary) | `lib/contracts/category-canonical.ts` + `lib/contracts/cog-category-filter.ts` | match-engine eligibility gate `cogCategoryCoveredByContract` (`match.ts`), every `buildCategoryWhereClause`/`buildUnionCategoryWhereClause` caller, `derived-metrics.ts` market-share scope, `volume.ts`, threshold writer market-share COG scope (`lib/contracts/recompute/threshold.ts`, fixed 2026-06-10 — was raw `in`, computed 0% share → $0 rows), category-mapping retro term rewrite (`lib/actions/cog-category-mapping.ts`). **Why it exists:** Prisma `category: { in }` and raw `Set.has` are case-SENSITIVE, so a COG row "Joint replacement" never matched the selected "Joint Replacement" → under-counted eligible spend AND inflated "Pre-Match" out_of_scope (Charles 2026-06-09 "I selected every category, not all the spend is brought in"). NEVER compare category names with raw `===`/`in`; canonicalize both sides (mirrors `normalizeSku`). Regression-guarded by `lib/contracts/__tests__/cog-category-filter.test.ts` + `match.test.ts` |
| Contract ownership (facility) | `contractOwnershipWhere` / `contractsOwnedByFacility` | `lib/actions/contracts-auth.ts` | every read in `lib/actions/` that takes a `contractId` |
| Contract ownership (vendor) — scope by `vendorId` OR grouped `additionalVendorIds`, NEVER bare `vendorId` | `contractsOwnedByVendor` / `contractOwnershipWhereVendor` | `lib/actions/contracts-vendor-auth.ts` | every vendor-side contract read — all of `lib/actions/vendor-reports/*` (report-data, overview, by-rebate-type, audit-trail, contracts-list), and any new vendor surface. **Why it exists:** bare `{ vendorId }` drops grouped contracts where the vendor is only in `additionalVendorIds` (memory: group-vendor-drift). Mirrors the facility helper; `contractOwnershipWhereVendor` returns a `ContractWhereInput` (OR predicate, not unique) so pair with `findFirst`, not `findUnique`. Regression-guarded by `lib/actions/__tests__/contracts-vendor-auth.test.ts` |
| Vendor facility-filter narrowing (AND a single facility onto a vendor-ownership predicate) | `scopeContractWhereToFacility(base, facilityId?)` | `lib/actions/contracts-vendor-auth.ts` | the Vendor Reports Hub facility selector — `getVendorReportsOverview` / `getVendorReportData` / `getVendorRebateBreakdownByType` (each takes optional `facilityId`); query keys carry it. **Why it exists:** the selector existed but the data actions ignored it. The helper only NARROWS an already vendor-scoped predicate (tenant-safe — a bad facilityId returns empty, never another vendor's data); `undefined`/`"all"` returns the base unchanged. Regression-guarded by `lib/actions/__tests__/contracts-vendor-auth.test.ts` |
| Rebate-units scaling (per `rebateType` — `percent_of_spend` ×100, all others unchanged) | `scaleRebateValueForEngine` (the owner) → consumed by `computeRebateFromPrismaTiers` + `formatTierRebateLabel` | `lib/rebates/calculate.ts` + `lib/contracts/tier-rebate-label.ts` | every Prisma→engine feed (`recompute-accrual.ts`, `accrual.ts`, `vendor-analytics.ts`, `prisma-engine-bridge.ts`, `scripts/regen-all-accruals.ts`) + every surface displaying % or earned from `ContractTier.rebateValue`. **Never blanket-×100** — inflates `fixed_rebate`/per-unit tiers 100×. Regression-guarded by `lib/contracts/__tests__/rebate-value-scaling-drift.test.ts` |
| Rebate applied to capital (tie-in) | `sumRebateAppliedToCapital` | `lib/contracts/rebate-capital-filter.ts` | contract-header applied-to-capital sublabel (`tie-in-rebate-split.tsx`), Capital Amortization card Paid-to-Date + Rebates-Applied + Balance-Due (`contract-amortization-card.tsx` via `getContractCapitalSchedule.rebateAppliedToCapital`) |
| Per-supply rebate rule (what an on-contract supply contributes, by matching its product to the contract's rebate term) | `buildSupplyRebateRuleMap` (contractId→rule) + `applySupplyRebateRule` (apply per supply, ≤extendedCost clamp) | `lib/actions/case-costing/supply-rebate-rules.ts` + `lib/case-costing/attribute-surgeon-rebates.ts` | `getSurgeonRebateContribution` (surgeon Rebate-Contribution report) AND `getTrueMarginReport` (case-costing True-Margin per-procedure **Rebate Allocation** column — Vick 2026-06-16 "take the products the surgeons used, check the product numbers with the contracts, see what rebate they're contributing"). **Why it exists:** True Margin used to distribute each vendor's *earned* Rebate-table total proportionally by spend share; that surfaced inflated/seed rebate ($1.49M on prod from a $1.5M S&N earned row that's inconsistent with $46K actual on-contract spend) instead of real per-product contribution. The rule is derived from the contract's highest-yielding term vs its realized on-contract totals: spend_rebate ladder → `extendedCost × pctRate`; volume_rebate → `quantity × $/unit`; carve_out / pricing_only / market_share / below-threshold → 0. Both surfaces MUST route through the one builder so they never drift. Regression-guarded by `true-margin.test.ts` + `surgeon-rebate-contribution` tests. |
| Vendor spend compliance (trailing-12mo vendor COG spend ÷ Σ active-contract annual targets, `annualValue \|\| totalValue`, capped at `VENDOR_COMPLIANCE_CAP_PCT` = 120, rounded 0.1) | `computeVendorCompliance` (vendor/facility rollup) + `computeContractCompliance` (per-contract) | `lib/contracts/vendor-compliance.ts` | `getVendorPerformance` + `getVendorPerformanceContracts` (`lib/actions/vendor-analytics.ts` — vendor /performance radar, hero, contract/rebate tabs), `getVendorPerformanceSummary` (`lib/actions/vendor-reports.ts` — Vendor Performance Summary CSV). **Why it exists:** vendor surfaces showed up to THREE different compliance values — cap 100 vs cap 120 vs an average of the persisted `Contract.complianceRate` (a *match*-compliance metric, % of COG rows on-contract — different invariant entirely). Displays needing a 0–100 domain (radar) clamp at display time; the underlying value keeps the over-target signal. Regression-guarded by `lib/actions/__tests__/vendor-compliance-parity.test.ts` (same inputs → same value through every call path) + `lib/contracts/__tests__/vendor-compliance.test.ts` |
| Per-category market share | `computeCategoryMarketShare` | `lib/contracts/market-share-filter.ts` | facility action `getCategoryMarketShareForVendor` (contract-detail Performance tab — `category-market-share-card.tsx`), vendor action `getVendorMarketShareByCategory` (vendor dashboard widget). Regression-guarded by `lib/actions/__tests__/market-share-parity.test.ts` |
| Per-evaluation-window market share for threshold terms (vendor-union spend ÷ facility-union spend per window, multi-category COMBINED — never per-category average / first-category; canonical category variants) | `computePerPeriodMarketShare` (+ `buildThresholdEvaluationWindows` for the writer-identical window grid) | `lib/contracts/recompute/threshold.ts` | threshold writer `recomputeThresholdAccrualForTerm` (persists `[auto-threshold-accrual]` rows), accrual-timeline display overlay `computeMarketShareDisplayForContract` (`lib/actions/contracts/accrual.ts` — Market Share column + below-threshold window visibility, bugs.rtfd 2026-06-13 M). **Why it exists:** zero-payment windows persist NO Rebate row, so timeline surfaces must recompute the share through this one helper, never a parallel reducer. Regression-guarded by `lib/actions/contracts/__tests__/market-share-union.test.ts` |
| Rebate forecast (12mo projection) | `getRebateForecast` | `lib/actions/analytics/rebate-forecast.ts` | contract-detail Performance tab (`components/contracts/analytics/rebate-forecast-card.tsx`) |
| Spend-tier display eligibility (which term drives Tier Achievement / Rebate utilization) | `hasSpendDollarTierLadder` | `lib/contracts/tier-metric.ts` | contract-detail Tier Achievement panel (`contract-detail-client.tsx` → `_performance-summary.tsx`), Rebate utilization tile (`lib/actions/contracts/performance-read.ts`), `getAccrualTimeline` term walk (`lib/actions/contracts/accrual.ts`, with the volume-family exception documented there, bug-bash A1 2026-06-11). **Why it exists:** `isSpendDollarThresholdTermType` is too loose — `carve_out`/`tie_in` pass it but earn per-SKU; their placeholder tier (rebateValue 0) produced bogus "Tier 4/3/7" and a false 0.0% utilization on carve-out tie-ins (Charles 2026-06-08). Carve-out rebate has its own surface (`getCarveOutRebate` → "Carve-out rebate" card w/ effective rate). Regression-guarded by `lib/contracts/__tests__/tier-metric.test.ts` |
| Tier-bar progress fill (per-tier Progress value on Rebates & Tiers) | `computeTierBarProgress` | `lib/contracts/tier-metric.ts` | `TierDisplay` (`components/contracts/contract-terms-display.tsx`) — both the spend-dollar and market-share paths; the call site routes the metric (dollars vs share %) and the threshold fields (`spendMin/spendMax` vs `marketShareMin/Max ?? spendMin/Max` mirror). **Why it exists:** market-share tier bars compared dollar spend to percent (0–100) thresholds, so every tier (0%+/50%+/100%+) rendered fully achieved at 71.1% actual share (bugs.rtfd 2026-06-11 A3). Regression-guarded by `lib/contracts/__tests__/tier-progress-display.test.ts` |
| Schema-level data invariants | _N/A — substrate, not a single helper_ | — | every read assumes these hold (date order, no negative rebate sums, status/expirationDate consistency, tie_in has capital structure, etc.) |
| End-to-end pipeline (importer → recompute) | _N/A — composite of helpers_ | — | every customer-facing aggregate after import + recompute (`runScenario`) |
| Persisted derived metrics (`Contract.complianceRate`, `currentMarketShare`, `annualValue`) | `refreshContractMetrics` (single contract) + `refreshContractMetricsForVendor` (bulk) | `lib/actions/contracts/refresh-metrics.ts` | auto-fired by `bulkImportCOGRecords` after the COG + match recompute pipeline; piggybacks on the contract-detail "Recompute Earned Rebates" button. Strategic-direction Plan #1 — these fields are now COMPUTED, not manually entered. The form still allows override during the transition; future work removes the manual paths entirely. |
| Pricing-file header detection (SKU / description / price column aliases) | `ITEM_NUMBER_ALIASES` / `DESCRIPTION_ALIASES` / `UNIT_PRICE_ALIASES` / `CATEGORY_ALIASES` (+ `detectPricingColumnMapping`) | `lib/utils/parse-pricing-file.ts` | contract import + AI-extract review (`parsePricingFile`), prospective proposal & pricing tabs (`pricingRowsToItems` in `components/facility/analysis/prospective/pricing-file-reader.ts`), vendor Benchmarks-tab import (`mapBenchmarkRows` in `app/vendor/prospective/sections/benchmark-file-reader.ts`, 2026-06-12 — benchmark-only columns like percentiles/min/max/sample-size keep local lists there since no other surface reads them), vendor proposal-builder pricing/usage uploads (`mapPricingRows`/`mapUsageRows` in `components/vendor/prospective/builder/file-handlers.ts` via `readPricingRows`, 2026-06-13 — builder-only columns like proposed_price/cost-basis/usage extended-cost keep SECONDARY local aliases behind the canonical lists; regression-guarded by `components/vendor/prospective/builder/__tests__/file-handlers.test.ts`), shared `<PricingFileDropzone>` column-mapper fallback (`components/shared/uploads/` — `resolveMapping` in `field-spec.ts` consumes per-surface `UploadFieldSpec[]` whose aliases IMPORT the canonical lists: `BENCHMARK_UPLOAD_SPECS`, `BUILDER_PRICING_UPLOAD_SPECS`/`BUILDER_USAGE_UPLOAD_SPECS`, `ANALYZER_PRICE_FILE_SPECS`; the canonical reader `readPricingRows` now lives in `components/shared/uploads/read-tabular-file.ts` with a re-export at the old pricing-file-reader path; unmapped-header telemetry via `logUploadHeaderEvent` in `lib/actions/upload-telemetry.ts` → `UploadHeaderEvent`, uploader improvements 1+2 2026-06-13; regression-guarded by `components/shared/uploads/__tests__/field-spec.test.ts`). **Why it exists:** the 2026-06-10 proposal analyzer hand-rolled a 7-alias copy that missed "ReferenceNumber" — the Arthrex price file parsed to 0 items ("No items found in the price file", Vick 2026-06-10). The canonical list carries every real-world alias fix (Stryker "Catalog Item", DePuy "PROD CD", SYK "Reference numer" typo). NEVER inline a header-alias list; import these. Regression-guarded by `components/facility/analysis/prospective/__tests__/pricing-file-reader.test.ts` |
| Case reimbursement backfill (CPT payor-rate estimate when `Case.totalReimbursement` is 0) | `buildCptRateSchedule` + `resolveCaseReimbursement` (date-aware) — plus `buildCptRateMap` (flat highest-wins, display only) | `lib/case-costing/cpt-rate-map.ts` | `getCases` (cases list), `getCaseCostingReportData` (case-costing report header), `getFacilityAveragesForFacility` (hero card), `calculatePayorMargins` (`lib/actions/payor-contracts.ts` — migrated to `buildCptRateSchedule` + `rateAsOf(c.dateOfSurgery)`), `getTrueMarginReport` (`lib/actions/case-costing/true-margin.ts` — the per-procedure True-Margin table's **Revenue** column; was a drift reading raw `Number(c.totalReimbursement)` → $0 on every row, Vick "Revenue is reimbursement" 2026-06-16; regression-guarded by the "Revenue backfill" block in `true-margin.test.ts`). **Why it exists (audit H5):** the rate-map builder was copy-pasted 3× and the report used raw stored reimbursement, so "Avg Margin" contradicted the tables beside it. SKU-class rule: never hand-roll a `cptRates` JSON parse — both `{cpt, rate}` and `{cptCode, rate}` shapes must be tolerated. **Date-aware (2026-06-17, Lighthouse Anthem):** multi-year payor contracts list one rate per CPT PER contract year; each year's rate persists as a separate `cptRates` row with its own `effectiveDate` (window start). `resolveCaseReimbursement` takes the case's `dateOfSurgery` and picks the rate effective as of that date (latest `effectiveFrom ≤ caseDate`, else earliest); rows WITHOUT an `effectiveDate` keep the legacy "highest rate wins" so seeded single-rate contracts are unaffected. NEVER feed undated highest-wins into a per-case number when the contract has year-columns — that inflates a Year-1 case to the Year-3 rate. Regression-guarded by `lib/case-costing/__tests__/cpt-rate-map.test.ts`. Coverage note: only cases whose CPT exists in a loaded payor contract get a non-zero estimate (prod: ~237/674 via the single Anthem contract); the rest stay $0 until more payor CPT rates load — a data limit, not a bug. |

| Access tier (Settings/Users — who can do what: Super=full incl Settings, Advanced=all but Settings, User=read-only) | `can()` matrix (pure) → `requireCan(perm)` / `requireCanMutate()` (session gates) | `lib/auth/permissions.ts` + `lib/actions/auth-permissions.ts` | EVERY mutating server action should gate with `requireCanMutate()` (read-only `user` tier blocked); Settings/member writes use `requireCan("settings.manage")` / `requireCan("members.manage")` (Super only); settings `page.tsx` server-redirects non-Super; client affordances via `<Can>`/`<ReadOnlyGuard>` + `AccessProvider` (`components/shared/auth/`). Tier lives on `Member.accessTier` (orthogonal to org role owner/admin/member). `getCurrentAccessContext` defaults to `super` when no Member row (admins/platform). Regression-guarded by `lib/auth/__tests__/permissions.test.ts`, `lib/actions/__tests__/auth-permissions.test.ts` + `settings-access-tier.test.ts`. **Memory: feedback_default_to_superpowers / the Settings/Users build.** |
| Vendor division scope (hard isolation — "each division behaves like a separate company") | `callerVendorDivisionIds(userId, vendorId)` (undefined=enterprise/Super, []=nothing, [ids]=restricted) + `divisionScopeWhere` + the EXTENDED `contractsOwnedByVendor(vendorId, divisionIds)` / `contractOwnershipWhereVendor(id, vendorId, divisionIds)` | `lib/actions/division-auth.ts` + `lib/actions/contracts-vendor-auth.ts` | every vendor-side read scopes to the caller's attached `DivisionMember` divisions; `divisionIds === undefined` is byte-identical to pre-feature behavior (opt-in). Division CRUD + user attach in `lib/actions/division-members.ts` (super-only via `requireCan("members.manage")`, vendor-scoped IDOR). Regression-guarded by `contracts-vendor-auth.test.ts` + `division-members-auth.test.ts`. |
| Vendor 1-/2-way mode + contract-flow gate (a vendor's contract reaches a facility ONLY when an `accepted` connection exists AND `mode === two_way`) | `vendorContractsVisibleToFacility(facilityId)` + `get/setConnectionMode` (vendor-only) | `lib/actions/connection-mode.ts` | mode lives on `Connection.mode` (per facility–vendor pair); 1-way vendors self-serve contracts (no facility approval) + may enter own COG. Regression-guarded by `connection-mode-gate` / `connection-mode.test.ts`. |
| Vendor-owned COG (1-way) — NEVER merged into facility-scoped `COGRecord` | `vendorCogScopedByDivisions(vendorId, divisionIds)` | `lib/contracts/vendor-cog-scope.ts` (+ `lib/actions/vendor-cog.ts`, `lib/actions/imports/vendor-cog-import.ts` reusing the canonical pricing-file aliases) | new `VendorCogRecord` table, vendor-owned + division-scoped; the facility `COGRecord` "always facility-scoped" invariant is untouched. Regression-guarded by `vendor-cog-scope.test.ts` + `vendor-cog-isolation.test.ts`. |
| Facility enterprise vs assigned scope (enterprise user sees all facilities in their HealthSystem; scoped user sees only assigned) | `getCallerFacilityIds()` + `contractsOwnedByFacilities(facilityIds[])` (+ bounded `facilityScopeClause("all", id, facilityIds)`) | `lib/actions/facility-assignment.ts` + `lib/actions/contracts-auth.ts` | new `FacilityAssignment` join; assign/unassign super-only + HealthSystem/org IDOR guards. Regression-guarded by `facility-assignment-scope.test.ts` + `facility-assignment-auth.test.ts`. |
| Uniform table filtering (one shared table) | `<DataTable enableColumnFilters>` + per-column `meta.filterVariant` (`text`/`select`/`range`/`none`) | `components/shared/tables/data-table.tsx` + `column-filter.tsx` | the ONE table wrapper for every filterable list (TanStack v8: sort + faceted column filters + pagination). `range` columns need a numeric `accessorFn`; `select` faceted via `getFacetedUniqueValues`. Legacy `useTableSort`/`SortableHead` + the orphaned `cpt-analysis-table` were deleted. Financial-statement / inline-editor / print / comparison tables stay bespoke shadcn `<Table>` on purpose. |

## Release hygiene

- **After file-rename or server-action-heavy days** (e.g., W1.T's tie-in refactor),
  the Next.js `.next/` action manifest can cache stale hashes. Symptom: runtime
  error `Server Action '<hash>' was not found on the server`. Fix: `rm -rf .next
  && bun run dev`. If the issue persists across a fresh build, a client bundle
  is referencing a removed server-action export — grep for the export name.
- **Full verify checklist** (run before saying "ship it"):
  1. `bunx tsc --noEmit` → 0 errors
  2. `bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'` → all green
  3. `rm -rf .next && bun run dev` + smoke the surfaces touched today
  4. For any shipped reducer or filter, confirm every surface listed in the
     invariants table calls the canonical helper (grep for ad-hoc reducers).
- **No dual-source metrics.** `getContractMetricsBatch` was removed in
  Charles W1.X-D. The single source for list-row metrics
  (`rebateEarned` lifetime, `rebateCollected` lifetime, `currentSpend`
  trailing 12mo) is `getContracts` via the canonical helpers
  (`sumEarnedRebatesLifetime`, `sumCollectedRebates`, trailing-12mo
  cascade). The list column accessors MUST NOT fall back to any
  batch-derived field. Enforced by
  `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`.

## AI-action error path

Every `"use server"` action that calls the Anthropic API (`renewal-brief.ts`,
`rebate-optimizer-insights.ts`, and future peers) MUST:

1. `console.error('[<action-name>]', err, { facilityId, contractId })` before
   any re-throw, so the underlying exception shows up in server logs. In prod
   builds, the user sees a generic digest; the server log is the only
   debugging path.
2. Surface a user-facing message that names the action and the failure kind
   (e.g., `AI request error: <reason>` for `generateText` failures,
   `AI returned an invalid payload: <zod path>: <issue>` for Zod parse
   failures). Never let the client see `An error occurred in the Server
   Components render.`

## Reference codebase

The v0 prototype folder (`/Users/vickkumar/Downloads/b_T2SEkJJdo8w/`) is **no
longer on disk** — do not try to read it. For v0-parity work the user supplies
screenshots or points at the live surface; port against tydei's Prisma + Next
architecture (not v0's localStorage stores). Many v0 reports already have tydei
equivalents — check before rebuilding. Example: the "Contract Performance
Details" report is `components/facility/reports/report-period-table.tsx` +
`report-trend-chart.tsx`, fed by `getReportData` in `lib/actions/reports.ts`
(per-contract-type columns already wired for usage/service/capital/tie_in/
grouped/pricing_only).

## Analysis / Prospective financial model (2026-06-22)

- **DCF MUST include a terminal value.** `computeFacilityProspectiveModel`
  (`lib/financial-analysis/prospective-impact-model.ts`) returns
  `current.dcf` = explicit-period PV **plus** a Gordon-Growth terminal value:
  `TV = FCF_N × (1+g) / (r − g)`, discounted back N years (helper
  `discountedCashFlowWithTerminalValue`, with `dcfExplicit` + `dcfTerminalValue`
  split). Terminal value is 60–80% of a real DCF — an explicit-only sum reads
  as "wrong" (John 2026-06-22). New `terminalGrowthPct` knob clamps just below
  the discount rate so the perpetuity can't diverge. Do NOT revert to the
  explicit-only sum. Regression: `__tests__/prospective-impact-model.test.ts`.
- **Net Revenue is an Actuals / Manual control — NEVER `spend ÷ 30%`.** The old
  implied proxy (`netRevenue = vendorSpend ÷ IMPLIED_SUPPLY_COST_PCT`) made
  EBITDA exactly equal vendor spend whenever the EBITDA-margin slider matched
  the 30% supply-cost ratio (Vick 2026-06-22). `getFacilityAnalysisData` now
  also returns `measuredReimbursement` + `reimbursementCoverage`; the dashboard
  Revenue control is **Actuals** (summed `resolveCaseReimbursement`, with a
  coverage caveat) or **Manual** (avg reimbursement/case × cases, seeded from
  the real per-covered-case average). The implied proxy survives only as a
  last-resort manual seed, never as the silent default.
- **Vendor Opportunity Engine strategic inputs are DB-derived, not hardcoded.**
  `getVendorOpportunityData` (`lib/actions/vendor-opportunity-data.ts`) returns
  `competitiveThreat` (top competing vendor by spend in the vendor's categories
  at its facilities), `topCompetitorSharePct`, `rebateCostPct` (earned rebates ÷
  revenue), `contractTypeCount`, `hasCapitalContract`. The Opportunity Engine
  feeds these into `computeVendorOpportunityScore` (was hardcoded
  `competitiveThreat: "Stryker"`, scores 60/55/50). Both the Opportunity Engine
  and the vendor per-facility **Facility Current State** panel
  (`components/vendor/prospective/facility-current-state.tsx`, fed by
  `getFacilityCurrentStateForVendor` — IDOR-scoped via `vendorRelatedFacilityWhere`)
  show an honest amber "modeled from defaults — no history" banner instead of
  presenting seed defaults as real data. The Opportunity Engine "Deal Scenario"
  picks a **division** (real `VendorDivision` list) and a **facility** that can
  be chosen or written-in (report label only, never shown to the facility).
- **Annual cases is an editable assumption.** In `FinancialAssumptionsCard`
  (`current-state-and-assumptions.tsx`) the "Annual cases" value is an inline
  number input seeded from case-costing data but overridable — it drives manual
  Net Revenue (avg/case × cases), impact-per-case, and the category breakdowns.
  Vendor spend stays a tracked, read-only display. Used by both the facility
  Analysis dashboard and the vendor Facility Current State panel.
- **Both exports carry the full picture / tell the story.** The vendor
  Opportunity Engine export (`export-opportunity.ts`) leads with a **Facility
  Current State** block (spend → revenue w/ actuals-or-manual basis → EBITDA →
  DCF explicit+terminal + every assumption) — the panel emits a live
  `FacilityCurrentStateSnapshot` to the section via `onSnapshotChange`. The
  facility Analysis export (`export-analysis.ts`) leads with a plain-English
  **Narrative** (`buildNarrative`, spend→revenue→EBITDA→DCF→saving lift) plus a
  DCF-breakdown section and the contribution-margin / individual-impact tables.
  Regression: `dashboard/__tests__/export-story.test.ts`. When you add a figure
  to either surface, add it to the matching exporter so the report stays
  complete (Vick 2026-06-22 "the export does not incorporate all the
  information / does not tell the story").

### Prospective audit fixes (2026-06-23)

- **Prospective benchmarks come ONLY from uploaded files.** Every prospective
  benchmark read uses the vendor's OWN `ProductBenchmark` rows
  (`where: { vendorId: vendor.id }`) — NEVER the seeded / national rows
  (`vendorId: null`). Applies to `getVendorBenchmarks` (Benchmarks tab,
  `lib/actions/prospective.ts`), the proposal analyzer
  `getVendorProspectiveAnalysis` (`lib/actions/vendor-prospective.ts`, was
  `OR: [{vendorId}, {vendorId: null}]`), and the Deal Scenario
  `categoryBenchmarks` in `getVendorOpportunityData`. Do NOT re-add the
  `{ vendorId: null }` branch in any prospective surface (Vick 2026-06-22
  "Benchmark should only come from uploaded files"). The seeded/national rows
  still feed non-prospective surfaces (admin `ProductBenchmark`, COG
  categorize-from-benchmark) — this rule is prospective-only.
- **Deal Scenario "Benchmark Position".** `getVendorOpportunityData` returns
  `categoryBenchmarks: { category, currentAsp, benchmarkAvg | null }[]` —
  per-category the vendor's ACTUAL trailing-12mo ASP (spend ÷ qty) and the
  UPLOADED benchmark average. `BenchmarkPositionCard`
  (`components/vendor/prospective/benchmark-position-card.tsx`) renders, per
  category, **Benchmark vs Current ASP (actual) vs Proposed ASP (assumption =
  current × (1+priceChange)) + % gap / above-below**. Honest empty state when
  nothing is uploaded. There are TWO benchmark surfaces on the vendor side — this
  Opportunity-Engine per-category ASP card AND the Deal Scorer's
  `DealScorerBenchmarkCompare` (per-scenario percentile, informational only,
  does NOT feed the score) — keep both consistent on uploaded-only sourcing.
- **Proposal tier extraction mirrors the contract flow.** The facility "Evaluate
  Proposals" upload (`components/facility/analysis/prospective/upload-proposal-tab.tsx`)
  uses ONE shared `isSpendDollarTerm(termType)` predicate (exported) to gate BOTH
  the 12-month lookback's `extractedTiers` AND `buildScoringInput`'s top-tier
  rate/min-spend. It was a too-narrow allow-list (`{spend_rebate, growth_rebate,
  ""}`) that dropped the AI's varied labels (`percent_of_spend`, `spend_based`,
  `usage`, `"Spend Rebate"`) → "tiers not picked up like contracts" (Vick
  2026-06-22). Broadened to include those, case/space-insensitive; market_share /
  volume / carve-out / fixed / per-procedure stay EXCLUDED. Regression:
  `__tests__/spend-dollar-term.test.ts`.
- **Proposal score baseline = real actuals.** The score's `currentSpend` seeds
  from the vendor's trailing-12mo COG (the lookback runs FIRST, then scoring),
  not the proposed contract total (which inflated savings on known vendors);
  unknown vendors fall back to the proposed total. The manual-entry tab has a
  **"Load actuals"** button that seeds the baseline from the typed vendor's
  trailing-12mo spend via `getVendorLookbackComparison`.
- **`proposedRebateRate` is a PERCENT in the proposal score — do NOT normalize
  it.** The scoring engine reads `proposedRebateRate` / `priceVsMarket` as
  percents (`scoring.ts:42` "top-tier rate as percent"), so `buildScoringInput`
  passes the raw AI `tier.rebateValue` (AI emits "3" for 3%). The LOOKBACK path
  is different: `computeRebateFromPrismaTiers` wants a FRACTION, so the lookback
  already calls `normalizeAIRebateValue("percent_of_spend", …)` ("3" → 0.03).
  Never "normalize the score's tier rate to match contracts" — that's the
  fraction engine, not the percent scorer (caught as an audit false positive
  2026-06-23).
- **Deal Scorer is construct-based + connects to the Opportunity Engine
  (2026-06-23).** The vendor Deal Scorer (`DealScorerSection`) is a table of
  **constructs** — one row per product (benchmark-picked OR free-text), each with
  **Current / Floor / Target / Ask** unit prices + annual volume + rebate %
  (Ceiling removed). The tested `analyzeVendorProspective` still scores
  `pricingScenarios`, so constructs are BLENDED into Floor/Target/Ask scenarios
  (spend-weighted unit price + summed volume + spend-weighted rebate; Current →
  baseline) by the pure `blendConstructsToScenarios`
  (`lib/prospective-analysis/blend-constructs.ts`, tested) — never re-derive that
  blend inline. The per-construct benchmark Avg/P25–P75 shows inline (informational;
  this REPLACED the separate `DealScorerBenchmarkCompare` + `MultiSelectCombobox`,
  both deleted). On attach, the constructs + `currentAnnualSpend` persist to the
  proposal's `pricingData` (`dealConstructs`, zod-validated); `getVendorProposals`
  derives a `dealHandoff` (facility, current spend, blended Target-vs-Current
  `priceChangePct`, share). My-Proposals scored cards get an **"Opportunity
  Engine"** button → `OpportunityEngineSection`'s `initialDeal` prop one-shot
  pre-fills facility + price/share sliders (proposal → score → opportunity story).
- **Vendor Prospective is a guided STEPPER (2026-06-24).** Tabs are now
  **Opportunities (list) · Proposals (stepper) · Benchmarks · Analytics** — the
  standalone Deal Scorer + Opportunity Engine tabs collapsed into the stepper,
  and the old benchmark-wedge `OpportunitiesSection` was deleted (Opportunities
  now renders the `ProposalCards` list). `ProposalStepper`
  (`app/vendor/prospective/sections/ProposalStepper.tsx`) has two steps:
  **Step 1 Usage & Pricing** = `DealScorerSection` and **Step 2 Opportunity &
  Report** = `OpportunityEngineSection`. **Constructs come ONLY from the
  benchmark dropdown** (Vick 2026-06-24) — usage/price files do NOT create
  constructs. Step 1 has two reference dropzones: a **usage** file (`mapUsageRows`
  → SKU→volume map, "what the volume is compared against") and a **current price**
  file (`mapPricingRows` → SKU→current-price map). When a construct is picked
  from the benchmark list, its Volume + Current are auto-filled from those maps by
  matching the benchmark's `normalizeSku(itemNumber)`; the vendor enters Floor /
  Target / Ask. (The earlier `usageProductsToConstructs` auto-populate was wrong
  and was removed.) On Analyze, `DealScorerSection`
  emits the blended deal via `onDealAnalyzed`; the stepper forwards it as the
  Opportunity Engine's `initialDeal` so Step 2 auto-seeds WITHOUT the manual
  handoff. The deal's per-construct rows ride `OppEngineHandoff.constructs` into
  the Opportunity Engine **export** (`export-opportunity.ts` — a "Proposed Deal
  — by product" table in both PDF + CSV), so the single export is the unified
  report. Creating a NEW proposal still uses the `ProposalBuilder` (the hidden
  `new-proposal` tab, reached from Opportunities' "New proposal").
- **`priceVsMarket` in the proposal scorer is POSITIVE when CHEAPER** (a
  discount → higher competitiveness; `priceCompetitiveness = clamp(5 +
  priceVsMarket/4, 0, 10)`, sign locked by `scoring.test.ts`). The price file's
  `PricingFileSummary.avgVariancePercent` is `(proposed − current)/current`,
  which is NEGATIVE when cheaper — so the helper `priceVsMarketFromAnalysis`
  (exported from `upload-proposal-tab.tsx`) **negates** it into a savings% before
  feeding the score (audit P1#6 — was hardcoded `0`; feeding it raw scores
  cheaper proposals LOWER). The proposal re-scores when a COG-matched price file
  is analyzed (PDF-then-pricing) and reads an already-analyzed file at PDF-score
  time (pricing-then-PDF). The manual-entry "Discount vs market %" field is
  **positive = cheaper** to match. Regression: `__tests__/spend-dollar-term.test.ts`.

## Key surfaces added recently (2026-06)

- **Vendor Reports Hub** (`components/vendor/reports/hub/` + `lib/actions/vendor-reports/`)
  — full parity with the facility Reports Hub, vendor-scoped. The vendor
  actions (`getVendorReportData` / `getVendorReportsOverview` /
  `getVendorRebateBreakdownByType` / `getVendorRebateCalculationAudit` /
  `getVendorReportContracts`) return the SAME payload shapes as their facility
  counterparts so the facility's presentational components (`ReportPeriodTable`,
  `ReportTrendChart`, `ReportContractHeader`) are REUSED verbatim — never fork
  them. All vendor contract reads go through `contractsOwnedByVendor`
  (invariants table). The hub mounts inside `components/vendor/reports-client.tsx`
  as the "Contract Performance Details" section above the CSV export cards
  (those CSVs are separate and still display-only on their facility filter).
  The hub's **facility selector** now scopes Overview / per-type / By-Rebate-Type
  (and the PDF export) to one facility via `scopeContractWhereToFacility`
  (invariants table) — it previously only filtered the contract dropdown.
- **Case-costing True-Margin (per-procedure)** table —
  `app/dashboard/case-costing/reports/reports-client.tsx`, fed by
  `getTrueMarginReport` (`lib/actions/case-costing/true-margin.ts`). **Revenue**
  = reimbursement via the canonical `resolveCaseReimbursement` backfill;
  **Rebate Allocation** = per-supply product match via `buildSupplyRebateRuleMap`
  + `applySupplyRebateRule` (NOT proportional distribution of earned rebate).
  Both are invariants — see the table above.

## Contract-form conventions

- **Capital / Leased Items editor seeds for EVERY tie_in/capital extraction.**
  In `components/contracts/new-contract-client.tsx` the AI-extract handler seeds
  one capital line item whenever `contractType ∈ {tie_in, capital}`, using the
  best available financed total (`capitalCost → totalValue → annualValue`). Do
  NOT re-gate the seed on `capitalCost > 0` — the AI often classifies the type
  correctly but misses the explicit capital-cost line, and an empty editor also
  BLOCKS save (the submit gate requires ≥1 capital item). The render gate and
  persist loop both use `tie_in || capital` (not `tie_in` alone). Vick "No
  capital coming up" 2026-06-16.
- **The capital seed ALSO fires on a manual contractType→tie_in/capital change**
  (not only during AI extract). The AI routinely misclassifies an
  equipment-contribution contract as `usage` (its spend-rebate tiers match the
  "usage" rule), so when the user corrects the type the editor would otherwise
  land empty and block save. A ref-guarded transition effect in
  `new-contract-client.tsx` seeds when the type transitions INTO tie_in/capital
  while the editor is empty. Both paths build the row through the ONE shared
  factory **`buildSeededCapitalLineItem`** (`capital-line-items-editor.tsx`,
  built on `makeEmptyCapitalLineItem`) so they can't drift — never inline a
  second seed builder. The AI prompt + `extractedContractSchema` also now
  classify financed/placed/contributed-equipment contracts as `tie_in` even
  with spend/volume tiers ("Equipment Contribution Schedule" = tie_in). Vick
  "AI not grabbing the capital again on the Tie in" 2026-06-22. Regression:
  `components/contracts/__tests__/seed-capital-line-item.test.ts`.

## File parsing & security hardening (2026-06-17 audit)

- **All `.xlsx` parsing MUST go through `parseXlsxMatrixBounded`**
  (`lib/xlsx/parse-xlsx-bounded.ts`) — NEVER raw `workbook.xlsx.load(buffer)`.
  It is the one chokepoint that (1) guards against decompression bombs by
  reading the ZIP central-directory declared uncompressed size + ratio
  BEFORE decompressing (caps 400 MB / 200:1), and (2) trims the
  **phantom tail** — real exports routinely fill one column to Excel's hard
  max (1,048,576 rows), so it stops after 500 consecutive ≤1-cell rows
  (mirrors the import sparse-run). Callers pass their own `cellToString`.
  Used by `app/api/parse-file/route.ts` and `parseXlsxBufferToRows`
  (`lib/actions/imports/shared.ts`, shared by `import-cog` + `import-pricing`);
  all three map `XlsxLimitError` → 400. Regression-guarded by
  `lib/xlsx/__tests__/parse-xlsx-bounded.test.ts` (incl. the phantom-tail
  case) and verified against the real Stryker / Arthrex / invoice exports.
- **Tenant isolation is the #1 invariant** (PHI + financial, multi-tenant).
  Every server action / API route that takes a client id MUST scope it to
  the caller's own facility/vendor (`contractOwnershipWhere` /
  `contractsOwnedByVendor`, etc.). The static guard is
  `lib/actions/__tests__/server-action-auth-scope-scanner.test.ts` — when it
  flags a bare `where: { id }`, add a REAL ownership check, never a false
  allowlist comment (the 2026-06-17 audit found two such false exemptions
  hiding live IDORs in `bundles.ts` + the now-DELETED `report-scheduling.ts`).
  Schedule CRUD lives ONLY in `lib/actions/reports/schedule.ts`
  (facility-scoped); the duplicate `report-scheduling.ts` was removed. Global
  `ProductBenchmark` mutations are `requireAdmin`. API routes that serve
  tenant data (e.g. `app/api/reports/pdf`) must hard-fail when the caller has
  no facility — never gate ownership behind `if (userFacilityId)`.

## Client-side & data-access conventions (best-practices sweep, 2026-06-17)

- **TanStack Query keys go through the factory.** Use `queryKeys.*` from
  `lib/query-keys.ts` for EVERY `useQuery`/`useMutation`/`invalidateQueries`
  — never an inline `queryKey: ["…"]` literal. A query's READ key and every
  INVALIDATION that should refresh it MUST share a matching prefix
  (invalidation is prefix-based). Hand-rolled literals drifting from their
  invalidations caused 3 real stale-cache bugs (a card and its invalidation
  used different strings, so the contract Performance-tab market share, the
  payor-margin tiles, and a dead `["cog"]` key never refreshed). When you add
  a query for a new resource, add a factory entry (with a `*Base` family key
  for prefix invalidation) rather than a literal.
- **Editable/reorderable lists use STABLE ids as keys, never the array
  index.** Any list whose rows can be deleted/reordered AND that holds
  per-row UI state (expand, focus, controlled inputs) must `key={row.id}` and
  delete by id — `key={idx}` reuses the wrong row's state on delete (capital-
  line-items + market-share-commitment editors shipped this bug; fixed with a
  UI-only `_uid` minted via `crypto.randomUUID()`, stripped at the persist
  boundary). Same for value-based keys that can collide (`{contractId}-{tier}`
  → use `{contractId}-{index}`).
- **Multi-write server-action sequences are atomic.** Dependent
  create/update/delete sequences (e.g. category remap, invoice variance
  recompute, invoice line revalidate) run inside `prisma.$transaction(async
  (tx) => …)` using `tx`, not `prisma` — partial-write hazard otherwise.
- **Derive, don't mirror.** Compute values from props/state during render (or
  `useMemo`), not via `useEffect` + `setState`; reset state on a prop change
  with a `key` prop, not a reset effect ("You Might Not Need an Effect").
- **Validate JSON-column writes.** Any server action writing a client array
  into a JSON column (e.g. `importCPTRates` → `PayorContract.cptRates`) must
  `zod.parse()` it first — it feeds canonical helpers downstream.
- `normalizeCategoryKey` (case/whitespace key-normalizer, distinct from the
  matching-oriented `canonicalizeCategoryName`) lives in ONE pure module
  `lib/categories/normalize-key.ts` — import it, never re-inline.

## Settings / Users + access tiers (2026-06-19/20)

The vendor + facility Settings areas have a real users/permissions system. Built
on the existing better-auth organization plugin (User → Member → Organization →
Facility|Vendor). All schema changes were **additive + nullable** (one migration
`…_settings_users_access_divisions_modes`); defaults mean **zero behavior change**
for existing rows until a caller opts in.

- **Three access tiers** (`Member.accessTier` enum `super|advanced|user`,
  `@default(super)`): Super=full incl Settings, Advanced=all but Settings,
  User=read-only. Orthogonal to the org role (owner/admin/member + vendor
  `admin:owner` colon sub-roles). The permission layer + every helper is in the
  invariants table (`can()` / `requireCan` / division / mode / vendor-cog /
  facility-assignment). Member tier is changed via `updateMemberAccessTier`
  (Super-only, owner-protected). Two distinct "admin" concepts: **platform
  super-admin** = `UserRole: admin` → the `/admin` operator console (cross-tenant,
  `requireRole("admin")`); **access tier `Super`** = top tier WITHIN one
  facility/vendor org. Don't conflate.
- **New tabs:** facility Settings adds **Facility Access** (`FacilityAssignment`
  enterprise/scoped) + **Alerts** (renewal alerts); vendor Settings adds
  **Divisions** (`VendorDivision`/`DivisionMember`) + **COGS** (1-way
  `VendorCogRecord` upload) + **Alerts**. Per-user **Profile** (name/email/
  password) is a shared `AccountProfileCard` wired to the better-auth client
  (`authClient.updateUser/changeEmail/changePassword`) — replaced the old mocked
  profile blocks. Self-profile is NOT tier-gated.
- **Demo logins** (`lib/auth/demo-accounts.ts`): per-tier accounts seeded by
  `scripts/seed-demo-roles.ts` (idempotent; safe on existing local/prod DB) +
  `prisma/seeds/users.ts`. The sign-in quick-login buttons are **server-gated by
  the `SHOW_DEMO_LOGINS` env var** (NOT `NEXT_PUBLIC` — evaluated in the login
  server component; when off, the accounts/credentials are never passed to the
  client). **LAUNCH HARDENING: set `SHOW_DEMO_LOGINS=false` AND delete the demo
  users from the DB.** New tier passwords are `demo-2024`.

## Reports + tables (2026-06-19/20)

- **Contract Performance Details: canonical rebate totals are LIFETIME, never
  windowed.** `getReportData` / `getVendorReportData` fetch the contract's
  `rebates` WITHOUT a `payPeriodStart/End` window — `rebateEarnedCanonical`,
  `rebateCollectedCanonical`, and `marginCanonical` feed the period-table footer
  "Total (to date)" + Contract Margin, which are lifetime figures that must
  agree with the Contracts List / Contract Detail (same `sumEarnedRebatesLifetime`
  / `sumCollectedRebates` helpers). Windowing the fetch hid annual-cadence
  rebates whose `payPeriodEnd` fell outside the report window — a 2024/2025
  rebate viewed in a trailing-90-day window read as $0 earned/collected/margin
  even though it was earned, collected, and applied to capital (Vick 2026-06-22,
  prod contract 0010126879). The per-month ROWS still come from the windowed
  `periods` (ContractPeriod, or COG-derived synthetic when none exist); only the
  totals are lifetime. Do NOT re-add a window to that rebates fetch.
- **`ReportPeriodTable` footer earned/collected fall back to the period rollup
  with `||` (not `??`)** so a $0 canonical never hides a non-zero ContractPeriod
  rollup (CLAUDE.md: earned/collected come from Rebate rows OR ContractPeriod
  rollups). The tie-in/capital **Balance** column shows a running remaining
  capital balance via `computeRunningCapitalBalances`
  (`lib/reports/running-capital-balance.ts`) — anchored so the most-recent period
  equals the contract's current `capitalRemainingBalance` (the header figure),
  reconciling regardless of the report window. Was rendering `paymentExpected`
  (always $0). Regression: `lib/reports/__tests__/running-capital-balance.test.ts`.
- **Price Discrepancy Report** reads **matched COG spend, not invoices.**
  `getPriceDiscrepancies` (`lib/actions/reports.ts`) queries `COGRecord` where
  `matchStatus IN (price_variance, off_contract_item)` — the SAME source the
  off-contract/price-variance ALERTS use (`lib/alerts/synthesizer.ts`). It used
  to read the (usually empty) `invoiceLineItem`, so the report sat empty while
  alerts had data. Keep these two surfaces on the one source.
- **All PDF reports render SERVER-SIDE via `lib/pdf.ts` — never a new
  client-side jsPDF generator.** `lib/pdf.ts` is the one place jsPDF/autotable
  lives server-side (returns `Uint8Array`); `/api/reports/pdf` is the one route
  that dispatches by `type` and the client downloads the blob. Generators:
  `generateContractReport`, `generateReportPerformancePDF`, `generateRebateReport`,
  `generateSurgeonScorecard`, and the generic `generateTableReportPDF(title,
  subtitle, head, rows, numericColumns)` (any tabular report — empty → explicit
  "No data" row, >6 cols → landscape). When you need a new PDF, add a generator
  here + a route branch, and POST from the client — do NOT spin up a client jsPDF
  helper (Vick 2026-06-22 "we have a server side pdf generator").
  **No exemptions (Vick 2026-07-02 "make all pdf gen backend only"):** the two
  Analysis exporters — `components/facility/analysis/dashboard/export-analysis.ts`
  and `app/vendor/prospective/sections/export-opportunity.ts` — now serialize
  their live client model into a payload and POST it to `/api/reports/pdf`
  (`type: "analysis"` facility-scoped / `type: "opportunity"` vendor-scoped) →
  `generateAnalysisReportPDF` / `generateOpportunityReportPDF` in `lib/pdf.ts`
  (payload interfaces live there too; clients import the TYPE only). CSV paths
  stay client-side. `grep -rl jspdf app components` must stay empty.
- **Report PDF export** (server-side, table-only — no charts): `/api/reports/pdf`
  `type: "report"` with `scope: facility|vendor` → `generateReportPerformancePDF`
  (`lib/pdf.ts`, jsPDF/autotable, reuses `getReportData`/`getVendorReportData`).
  Shared `<ReportPdfButton>` (`components/shared/reports/`) on both hubs;
  vendor scope does NOT require a facility membership (the action enforces).
  **It renders LANDSCAPE and its per-period columns MUST match the on-screen
  `ReportPeriodTable`** — for tie-in/capital that means Rebate Collected AND a
  running **Balance** column (`computeRunningCapitalBalances`, anchored to the
  contract's `capitalRemainingBalance`, passed on `ReportPerfContract`). Was
  portrait + missing those columns → "the exported report doesn't have all the
  data" (Vick 2026-06-22). Don't drop back to portrait or a thinner column set.
- **Vendor Reports cards = PDF + CSV.** The Rebate Statement / Performance
  Summary / Contract Roster cards (`components/vendor/reports/report-type-grid.tsx`
  → `reports-client.tsx`) offer **Download PDF** (POST `/api/reports/pdf`
  `type: "vendor-report"`, `vendorReport: rebates|performance|roster` →
  `generateTableReportPDF`) AND **Download CSV** (client `toCSV`). Both pull the
  SAME data actions (`getVendorRebateStatement` / `getVendorPerformanceSummary` /
  `getVendorContractRoster`); the route is vendor-scoped (`requireVendor`, no
  facility membership). Purchase Leakage has no tabular export — its button
  scrolls to the live audit card. The facility "Evaluate Proposals" report
  (`proposal-report-print.tsx`, `window.print()`) leads with a `buildProposalNarrative`
  Summary (`proposal-narrative.ts`) so the prospective report tells the story too.
- **Reports Hub tab auto-route:** when a contract is selected the hub narrows
  tabs (Overview / type / Calculations) and auto-routes to the type tab — that
  effect must fire ONLY on SELECTION change (tracked by a ref), not on every
  `activeTab` change, or Overview/Calculations bounce back and are unreachable
  (`reports-client.tsx` + `vendor-reports-hub-client.tsx`).
- **Vendor contract detail has ONE tab bar — never nest a second.**
  `VendorContractOverview` (`components/vendor/contracts/vendor-contract-overview.tsx`)
  OWNS the tab bar (Overview/Terms/Transactions/Amendments) AND the contract
  header + KPI cards. The detail page
  (`app/vendor/contracts/[id]/vendor-contract-detail-client.tsx`) merges its
  parity surfaces (Accruals / [Amortization, capital-like only] / Performance /
  Pricing / Documents) into that ONE bar via the component's optional
  `extraTabs: VendorContractExtraTab[]` prop, plus `overviewExtra` for extra
  content inside the Overview tab — it must NOT wrap `VendorContractOverview` in
  its own `<Tabs>` (that produced a doubled tab bar with a duplicate "Overview",
  Vick 2026-06-22 "the contract UI changed on the vendor side when you click
  in"). The OTHER consumer, `vendor-contract-edit-client.tsx`, renders
  `<VendorContractOverview contract={…} />` with neither prop (standalone) — so
  both props default empty and that surface is unchanged.

## Mobile / responsive conventions

- **Tab bars scroll, don't clip.** The shared `TabsList`
  (`components/ui/tabs.tsx`) is `max-w-full overflow-x-auto scrollbar-none` so a
  wide tab bar swipes on mobile (Tailwind v4 native `scrollbar-none` utility).
- **Page headers with action buttons stack on mobile:** `flex flex-col gap-4
  sm:flex-row sm:items-center sm:justify-between` + `flex-wrap` on the button row
  (not a fixed `flex items-center justify-between`, which overlaps the title).
- **Truncate inside a grid/flex needs `min-w-0` on the grid ITEM** (grid items
  default to `min-width:auto`), or the card grows to the un-truncated content and
  blows the page past the viewport (the admin-dashboard Recent-Activity overflow).
  Use `[&>*]:min-w-0` on the grid.
