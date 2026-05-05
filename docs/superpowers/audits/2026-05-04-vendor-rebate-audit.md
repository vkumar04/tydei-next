---
date: 2026-05-04
scope: vendor portal + rebate canonical-helper coverage + Charles canonical engine diff
branch: claude/v1-port-deferred-features
---

# Vendor + Rebates Audit — 2026-05-04

Two audits combined into one report:

1. **Part A** — Walk every `/vendor/*` route, verify auth, real-data wiring, rebate-helper compliance
2. **Part B** — Diff Charles Weidman's canonical "Unified Rebate Calculation Engine" spec against tydei's current implementation

---

## TL;DR

- **No ship blockers on math correctness** for surfaces that are actually wired.
- **4 numeric drift findings** in production surfaces — all single-line reducer swaps. None crash, none leak auth; they under-report rebate aggregates because they pull from sparse `ContractPeriod._sum` instead of canonical `Rebate`-row helpers.
- **7 of 8 per-type rebate engines are unreachable from production.** They live in `lib/rebates/engine/*.ts`, look like the canonical engine Charles described, but no server action calls them. CARVE_OUT is the only one wired. Display + recompute paths re-derive tier math via `determineTier` + hand-rolled bracket sums.
- **No single `calculateRebate(config, periodData)` dispatcher** — the dispatcher was deliberately deleted (`lib/rebates/engine/index.ts:1-20`) because nothing called it. Charles's spec says there should be one.
- **`allocateRebatesToProcedures` (true-margin allocation) is dead code** — exists at `lib/contracts/true-margin.ts:35`, has tests, no UI consumer.
- **Vendor portal auth is clean across all 17 routes.** No raw session checks, no missing gates.

---

## Part A — Vendor portal walk

| Route | Renders | Auth | Real data | Rebate fields | Bugs/drift |
|---|---|---|---|---|---|
| `/vendor` (redirect) | yes | layout `requireVendor()` | redirect | none | clean |
| `/vendor/dashboard` | yes | both | yes | `totalRebates` hero KPI | **DRIFT-1**: from `ContractPeriod._sum(rebateEarned)` instead of `sumEarnedRebatesLifetime` |
| `/vendor/contracts` | yes | both | yes | none in list | clean |
| `/vendor/contracts/new` | yes | both | yes | none | clean |
| `/vendor/contracts/[id]` | yes | both | yes | header card "Rebate Earned" + "X collected" sublabel; Transactions tab | uses canonical helpers correctly |
| `/vendor/contracts/[id]/edit` | yes | both | yes (ChangeProposal flow) | n/a | clean |
| `/vendor/contracts/pending/[id]/edit` | yes | both | yes | n/a | clean |
| `/vendor/ai-agent` | yes | both | yes | none directly | clean |
| `/vendor/alerts` | yes | both | yes | none | clean |
| `/vendor/invoices` | yes | both | yes | none | clean |
| `/vendor/market-share` | yes | both | yes | none (spend share, not rebates) | clean |
| `/vendor/performance` | yes | both | yes | "Rebate Paid" per-row + "Total Paid YTD" + "Effective Rate" + tier ladder | **DRIFT-2**: "Total Paid YTD" label on lifetime data; **DRIFT-3**: `t.rebateValue * 100` direct scaling at `vendor-analytics.ts:452` |
| `/vendor/prospective` | yes | both | yes | rebate forecasts in proposal builder | clean |
| `/vendor/purchase-orders` | yes | both | yes | none | clean |
| `/vendor/renewals` | yes | both | yes | `totalRebate` per pipeline card | **DRIFT-4**: from `getExpiringContracts` reducer over `c.periods.rebateEarned` (renewals.ts:90,138) |
| `/vendor/reports` | yes | both | **stub data** — `defaultRecentReports` static array | "Rebate Statement" tile (visual only) | **STUB-1**: report listing is static; only the leakage card is real |
| `/vendor/settings` | yes | both | yes | none | clean |

### Drift detail

- **DRIFT-1** — `lib/actions/vendor-dashboard.ts:31,60` aggregates `prisma.contractPeriod.aggregate({_sum:{rebateEarned}})`. Per CLAUDE.md and the W1.U-B parity test, lifetime-earned must come from `Rebate` rows via `sumEarnedRebatesLifetime`. Same shape of drift the contract-detail page was fixed for in 2026-04-26 Bug 3.
- **DRIFT-2** — `components/vendor/performance/performance-rebates-tab.tsx:268` labels the reducer total as "Total Paid YTD", but `totalRebatesPaid` (line 173 of `performance-client.tsx`) sums `c.rebatePaid` which is `sumEarnedRebatesLifetime`. Either swap label to "Lifetime" or change `getVendorPerformanceContracts` to compute YTD via `sumEarnedRebatesYTD`.
- **DRIFT-3** — `lib/actions/vendor-analytics.ts:452` does `Number(t.rebateValue ?? 0) * 100`. Comment acknowledges the rule. Should call `formatTierRebateLabel` or `scaleRebateValueForEngine`. Math correct today; off-canonical.
- **DRIFT-4** — `lib/actions/renewals.ts:90,138` reduces over `c.periods.rebateEarned`. Affects BOTH facility + vendor renewals pages. Fix shape: include `rebates: { ... }` in the prisma query and reduce via `sumEarnedRebatesLifetime`.
- **STUB-1** — `/vendor/reports` operates entirely on local state. `defaultRecentReports` is hard-coded; "Generate" runs a `setInterval` progress bar. Only `VendorPurchaseLeakageCard` calls a real action. Adjacent `lib/actions/vendor-reports.ts.getVendorReportData` exists but is not consumed (and itself reads only the most-recent ContractPeriod, so it'd also be drifted if wired up).

### Defensive-depth note (low)

- `lib/actions/vendor-purchase-orders.ts:191` — `prisma.contract.findUnique({ where: { id: input.contractId } })` followed by an explicit `contract.vendorId !== vendor.id` check on line 195. Safe pattern; should carry a `// auth-scope-scanner-skip:` comment to keep the scanner test honest.

---

## Part B — Charles canonical engine vs tydei diff

Charles's canonical "Unified Rebate Calculation Engine" specifies 8 supported rebate types behind a single `calculateRebate(config, periodData, options)` dispatcher, with shared helpers (`determineTier`, `getNextTier`, `calculateCumulativeRebate`, `calculateMarginalRebate`, `resolveBaseline`, `filterPurchasesByBasis`), a standardized `RebateResult` shape, and two adjacent canonical helpers: `allocateRebatesToProcedures` (true margin) and `detectPriceDiscrepancies` (COG variance).

### Per-type implementation status

| Rebate type | Tydei impl | Behavior matches? | Wired in prod? |
|---|---|---|---|
| SPEND_REBATE | `lib/rebates/engine/spend-rebate.ts` | yes (full ALL_SPEND/REF/CATEGORY filters, both baselines, growthOnly, fixedRebate precedence) | **NO** — no production caller |
| VOLUME_REBATE | `lib/rebates/engine/volume-rebate.ts` | yes (caseId+cptCode dedup, occurrence baselines) | **NO** — `recompute/volume.ts:202` re-implements by hand |
| TIER_PRICE_REDUCTION | `lib/rebates/engine/tier-price-reduction.ts` | yes (RETROACTIVE/FORWARD_ONLY, per-line `priceReductionLines`) | **NO** (only as embedded sub-engine in CAPITATED) |
| MARKET_SHARE_REBATE | `lib/rebates/engine/market-share-rebate.ts` | yes (% threshold separate from $ calc, fatal errors on missing data) | **NO** — `market-share-filter.ts` only computes share %, not rebate |
| MARKET_SHARE_PRICE_REDUCTION | `lib/rebates/engine/market-share-price-reduction.ts` | yes | **NO** |
| CAPITATED | `lib/rebates/engine/capitated.ts` | yes (eligibleSpend = min(group, cap), warns on cap exceedance) | **NO** |
| **CARVE_OUT** | `lib/rebates/engine/carve-out.ts` | yes (PERCENT_OF_SPEND + FIXED_PER_UNIT) | **YES** — `recompute/carve-out.ts:200`, `actions/contracts/carve-out.ts:127` |
| TIE_IN_CAPITAL | `lib/rebates/engine/tie-in-capital.ts` + `amortization.ts` | yes (PMT formula, all 3 cadences, signed trueUpAdjustment) | **schedule yes**, per-period evaluator NO — true-up via `rebate-capital-filter.ts` instead |

### Dispatcher

**Tydei does NOT have a single switch-on-type `calculateRebate` dispatcher.** `lib/rebates/engine/index.ts` is now a type barrel only (the dispatcher was deliberately deleted, see comment lines 1-20). `lib/rebates/calculate.ts#calculateRebate` exists but only switches `cumulative` vs `marginal` for flat-tier inputs; it does not route by `RebateType`.

### Tier mechanics — where they live

- CUMULATIVE: `lib/rebates/engine/shared/cumulative.ts`
- MARGINAL: `lib/rebates/engine/shared/marginal.ts` (audit fix [A2] applied — no cent rounding)
- EXCLUSIVE boundary: `determine-tier.ts:46`. All flat-tier callers via `lib/rebates/calculate.ts:122,163` HARDCODE `"EXCLUSIVE"`.
- INCLUSIVE boundary: implemented at `determine-tier.ts:44`, reachable only through per-type engines.
- **Inverted naming caveat** documented in `determine-tier.ts:7-23` — "INCLUSIVE" here means "boundary belongs to lower tier" (math-textbook reading is reversed).

### Standardized RebateResult shape

Per-type engines return a roughly-Charles-shaped `RebateResult` (`types.ts:286-314`). Differences from Charles's spec:

- No top-level `growthSpend`, `baseline`, `nextTier`, `amountToNextTier` (last lives inside `tierResult.amountToNextTier`)
- No top-level `marketSharePercent` (lives inside `tierResult.thresholdReached` for share types)
- No structured `capitatedSpend`, `periodCap`, `capExceededBy` (cap data is in warning strings only)
- No structured `cumulativeRebateEarned`, `remainingCapitalBalance`, `shortfall`, `shortfallHandling`, `carriedForwardShortfall` (lives inside nested `amortizationEntry`)
- No `priorAccruals`, `cptOccurrences`, `effectiveUnitPrice` aggregate

The flat-tier `RebateResult` in `lib/rebates/calculate.ts:195-200` is a **separate shape** (`tierAchieved`, `rebatePercent`, `rebateEarned`, `rebateCollected`) — this is what every production surface actually consumes.

### Adjacent canonical helpers

- **`allocateRebatesToProcedures`**: implemented at `lib/contracts/true-margin.ts:35-53`. **Zero production callers** — only consumed by tests. No `/dashboard/reports/true-margin` page invokes it. Charles's [A9] enhancements (zero-reimbursement guard, `priceReductionAllocation`, `totalContractBenefit`) are NOT present.
- **`detectPriceDiscrepancies`**: tydei's equivalent is `analyzePriceDiscrepancies` in `lib/contracts/price-variance.ts:128`. **Wired to production** via `lib/data-pipeline/invoice-variance.ts`, `lib/actions/contracts/insights.ts`, and `lib/actions/reports.ts#getPriceDiscrepancies` (consumed by price-discrepancy page and `price-variance-dashboard.tsx`). Severity bands 2%/5% match Charles. Direction enum naming differs (`"at_price"` vs `"MATCH"`, lowercase vs uppercase) — functional, not source-compatible.

### Type-system mismatch

Engine types use `SPEND_REBATE | VOLUME_REBATE | …` (uppercase, 8 values); Prisma `RebateType` enum is `percent_of_spend | fixed_rebate | fixed_rebate_per_unit | per_procedure_rebate` (lowercase, 4 values). `computeRebateFromPrismaTiers` only handles 2 of the 4 Prisma values; returns 0 for the unit-based ones (line 371-381). **No bridge from Prisma's flat tier rows to engine's `RebateConfig` discriminated union exists.**

### Missing CONFIGURABLE values

- `TierPriceReductionConfig.priceReductionTrigger` — Charles spec includes RETROACTIVE | FORWARD_ONLY | **CONFIGURABLE**. tydei has only the first two.
- `TieInCapitalConfig.shortfallHandling` — Charles spec includes BILL_IMMEDIATELY | CARRY_FORWARD | **CONFIGURABLE**. tydei has only the first two.

---

## Top gaps (sorted by severity)

1. **Per-type engines are unreachable from production** (CARVE_OUT excepted). 7 of 8 calculators in `lib/rebates/engine/*.ts` have NO server-action callers. Display + recompute paths re-derive tier math. Net: baseline math, growthOnly, MULTI_CATEGORY filtering, market-share rebate dollars, capitated cap math, per-period tie-in true-up are **dead code on customer-visible surfaces**.
2. **No single `calculateRebate(config, periodData)` entry point.** Deliberately removed. Callers must know which per-type engine to import — and most don't, so they hand-roll.
3. **`allocateRebatesToProcedures` (true margin) is dead** — exported, tested, no UI consumer. True-margin reporting not surfaced.
4. **RebateResult shape lacks several Charles fields** at the top level. Cap overage info lives only in warning strings — fragile for any caller that wants to render it.
5. **DRIFT-1 + DRIFT-4** — production aggregates under-report rebate totals on vendor dashboard hero and renewals pipeline cards.
6. **Inverted INCLUSIVE/EXCLUSIVE naming** documented but unfixed. Production passes EXCLUSIVE only, so no math bug today.
7. **Missing CONFIGURABLE values** in two enums (PriceReductionTrigger, TrueUpShortfallHandling).
8. **Prisma `RebateType` ↔ engine `RebateConfig` bridge missing.** Unit-based tiers (`fixed_rebate_per_unit`, `per_procedure_rebate`) compute as 0.
9. **DRIFT-2 + DRIFT-3** — UI label and one-line scaling fix.
10. **STUB-1** — vendor /reports static.

---

## Ship classification

### BLOCKERS (won't ship)
None. Math is correct on wired surfaces. Auth is clean.

### KNOWN-GAPS (ship, file followups)
- DRIFT-1, 2, 3, 4 — single-line fixes; under-reporting today, not crashes
- 7 dead per-type engines — decide: wire them or delete them
- `allocateRebatesToProcedures` dead — wire to a true-margin page or delete
- Missing CONFIGURABLE enum values — add when an in-flight contract needs them
- Prisma↔engine bridge — needed before unit-based rebate tiers can be modeled

### CLEAN
- Auth across 17 vendor routes
- `sumCollectedRebates`, `sumEarnedRebatesLifetime`, `sumEarnedRebatesYTD`, `computeCategoryMarketShare`, `sumRebateAppliedToCapital`, `scaleRebateValueForEngine`, `refreshContractMetrics`
- `analyzePriceDiscrepancies` matches Charles's 2%/5% bands; wired to UI
- `calculateCarveOut` matches Charles AND is wired
- `buildTieInAmortizationSchedule` matches Charles (schedule wired; per-period evaluator routes through `rebate-capital-filter.ts` instead of the engine's `calculateTieInCapital`)
- Cumulative + Marginal helpers (audit fixes [A1]–[A4] applied)
- All 10 oracle scripts look executable against current code

---

## Files for caller to act on

- `/Users/vickkumar/code/tydei-next/lib/actions/vendor-dashboard.ts:31,60` — DRIFT-1
- `/Users/vickkumar/code/tydei-next/lib/actions/renewals.ts:90,138` — DRIFT-4 (affects facility + vendor)
- `/Users/vickkumar/code/tydei-next/components/vendor/performance/performance-rebates-tab.tsx:268` + `performance-client.tsx:173` — DRIFT-2
- `/Users/vickkumar/code/tydei-next/lib/actions/vendor-analytics.ts:452` — DRIFT-3
- `/Users/vickkumar/code/tydei-next/components/vendor/reports-client.tsx` + `lib/actions/vendor-reports.ts:34` — STUB-1
- `/Users/vickkumar/code/tydei-next/lib/actions/vendor-purchase-orders.ts:191` — defense-depth skip-comment
- `/Users/vickkumar/code/tydei-next/lib/rebates/engine/*.ts` — 7 dead per-type engines (decide: wire or delete)
- `/Users/vickkumar/code/tydei-next/lib/contracts/true-margin.ts:35` — dead `allocateRebatesToProcedures`

## Reference

Charles Weidman's canonical engine source was sent via email 2026-04-18; partial copy at `/tmp/charles-canonical.b64`. Future Claude sessions should ask the user for the full file before implementing engine changes.
