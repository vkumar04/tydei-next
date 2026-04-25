# Recurring bug patterns in tydei-next

Last audited 2026-04-25 across the most recent ~60 fix commits.
Updated whenever a new structural pattern is identified.

## Why this document exists

Charles + the dev team kept reporting the same shapes of bug across
different surfaces. Looking at the commit history, **the bug families
recur because the underlying structural risk hasn't been closed** —
each fix is local. This file names the patterns so a future session
can recognize them on sight, and so we can knock down the structural
risks rather than playing whack-a-mole.

## The eight families

Counts are approximate (sampled the most recent 60 commits matching
each pattern).

| Family | Count | Canonical example |
|---|---|---|
| **Units / scaling** (fraction ↔ percent, ×100) | ~12 | `e168098 fix(rebates): scale rebateValue at Prisma boundary in persistence path (W1.V)` |
| Scoping (category, facility, term) | ~10 | `94309d5 fix(contracts): resolve scopedCategoryIds → names at write boundary` |
| UI / copy / layout | ~8 | `2c88281 fix(contracts): stabilize Create Contract button to prevent text overlap` |
| Parallel data sources / drift | ~7 | `97741a2 test(contracts): W2.A.3 regression guard for Transactions tab summary-card drift` |
| Validation / null guards | ~7 | `bdef6b2 fix(contracts): allow empty term.effectiveEnd for evergreen contracts` |
| Dispatcher / wiring gap | ~5 | `86cb285 feat(rebates): wire carve-out engine end-to-end (W1.Z-A)` |
| AI extraction | ~4 | `a7e9aed fix(ai): tighten evergreen detection — false-positive on termination-for-convenience` |
| Cache invalidation | ~3 | `5267958 fix(cog): vendor-concentration + spend-trend cards now invalidate with COG CRUD` |

## Family 1 — Units / scaling

**Convention:** `ContractTier.rebateValue` is stored as a **fraction**
in the DB (`0.03` means 3%). Many display surfaces and the rebate engine
expect **integer percent** (`3` means 3%). The dual storage convention
isn't enforced at the type level — it's policed by reviewer + a
single helper, and new code routinely forgets the scale.

**Boundary helper:** `lib/contracts/rebate-value-normalize.ts`
exports `toDisplayRebateValue(rebateType, value)` and
`fromDisplayRebateValue`. `lib/rebates/calculate.ts` exports
`scaleRebateValueForEngine`. Use these at every Prisma → display or
Prisma → engine boundary.

**Smell to look for:**

```ts
// 🚨 raw `rebateValue` used in a display string or in math without scale
`${tier.rebateValue}%`
spend * Number(tier.rebateValue) / 100
```

The first prints `0.03%` (should be `3.0%`); the second computes
`spend × 0.0003` (should be `spend × 0.03`).

**Real bugs caused (most recent first):**

- `vendor-contract-overview.tsx:307` — vendor portal showed every
  tier as "0.0%" because `Number(tier.rebateValue).toFixed(1)` ran on
  the raw fraction (fixed 2026-04-25).
- `lib/rebate-optimizer/engine.ts:397-399` — alert payloads + AI
  tool inputs carried raw fractions, so AI recommendations said "earn
  another 0.005% rebate" instead of "0.5%" (fixed 2026-04-25).
- `lib/actions/rebate-optimizer.ts` — projected additional rebate was
  100× too small because the math expected percent but got fraction
  (fixed 2026-04-25).
- `lib/contracts/performance.ts:63` — survives only because
  `performance-read.ts` pre-scales tiers before passing them in. Any
  other caller would get 10000× wrong utilization.

**Structural fix (proposed):** introduce a branded
`PercentFraction` type at the Prisma reader boundary. Every consumer
that wants display-percent must call `toDisplayRebateValue` to
unwrap; raw arithmetic on the branded type fails to compile.
Tracking issue: write me when you have a willing reviewer.

## Family 2 — Scoping (category, facility, term)

**Pattern:** queries forget to scope by `facilityId` or to filter
COG rows by the term's `categories` array. Symptom: a $X-scoped
rebate accrues against $Y of off-scope spend.

**Canonical helpers (CLAUDE.md):**
- `contractOwnershipWhere(id, facilityId)` for single-row reads
- `contractsOwnedByFacility(facilityId)` for list reads
- `buildCategoryWhereClause` / `buildUnionCategoryWhereClause` for
  COG category-scope filters
- `requireFacility()` for session-scoped routes

Coverage is uniform — every contracts read in `lib/actions/`
threads through these. New surfaces should follow the same pattern.

## Family 3 — UI / copy / layout

**Pattern:** values are computed correctly, layout truncates them.
Real example from 2026-04-24: the Spend Trend card crammed two
currencies + separator into a 1/3-width grid cell; second number
displayed as "$187,—" with the trailing digits clipped. Charles
read it as "hardcoded gibberish" (his actual quote).

**Smell to look for:** any cell rendering a long string in a fixed
fraction of `grid-cols-N`. Compact-format numbers (`notation:
"compact"`) when uncertain about width. Always split dual values
into separate cells.

## Family 4 — Parallel data sources / drift

**Pattern:** two surfaces compute "the same number" from different
sources and silently drift apart. Example: contracts list
"Earned YTD" vs contract detail "Earned YTD" used different
reducers until the canonical-helpers table was introduced.

**Defensive infra:** `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`
fails when ad-hoc reducers drift from the canonical helper.

**Open drift hazards (still uncovered):**

- `lib/actions/contract-periods.ts:130-180` — synthetic
  `ContractPeriod` builder re-applies tier rate inline instead of
  going through `computeRebateFromPrismaTiers`. Already caused W1.U-B
  drift; not yet parity-tested.

## Family 5 — Validation / null guards

Routine; no structural fix needed beyond enforcing zod refinements
at server-action boundaries (which the codebase does).

Recent example: tier-overlap validation
(`lib/validators/contract-terms.ts refineTierOrdering`) — was
silently double-rebating the boundary dollar until a refinement was
added 2026-04-25.

## Family 6 — Dispatcher / wiring gap

**Pattern:** the rebate engine ships ~10 type-specific calculators
under `lib/rebates/engine/{spend,volume,carve-out,…}.ts`, but the
dispatcher that routed `term.rebateType` → engine was deleted
(commit `9b27a55`, "shrink unified-engine surface per 2026-04-19
audit"). The single live writer
(`recomputeAccrualForContract`) treats every term as a spend rebate.

**User impact:** picking "Volume Rebate" or "Growth Rebate" or
"Market Share" silently gives spend-rebate math.

**Mitigation in place:** the term-type dropdown is now `disabled`
on every type without a working bridge, with an "Engine pending"
badge (2026-04-25). Re-enable each row when its engine is wired
end-to-end.

**Audit doc:** `docs/superpowers/audits/2026-04-19-engine-param-coverage.md`
(if it exists in your tree — that's where the dispatcher rationale
lives).

## Family 7 — AI extraction

**Pattern:** extraction prompt is too vague, so Claude grabs the
"obvious" number which isn't the right one.

Examples:
- evergreen detection — false-positive on termination-for-convenience
  clauses (2026-04-22)
- totalValue grabbed minimum QAS threshold instead of contract total
  (2026-04-25; tightened prompt + schema describe)

**Smell to look for:** any `.describe("...")` field shorter than
~20 words that's NOT also called out in the system prompt with
"DO NOT" rules. AI ambiguity needs anchors in BOTH places.

## Family 8 — Cache invalidation

**Pattern:** TanStack Query mutation succeeds on the server, client
keeps showing stale data because the mutation forgot to invalidate
sibling query keys.

**Convention:** every server-side CRUD that touches `Contract`,
`ContractTerm`, `Rebate`, or `COGRecord` must invalidate every
`queryKey` listed in `lib/query-keys.ts` for that entity (or call
`queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all })`).

## Defensive infrastructure landed (2026-04-25)

These exist now and should fail CI on regression:

- **`lib/contracts/__tests__/rebate-value-scaling-drift.test.ts`** —
  scans every `.ts`/`.tsx` outside the allowlist for unsafe display
  patterns: `${*.rebateValue}%` and `*.rebateValue).toFixed(N)}%`.
  Catches the recurring family-1 bug before it ships. Allowlist in
  the test file lists the boundary helpers + engine internals that
  legitimately handle raw fractions; everywhere else must route
  through `toDisplayRebateValue`.

- **`scripts/qa-sanity.ts no-orphan-cog-rows`** — fails when >5% of
  facility's COG rows are missing both `vendorItemNo` AND
  `fileImportId`. Catches the verify-against-oracle / e2e-synthetic
  drift class that produced the 21k orphan rows on 2026-04-24.

- **`lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`**
  — locks parity between contract-list and detail surfaces using
  the canonical helpers (W2.A.3).

## Recurring-bug review checklist

When you fix a bug, ask:

1. Does the fix close a *family* or just this one site?
2. If only this site: is there an issue tracking the family-level fix?
3. Did I add a parity test, sanity check, or invariant comment that
   would catch the next instance?
4. Does the canonical-helpers table in CLAUDE.md need a new entry?

Each "yes" to (1)-(3) makes the next session's debugging cheaper.
