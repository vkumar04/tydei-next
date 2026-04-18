# Subsystem 5 — Price Variance Detection (Contracts Rewrite)

**Goal:** Detect and grade per-line price variance between invoice lines and contract pricing. UI + invoice-save hook deferred to subsystem 8.

**Parent spec:** `docs/superpowers/specs/2026-04-18-contracts-rewrite.md`

## Files

- Create: `lib/contracts/price-variance.ts` — exports:
  - `calculatePriceVariance(actualPrice, contractPrice, quantity)` → `{ variancePercent, direction: overcharge|undercharge|at_price, severity: minor|moderate|major, dollarImpact }`
  - `analyzePriceDiscrepancies(lines, priceLookup)` → batch with overcharge/undercharge totals + severity histogram
- Create: `tests/contracts/price-variance.test.ts` — 8 tests covering direction detection, severity thresholds, dollar impact, batch aggregation

## Severity thresholds

- minor: `|variance%| < 2`
- moderate: `2 ≤ |variance%| < 10`
- major: `|variance%| ≥ 10`

(Note: distinct from compliance's 5% off-contract tolerance — severity grading runs independently of compliance status.)

## Acceptance

- `bunx vitest run tests/contracts/price-variance.test.ts` → 8/8 passing
- `bunx tsc --noEmit` → 0 errors
- Engine-only commit; invoice-save hook + score-page "Price Variance" card come in subsystem 8.
