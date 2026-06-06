# Math Stabilization — Carveout, Reference Matching, Market Share, Baseline

**Date:** 2026-06-06
**Source:** Customer meeting with Charles Weidman (Jun 6, 2026, 10:07 EDT)
**Scope decision:** "Stabilize math first" — Charles named contract-mapping +
calculation correctness as the deployment prerequisite. The vendor-side build
(uploads, pending approvals, mirrored logic with blinded dollars) is explicitly
deferred to a later session/spec.

This spec covers five work units. Two are real code fixes (A, C), one is a
trivial UI add (B), one is a verification that only becomes a fix if a defect
reproduces (D), and one is a documentation deliverable for tomorrow's call (E).

---

## Background: what the meeting actually surfaced

Parallel root-cause investigation (read-only) reduced four reported "math bugs"
to four *different* situations:

1. **Carveout forecast / pricing column** — a real bug. Forecasts project $0 for
   carveout contracts.
2. **Per-category market share** — already fixed in code (commit `76f6bb4`,
   Jun 2, four days before the meeting). Needs reproduction, not a blind fix.
3. **Baseline vs. minimum-annual-purchase** — no bug; the two concepts are
   cleanly separated in code. Charles asked for *clarification*, plus there are
   genuine product questions only he can answer.
4. **Group reference-number matching** — a real gap. COG→contract matching never
   consults reference numbers; it is `vendorItemNo`-first with a fragile fuzzy
   vendor-name fallback.

---

## A · Carveout forecast — flat-rate projection (REAL FIX)

### Problem (root cause)

`lib/contracts/rebate-forecast-engine.ts:44` includes `"carve_out"` in
`SPEND_BASED_TERM_TYPES`, but carveout terms have **no tiers** by design
(`lib/rebates/engine/carve-out.ts`: "There are no tiers: each line is a flat
rate"). The term-selection logic at `rebate-forecast-engine.ts:94-100` looks for
a spend-based term *with tiers* (`t.tiers.length > 0`); for carveouts that
condition always fails, so `tiers` resolves to `[]` and `projectTier` returns
`{ achievedTier: 0, rate: 0 }` for every point. Result: every history and
forecast point shows `rebateForPeriod = spend × 0 = $0`.

`lib/actions/analytics/contract-performance-bundle.ts:49` calls
`getRebateForecast` unconditionally, so the Performance tab inherits the $0
forecast for carveout contracts (this is the "performance data not populating"
symptom).

### Carveout economics (why a flat rate is correct)

Carveout rebate is computed per carved-out reference number:
`PERCENT_OF_SPEND → lineRebate = totalSpend × rebatePercent`, or
`FIXED_PER_UNIT → lineRebate = totalUnits × rebatePerUnit`
(`lib/rebates/engine/carve-out.ts:60-96`). There is no cumulative-YTD tier
ladder — the rate does not change with volume. So a projection is simply
`projected spend × effective carveout rate`.

### Design

**Engine — `lib/contracts/rebate-forecast-engine.ts`**

1. Remove `"carve_out"` from `SPEND_BASED_TERM_TYPES` (leave
   `spend_rebate`, `tie_in`). This restores the tier path to terms that
   actually have tiers.
2. Add an optional input to `ComputeRebateForecastInput`:
   ```ts
   /** Flat carve-out rate (decimal, e.g. 0.03 = 3%) applied to every
    *  point's spend when the contract is carve-out-style and has no
    *  tier ladder. When set, the tier projection is bypassed. */
   carveOutEffectiveRate?: number
   ```
3. Compute the per-point rate via a single helper instead of inlining
   `projectTier`. When `carveOutEffectiveRate != null` (and > 0), every point —
   history and forecast — uses that flat rate: `achievedTier = 0`,
   `achievedRatePct = carveOutEffectiveRate × 100`,
   `rebateForPeriod = spend × carveOutEffectiveRate`. Otherwise fall through to
   the existing tier projection unchanged.
4. The empty-history guard (`values.length < 3` → empty forecast) is unchanged.

**Action — `lib/actions/analytics/rebate-forecast.ts`**

The action owns Prisma + the rate derivation; the engine stays pure.

1. Load enough term/pricing data to determine whether the contract is
   carveout-style and to derive the blended rate. A contract is carveout-style
   when it has a `carve_out` term (and no spend-based tier term that would take
   precedence).
2. Derive `carveOutEffectiveRate` (decimal):
   - For `PERCENT_OF_SPEND` lines: weight each line's `rebatePercent` by that
     line's **trailing eligible spend** (spend on its reference number over the
     same 24-month window already pulled for the forecast).
   - For `FIXED_PER_UNIT` lines: convert to an effective percent via
     `trailing (units × rebatePerUnit) ÷ trailing spend` on that reference
     number.
   - Blended rate = `Σ line rebate (trailing) ÷ Σ eligible spend (trailing)`.
   - Fallback when there is no trailing eligible spend: simple mean of the
     configured `PERCENT_OF_SPEND` rates (FIXED_PER_UNIT lines contribute 0 to
     the mean in that degenerate case).
3. Pass `carveOutEffectiveRate` to `computeRebateForecast` only for
   carveout-style contracts; tiered contracts call the engine exactly as today.

This keeps the forecast a *projection surface* (explicitly allowed to use the
engine per CLAUDE.md) and does not touch any displayed/earned/collected rebate
aggregate.

### Tests

- Unit (`lib/contracts/__tests__/`): a carveout-style input
  (`carveOutEffectiveRate = 0.03`, ≥3 months spend) produces non-zero
  `rebateForPeriod` on both history and forecast points, with
  `achievedRatePct === 3` and `achievedTier === 0`; and that a tiered input is
  unchanged by the new branch (regression guard).
- Oracle (`scripts/oracles/rebate-forecast.ts`): extend the gross-drift detector
  so a carveout contract is included and asserts a non-zero, non-drifting
  projected rebate.

### Out of scope

We do **not** project per-reference-number forecasts or model FIXED_PER_UNIT
lines as anything other than a blended effective percent. A single blended rate
matches Charles's ask ("forecasts should populate") without over-modeling.

---

## B · Carveout column in the pricing tab (TRIVIAL UI)

### Problem

`ContractPricing.carveOutPercent` is already fetched and serialized by
`getContractPricing` (`lib/actions/pricing-files.ts`) and present on the
`ContractPricingItem` type (`lib/actions/pricing-files-types.ts:20`), but
`components/contracts/contract-pricing-tab.tsx` renders no column for it
(current columns: Vendor Item No, Description, List Price, Contract Price, UOM,
Category).

### Design

Add a "Carve-Out %" column header after "Category" and a matching cell that
renders the value as a percent (e.g. `0.03 → "3%"`) or `"—"` when
null/undefined. No server-side or schema change.

### Tests

Covered by existing component render; no new unit test required (display-only,
no business logic). If the file already has a render test, extend it to assert
the header is present.

---

## C · Reference-number-first matching across grouped vendors (REAL FIX)

### Problem (root cause)

`lib/contracts/match.ts` (`matchCOGRecordToContract`) is the canonical
COG→contract matcher. It already honors grouped vendors at step 2
(`match.ts:153-158` checks both `vendorId` and `additionalVendorIds`). But the
item lookup at **step 5** (`match.ts:196-240`) matches *only* on
`vendorItemNo` (the per-vendor SKU). Reference numbers
(`COGRecord.manufacturerNo`, `ContractTerm.referenceNumbers[]`, carve-out line
`referenceNumber`) are never consulted for matching — they are used only for
rebate-eligibility filtering *after* a match
(`lib/rebates/prisma-engine-bridge.ts:175-176`).

Consequence: within a group whose vendors use different SKUs (or whose COG rows
carry inconsistent vendor names), a purchase whose cross-vendor reference number
is on the contract still falls to `off_contract_item` because its `vendorItemNo`
doesn't appear in the pricing file. Charles wants reference-number matching to be
the robust cross-vendor key.

### Design

**Types — `lib/contracts/match.ts`**

1. Extend `CogRecordForMatch` with the cross-vendor reference field:
   ```ts
   /** Manufacturer / cross-vendor reference number. Stable across vendor
    *  name + SKU variations within a group. Optional for back-compat. */
   manufacturerNo?: string | null
   ```
2. Extend `ContractForMatch` with the contract's reference-number set:
   ```ts
   /** Union of reference numbers covered by this contract — from each
    *  term's `referenceNumbers[]` and carve-out line `referenceNumber`s.
    *  Normalized lowercase by the caller. Optional for back-compat. */
   referenceNumbers?: string[]
   ```

**Matching — `matchCOGRecordToContract` step 5**

Keep `vendorItemNo` as the first key (most precise). When the SKU lookup misses
for all candidate contracts, fall through to a **reference-number match**: if
the COG row's `manufacturerNo` (normalized lowercase) is in a candidate
contract's `referenceNumbers` set, treat it as on-contract. Because step 2
already widened candidates to the full vendor group, this resolves a purchase by
any group vendor regardless of name/SKU inconsistency.

Match-result details for the reference-number path:
- It establishes *on-contract membership*. Where a contract price for that
  reference number is available, compute `variancePercent` / `savings` exactly
  as the SKU path does. Where no per-unit contract price exists for the
  reference number (carve-out lines need not carry a list/contract price),
  return `on_contract` with `contractPrice` from the matched line if present, or
  `0` savings otherwise — i.e. membership without a price-variance claim. (Final
  shape settled in the plan against the existing `MatchResult` union; no new
  status is introduced.)
- The existing `off_contract_item` "no vendorItemNo" early-return at
  `match.ts:198-203` must be relaxed: a row with no `vendorItemNo` but a
  `manufacturerNo` should still reach the reference-number step.

**Loaders — `lib/cog/recompute.ts`**

Populate the two new fields when constructing matcher inputs:
- Select `COGRecord.manufacturerNo` into `CogRecordForMatch.manufacturerNo`.
- Build `ContractForMatch.referenceNumbers` from the union of each term's
  `referenceNumbers[]` (and carve-out line reference numbers), normalized
  lowercase. `ContractTerm.referenceNumbers` already exists
  (`prisma/schema.prisma:825`).

### Priority semantics (per Charles)

Charles asked the system to "prioritize matching based on reference numbers
across all listed vendors rather than relying on vendor name matches." We keep
the precise `vendorItemNo` SKU key first (it carries price-variance signal), and
make the reference number the **cross-vendor fallback that supersedes any
vendor-name fuzzy matching**. The fragile fuzzy vendor-name fallback in
`lib/cog/match.ts` is downgraded below reference-number matching (it remains only
as a last resort). Exact ordering finalized in the plan.

### Tests

- Unit (`lib/contracts/__tests__/match*.test.ts`): a COG row with a
  `vendorItemNo` absent from the pricing file but a `manufacturerNo` present in
  the contract's `referenceNumbers` set resolves to `on_contract`; and the
  grouped case where the row's vendor is an `additionalVendorIds` member with a
  varying name still resolves via reference number.
- Oracle: extend the grouped-vendor scope oracle
  (`scripts/oracles/grouped-vendor-scope.ts`) to assert reference-number matches
  attribute spend to the group contract.

---

## D · Market share — verify, fix only if a defect reproduces (INVESTIGATION)

### Status

The grouped-numerator truncation bug (numerator counting only the primary
vendor's spend) was fixed in commit `76f6bb4` on Jun 2 — four days before the
meeting. `computeCategoryMarketShare`
(`lib/contracts/market-share-filter.ts`) and both call sites
(`getCategoryMarketShareForVendor`, `getVendorMarketShareByCategory`) look
correct, and `lib/actions/__tests__/market-share-parity.test.ts` passes.

### Plan

This unit runs **after A lands**, because the most likely explanation for the
"market share fails to display" symptom is the carveout Performance-tab bug
(the per-category market-share card lives on that same tab — if the tab bundle
returns empty/zero for carveout contracts, market share appears missing too).

Steps:
1. Run `scripts/oracles/market-share.ts` against current seed data.
2. Reproduce the contract-detail Performance tab for a carveout/grouped contract
   (`Lighthouse Surgical Center`, the primary demo facility) and confirm whether
   the market-share card renders after fix A.
3. If a *real remaining* defect surfaces (empty-state render when rows are
   empty, category-canonicalization mismatch, stale persisted
   `Contract.currentMarketShare`), write a narrow fix + regression test.
   Otherwise document that it is resolved by the existing fix + A, and note that
   Charles should re-test on the current build.

No speculative code change.

---

## E · Baseline vs. minimum-annual-purchase clarification (DOC ONLY)

### Status

No bug. The two concepts are cleanly separated:

- **Baseline** — `ContractTerm.spendBaseline` (`schema.prisma:793`) with
  `baselineType` (`schema.prisma:785`). When `baselineType = "growth_based"` and
  `spendBaseline > 0`, the tier engine evaluates on **incremental spend above
  the baseline** (pro-rated to the evaluation period);
  `lib/contracts/accrual.ts:758-764`. Exceeding the baseline simply means more
  growth slice qualifies for rebate — baseline is **not** a floor/penalty.
- **Minimum annual purchase** — `ContractTerm.minimumPurchaseCommitment`
  (`schema.prisma:815`). A floor: when rolling-12 spend falls **below** it, a
  shortfall is flagged (`met = false`, `gap > 0`) but no automatic penalty is
  applied; `lib/contracts/min-annual-shortfall.ts:19-33`.
- **Carry-forward** exists only for tie-in **capital true-ups**
  (`shortfallHandling = CARRY_FORWARD`, `schema.prisma:805`;
  `lib/rebates/engine/tie-in-capital.ts:125-145`), threaded by the caller as
  `carriedForwardShortfall`. The min-annual floor check itself is a stateless
  rolling-12 snapshot with **no** carry-forward.

### Deliverable

Write `docs/superpowers/specs/2026-06-06-baseline-vs-min-annual-clarification.md`
(a sibling reference doc, written during implementation) containing:
1. Plain-language definition of each concept with the backing schema field and
   the consuming calculation (file:line).
2. A worked numeric example for each (e.g. $120K spend / $100K baseline →
   growth slice $20K × 5% = $1,000; MIN_ANNUAL $400K / rolling-12 $312,056 →
   gap $87,944, `met=false`).
3. The four open product questions for Charles:
   - Should `spendBaseline` keep silently doubling as the min-annual fallback
     when `minimumPurchaseCommitment` is null, or should the floor be explicit?
   - Should tie-in capital shortfall carry-forward be **persisted** (DB field)
     rather than a runtime parameter callers must thread?
   - Should there be a forward-looking "pace needed to meet minimum annual by
     contract end" metric (current check is backward-looking rolling-12)?
   - When a contract has multiple tie-in terms with different
     `minimumPurchaseCommitment` values, which floor governs (system currently
     uses the maximum)?

No code change this session; the answers feed a future spec.

---

## Sequencing & isolation

- **A, B, C** are independent files (forecast engine/action, pricing-tab
  component, match engine/loaders) — can be implemented in parallel worktrees
  and cherry-picked.
- **D** depends on **A** (run after A lands).
- **E** is pure docs, anytime.

## Verification (before "ship it")

Per CLAUDE.md release hygiene:
1. `bunx tsc --noEmit` → 0 errors.
2. `bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'` → green.
3. `rm -rf .next && bun run dev`, smoke the contract-detail Performance tab +
   pricing tab for a carveout/grouped contract on `Lighthouse Surgical Center`.
4. Run the touched oracles: `rebate-forecast`, `grouped-vendor-scope`,
   `market-share`.
5. Confirm no displayed/earned/collected rebate aggregate changed — the forecast
   is a projection surface only; the canonical reducers
   (`sumCollectedRebates`, `sumEarnedRebatesLifetime`, …) are untouched.

## Non-goals (explicitly deferred)

- Vendor-side contract uploads, pending-approvals flow, mirrored contract logic
  with blinded dollar amounts (meeting items 6–9 / "vendor-side").
- Category mapping during pricing-file upload (meeting item 1).
- Group list selection scrolling bug and the capital-"link"-only-for-capital
  gating (contained UI fixes — separate quick-bug-bash session).
- Any change to how carry-forward or min-annual is computed (pending Charles's
  answers from E).
