# 2026-06-13 Rebate-engine bug bash (5 bugs)

From bugs.rtfd. Root causes from 4 parallel read-only investigations.

| # | Bug | Cluster | Files | Wave |
|---|---|---|---|---|
| 1 | Growth baseline math not applied (full spend × rate instead of (spend−baseline) × rate) | growth | spend-rebate.ts, accrual.ts, recompute-accrual.ts | 1 |
| 4 | "From dollar one / Growth" dropdown not saving on EDIT | growth | edit-contract-client.tsx | 1 |
| 5 | "Product category (units)" must force Specific-Category scope (no All Products) | form | contract-terms-entry.tsx, validators/contract-terms.ts | 1 (parallel) |
| 3 | Market-share per-unit rebate pays flat $ instead of units × rate | engine | threshold.ts, accrual.ts, contract-accrual-timeline.tsx | 2 |
| 2 | Two terms, sparse spend: one accrues, the other $0 (should be cumulative-at-period-close per term) | engine | recompute-accrual.ts, accrual.ts | 2 |

**Field model:** `ContractTerm.growthOnly: Boolean` (false="From dollar one", true="Growth"), `spendBaseline: Decimal?`, `baselineType` enum (spend_based/volume_based/growth_based). Market-share tiers store % threshold in `spendMin`; per-unit types `fixed_rebate_per_unit`/`per_procedure_rebate`. `volumeType` enum value for "Product category (units)" = `product_category`.

**Wave 1 (parallel, file-disjoint):** G (bugs 1+4), F (bug 5).
**Wave 2 (sequential on accrual.ts, after Wave 1 cherry-picked):** bug 3, then bug 2.
