# Vendor-mapping engine wiring (#1) — design (2026-05-31)

> Status: **designed, not yet scheduled.** Brainstormed with Vick 2026-05-31.
> All decisions below are confirmed.

## Problem

A confirmed vendor mapping does not survive the next import. Three disconnected
pieces today:

- **`lib/vendors/resolve.ts`** — the shared import-time resolver
  (exact → hardcoded `VENDOR_ALIASES` → fuzzy Levenshtein → create), used by
  COG import and mass pricing-file import. It **never consults**
  `VendorNameMapping`.
- **`remapCOGVendorName`** (`lib/actions/cog-vendor-mapping.ts:112`, the Vendor
  Mapping dialog) bulk-rewrites `COGRecord.vendorId` for existing rows +
  recomputes — but it is a **one-time mutation**, not a persistent rule. The
  next import with the old vendor name reverts it, because `resolve.ts` doesn't
  know about the mapping.
- **`VendorNameMapping`** (`schema.prisma:1620`, the "confirmed mappings" table)
  is the natural home for a persistent rule, but **nothing reads it** — only its
  own CRUD in `lib/actions/vendor-mappings.ts` touches it.

User intent (#1): "when the system sees a REF number with the old or new vendor
name from a price file it needs to equate them together" — i.e. map a vendor
once and have every future import auto-apply it (REFs equate because the
`vendorId` is consistent; the matcher already keys strictly on `vendorId`,
`match.ts:143`).

## Decisions (confirmed)
- **Reach:** future imports **and** retroactive existing-row remap ("map once,
  fixed everywhere, forever").
- **Tenancy:** per-facility (add `facilityId` to `VendorNameMapping`).
- **Auto-apply:** confirmed mappings only; no auto-suggestion engine.

## Design

### Schema
Add to `VendorNameMapping`: `facilityId String`, `facility` relation,
`@@unique([facilityId, cogVendorName])` (one rule per name per facility), and an
index. Migration: because the table is currently engine-unused, the migration
**drops any existing rows** (a non-null `facilityId` on a previously-global,
unused table has no correct backfill), then adds the column as required.

### Facility-aware resolver (core change)
`lib/vendors/resolve.ts` gains an optional `facilityId` in opts. When present, a
new **Pass 0** (highest priority, before exact/alias/fuzzy) consults confirmed
mappings:
```
VendorNameMapping WHERE facilityId = X
  AND cogVendorName = name (case-insensitive)
  AND isConfirmed AND mappedVendorId IS NOT NULL  →  return mappedVendorId
```
The bulk resolver (`resolveVendorIdsBulk` / `findOrCreateVendorByName`) loads the
facility's confirmed mappings once into a name→vendorId map. Without
`facilityId` (non-import callers), Pass 0 is skipped — back-compat preserved.
This is what makes future COG + mass-pricing imports auto-equate the old name to
the mapped vendor.

### Close the loop — one "set mapping" path
Converge the two disconnected actions so any mapping action does **both** persist
the rule and apply it:
- **`remapCOGVendorName`** (dialog) → after re-mapping rows + recompute, **upsert
  a confirmed `VendorNameMapping`** for `(facilityId, vendorName) → newVendorId`.
- **`confirmVendorNameMapping`** → after flipping `isConfirmed`, trigger
  `remapCOGVendorName` so existing rows + metrics update.
- **Unmap** (dialog Unmap button, commit `7cf545e`) → delete/disable the rule so
  it stops auto-applying (and clears `COGRecord.vendorId` for that name as today).

### Scope
- Auto-apply on **COG imports + mass pricing-file imports** (`ingestPricingFile`)
  — both resolve vendors via `resolve.ts` / `findOrCreateVendorByName`.
  `importContractPricing` is contract-linked (vendor from the contract, no name
  resolution) — unaffected.
- Confirmed mappings only.

## Testing
- Resolver: a confirmed per-facility mapping wins Pass 0 over exact/alias; an
  unconfirmed mapping is ignored; a mapping for a different facility is ignored;
  no `facilityId` → Pass 0 skipped (back-compat).
- `remapCOGVendorName` persists a confirmed rule + remaps rows; an end-to-end
  test: set mapping → re-import a file with the old name → rows resolve to the
  mapped vendor without re-mapping.
- `confirmVendorNameMapping` triggers a remap; Unmap removes the rule.
- Migration smoke: `facilityId` + unique constraint hold.

## Out of scope
The `confidenceScore`-driven auto-suggestion UI; #2 (group aggregation —
separate spec `2026-05-31-group-wide-aggregation-design.md`).
