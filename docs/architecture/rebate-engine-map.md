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
| Volume rebate | `engine/volume-rebate.ts` | **Wired** via `lib/actions/contracts/recompute-volume-accrual.ts` (Charles 2026-04-25). The bridge does NOT call `calculateVolumeRebate` directly because that engine's tier path delegates to `calculateCumulativeRebate` which divides by 100 (percent semantics from spend rebate). Volume tiers store `rebateValue` as $/occurrence — the bridge applies `occurrences × tier.rebateValue` directly. Both cumulative and marginal methods supported; dedup by case+CPT per the [A5] rule. Engine file is still referenced for type definitions only. |
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

## Writers of `Rebate` rows

| Writer | File:line | Term-type coverage |
|---|---|---|
| `recomputeAccrualForContract` | `lib/actions/contracts/recompute-accrual.ts:72` | Spend writer — `spend_rebate`, `growth_rebate` (via `growthBased` opt-in), `fixed_fee` (via `fixed_rebate` tier), and any future `percent_of_spend` / `fixed_rebate` path. Dispatches to volume + PO writers below. |
| `recomputeVolumeAccrualForTerm` | `lib/actions/contracts/recompute-volume-accrual.ts` | `volume_rebate`, `rebate_per_use`. Sources from `Case.procedures` filtered by `term.cptCodes`; dedup by case+CPT. |
| `recomputePoAccrualForTerm` | `lib/actions/contracts/recompute-po-accrual.ts` | `po_rebate`. Sources from `PurchaseOrder` rows at `(vendorId, facilityId)` filtered by status. |
| `recomputeThresholdAccrualForTerm` | `lib/actions/contracts/recompute-threshold-accrual.ts` | `compliance_rebate` reads `Contract.complianceRate`; `market_share` reads `Contract.currentMarketShare`. Tier ladder = required %, flat $ payout per period when achieved. |
| `recomputeInvoiceAccrualForTerm` | `lib/actions/contracts/recompute-invoice-accrual.ts` | `payment_rebate`. Sources from `Invoice` rows at `(vendorId, facilityId)` filtered by status. |
| `createContractTransaction` (collected path) | `lib/actions/contract-periods.ts:225` | Type-agnostic — user supplies the dollar value |
| Synthetic period builder (in-memory) | `lib/actions/contract-periods.ts:130-200` | Now derives effective rate via canonical helper; no longer touches `rebateValue` raw (drift hazard #3 closed 2026-04-25). |
| Seed scripts | `prisma/seeds/rebates.ts`, `cog-for-contracts.ts:340`, `contract-pricing.ts` | Static fixtures + ContractPricing populated for active contracts so demo on-contract %, optimizer projections, accruals all show real numbers. |

Each persisting writer uses its own notes prefix so re-runs don't
clobber each other and user-collected rows survive: `[auto-accrual]`
(spend), `[auto-volume-accrual] term:<id>` (volume + rebate-per-use),
`[auto-po-accrual] term:<id>` (PO).

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

### 2. Dispatcher gap (was: 12 of 15 types silently degraded)

**Status (2026-04-25):** RESOLVED. After the dispatcher rebuild this
session, **15 of 15** term types are functional:

| Status | Term type | Engine path |
|---|---|---|
| ✅ | `spend_rebate` | `recompute-accrual.ts` (canonical spend writer) |
| ✅ | `growth_rebate` | `recompute-accrual.ts` + `buildEvaluationPeriodAccruals` growth-baseline branch |
| ✅ | `volume_rebate` | `recompute-volume-accrual.ts` (CPT-event counting from Cases) |
| ✅ | `rebate_per_use` | shares `recompute-volume-accrual.ts` (same Cases data, single-tier shape) |
| ✅ | `po_rebate` | `recompute-po-accrual.ts` (PO counts from PurchaseOrder) |
| ✅ | `fixed_fee` | spend writer's `fixed_rebate` tier path (configure single tier) |
| ✅ | `locked_pricing` | no engine — pricing-only catalog handled by `ContractPricing` |
| ✅ | `carve_out` | `carve-out.ts` (pre-existing) |
| ✅ | `tie_in_capital` | `tie-in.ts` (pre-existing) |
| ✅ | `compliance_rebate` | `recompute-threshold-accrual.ts` reads `Contract.complianceRate`; tier `spendMin` = required %, `rebateValue` = flat $/period |
| ✅ | `market_share` | shares `recompute-threshold-accrual.ts` reading `Contract.currentMarketShare` instead of complianceRate |
| ✅ | `price_reduction` | no rebate accrual — pricing-only catalog handled by ContractPricing rows |
| ✅ | `payment_rebate` | `recompute-invoice-accrual.ts` — counts qualifying Invoice rows (vendor + facility + non-cancelled); tier rebateValue is $/invoice. v2 will add on-time-payment threshold once Invoice gains a paidDate field. |
| ✅ | `market_share_price_reduction` | pricing-only catalog (same model as price_reduction) — discount applies via ContractPricing once market share target is met |
| ✅ | `capitated_price_reduction` | pricing-only catalog (same model) — discount applies once procedure-spend threshold is met |
| ✅ | `capitated_pricing_rebate` | shares `recompute-volume-accrual.ts` — per-procedure rebate when CPT count crosses tier (same Cases.procedures data, tier rebateValue is $/procedure) |

The 6 remaining 🔒 types stay disabled in the dropdown with the
"Engine pending" badge until product semantics are defined. Each
follows the established bridge pattern (separate `recompute-*-accrual.ts`
file with its own `[auto-*-accrual]` notes prefix, dispatcher branch
in `recompute-accrual.ts`) so wiring a new one is now a 2-3 hour task.

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

**Status (2026-04-25):** RESOLVED. `buildEvaluationPeriodAccruals`
now accepts `{ spendBaseline, growthBased }` options. When
`growthBased === true` AND `spendBaseline > 0`, the engine
evaluates tiers against `max(0, periodSpend − proRatedBaseline)`
where `proRatedBaseline = spendBaseline × (evalMonths / 12)`.
Bucket's reported `totalSpend` stays at gross spend so display
surfaces show "we spent $X this period"; only the tier engine
sees the growth slice. Wired through `recomputeAccrualForContract`
which signals growth-mode when `baselineType === "growth_based"`
OR `termType === "growth_rebate"`. `growth_rebate` is now enabled
in the term-type dropdown. Tests in
`lib/contracts/__tests__/annual-evaluation-accrual.test.ts`
cover annual, quarterly pro-rate, below-baseline, and the
opt-in-required default.
