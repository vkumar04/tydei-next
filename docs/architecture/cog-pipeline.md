# COG data lifecycle

CSV upload → enrichment → on-contract attribution → case-supply rollup.
Audited 2026-04-25.

## Schema (key relationships)

```
Vendor (vendor)
 └─ id, name, aliases[]

Facility (facility)
 └─ id, name

Contract (contract)
 ├─ id, vendorId→Vendor, facilityId?→Facility, status, effectiveDate, expirationDate
 ├─ contractFacilities[]→ContractFacility (multi-facility join)
 ├─ contractCategories[]→ContractProductCategory
 ├─ pricingItems[]→ContractPricing  (vendorItemNo, unitPrice, listPrice, category)
 └─ terms[]→ContractTerm
        ├─ appliesTo, categories[], effectiveStart/End
        └─ products[]→ContractTermProduct (vendorItemNo, contractPrice)

PricingFile (pricing_file)              # facility-scoped vendor catalog
 └─ vendorId, facilityId, vendorItemNo, contractPrice, category, effectiveDate

COGRecord (cog_record)
 ├─ facilityId, vendorId?, vendorName?, vendorItemNo?, category?
 ├─ inventoryNumber, inventoryDescription, unitCost, quantity, extendedPrice, transactionDate
 ├─ matchStatus (enum), contractId?, contractPrice?, isOnContract, savingsAmount?, variancePercent?
 └─ fileImportId?→FileImport

Case → CaseSupply (case_supply)
 └─ caseId, materialName, vendorItemNo?, isOnContract, contractId?
```

## Import pipeline

| Step | File:func | Populates |
|---|---|---|
| 1. Upload + parse CSV (client) | `hooks/use-cog-import.ts:46` | headers, rows, AI mapping suggestion |
| 2. Manual mapping screen | same file (`vendor_match`, `duplicate_check` steps) | mapping, vendorMappings |
| 3. Duplicate check | `lib/actions/cog-duplicate-check.ts:52` | reads existing rows in batches; full-key compare per `lib/cog/duplicate-detection.ts` |
| 4a. CSV bulk path | `lib/actions/imports/cog-csv-import.ts:16` `ingestCOGRecordsCSV` | normalized records → `bulkImportCOGRecords` |
| 4b. UI wizard path | `lib/actions/cog-import.ts:27` `bulkImportCOGRecords` | `resolveVendorIdsBulk` → `vendorId` resolved/auto-created → `cOGRecord.createMany` in 500-row batches |
| 5. Post-import enrichment | `lib/actions/cog-import.ts:217-242` (dynamic import per distinct vendorId) | `matchStatus`, `contractId`, `contractPrice`, `isOnContract`, `savingsAmount`, `variancePercent`, optional `category` backfill |
| 6. Stats rollup | `cog-import.ts:252-272` 60-second window count | `matched` / `onContractRate` |

**At create time:** facilityId, vendorId, vendorName, inventoryNumber, inventoryDescription, vendorItemNo, manufacturerNo, poNumber, unitCost, extendedPrice, quantity, transactionDate, category, createdBy.
**Left default at create:** `matchStatus=pending`, `contractId=null`, `isOnContract=false`, `fileImportId=null`.

## Match Pricing vs Re-run match

| Concern | `matchCOGToContracts` (`cog-match.ts:26`) | `backfillCOGEnrichment` (`cog-import/backfill.ts:31`) |
|---|---|---|
| UI label | "Match Pricing" | "Re-run match" |
| Step 1 | `groupBy [vendorName, vendorId]` on facility's COG | `findMany contracts` (active/expiring) at facility |
| Step 2 | `resolveVendorIdsBulk(names, {createMissing:false})` resolves names → vendorIds | (skipped — relies on prior vendor resolution) |
| Step 3 | `prisma.cOGRecord.updateMany {vendorId: matchedId}` per group | n/a |
| Step 4 | For each contracted vendorId → `recomputeMatchStatusesForVendor` | For each distinct contract.vendorId → `recomputeMatchStatusesForVendor` |
| Net effect | **Resolves vendorId first**, THEN enriches | Enriches only |

`recomputeMatchStatusesForVendor` (`lib/cog/recompute.ts:121`) is the
sole writer of `matchStatus` / `contractId` / `contractPrice` /
`isOnContract` / `savingsAmount` / `variancePercent` / (optional)
`category`. Batches updates 500 at a time.

The two buttons exist because they do different things; tooltips were
added 2026-04-24 to make the difference visible. Charles asked
"what's the purpose of having Match and Rematch?" — the answer is:
- Use Match Pricing after **importing new COG** (rows lack vendorId).
- Use Re-run match after **changing contracts** (vendorId already set).

## Supply.isOnContract on cases

**Writers (only at create — NO recompute today):**
- `lib/actions/cases.ts:380` `importCaseSupplies` — uses caller-supplied `supply.isOnContract ?? false`
- `lib/actions/case-costing/compliance.ts:42` (hardcodes `true` — looks like a stub)
- `prisma/seeds/cases.ts:233` — seed-time literals

**Readers:**
- `lib/case-costing/compliance.ts:60` (per-case rollup)
- `lib/actions/cases.ts:402, 443` (surgeon scorecards)
- `components/facility/case-costing/case-detail.tsx`
- `lib/data-pipeline/po-summary.ts`

**Status:** there is NO recompute helper analogous to
`recomputeMatchStatusesForVendor`. Once a `CaseSupply` row is written,
its `isOnContract` is frozen — adding/removing a `Contract` row never
updates downstream cases. **This is why "Avg On-Contract %" on Case
Costing shows 0% in fresh demo state**.

The fix (added 2026-04-25 — see `lib/case-costing/recompute-supply.ts`):
helper that joins `CaseSupply.vendorItemNo` against the
`ContractPricing` catalog used in `lib/cog/recompute.ts`, scoped by
the case's `facilityId` and `dateOfSurgery`. Wired into
`approvePendingContract`, `createContract`, `updateContract`, and the
post-import path of `bulkImportCOGRecords`.

## The 21,377 orphan rows that bit us 2026-04-24

Profile: `vendorItemNo=null`, `category=null`, `fileImportId=null`,
all at Lighthouse Surgical Center.

Suspect code paths:
- `scripts/e2e-synthetic-test.ts:776-780` — bulk createMany scoped to a facility
- `scripts/qa-mock-contract-lifecycle.ts:178` — same pattern
- `scripts/verify-app-against-oracle.ts:249`, `verify-vendor-app-against-oracle.ts:249` — same

None of the canonical seeds (`prisma/seeds/cog-records.ts`,
`cog-for-contracts.ts`) leave `vendorItemNo` null. The orphans almost
certainly came from a verify-against-oracle run that aborted between
`createMany` and `deleteMany`.

**Detection (added 2026-04-25 to `scripts/qa-sanity.ts`):** sanity
check fails if `COUNT(*) WHERE vendorItemNo IS NULL AND fileImportId
IS NULL` exceeds 5% of facility total. Catches future drift.

## Multi-facility scoping audit

Every facility-portal COG read goes through `requireFacility()` and
filters on `facilityId: facility.id`. Spot-checked clean across:
`lib/actions/cog-records.ts`, `cog-import.ts`, `cog-match.ts`,
`cog-import/backfill.ts`, `cog-duplicate-check.ts`,
`cog/spend-trend.ts`, `cog/concentration.ts`, `contracts.ts` spend
aggregations, `notifications.ts`, `prospective.ts`, `analysis.ts`,
`rebate-optimizer-engine.ts`, `rebate-optimizer-insights.ts`.

**Vendor-portal cross-facility reads (intentional):**
- `lib/actions/vendor-analytics.ts:62-92` — vendor sees their own
  spend across every facility they sold to (correct; that's the
  vendor's market share denominator).
- L77 `groupBy` "total market" sum runs without a `vendorId` filter
  when `facilityId` is omitted — by design, but if a future caller
  forgets to scope, this silently leaks. Worth a typed `where`
  contract here (currently typed `Record<string, unknown>`).
