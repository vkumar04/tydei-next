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
- **DB:** `postgresql://tydei:tydei_dev_password@localhost:5432/tydei` (local).
  **Primary demo facility is "Lighthouse Surgical Center"** — it's what
  `scripts/qa-sanity.ts getDemoFacility()` targets and what the seed
  loads most COG/contracts against. "Lighthouse Community Hospital" is
  the secondary; easy to confuse — always match by `name`, never by
  hard-coded cuid. IDs regenerate on every `bun run db:seed`, so any
  literal `cmo6j6fx…`-style cuid you find in older notes is stale.
- **No `any` in TypeScript.** Strict mode is on; use proper types.
- **Server actions** live under `lib/actions/`. `"use server"` files can ONLY
  export async functions (interfaces/types are fine — they're erased).
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
  only rows with a `collectionDate` set. See:
  - `docs/superpowers/specs/2026-04-18-contracts-rewrite.md` (cross-cutting rule)
  - `docs/superpowers/specs/2026-04-18-contracts-list-closure.md` Subsystem 1
- **Canonical "Collected" aggregate:** every surface that renders a "Rebates
  Collected" number (contracts list, contract detail header card, contract
  Transactions tab summary card, dashboard, reports) MUST go through
  `sumCollectedRebates` in `lib/contracts/rebate-collected-filter.ts`. Do not
  hand-roll a `r.collectionDate ? ... : ...` reducer — the helper is the one
  place the filter lives so surfaces cannot drift. See Charles W1.R.
- **Rebate engine units:** `ContractTier.rebateValue` is stored as a fraction
  (0.02 = 2%). The math engine in `lib/contracts/rebate-method.ts` expects integer
  percent. `computeRebateFromPrismaTiers` and `lib/contracts/tier-rebate-label.ts`
  scale by 100 at the Prisma boundary — don't hand-roll the conversion elsewhere.
- **Specs live in `docs/superpowers/specs/`** as `YYYY-MM-DD-<topic>-design.md`.
  **Plans live in `docs/superpowers/plans/`** as `YYYY-MM-DD-<topic>.md`.
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

| Invariant | Canonical helper | File | Used by | Oracle |
|---|---|---|---|---|
| Rebates Collected (lifetime) | `sumCollectedRebates` | `lib/contracts/rebate-collected-filter.ts` | contracts-list, contract-detail header, Transactions tab, dashboard, reports | `scripts/oracles/full-sweep.ts` |
| Rebates Earned (lifetime) | `sumEarnedRebatesLifetime` | `lib/contracts/rebate-earned-filter.ts` | **contracts-list earned column** (Charles iMessage 2026-04-20 N13 "make that lifetime"), contract-detail Transactions tab "Total Rebates (Lifetime)" card (`components/contracts/contract-transactions.tsx` via `mapRebateRowsToLedger`), reports overview. Regression-guarded by `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts` "W2.A.3" block | `scripts/oracles/full-sweep.ts` |
| Rebates Earned (YTD) | `sumEarnedRebatesYTD` | `lib/contracts/rebate-earned-filter.ts` | contract-detail "Earned (YTD)" card | `scripts/oracles/ytd-earned-engine.ts` (engine-input) + `scripts/oracles/ytd-earned.ts` (real-data) |
| COG in-term-scope | `buildCategoryWhereClause` / `buildUnionCategoryWhereClause` | `lib/contracts/cog-category-filter.ts` | `recomputeAccrualForContract`, `getAccrualTimeline`, contracts-list trailing-12mo cascade | `scripts/oracles/cog-in-term-scope.ts` |
| Contract ownership | `contractOwnershipWhere` / `contractsOwnedByFacility` | `lib/actions/contracts-auth.ts` | every read in `lib/actions/` that takes a `contractId` | _N/A — auth invariant, not numeric_ |
| Rebate-units scaling | `computeRebateFromPrismaTiers` + `formatTierRebateLabel` | `lib/rebates/calculate.ts` + `lib/contracts/tier-rebate-label.ts` | every surface displaying % or earned from `ContractTier.rebateValue` | `scripts/oracles/full-sweep.ts` (cumulative + marginal calc engine) |
| Rebate applied to capital (tie-in) | `sumRebateAppliedToCapital` | `lib/contracts/rebate-capital-filter.ts` | contract-header applied-to-capital sublabel (`tie-in-rebate-split.tsx`), Capital Amortization card Paid-to-Date + Rebates-Applied + Balance-Due (`contract-amortization-card.tsx` via `getContractCapitalSchedule.rebateAppliedToCapital`) | `scripts/oracles/capital-amortization.ts` (per-period principal/interest equality) |
| Per-category market share | `computeCategoryMarketShare` | `lib/contracts/market-share-filter.ts` | facility action `getCategoryMarketShareForVendor` (contract-detail Performance tab — `category-market-share-card.tsx`), vendor action `getVendorMarketShareByCategory` (vendor dashboard widget). Regression-guarded by `lib/actions/__tests__/market-share-parity.test.ts` | `scripts/oracles/market-share.ts` |
| Rebate forecast (12mo projection) | `getRebateForecast` | `lib/actions/analytics/rebate-forecast.ts` | contract-detail Performance tab (`components/contracts/analytics/rebate-forecast-card.tsx`) | `scripts/oracles/rebate-forecast.ts` (gross-drift detector) |
| Schema-level data invariants | _N/A — substrate, not a single helper_ | — | every read assumes these hold (date order, no negative rebate sums, status/expirationDate consistency, tie_in has capital structure, etc.) | `scripts/oracles/schema-invariants.ts` |
| End-to-end pipeline (importer → recompute) | _N/A — composite of helpers_ | — | every customer-facing aggregate after import + recompute (`runScenario`) | `scripts/oracles/source-scenarios.ts` (5 synthetic scenarios) |
| Persisted derived metrics (`Contract.complianceRate`, `currentMarketShare`, `annualValue`) | `refreshContractMetrics` (single contract) + `refreshContractMetricsForVendor` (bulk) | `lib/actions/contracts/refresh-metrics.ts` | auto-fired by `bulkImportCOGRecords` after the COG + match recompute pipeline; piggybacks on the contract-detail "Recompute Earned Rebates" button. Strategic-direction Plan #1 — these fields are now COMPUTED, not manually entered. The form still allows override during the transition; future work removes the manual paths entirely. | `lib/actions/contracts/__tests__/refresh-metrics.test.ts` (parity test) |

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

The v0 prototype lives at `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/`. When the
user asks to port v0 features, treat that path as the read-only reference — the
spec/plan documents the gap; subagents implement against tydei's Prisma + Next
architecture, not v0's localStorage stores.
