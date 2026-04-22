# W2.A1b — Recompute pipeline probe (Arthrex cluster)

Date: 2026-04-22

> ⚠ **WARNING:** This script WRITES to the dev DB.
> It invokes the real `recomputeMatchStatusesForVendor` with side effects.

- Contract:        `cmo6j6g34002sachllckth77b`
- Facility:        `cmo6j6fx40003achla96kuxs1` (Lighthouse Surgical Center)
- Vendor:          `cmo6j6fxi000eachl119glqh0` (Arthrex)

## Step 1 — Raw contract row + relations

```json
{
  "id": "cmo6j6g34002sachllckth77b",
  "name": "Arthrex Arthroscopy - Lighthouse",
  "vendorId": "cmo6j6fxi000eachl119glqh0",
  "facilityId": "cmo6j6fx40003achla96kuxs1",
  "status": "active",
  "effectiveDate": "2025-04-01T00:00:00.000Z",
  "expirationDate": "2028-04-01T00:00:00.000Z",
  "contractFacilitiesCount": 0,
  "contractFacilityIds": [],
  "pricingItemsCount": 0,
  "pricingItemsSample": [],
  "termsCount": 1,
  "terms": [
    {
      "appliesTo": "specific_items",
      "categories": []
    }
  ]
}
```

## Step 2 — `loadContractsForVendor` output (what the pipeline SEES)

Pipeline loaded **1** contract(s) for vendor=cmo6j6fxi000eachl119glqh0 facility=cmo6j6fx40003achla96kuxs1.

```json
[
  {
    "id": "cmo6j6g34002sachllckth77b",
    "vendorId": "cmo6j6fxi000eachl119glqh0",
    "status": "active",
    "effectiveDate": "2025-04-01T00:00:00.000Z",
    "expirationDate": "2028-04-01T00:00:00.000Z",
    "facilityIds": [
      "cmo6j6fx40003achla96kuxs1"
    ],
    "pricingItemsLength": 0,
    "pricingItemsSample": [],
    "termsLength": 1,
    "terms": [
      {
        "appliesTo": "specific_items",
        "categories": []
      }
    ]
  }
]
```

## Step 3 — COG matchStatus distribution BEFORE recompute

Total Arthrex-vendor COG rows at this facility: **163**

```json
{"pending":163}
```

## Step 4 — Call `recomputeMatchStatusesForVendor` (real, writes to DB)

[recompute] vendor=cmo6j6fxi000eachl119glqh0 facility=cmo6j6fx40003achla96kuxs1 done — 163 updated (on_contract=163, price_variance=0, off_contract=0, out_of_scope=0, unknown_vendor=0)
```json
{
  "total": 163,
  "updated": 163,
  "onContract": 163,
  "priceVariance": 0,
  "offContract": 0,
  "outOfScope": 0,
  "unknownVendor": 0
}
```

## Step 5 — COG matchStatus distribution AFTER recompute

Total Arthrex-vendor COG rows at this facility: **163**

```json
{"on_contract":163}
```

## Step 6 — Remaining `pending` rows: 0

_(No rows remain at `pending` — pipeline flipped everything.)_

## Hypothesis grid

- ❌ **H1** — `loadContractsForVendor` returns zero contracts.
- ❌ **H2** — Loaded but `facilityIds` array is empty.
- ✅ **H3** — Loaded but `pricingItems` is empty.
- ✅ **H4** — Recompute OK, updated = 163, onContract > 0 (pipeline fine; trigger wasn't wired).
- ❌ **H5** — Recompute OK, updated = 163, onContract = 0 & offContract = 163 (seed/vendor-attribution bug).
- ❌ **H6** — Recompute silently errored (caught above).

## Report

- **Status:** DONE
- **Hypothesis confirmed:** **H4** (primary; H3 also true but does not block matching — see note below)
- **Distribution pre-recompute:** `{"pending":163}`
- **Distribution post-recompute:** `{"on_contract":163}`
- **Recompute summary:** `{"total":163,"updated":163,"onContract":163,"priceVariance":0,"offContract":0,"outOfScope":0,"unknownVendor":0}`
- **Next step:** The recompute pipeline is wired correctly and matches all 163 rows. The bug is upstream: the pipeline was never invoked against this vendor+facility. Dig into (a) `lib/actions/cog-import.ts` (dynamic-import call site ~line 200) to verify post-import recompute actually fires for every vendor touched by the import, and (b) `lib/actions/contracts.ts` to verify contract create/update/delete triggers recompute for the vendor+facility. The Arthrex contract's `pricingItemsCount = 0` (H3) is a separate seed-data observation; it happens not to block matching because the cascade's vendor+date fallback short-circuits to `on_contract` via the override at `lib/cog/recompute.ts:297-302`. If that fallback were ever removed, H3 would become load-bearing.

### Why the grid shows both H3 and H4 ✅

- **H3** (pricingItems empty): true — the contract has zero `ContractPricing` rows. With a naive matcher this would force `off_contract_item` for every line.
- **H4** (pipeline works, triggers missing): true and the dominant explanation — when the probe called the recompute directly, all 163 rows flipped to `on_contract` via the cascade's `vendorAndDate` override (`lib/cog/recompute.ts:297-302`), which trusts vendor+date even when the strict item-level matcher returned `off_contract_item`.
- The actionable bug is therefore **trigger wiring**, not the seed data, not the matcher, not `loadContractsForVendor`.

_(Commit SHAs to be filled in after commit.)_
