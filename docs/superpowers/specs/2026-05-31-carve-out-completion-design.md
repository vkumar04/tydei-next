# Carve-out completion — design (2026-05-31)

## Context

Vick screenshot (2026-05-31) showed a contract-detail toast: *"Contract saved,
but pricing import error occurred in the Server Components render…"* on the
Stryker Mako (SYK) carve-out file. Investigation surfaced one crash (already
fixed — see below) and two latent gaps that this spec addresses.

### Already shipped (prerequisite, not part of this spec)
`importContractPricing` threw on the carve-out file because `carveOutPercent`
(a `Decimal(5,4)`, max 9.9999) received percent-points (e.g. `30` meaning 30%)
and overflowed, rolling back the whole batch; the thrown error was redacted by
Next.js 16 production builds. Fixed via `sanitizePricingRow` (coerce overflow /
NaN / bad dates) + error-as-value `*Safe` action variants. That fix unblocked
the import **and** the carve-out auto-populate that depends on it.

### How carve-out actually works (ground truth from the engine)
- Carve-out **rebate math** reads `ContractPricing.carveOutPercent` per-SKU
  (`lib/contracts/recompute/carve-out.ts:115`), keyed by `vendorItemNo`. It does
  **not** read `ContractTermProduct` rows or `ContractTerm.appliesTo`.
- `populateCarveOutTermsForContract` (fires after every pricing import) writes
  `ContractTermProduct` rows from pricing rows with `carveOutPercent > 0` and
  sets `appliesTo = "specific_products"`.
- Category values only affect **COG coverage / market-share matching**
  (`cogCategoryCoveredByContract`, `lib/contracts/match.ts:112`), not the
  carve-out rebate amount.

This reframes the remaining work:
- **#4b** = stop raw categories from silently dropping COG coverage.
- **#3** = stop the term-editor from presenting carve-out scope as manually
  editable when the engine derives it from the pricing file.

Out of scope (tracked follow-ups): `ingestPricingFile` mass-upload category
normalization; backfill of existing rows; vendor-mapping engine wiring (#1);
group-wide rebate aggregation across `additionalVendorIds` (#2).

## Part A — Category normalization in `importContractPricing` (#4b)

**Problem.** `importContractPricing` stores `ContractPricing.category` raw. COG
import canonicalizes (`"Ortho Extremity"` → `"Ortho-Extremity"` via
`resolveCategoryNamesBulk` + a `canonicalize` closure). The mismatch makes
`cogCategoryCoveredByContract` silently exclude COG rows from the contract's
coverage and market-share.

**Fix.** Mirror the COG path exactly (`lib/actions/cog-import.ts:138-146`).
In `importContractPricing`, before the `createMany` transaction:
1. Collect every `item.category` from the deduped items.
2. `const map = await resolveCategoryNamesBulk(cats, { createMissing: true, source: "pricing_file" })`.
3. Build the same `canonicalize(raw)` closure COG uses, keyed by
   `raw.trim().toLowerCase().replace(/\s+/g, " ")`.
4. Apply `category: canonicalize(row.category)` in the `createMany` map, right
   after `sanitizePricingRow`. `sanitizePricingRow` stays pure — DB lookups do
   not belong in it; it continues to pass `category` through untouched and the
   action canonicalizes the result.

**Scope.** `importContractPricing` only. `ingestPricingFile` keeps storing raw
(follow-up). No backfill — `importContractPricing`'s replace-semantics (delete +
reinsert) heals an existing contract on its next pricing re-upload.

## Part B — Carve-out term-editor lock (#3)

**Problem.** The term editor shows an editable Product Scope dropdown + SKU
picker for carve-out terms, yet the engine ignores both. Worse,
`populateCarveOutTermsForContract` writes `appliesTo = "specific_products"`, a
value the dropdown (`specific_items`) doesn't recognize, so the Select renders
stale/empty.

**Fix.**
1. **Standardize the value.** Change `populateCarveOutTermsForContract` to write
   `appliesTo: "specific_items"` (the value the dropdown + `SpecificItemsPicker`
   recognize). Engine-neutral for carve-out (engine reads `carveOutPercent`
   directly); makes the read-only SKU list render.
2. **Lock the controls for `term.termType === "carve_out"`** in
   `components/contracts/contract-terms-entry.tsx`:
   - Product Scope → disabled Select displaying **"Auto (from pricing file)"**,
     with a helper note that scope + per-SKU rebate come from the Pricing tab.
   - SKU list → `SpecificItemsPicker` in a new **`readOnly`** mode: renders the
     `term.scopedItemNumbers` as a read-only list (no search/checkboxes/toggle),
     resolving descriptions from `availableItems` when present. Empty state:
     *"No items yet — upload a pricing file with a carve-out % column."*
   - Keep the existing editable branches (`specific_category`, `specific_items`)
     for non-carve-out terms unchanged.
3. **`SpecificItemsPicker`** gains `readOnly?: boolean`. Read-only short-circuits
   to the list view above; the editable path is untouched.

The auto-populate's `ContractTermProduct` rows now feed the read-only display
even though the rebate engine reads `carveOutPercent` directly.

## Testing

- **A:** `importContractPricing` canonicalizes categories — given an existing
  `"Ortho-Extremity"` category, importing a row with `"Ortho Extremity"` writes
  the canonical name to `createMany` (mock `resolveCategoryNamesBulk` + prisma
  `$transaction`/`createMany`).
- **B1:** pure predicate `isCarveOutScopeLocked(termType)` — true only for
  `"carve_out"`.
- **B2:** `populateCarveOutTermsForContract` writes `appliesTo === "specific_items"`.
- **B3:** `SpecificItemsPicker` `readOnly` renders selected SKUs without
  toggle controls and shows the empty-state copy when `selected` is empty
  (pure-helper / render-logic level).

## Verify checklist (before PR)
1. `bunx tsc --noEmit` → 0 errors.
2. `bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'` →
   green (the pre-existing `tie-in.ts` date-drift failure is unrelated).
3. Confirm every pricing surface still routes through the canonical helpers.
