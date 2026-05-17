# Volume Rebate — `% of Spend` tier on the CPT path + Per-Unit scope relaxation

**Date:** 2026-05-17
**Author:** Vick (via Claude)
**Status:** Approved (verbal, 2026-05-17)

## Context

Two related issues reported against the Volume Rebate form + recompute path
(screenshot 2026-05-17, contract with Volume Counted By = Procedure code
(CPT), CPT codes set, mixed tier rebate types):

1. A Volume tier configured with `rebateType = percent_of_spend` does not
   pay based on dollars spent — it still pays based on CPT occurrences.
2. The "Per-Unit rebate tiers require a Specific Items scope with at
   least one REF number selected" warning at
   `components/contracts/contract-terms-entry.tsx:987-1002` blocks a
   legitimate config (per-unit rebate with All Products scope).

The user's mental model, captured verbatim:

> "For Volume the Threshold is always in UNITs. But the system should do
> the math based on the dollars spent if that is what is chosen, so when
> volume is chosen. Volume can still be counted by All products and it
> just counts by the QTY used of products on the contract. Per unit
> rebate can have a scope of all products still if needed."

## Root cause

`lib/contracts/recompute/volume.ts` has two execution paths:

| Path | Trigger | `%-of-Spend` handling |
|---|---|---|
| `recomputeVolumeFromCases` (CPT path) | `term.cptCodes.length > 0` | **Broken.** Synthesizes `PurchaseRecord` with `extendedPrice=0`, scales every tier's `rebateValue × 100`, routes through the canonical engine. A `percent_of_spend` tier computes `occurrences × rate × 100` (the stored fraction is treated as dollars-per-occurrence). |
| `recomputeVolumeFromCogRecords` (COG fallback) | `term.cptCodes.length === 0` | Correct. Lines 612-623 dispatch on `rebateType`: `percent_of_spend → bucketSpend × rebateValue` (fraction). |

The screenshot's term has CPT codes, so it hits the broken path.

The Per-Unit warning is UX-only — it does not block save and the engine
already pays per-unit on whatever's in scope. The requirement that scope
be "Specific Items with REF numbers" is a holdover from W1.X-A6 and no
longer reflects the engine's actual behavior.

## Changes

### Change A — Fix `%-of-Spend` on the CPT path

In `recomputeVolumeFromCases`, after the canonical engine call inside
`buckets.map(...)`, when the bucket's achieved tier has
`rebateType === "percent_of_spend"`, replace the engine's `rebateEarned`
with `bucketSpend × rebateValue` (fraction, 0.02 = 2%).

- `bucketSpend` is sourced from `prisma.cOGRecord.findMany({ facilityId,
  vendorId: term.vendorId, transactionDate: { gte: bucketStart, lte:
  bucketEnd }, ...categoryFilter })`, summing `Number(extendedPrice)`.
- The `categoryFilter` mirrors what the COG-fallback path already
  builds (lines 492-498): if `term.appliesTo === "specific_category"`,
  filter to those categories; otherwise no category filter (= all
  products on contract).
- Tier *selection* still uses CPT occurrences via the existing engine
  call. Only the dollar number is replaced for `percent_of_spend` tiers.
- The COG query runs once per term (not per bucket): fetch all in-scope
  COG records inside the term window upfront, then sum per-bucket
  in-memory. Same pattern as the COG fallback.
- The `notes` string keeps the `<N> occurrences` prefix so the audit
  trail stays consistent.

Tier-selection threshold remains denominated in occurrences (units),
matching the user's stated mental model.

### Change B — Drop the Per-Unit REF# warning

Delete the JSX block at `components/contracts/contract-terms-entry.tsx:987-1002`
(the `(term.tiers ?? []).some(t => t.rebateType === "fixed_rebate_per_unit") && ...`
amber-warning paragraph). No data-model or engine change.

### Change C — Verify "All Products + count qty" already works

The COG fallback path (used when `cptCodes` is empty) already sums
`quantity` across the vendor's COG records in the term window, filtered
by category scope only. No code change. Add a regression test that
asserts: a Volume term with `cptCodes=[]`, `appliesTo="all_products"`,
and a single `fixed_rebate_per_unit` tier with `volumeMin=0,
rebateValue=$5` pays `5 × sum(quantity)` for the bucket window.

## Testing

Unit tests in `lib/contracts/recompute/__tests__/volume.test.ts` (create
if missing — sibling tests live in
`lib/rebates/engine/__tests__/volume-rebate.test.ts` already):

1. **CPT path + percent_of_spend tier** — seed a contract with CPT
   codes, one tier `{ rebateType: "percent_of_spend", rebateValue: 0.02,
   volumeMin: 0 }`, COG records summing to $100k spend in the bucket
   window. Expected `rebateEarned = $2,000`.
2. **CPT path + mixed tiers** — tier 1 per-unit, tier 2 percent_of_spend.
   Bucket hits tier 2 (occurrence count above tier 2 threshold).
   Expected `rebateEarned = bucketSpend × tier2.rate`, not
   `occurrences × tier2.rate × 100`.
3. **CPT path + per-unit only** — regression guard. Existing behavior
   must not change.
4. **COG fallback + all-products** — Change C verification. Seed
   `cptCodes=[]`, `appliesTo="all_products"`, one per-unit tier. Confirm
   `rebateEarned = $5 × sum(quantity)`.

Manual smoke (after merge):
- Open the volume term in the screenshot.
- Switch a tier to "% of Spend" with rate 2%.
- Hit "Recompute Earned Rebates" on contract detail.
- Confirm the earned dollar number ≈ in-scope COG spend × 0.02.

## Out of scope

- Marginal-method support on the COG path (existing TODO at line ~432).
- Reworking the `Volume Counted By` enum or relabeling tier thresholds
  based on tier composition.
- Display-side changes on contract detail / dashboard / list.
- The canonical engine itself — the fix lives at the recompute boundary,
  not inside `lib/rebates/engine/volume-rebate.ts`.

## Files touched

- `lib/contracts/recompute/volume.ts` (Change A)
- `components/contracts/contract-terms-entry.tsx` (Change B — delete lines ~987-1002)
- `lib/contracts/recompute/__tests__/volume.test.ts` (new file, Changes A + C tests)
