# Subsystem 3 — Rebate Accrual Schedule (Contracts Rewrite)

**Goal:** Implement the monthly-accrue / quarterly-true-up / annual-settlement calculation engine per spec section 2.2. UI surfaces (accrual timeline on detail page) deferred to subsystem 8.

**Parent spec:** `docs/superpowers/specs/2026-04-18-contracts-rewrite.md`

## Files

- Create: `lib/contracts/accrual.ts` — four exports:
  - `calculateMonthlyAccrual(monthlySpend, cumulativeSpendEndOfMonth, tiers, method)` — single-month accrual
  - `calculateQuarterlyTrueUp(quarterlySpend, tiers, previousAccruals, method)` — adjustment after 3 months
  - `calculateAnnualSettlement(annualSpend, tiers, allAccruals, method)` — year-end reconciliation
  - `buildMonthlyAccruals(series, tiers, method)` — walk a monthly-spend series and return a running timeline
- Create: `tests/contracts/accrual.test.ts` — 9 tests covering cumulative and marginal variants of each function plus a timeline walk

## Acceptance

- `bunx vitest run tests/contracts/accrual.test.ts` → 9/9 passing
- Spec section 2.2 examples:
  - Monthly accrual with tier promotion mid-quarter captured.
  - Quarterly true-up: actual − previous accruals = adjustment (positive when under-accrued, negative when over).
  - Annual settlement: final rebate − total accruals = settlement owed.
  - Marginal annual: $150K → $4,500 (bracket sum) vs cumulative $6,000.
- Marginal monthly accrual correctly splits across bracket boundaries (delta between marginal-rebate-at-end and marginal-rebate-at-start of month).
- `bunx tsc --noEmit` → 0 errors
- Engine-only commit; UI timeline on detail page comes in subsystem 8.
