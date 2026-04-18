# Subsystem 6 — True Margin Analysis (Contracts Rewrite)

**Goal:** Implement procedure-level margin analysis with proportional rebate allocation. Pure engine; UI on score page deferred to subsystem 8.

**Parent spec:** `docs/superpowers/specs/2026-04-18-contracts-rewrite.md`

## Files

- Create: `lib/contracts/true-margin.ts`:
  - `allocateRebatesToProcedures(procedures, totalVendorSpend, totalRebate)` → Map<procedureId, allocated rebate $>
  - `calculateMargins({revenue, costs}, rebateAllocation)` → `{ standardMargin, trueMargin, rebateContribution, standardMarginPercent, trueMarginPercent }` (percents null when revenue is 0)
- Create: `tests/contracts/true-margin.test.ts` — 7 tests covering proportional split, zero-spend edge, zero-rebate edge, empty procedures, zero revenue, negative margin

## Allocation rule

Each procedure receives `totalRebate × (procedure.vendorSpend / totalVendorSpend)`. Matches spec section 7.

## Acceptance

- `bunx vitest run tests/contracts/true-margin.test.ts` → 7/7 passing
- `bunx tsc --noEmit` → 0 errors
