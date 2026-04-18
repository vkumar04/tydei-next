# Subsystem 4 — Compliance + Market Share (Contracts Rewrite)

**Goal:** Implement the compliance engine (per-purchase evaluation + aggregate rate) and the market-share commitment engine. UI surfaces deferred to subsystem 8.

**Parent spec:** `docs/superpowers/specs/2026-04-18-contracts-rewrite.md`

## Files

- Create: `lib/contracts/compliance.ts` — exports:
  - `evaluatePurchaseCompliance(purchase, activeContracts, asOf?)` — per-purchase check returning `{ compliant, reasons: ComplianceViolation[] }`
  - `calculateComplianceRate(purchases, activeContracts, asOf?)` — aggregate compliance % and violation breakdown
  - `calculateMarketShare(vendorSpend, categoryTotalSpend, commitmentPercent)` — % share with commitment-met flag and gap
- Create: `tests/contracts/compliance.test.ts` — 13 tests covering:
  - Purchase on-contract at contract price → compliant
  - Vendor with no active contract → `off_contract`
  - Purchase outside date range → `expired_contract`
  - Unknown SKU → `unapproved_item`
  - Price over contract by > 5% → `price_variance`
  - Small undercharge → no violation
  - Aggregate compliance with 25% rate + breakdown counts
  - Empty purchases → null compliance percent (no denominator)
  - Market share at commitment, above, below, undefined

## Violation taxonomy

`ComplianceViolation = 'off_contract' | 'expired_contract' | 'unapproved_item' | 'price_variance'`

Price variance tolerance defaults to 5%; only overcharges flag (undercharges aren't buyer compliance issues).

## Acceptance

- `bunx vitest run tests/contracts/compliance.test.ts` → 13/13 passing
- `bunx tsc --noEmit` → 0 errors
- Engine-only commit; contract-detail + score-page UI comes in subsystem 8.
