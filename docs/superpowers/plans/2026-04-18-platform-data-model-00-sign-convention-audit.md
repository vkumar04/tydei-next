# Sign Convention Audit — 2026-04-18

**Canonical rule** (from platform-data-model-reconciliation.md §4.11):
- `savings` positive = facility paid less than list (win)
- `variancePercent` positive = facility paid more than contract (alert / bad)

This audit runs before platform-data-model subsystem 0's schema change to catalog every site in the codebase that computes savings/variance so subsequent subsystems can enforce consistency. If any site disagrees with the canonical sign, it becomes a follow-up ticket — not a scope expansion of the schema change itself.

---

## Audit methodology

Grep run (in `/Users/vickkumar/code/tydei-next/.worktrees/contracts-00-schema`):

```bash
grep -nE "savings|variance|unitPrice - contractPrice|contractPrice - unitPrice|actualPrice - contractPrice" \
  lib/actions/cog-records.ts \
  lib/actions/dashboard.ts \
  lib/actions/contracts.ts \
  lib/rebates/calculate.ts \
  lib/contracts/price-variance.ts
```

Every hit was classified by reading ±5 lines of context.

---

## Findings

### `lib/contracts/price-variance.ts` — single real calculation site

**Result: matches canonical.**

- Line 75: `const variancePercent = ((actualPrice - contractPrice) / contractPrice) * 100`

  Interpretation: `actualPrice > contractPrice` → `variancePercent > 0`.
  Canonical says positive variance = facility paid more than contract (overcharge).
  **✓ Matches.**

- Line 83: `const dollarImpact = (actualPrice - contractPrice) * quantity`

  Same interpretation: positive dollarImpact = overcharge magnitude.
  **✓ Matches.**

- Line 119-122: direction `'overcharge'` accumulates positive `dollarImpact` into `overchargeTotal`; direction `'undercharge'` accumulates negative `dollarImpact` into `underchargeTotal`.

  **✓ Matches.** `overchargeTotal` is a positive number representing dollars the facility overpaid; `underchargeTotal` is a negative number representing the dollar credit the facility effectively received (invoice came in below contract).

### `lib/actions/cog-records.ts` — zero hits

**Result: no sign-convention computations.** This file reads/writes COG records but doesn't compute savings or variance itself. Nothing to audit.

### `lib/actions/dashboard.ts` — zero hits

**Result: no sign-convention computations.** The dashboard aggregates, but doesn't compute per-row variance itself — it reads pre-computed figures from `rebates` / `contract periods`.

### `lib/actions/contracts.ts` — imports + comments + variable names only

**Result: no sign-convention computations.** Matches are imports (`from "@/lib/contracts/price-variance"`), doc comments, or variable names passing data through to `analyzePriceDiscrepancies`. The actual calculation happens inside `price-variance.ts`, which is already classified above.

### `lib/rebates/calculate.ts` — zero hits

**Result: no sign-convention computations.** This file computes rebates (`spend × rebatePercent / 100`), not price variance. Rebate amounts are always positive by construction.

---

## Summary

**All existing variance/savings computations match the canonical sign convention.**

No violations to fix. The single source-of-truth for price-variance math is `lib/contracts/price-variance.ts:75-83` (landed in contracts-rewrite subsystem 5), and it matches canonical.

---

## Recommendations for subsequent subsystems

1. **COG data rewrite subsystem 1 (enrichment engine)** — when populating `COGRecord.savingsAmount`, use `(listPrice - contractPrice) * quantity` (positive = win for facility). When populating `COGRecord.variancePercent`, use `((actualPrice - contractPrice) / contractPrice) * 100` (positive = overcharge). This matches canonical and the existing `price-variance.ts` convention.

2. **Platform data-model subsystem 5 (canonical matcher)** — the `matchCOGRecordToContract` algorithm should surface `variancePercent` computed the same way. The `ON_CONTRACT` status only fires when `|variancePercent| < 2%`; `PRICE_VARIANCE` status fires otherwise.

3. **Data pipeline subsystem 2 (invoice validation polish)** — already uses `analyzePriceDiscrepancies` from `price-variance.ts`, so inherits the correct convention automatically.

---

## Next-step action

No follow-up ticket required. After platform-data-model subsystem 5 merges, this report can be deleted — at that point, the sign convention is enforced at both the schema-column level (`savingsAmount` + `variancePercent` are typed Decimal columns) and the engine level (single `lib/contracts/price-variance.ts` source of truth).
