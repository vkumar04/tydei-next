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
| Rebate-units scaling (per `rebateType` — `percent_of_spend` ×100, all others unchanged) | `scaleRebateValueForEngine` (the owner) → consumed by `computeRebateFromPrismaTiers` + `formatTierRebateLabel` | `lib/rebates/calculate.ts` + `lib/contracts/tier-rebate-label.ts` | every Prisma→engine feed (`recompute-accrual.ts`, `accrual.ts`, `vendor-analytics.ts`, `prisma-engine-bridge.ts`, `scripts/regen-all-accruals.ts`) + every surface displaying % or earned from `ContractTier.rebateValue`. **Never blanket-×100** — inflates `fixed_rebate`/per-unit tiers 100×. Regression-guarded by `lib/contracts/__tests__/rebate-value-scaling-drift.test.ts` |
| Rebate applied to capital (tie-in) | `sumRebateAppliedToCapital` | `lib/contracts/rebate-capital-filter.ts` | contract-header applied-to-capital sublabel (`tie-in-rebate-split.tsx`), Capital Amortization card Paid-to-Date + Rebates-Applied + Balance-Due (`contract-amortization-card.tsx` via `getContractCapitalSchedule.rebateAppliedToCapital`) |
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
| Case reimbursement backfill (CPT payor-rate estimate when `Case.totalReimbursement` is 0) | `buildCptRateMap` + `resolveCaseReimbursement` | `lib/case-costing/cpt-rate-map.ts` | `getCases` (cases list), `getCaseCostingReportData` (case-costing report header), `getFacilityAveragesForFacility` (hero card), `calculatePayorMargins` (rate map only — per-case match bookkeeping stays local). **Why it exists (audit H5):** the rate-map builder was copy-pasted 3× and the report used raw stored reimbursement, so "Avg Margin" contradicted the tables beside it. SKU-class rule: never hand-roll a `cptRates` JSON parse — both `{cpt, rate}` and `{cptCode, rate}` shapes must be tolerated and the highest rate wins. |

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
