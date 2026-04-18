# Subsystem 2 — Tier Progression (Contracts Rewrite)

**Goal:** Surface tier progression on the contract-terms display — current tier, next tier, dollars to next tier, % through bracket, projected additional rebate.

**Architecture:** Pure function `calculateTierProgress(currentSpend, tiers, method)` in `lib/contracts/tier-progress.ts`. Reuses the subsystem-1 rebate engine to compute "rebate now" vs "rebate at next-tier threshold" and exposes the delta as the projected-additional-rebate. Display is client-side inside `ContractTermsDisplay`. `getContract` already aggregates COG spend; now returns it as `currentSpend`, which the terms page forwards to the display.

**Parent spec:** `docs/superpowers/specs/2026-04-18-contracts-rewrite.md`
**Depends on:** Subsystem 0 (ContractTier.tierName, ContractTerm.rebateMethod), Subsystem 1 (rebate engine).

## Files

- Create: `lib/contracts/tier-progress.ts` — `calculateTierProgress(currentSpend, tiers, method)` returning `{ currentTier, nextTier, progressPercent, amountToNextTier, projectedAdditionalRebate }`
- Create: `tests/contracts/tier-progress.test.ts` — 8 tests covering spec section 3 examples + edge cases (empty tiers, top tier, boundary spend, marginal method)
- Modify: `lib/contracts/rebate-method.ts` — add `tierName?: string | null` to `TierLike`
- Modify: `lib/actions/contracts.ts` — `getContract` always computes current COG spend and returns it as `currentSpend`; reuses the same spend for the fallback rebate-from-tiers path, now also honouring `rebateMethod`
- Modify: `components/contracts/contract-terms-display.tsx` — new `TierProgressCard` inside each accordion term, rendered only when `currentSpend` is provided
- Modify: `components/facility/contracts/contract-terms-page-client.tsx` — forwards `contract.currentSpend` to `ContractTermsDisplay`

## Acceptance

- `bunx vitest run tests/contracts/tier-progress.test.ts` → 8/8 passing
- Spec example ($75K at tiers 2/3/4% with thresholds 0/50K/100K):
  - currentTier = 2 (Silver), nextTier = 3 (Gold)
  - amountToNextTier = $25,000
  - progressPercent = 50%
  - projectedAdditionalRebate cumulative = $1,750 (rebate at $100K minus rebate at $75K)
  - projectedAdditionalRebate marginal = $750 ($25K × 3% bracket earnings)
- `bunx tsc --noEmit` → 0 errors
- `db:seed` + QA sanity → 10/10 passing
- `next build` → compiled successfully
- Detail page's `getContract` now returns `currentSpend`; no existing callers break because the field is additive.
