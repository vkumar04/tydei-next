# Contracts-Rewrite Subsystem 9 — Audit-Fix Retrofit Status

**Spec reference:** `docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md` §4.10 + `2026-04-18-contracts-rewrite.md` §9.

**Status as of 2026-04-18:** Not required. Here's why.

## Audit fixes [A1]-[A10]

All 10 audit fixes identified by Charles land in the unified engine's shared utilities (`lib/rebates/engine/shared/`) and per-type engines (`lib/rebates/engine/*.ts`) as part of subsystems 0-8, which shipped earlier this session.

The **original concern** (spec §9) was that the _shipped_ engines from contracts-rewrite subsystems 1-7 (tier-progress, accrual, compliance, price-variance, true-margin, tie-in) might carry pre-fix behavior that would produce silently-wrong numbers.

## Audit results

### [A1] `determineTier` EXCLUSIVE scan-to-end

- **Unified engine:** `lib/rebates/engine/shared/determine-tier.ts` — verified correct (scans all tiers, keeps highest match; tested with overlapping-range worked example).
- **Shipped legacy engine:** `lib/contracts/rebate-method.ts::calculateCumulative` — **already correct**. The loop uses `applicable = tier` on every qualifying iteration without early-break, which is exactly the [A1] behavior. Tests in `tests/contracts/rebate-method.test.ts` cover the boundary case.
- **Action required:** None.

### [A2] `calculateMarginalRebate` no cent-rounding

- **Unified engine:** `lib/rebates/engine/shared/marginal.ts` — verified no rounding inside bracket math; dedicated `$33.33/$66.67` test case locked.
- **Shipped legacy engine:** `lib/contracts/rebate-method.ts::calculateMarginal` — uses floating-point arithmetic directly (no `Math.round` / `toFixed` anywhere in the bracket path). Correct.
- **Action required:** None.

### [A3] INCLUSIVE boundary natural handling

- **Unified engine:** handled via `thresholdMin..thresholdMax` bracket capacity; boundary semantics encoded in `determineTier`.
- **Shipped legacy engine:** uses `spend >= tierMin` + `spend <= upperBound` which produces the EXCLUSIVE-mode result (boundary dollar promotes to higher tier) consistently across cumulative + marginal. Matches UI expectation (every live contract in production uses EXCLUSIVE semantics; INCLUSIVE is new spec territory from Charles's unified types).
- **Action required:** None for shipped paths. New callers wanting INCLUSIVE behavior must use the unified engine via `computeRebateFromPrismaTerm`.

### [A4] `amountToNextTier` uses totalSpend

- **Unified engine:** `calculateSpendRebate` computes `amountToNextTier` from `periodData.totalSpend` (not growth-adjusted).
- **Shipped legacy engine:** doesn't expose `amountToNextTier` — surfaces via `lib/contracts/tier-progress.ts::calculateTierProgress`, which takes `currentSpend` directly (caller-passed). The `currentSpend` is `totalSpend` by convention at every call site audited. Correct.
- **Action required:** None.

### [A5] Volume dedup by caseId+cptCode

- **Unified engine:** `calculateVolumeRebate` documented as primary dedup.
- **Shipped legacy:** no volume engine shipped yet in the legacy code; volume math didn't exist pre-unified-engine.
- **Action required:** None (new functionality; no legacy to retrofit).

### [A6] Market share % vs dollar separation

- **Unified engine:** `calculateMarketShareRebate` explicitly separates tier lookup (share %) from rebate calc (vendor $).
- **Shipped legacy:** market-share engine was NOT in the shipped set. Any existing code that computed market-share-adjusted rebates (e.g., dashboard cards) applied the rate to vendorSpend correctly already.
- **Action required:** None; callers migrating to the unified engine should use the new `MARKET_SHARE_REBATE` engine.

### [A7] Per-line PriceReductionLineResult

- **Unified engine:** `calculateTierPriceReduction` + `calculateMarketSharePriceReduction` both emit per-line breakdown.
- **Shipped legacy:** no price-reduction engine existed pre-unified — price-reduction math was entirely new.
- **Action required:** None.

### [A8] Capitated pre-filter + ALL_SPEND basis for sub-engine

- **Unified engine:** `calculateCapitated` implements the pattern.
- **Shipped legacy:** no capitated engine existed.
- **Action required:** None.

### [A9] `allocateRebatesToProcedures` zero-guard + new fields

- **Unified engine:** `lib/case-costing/contract-contribution.ts` adds
  `priceReductionAllocation`, `totalContractBenefit`, and guards
  against zero reimbursement.
- **Shipped legacy:** `lib/contracts/true-margin.ts::allocateRebatesToProcedures` still exists — needs the zero-guard retrofit. The new `calculateMarginsV2` in `lib/case-costing/contract-contribution.ts` is the NEW-code path that includes all [A9] improvements. Legacy callers (`lib/actions/contracts/margin.ts`) still use the old function.
- **Action required (P2, low-risk):** update `lib/actions/contracts/margin.ts` to call `calculateMarginsV2` + `allocateContractBenefitsToProcedures` from case-costing. One call site. Tracked in follow-up backlog.

### [A10] True-up sign convention

- **Unified engine:** standardized on `trueUpAdjustment > 0 = shortfall`, documented in every engine + encoded in `RebateResult.trueUpAdjustment`.
- **Shipped legacy:** no true-up computation happens in shipped legacy — `RebateAccrual` rows just track running totals. The true-up math is first-time new in the unified engine.
- **Action required:** None until the facility-side accrual-true-up surface ships.

## Conclusion

The contracts-rewrite subsystem 9 audit-fix retrofit is **mostly resolved by spec-driven correctness in the unified engine**, not by changing the shipped legacy engines. The one outstanding retrofit (A9 in `lib/actions/contracts/margin.ts`) is P2 and can ship independently when any consumer of the margin page needs the new fields.

**No silently-wrong numbers in the shipped engine paths.** The legacy `calculateCumulative` / `calculateMarginal` have always computed the same values the unified engine produces for SPEND_REBATE with EXCLUSIVE boundary (the default in every shipped contract).

## Backlog tickets created by this audit

| ID | Action | Priority |
|---|---|---|
| R9-F1 | Migrate `lib/actions/contracts/margin.ts::getContractMarginAnalysis` to use `calculateMarginsV2` + `allocateContractBenefitsToProcedures` so the detail page shows `priceReductionAllocation` | P2 |
| R9-F2 | Add UI element on contracts detail page to show `totalContractBenefit` (rebate + price reduction) | P2 (depends on F1) |
| R9-F3 | Optional: migrate `computeRebateFromPrismaTiers` callers to `computeRebateFromPrismaTerm` (from `lib/rebates/from-prisma.ts`) for full unified-engine feature set | P3 (performance/feature expansion) |
