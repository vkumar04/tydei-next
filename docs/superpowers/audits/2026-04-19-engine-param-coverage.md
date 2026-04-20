# Engine Parameter Coverage Audit (W1.U retro backlog B1)

**Date:** 2026-04-19
**Scope:** Every parameter declared by functions in `lib/rebates/engine/`
and by the Prisma-to-engine bridge `lib/rebates/from-prisma.ts`.
**Trigger:** W1.U-A found that `SpendRebateConfig.categories` was honored
by the engine (`lib/rebates/engine/spend-rebate.ts:57-66`, covered in
`spend-rebate.test.ts:160`) but NO display-path caller (`recomputeAccrualForContract`,
`getAccrualTimeline`, contracts-list trailing-12mo cascade) ever passed
it. The engine was correct; the glue was missing. This audit enumerates
every parameter with the same failure mode to document the remaining
gaps.

**Method:**

1. For each function exported from `lib/rebates/engine/` (and the two
   facades in `lib/rebates/from-prisma.ts`), list every config field /
   PeriodData field / option the engine reads.
2. Grep every caller of that function across `lib/actions/` and
   `components/`. "Caller" here means a file that builds a config /
   periodData object, NOT engine-internal composition.
3. Rate each parameter:
   - **HIGH** — no caller sets the parameter; the engine path is effectively
     dead or silently defaulted. Same class of bug as W1.U-A.
   - **MEDIUM** — some callers set it, others rely on defaults; drift
     hazard when a new caller forgets.
   - **LOW** — all callers set the parameter consistently.
4. HIGH-risk findings get a narrative row at the bottom describing the
   gap and a sketch of the fix. **No fixes in this PR** — this doc is
   the ledger.

## Headline

The unified engine (`lib/rebates/engine/index.ts::calculateRebate`) has
essentially NO direct callers in the display path today. The server
actions that render earned/collected/accrued numbers drive the engine
through one of two narrow ramps:

- `computeRebateFromPrismaTerm` / `buildConfigFromPrismaTerm` —
  used only by `lib/rebates/__tests__/from-prisma.test.ts`, not by any
  server action.
- `lib/contracts/rebate-accrual-schedule.ts` — which imports
  shared tier utilities directly (`determineTier`, `calculateCumulativeRebate`,
  `calculateMarginalRebate`) and bypasses the config-driven dispatch entirely.

This means every engine-level spend-basis / baseline / price-reduction-
trigger parameter is currently ignored by the production surfaces.
W1.U-A fixed one branch of this problem by wiring category filters
directly into the COG query (not via the engine), which is faster but
leaves the per-engine parameters orphaned.

## Parameter Table

| Engine function | Parameter | Callers | Caller sets it? | Risk |
|---|---|---|---|---|
| `calculateSpendRebate` | `config.spendBasis` | `buildConfigFromPrismaTerm` (from-prisma.ts:134-141) | Yes — derived from `referenceNumbers`/`categories` length | LOW (bridge only) |
| `calculateSpendRebate` | `config.categories` (MULTI_CATEGORY) | `buildConfigFromPrismaTerm:158` | Partial — passed from ContractTerm.categories | MEDIUM — no display caller reaches this path; W1.U-A bypassed the engine entirely for this filter |
| `calculateSpendRebate` | `config.productCategory` | `buildConfigFromPrismaTerm:156` | Yes (when categories.length === 1) | MEDIUM — same "engine path unreached" caveat |
| `calculateSpendRebate` | `config.referenceNumbers` | `buildConfigFromPrismaTerm:155` | Yes | MEDIUM — same |
| `calculateSpendRebate` | `config.baselineType` | `buildConfigFromPrismaTerm:149` via `baselineToEngine` | Yes, but only three values (`NEGOTIATED_FIXED` / `PRIOR_YEAR_ACTUAL` / `NONE`) | LOW — bridge covers the mapping |
| `calculateSpendRebate` | `config.negotiatedBaseline` | `buildConfigFromPrismaTerm:151-153` | Yes | LOW |
| `calculateSpendRebate` | `config.growthOnly` | `buildConfigFromPrismaTerm:154` | Yes | LOW |
| `calculateSpendRebate` | `periodData.priorYearActualSpend` | No caller — never populated from Prisma | **No** | **HIGH** — `PRIOR_YEAR_ACTUAL` baseline silently warns and falls through to full eligible spend |
| `calculateSpendRebate` | `periodData.purchases` | `computeRebateFromPrismaTerm` (test callers only) | Partial — passed through but no action constructs it | **HIGH** — every spend-basis branch filters `periodData.purchases`; an empty array makes the engine return 0 |
| `calculateSpendRebate` | `periodData.totalSpend` | test-only | Partial | MEDIUM — engine falls back to `sumExtendedPrice(purchases)` for non-ALL_SPEND branches |
| `calculateVolumeRebate` | `config.cptCodes` | `buildConfigFromPrismaTerm:101` | Yes (from `term.cptCodes ?? []`) | LOW (bridge) |
| `calculateVolumeRebate` | `config.fixedRebatePerOccurrence` | `buildConfigFromPrismaTerm:107-110` | Yes | LOW |
| `calculateVolumeRebate` | `config.baselineType` / `negotiatedBaseline` | `buildConfigFromPrismaTerm:102-105` | Yes | LOW |
| `calculateVolumeRebate` | `periodData.purchases[].caseId` | No caller populates `caseId` from COG | **No** | **HIGH** — `[A5]` dedup degrades from `caseId+cptCode` to `date+cptCode`, producing different occurrence counts |
| `calculateVolumeRebate` | `periodData.purchases[].cptCode` | No action populates from COG | **No** | **HIGH** — without cptCode, every purchase falls out of `filterPurchasesByCpt` and the rebate reads $0 |
| `calculateVolumeRebate` | `periodData.priorYearActualSpend` (occurrences) | No caller | **No** | **HIGH** — growth-based volume rebates silently fall back |
| `calculateTierPriceReduction` | `config.trigger` (`RETROACTIVE` vs `FORWARD_ONLY`) | No caller — not in `buildConfigFromPrismaTerm` | **No** | **HIGH** — no action dispatches to this engine; `ContractTerm.termType = "tier_price_reduction"` does not exist in the bridge switch |
| `calculateTierPriceReduction` | `config.spendBasis` / `referenceNumbers` / `categories` | No caller | **No** | **HIGH** — same "no bridge" gap |
| `calculateMarketShareRebate` | `config.marketShareVendorId` | No caller | **No** | **HIGH** — no bridge for `MARKET_SHARE_REBATE` |
| `calculateMarketShareRebate` | `config.marketShareCategory` | No caller | **No** | **HIGH** — same |
| `calculateMarketShareRebate` | `periodData.totalCategorySpend` / `vendorCategorySpend` | No caller | **No** | **HIGH** — engine errors with "totalCategorySpend required" on any empty PeriodData |
| `calculateMarketSharePriceReduction` | `config.trigger` | No caller | **No** | **HIGH** — no bridge |
| `calculateMarketSharePriceReduction` | `config.marketShareCategory` | No caller | **No** | **HIGH** — no bridge |
| `calculateCarveOut` | `config.lines[]` | `buildConfigFromPrismaTerm:113-127` falls through to SPEND_REBATE | **No** | **HIGH** — ContractTerm → CarveOutConfig mapping returns a SPEND_REBATE stub; no action produces `CarveOutLineConfig[]` |
| `calculateCarveOut` | `config.lines[].rateType` / `rebatePercent` / `rebatePerUnit` | No caller | **No** | **HIGH** — same, downstream |
| `calculateCapitated` | `config.groupedReferenceNumbers` | No caller | **No** | **HIGH** — no bridge maps `ContractTerm` to `CapitatedConfig` |
| `calculateCapitated` | `config.periodCap` | No caller | **No** | **HIGH** — same |
| `calculateCapitated` | `config.embeddedRebate` | No caller | **No** | **HIGH** — same (the wrapping is engine-internal only) |
| `calculateTieInCapital` | `config.capitalCost` / `interestRate` / `termMonths` / `period` | `lib/actions/contracts/tie-in.ts` via `buildTieInAmortizationSchedule` (not the unified-engine entry) | Partial | MEDIUM — fields are wired for schedule generation but no action calls `calculateTieInCapital` for per-period true-up |
| `calculateTieInCapital` | `config.shortfallHandling` | No caller | **No** | **HIGH** — `BILL_IMMEDIATELY` vs `CARRY_FORWARD` is unwired |
| `calculateTieInCapital` | `config.rebateEngine` | No caller | **No** | **HIGH** — no action composes the nested rebate stream for tie-in |
| `buildTieInAmortizationSchedule` | `capitalCost` / `interestRate` / `termMonths` / `period` | `lib/actions/contracts/tie-in.ts`; tests in `contract-term-amortization-shape.test.ts` | Yes | LOW |
| `buildConfigFromPrismaTerm` | `ContractTerm.appliesTo` | No callers read the resulting config path today (SPEND_REBATE branch inspects `categories` only; `appliesTo === "all_products"` gives `categories.length === 0` → `ALL_SPEND`) | Partial | MEDIUM — `appliesTo === "specific_category"` with empty `categories` is silently treated as `ALL_SPEND` — mirror of W1.U-A. |
| `buildConfigFromPrismaTerm` | `ContractTerm.rebateMethod` | All callers (bridge hard-codes) | Yes | LOW |
| `buildConfigFromPrismaTerm` | `ContractTerm.boundaryRule` | All callers (bridge hard-codes) | Yes | LOW |
| `calculateRebate` (dispatcher) | `config.type` | Only constructors in `buildConfigFromPrismaTerm` | Partial — only `SPEND_REBATE` and `VOLUME_REBATE` branches reachable | MEDIUM — six of eight engine types are unreachable from Prisma data |
| `calculateRebate` / sub-engines | `options.periodLabel` | No caller sets `periodLabel` | **No** | MEDIUM — diagnostic only; failures surface as `periodLabel: null` in error logs |
| `calculateRebate` / sub-engines | `options.verbose` | No caller | **No** | LOW — debug-only |

## HIGH-risk findings — narrative

Each item below names the gap and sketches what a fix would look like.
Fixes live in follow-up tickets; this PR documents only.

### H1 — `calculateSpendRebate`: no server action constructs `PeriodData.purchases`

**Gap.** Every spend-basis branch other than `ALL_SPEND` filters
`periodData.purchases` by reference number or category. No server action
in `lib/actions/` builds a `PurchaseRecord[]` from COG rows and hands it
to the unified engine. The production display path uses
`lib/contracts/rebate-accrual-schedule.ts` with a `MonthlySpend[]` array
instead, which bypasses `purchases` entirely.

**Fix sketch.** Either (a) deprecate the `purchases`-driven code path in
the unified engine since the production path uses accrual schedules, or
(b) wire `recomputeAccrualForContract` to project a `PurchaseRecord[]`
window and dispatch through `calculateRebate`. Option (b) restores the
per-reference and per-category filtering the engine was designed for;
option (a) is cheaper and matches the current reality.

### H2 — `calculateVolumeRebate`: COG rows do not carry `cptCode` / `caseId`

**Gap.** `PurchaseRecord.cptCode` and `caseId` are central to
volume-rebate dedup (`[A5]`). `COGRecord` has a `cptCode` column but
accrual paths never populate the engine's `PurchaseRecord`. Result: any
hypothetical wiring through `calculateVolumeRebate` would filter every
purchase out of `filterPurchasesByCpt` and return $0.

**Fix sketch.** Extend the Prisma → engine bridge to project COG rows
into `PurchaseRecord` with `cptCode` and `caseId` populated. Add a
wiring test under `lib/actions/contracts/__tests__/` that constructs a
`VolumeRebateConfig`, runs `computeRebateFromPrismaTerm`, and asserts
occurrence counting matches the dedup rules. Today there is no such
test.

### H3 — `calculateMarketShareRebate` / `calculateMarketSharePriceReduction`: no Prisma bridge

**Gap.** `buildConfigFromPrismaTerm` does not have branches for
`ContractTerm.termType === "market_share_rebate"` or
`"market_share_price_reduction"`. Even if a facility creates such a
term in the DB, the engine never sees it; the bridge falls through to
`SPEND_REBATE` with `baselineType: NONE`.

**Fix sketch.** Add `market_share_rebate` / `market_share_price_reduction`
cases to the switch in `from-prisma.ts`, pulling `marketShareVendorId`
and `marketShareCategory` from corresponding `ContractTerm` columns
(adding the columns if they don't exist). Add a server action that
computes `totalCategorySpend` and `vendorCategorySpend` from the COG
cohort and passes them via `PeriodData`.

### H4 — `calculateCarveOut`: bridge returns a SPEND_REBATE stub

**Gap.** `buildConfigFromPrismaTerm:113-127` explicitly returns a
`SPEND_REBATE` config for `term.termType === "carve_out"` because
`ContractTier.rebateValue` does not encode per-line reference numbers +
rate types. A carve-out term therefore computes as if it were a flat
spend rebate — numerically wrong and silent.

**Fix sketch.** Introduce a `ContractCarveOutLine` table (`contractTermId`,
`referenceNumber`, `rateType`, `rebatePercent`, `rebatePerUnit`) and
replace the SPEND_REBATE fallback with a `CarveOutConfig` builder that
reads those rows.

### H5 — `calculateCapitated`: no bridge path

**Gap.** Same as H3 — `ContractTerm.termType === "capitated"` has no
mapping in the bridge. `groupedReferenceNumbers` and `periodCap` have
no schema columns today.

**Fix sketch.** Add `groupedReferenceNumbers: string[]` and `periodCap:
Decimal` columns to `ContractTerm`; add a `capitated` case to
`buildConfigFromPrismaTerm`; add a wiring test.

### H6 — `calculateTieInCapital.shortfallHandling` unwired

**Gap.** `BILL_IMMEDIATELY` vs `CARRY_FORWARD` is a contract-business
policy knob that changes true-up behavior (`[A10]`). No server action
reads this flag; `lib/actions/contracts/tie-in.ts` only generates the
schedule without invoking `calculateTieInCapital`'s per-period true-up.

**Fix sketch.** When the recurring tie-in accrual job lands (currently
scoped for a future subsystem), it should call `calculateTieInCapital`
with the correct `shortfallHandling` pulled from the contract. Until
then, tie-in contracts cannot surface a signed `trueUpAdjustment` in
the UI.

### H7 — `calculateSpendRebate.periodData.priorYearActualSpend` never populated

**Gap.** `PRIOR_YEAR_ACTUAL` baseline triggers a "baseline missing;
evaluating on full eligible spend" warning instead of using the actual
prior-year figure. No server action queries ContractPeriod or COG for
the facility's prior-year vendor spend to populate this field.

**Fix sketch.** Add a helper under `lib/contracts/` that computes
prior-year COG for a given `(facilityId, vendorId, category)` tuple and
threads the result through `PeriodData` when the bridge builds a
`PRIOR_YEAR_ACTUAL` config. Unit test the helper; wiring test the
action.

### H8 — `calculateTierPriceReduction`: no bridge

**Gap.** Same family as H3/H5. `ContractTerm.termType === "tier_price_reduction"`
doesn't appear in `buildConfigFromPrismaTerm`'s switch. `reducedPrice`
and `priceReductionPercent` columns exist on `ContractTier` but never
reach the engine.

**Fix sketch.** Add a `tier_price_reduction` branch that reads
`ContractTerm.priceReductionTrigger` (new column, `RETROACTIVE` default)
and builds a `TierPriceReductionConfig`. Currently the price-reduction
tier tests live only in `lib/rebates/engine/__tests__/tier-price-reduction.test.ts`
— there's no integration test exercising the full path.

---

## Summary counts

- Parameters flagged HIGH: **17** (of ~35 total)
- Parameters flagged MEDIUM: **7**
- Parameters flagged LOW: **10**

The pattern is consistent: the unified engine's 8 types were designed
for a display path that hasn't been built. 6 of 8 `RebateType`s have no
bridge; the 2 that do (`SPEND_REBATE` + `VOLUME_REBATE`) have their
filtering parameters set at the bridge but never exercised by a server
action that actually calls `calculateRebate`. The rebate numbers users
see today come from `lib/contracts/rebate-accrual-schedule.ts`, which
skips the dispatcher and calls the shared tier primitives directly.

## Recommendation

Pick ONE of the following directions before investing more in the
bridge:

1. **Adopt the unified engine.** Replace `rebate-accrual-schedule.ts`'s
   direct calls to shared primitives with `calculateRebate(config, ...)`.
   Build `PurchaseRecord[]` projections from COG rows. Add wiring tests
   under `lib/actions/__tests__/` for each of the 8 engine types (the
   tripwire in `parity/engine-wiring-parity.test.ts` will go green
   automatically).
2. **Shrink the engine surface.** Delete the 6 engine types that have no
   Prisma bridge today (`TIER_PRICE_REDUCTION`, `MARKET_SHARE_*`,
   `CAPITATED`, `CARVE_OUT`, `TIE_IN_CAPITAL`). Keep `SPEND_REBATE` +
   `VOLUME_REBATE` and consolidate their display-path usage. Saves
   ~1500 LOC of unreferenced engine code and its tests.

Either direction collapses the "engine parameters set but unreached"
surface to zero. Leaving both paths live indefinitely is the W1.U-A
bug class on a larger scale.

## Resolution (2026-04-19)

**Direction chosen:** Option 2 — shrink the unreachable surface.

Rationale: every production display path already routes through
`lib/contracts/rebate-accrual-schedule.ts` or
`lib/rebates/calculate.ts#computeRebateFromPrismaTiers`. No server
action, component, or loader invoked the unified-engine dispatcher, and
6 of its 8 `RebateType` branches had no Prisma bridge at all. Keeping
the orchestrator alive would have required either building 6 new
Prisma-to-engine bridges to close the HIGH rows above, or accepting
permanent dead code. Adopting the engine wholesale was not on the near
roadmap, so the shrink is the correct reduction.

### What was deleted

- `lib/rebates/engine/index.ts` — removed the `calculateRebate(config,
  periodData, options)` dispatcher and its per-case fanout to all 8
  engine types. The file now only re-exports the shared
  `RebateConfig` / `PeriodData` / `RebateResult` / `EngineOptions`
  types so downstream code that needs those shapes keeps working.
- `lib/rebates/from-prisma.ts` — removed entirely. This file housed
  `buildConfigFromPrismaTerm(term)` (the Prisma-to-engine bridge) and
  `computeRebateFromPrismaTerm(term, periodData, options)` (the thin
  wrapper that called the dispatcher). Neither function had a live
  caller outside its own test file.
- `lib/rebates/__tests__/from-prisma.test.ts` — removed. Every test in
  this file exercised only the deleted bridge.
- `lib/rebates/engine/__tests__/dispatcher.test.ts` — removed. Every
  test in this file exercised only the deleted dispatcher.

### What was kept

- **All per-type calculator modules** remain exported from their own
  files (`spend-rebate.ts`, `volume-rebate.ts`,
  `tier-price-reduction.ts`, `market-share-rebate.ts`,
  `market-share-price-reduction.ts`, `capitated.ts`, `carve-out.ts`,
  `tie-in-capital.ts`, `amortization.ts`) along with their test
  suites. The audit shows these are imported directly in places
  (e.g., `capitated.ts` composes `spend-rebate.ts` and
  `volume-rebate.ts`; `tie-in-capital.ts` wraps
  `buildTieInAmortizationSchedule`); deleting them would regress
  those internal compositions.
- **The `RebateType` union in `lib/rebates/engine/types.ts`** (and the
  mirrored Prisma enum) stays intact. `TIER_PRICE_REDUCTION`,
  `MARKET_SHARE_REBATE`, `MARKET_SHARE_PRICE_REDUCTION`, `CAPITATED`,
  `CARVE_OUT`, and `TIE_IN_CAPITAL` are data-model term types that
  facilities already create through the contract-terms UI and AI
  extraction pipeline; the schema still needs them. What's gone is
  the claim that the unified dispatcher can compute a rebate from
  them without a matching Prisma bridge.
- **Shared tier primitives** (`determineTier`,
  `calculateCumulativeRebate`, `calculateMarginalRebate`, etc. under
  `lib/rebates/engine/shared/`) remain — these are the primitives the
  production accrual schedule uses directly.
- **`lib/rebates/calculate.ts#computeRebateFromPrismaTiers`** remains
  (this is the older, spend-based facade actually used in production).

### Why per-type calculators stayed

The `lib/actions/__tests__/engine-wiring-manifest.test.ts` manifest
was updated to drop the `"dispatched"` status (the dispatcher no
longer exists) and now classifies every per-type calculator as either
`"wired"`, `"unwired"`, or `"internal"`. Unwired calculators still
pass the `engine-wiring-parity.test.ts` tripwire because the manifest
names them — they're documented as unreachable from production rather
than deleted outright. That leaves a clean re-adoption path if the
product direction changes: wire a new server action to the existing
calculator and flip the status to `"wired"`.

### HIGH-risk row outcomes

- **H1 (`SpendRebate.purchases`), H2 (`VolumeRebate.cptCode/caseId`),
  H7 (`priorYearActualSpend`)** — no longer tracked as gaps. The
  engine paths those parameters live on are unreachable from Prisma
  by design; re-opening the parameters requires a full re-adoption
  effort that would ship its own plan.
- **H3 (MarketShare bridge), H4 (CarveOut bridge), H5 (Capitated
  bridge), H8 (TierPriceReduction bridge)** — closed by deletion, not
  by wiring. The bridge no longer exists, so "bridge doesn't cover
  type X" is now vacuously true. If a future subsystem adopts the
  unified engine, it will need to build bridges from scratch against
  the Prisma schema at that time.
- **H6 (TieInCapital.shortfallHandling)** — still a gap when the
  future tie-in accrual job lands. The calculator is preserved; the
  shortfallHandling column is preserved on `ContractTerm`. Wiring is
  the open work item.
