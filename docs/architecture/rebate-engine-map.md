# Rebate engine map

Single source of truth for "which engine handles which contract".
Audited 2026-04-25.

## Two parallel engine surfaces exist

There is a **flat-tier facade** and a **typed dispatcher**. Right now
ONLY the flat-tier facade has a live caller path; the typed
dispatcher's per-type engines exist but are mostly orphaned.

### Flat-tier facade — the live path

`lib/rebates/calculate.ts` exports:

- `calculateCumulative(spend, tiers)` → returns `{tierAchieved, rebatePercent, rebateEarned}`. Uses `lib/rebates/engine/shared/cumulative.ts`.
- `calculateMarginal(spend, tiers)` → `lib/rebates/engine/shared/marginal.ts`.
- `computeRebateFromPrismaTiers(spend, tiers, method)` → the canonical Prisma-shape entrypoint. Scales fraction → percent at the boundary.

This is what `recomputeAccrualForContract` (the single writer of
`Rebate` rows for auto-accrual) calls. Coverage: percent_of_spend
and fixed_rebate. Per-unit and per-procedure types fall through to 0.

### Typed dispatcher — mostly dormant

`lib/rebates/engine/` contains these per-type calculators:

| Engine | File | Status |
|---|---|---|
| Spend rebate | `engine/spend-rebate.ts` | Tests only, no live caller |
| Volume rebate | `engine/volume-rebate.ts` | Tests only |
| Tier price reduction | `engine/tier-price-reduction.ts` | Tests only |
| Market-share rebate | `engine/market-share-rebate.ts` | Tests only |
| Market-share price reduction | `engine/market-share-price-reduction.ts` | Tests only |
| Capitated | `engine/capitated.ts` | Tests only |
| **Carve-out** | `engine/carve-out.ts` | **Wired** via `lib/actions/contracts/carve-out.ts` |
| **Tie-in capital** | `engine/tie-in-capital.ts` + `amortization.ts` | **Wired** via `lib/actions/contracts/tie-in.ts` |

`lib/rebates/engine/index.ts` USED to export `calculateRebate(config,
periodData, options)` that switched on `config.type`. Removed in commit
`9b27a55` ("shrink unified-engine surface per 2026-04-19 audit") because
6 of 8 branches had no Prisma → engine bridge. The audit closed the
work by deleting the dispatcher, not by completing the bridges.

## Single writer of `Rebate` rows

| Writer | File:line | RebateType coverage |
|---|---|---|
| `recomputeAccrualForContract` | `lib/actions/contracts/recompute-accrual.ts:72` | `percent_of_spend`, `fixed_rebate` only. Per-unit / per-procedure → 0. The 6 typed-engine `RebateType` values aren't branched on. |
| `createContractTransaction` (collected path) | `lib/actions/contract-periods.ts:225` | Type-agnostic — user supplies the dollar value |
| Synthetic period builder (in-memory) | `lib/actions/contract-periods.ts:130-180` | Re-applies `bucket.spend × Number(applicableTier.rebateValue)` inline; relies on the fraction-storage convention being intact |
| Seed scripts | `prisma/seeds/rebates.ts`, `cog-for-contracts.ts:340` | Static fixtures |

## Canonical reducers (CLAUDE.md table)

| Invariant | Helper | File |
|---|---|---|
| Rebates Collected (lifetime) | `sumCollectedRebates` | `lib/contracts/rebate-collected-filter.ts` |
| Rebates Earned (lifetime) | `sumEarnedRebatesLifetime` | `lib/contracts/rebate-earned-filter.ts` |
| Rebates Earned (YTD) | `sumEarnedRebatesYTD` | `lib/contracts/rebate-earned-filter.ts` |
| COG in-term-scope | `buildCategoryWhereClause` / `buildUnionCategoryWhereClause` | `lib/contracts/cog-category-filter.ts` |
| Contract ownership | `contractOwnershipWhere` / `contractsOwnedByFacility` | `lib/actions/contracts-auth.ts` |
| Rebate-units scaling | `computeRebateFromPrismaTiers` + `formatTierRebateLabel` + `toDisplayRebateValue` | `lib/rebates/calculate.ts` + `lib/contracts/tier-rebate-label.ts` + `lib/contracts/rebate-value-normalize.ts` |
| Rebate applied to capital | `sumRebateAppliedToCapital` | `lib/contracts/rebate-capital-filter.ts` |

## Open structural risks (sorted by likelihood × impact)

### 1. Fraction-stored `rebateValue` with no nominal type

`ContractTier.rebateValue: Decimal` is just a number. The boundary
helper exists but is opt-in. Drift sites known as of 2026-04-25 (after
that day's fix wave):

- `lib/actions/contract-periods.ts:164` — synthetic builder; relies
  on convention silently
- `lib/contracts/performance.ts:63` — only safe because caller
  pre-scales (`performance-read.ts:74-77`)
- `components/contracts/ai-extract-review.tsx:349` — only safe because
  AI extract values are pre-normalized
- `components/contracts/compare-cards.ts:151` — bug (raw fraction in
  `${tier.rebateValue}%`)
- `lib/reports/tier-progress-projection.ts:104, 124, 142` — bug
- `lib/alerts/synthesizer.ts:419` — alert payloads carry raw fraction

**Recommended fix:** branded type at the Prisma reader boundary so the
TypeScript compiler enforces `toDisplayRebateValue` calls.

### 2. Dispatcher gap (6 RebateType values silently degrade)

Mitigated 2026-04-25 by disabling the unsupported types in the form
dropdown. Real fix: rebuild the dispatcher with the missing
`buildConfigFromPrismaTerm` bridges for each type.

### 3. Synthetic ContractPeriod builder is a parallel reducer

**Status (2026-04-25):** PARTIALLY MITIGATED. The synthetic builder
at `lib/actions/contract-periods.ts:130-200` no longer reads
`Number(applicableTier.rebateValue)` raw — it now derives an
`effectiveRate` from the canonical helper's
`facade.rebateEarned / tierSpend` and re-applies to the month's
own spend. So the unit-storage convention is owned exclusively by
`computeRebateFromPrismaTiers`. Still not parity-tested at the
function level (the function isn't exported); future work could
extract the inner math into a pure helper for direct testing.

### 4. AI / alert surfaces emit raw fractions

Mitigated 2026-04-25 by scaling the optimizer engine's outputs. Still
needs auditing on the alert + AI tool paths.

### 5. No type-system enforcement of the canonical-helper rule

**Status (2026-04-25):** PARTIALLY MITIGATED. Added
`lib/contracts/__tests__/rebate-value-scaling-drift.test.ts` — a
Vitest scanner that fails CI when an unallowlisted file matches the
high-signal display patterns `${*.rebateValue}%` or
`*.rebateValue).toFixed(N)}%`. The scanner deliberately does NOT
flag every `Number(*.rebateValue)` (too noisy — many helpers
legitimately accept raw fraction). Future hardening: introduce a
branded `PercentFraction` type at the Prisma reader boundary so the
TypeScript compiler enforces `toDisplayRebateValue` calls before
arithmetic.

### 6. Growth-baseline rebates silently degrade to spend-tier math

**Status (2026-04-25):** UNDOCUMENTED → DOCUMENTED. Charles asked
about "growth language" 2026-04-25; investigation showed the
`baselineType === "growth_based"` branch on `ContractTerm` is
populated correctly but `recomputeAccrualForContract` doesn't
honor `term.spendBaseline` — it evaluates tiers against full
cumulative spend regardless of baseline. Mitigated for now by
keeping `growth_rebate` disabled in the term-type dropdown
("Engine pending" badge). Implementing growth math right requires
a product decision on per-evaluation-period baseline distribution
(annual baseline vs proportional monthly) — captured for the
per-type-engine roadmap.
