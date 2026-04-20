# Edit-save diagnostic — contract cmo6j6g3o003cachl91ayhx0n

## Contract scalar fields

```json
{
  "id": "cmo6j6g3o003cachl91ayhx0n",
  "contractNumber": "ILS-2025-DR",
  "name": "Integra Dural Repair",
  "vendorId": "cmo6j6fxk000hachlr4aw9usq",
  "facilityId": "cmo6j6fx70004achlf8fr82h2",
  "productCategoryId": "cmo6j6fxw0015achlsou9n5zw",
  "contractType": "usage",
  "status": "active",
  "effectiveDate": "2025-04-01T00:00:00.000Z",
  "expirationDate": "2027-04-01T00:00:00.000Z",
  "autoRenewal": false,
  "terminationNoticeDays": 90,
  "totalValue": "280000",
  "annualValue": "140000",
  "description": "DuraGen and DuraMatrix dural repair products",
  "notes": null,
  "gpoAffiliation": null,
  "performancePeriod": "quarterly",
  "rebatePayPeriod": "annual",
  "isGrouped": false,
  "isMultiFacility": false,
  "tieInCapitalContractId": null,
  "capitalCost": null,
  "interestRate": null,
  "termMonths": null,
  "downPayment": null,
  "paymentCadence": null,
  "amortizationShape": "symmetrical",
  "complianceRate": null,
  "currentMarketShare": null,
  "marketShareCommitment": null,
  "score": null,
  "scoreBand": null,
  "scoreUpdatedAt": null,
  "createdById": null,
  "createdAt": "2026-04-20T01:43:16.740Z",
  "updatedAt": "2026-04-20T01:43:16.740Z"
}
```

## Terms + tiers

```json
[
  {
    "id": "cmo6j6g3p003dachlfx5aaaxi",
    "contractId": "cmo6j6g3o003cachl91ayhx0n",
    "termName": "Volume Rebate",
    "termType": "volume_rebate",
    "baselineType": "volume_based",
    "evaluationPeriod": "annual",
    "paymentTiming": "quarterly",
    "appliesTo": "all_products",
    "rebateMethod": "cumulative",
    "effectiveStart": "2025-04-01T00:00:00.000Z",
    "effectiveEnd": "2027-04-01T00:00:00.000Z",
    "volumeType": null,
    "spendBaseline": null,
    "volumeBaseline": 60,
    "growthBaselinePercent": null,
    "desiredMarketShare": null,
    "boundaryRule": null,
    "priceReductionTrigger": null,
    "shortfallHandling": "carry_forward",
    "negotiatedBaseline": null,
    "growthOnly": false,
    "periodCap": null,
    "fixedRebatePerOccurrence": null,
    "minimumPurchaseCommitment": null,
    "cptCodes": [],
    "groupedReferenceNumbers": [],
    "referenceNumbers": [],
    "categories": [],
    "marketShareVendorId": null,
    "marketShareCategory": null,
    "createdAt": "2026-04-20T01:43:16.741Z",
    "updatedAt": "2026-04-20T01:43:16.741Z",
    "tiers": [
      {
        "id": "cmo6j6g3s003eachlf0ecn9a9",
        "termId": "cmo6j6g3p003dachlfx5aaaxi",
        "tierNumber": 1,
        "tierName": null,
        "spendMin": "0",
        "spendMax": null,
        "volumeMin": 0,
        "volumeMax": 60,
        "marketShareMin": null,
        "marketShareMax": null,
        "rebateType": "fixed_rebate_per_unit",
        "rebateValue": "25",
        "fixedRebateAmount": null,
        "reducedPrice": null,
        "priceReductionPercent": null,
        "createdAt": "2026-04-20T01:43:16.744Z"
      },
      {
        "id": "cmo6j6g3s003fachl9pjuw8ct",
        "termId": "cmo6j6g3p003dachlfx5aaaxi",
        "tierNumber": 2,
        "tierName": null,
        "spendMin": "0",
        "spendMax": null,
        "volumeMin": 60,
        "volumeMax": null,
        "marketShareMin": null,
        "marketShareMax": null,
        "rebateType": "fixed_rebate_per_unit",
        "rebateValue": "50",
        "fixedRebateAmount": null,
        "reducedPrice": null,
        "priceReductionPercent": null,
        "createdAt": "2026-04-20T01:43:16.744Z"
      }
    ]
  }
]
```

## Contract scalar field names

amortizationShape, annualValue, autoRenewal, capitalCost, complianceRate, contractNumber, contractType, createdAt, createdById, currentMarketShare, description, downPayment, effectiveDate, expirationDate, facilityId, gpoAffiliation, id, interestRate, isGrouped, isMultiFacility, marketShareCommitment, name, notes, paymentCadence, performancePeriod, productCategoryId, rebatePayPeriod, score, scoreBand, scoreUpdatedAt, status, termMonths, terminationNoticeDays, tieInCapitalContractId, totalValue, updatedAt, vendorId

## Term scalar field names

appliesTo, baselineType, boundaryRule, categories, contractId, cptCodes, createdAt, desiredMarketShare, effectiveEnd, effectiveStart, evaluationPeriod, fixedRebatePerOccurrence, groupedReferenceNumbers, growthBaselinePercent, growthOnly, id, marketShareCategory, marketShareVendorId, minimumPurchaseCommitment, negotiatedBaseline, paymentTiming, periodCap, priceReductionTrigger, rebateMethod, referenceNumbers, shortfallHandling, spendBaseline, termName, termType, updatedAt, volumeBaseline, volumeType

## Suspected drop set

### Update-action field catalog comparison

Every contract scalar field the update action accepts + assigns to the
`Prisma.ContractUpdateInput` object (`lib/actions/contracts.ts:893-944`):

- name, contractNumber, vendor (via vendorId), productCategory (via
  productCategoryId OR categoryIds[0]), contractType, status,
  effectiveDate, expirationDate, autoRenewal, terminationNoticeDays,
  totalValue, annualValue, description, notes, gpoAffiliation,
  performancePeriod, rebatePayPeriod, isMultiFacility, isGrouped,
  capitalCost, interestRate, termMonths, downPayment, paymentCadence,
  amortizationShape, facilityIds (join), categoryIds (join),
  customAmortizationRows (amortization schedule rebuild)

Schema fields (`createContractSchema` / `updateContractSchema`) that are
NOT handled in `updateContract`:

- **`additionalFacilityIds`** — persisted on create via
  `prisma.contractFacility.createMany({ skipDuplicates: true })` at
  `lib/actions/contracts.ts:703`. Silently dropped on update.
- `tieInCapitalContractId` — accepted on create (line 802), not handled
  on update. Legacy field; deprecated by W1.T's contract-level capital.
- `tieInCapitalValue` / `tieInPayoffMonths` — legacy, accepted by the
  schema but neither create nor update does anything with them.

### Root cause

**`additionalFacilityIds` is the field domain that drops.** The multi-
facility picker (`FacilityMultiSelect` in `components/contracts/contract-form.tsx:790-795`)
writes user-selected facility IDs into `form.values.additionalFacilityIds`.
On save the edit-contract client spreads `values` into the update payload,
so the server receives them — but the `updateContract` server action has
no handler for that key, so the value evaporates before it reaches
Prisma.

W1.W-E (commit `19b38ab`) hardened the contractType flip + new-term-with-
tiers path. It did not touch `additionalFacilityIds`. The regression test
added in this task (`contract-edit-save-regression.test.ts`) pins the
drop: on current main the assertion `expect(allAddedFacilityIds).toContain("fac-3")`
fails because `prisma.contractFacility.createMany` is only called once
with the `facilityIds` array and `fac-3` (from `additionalFacilityIds`)
never hits the DB.

### Fix

Add an `additionalFacilityIds` handler to `updateContract` that mirrors
the create path: `prisma.contractFacility.createMany` with
`skipDuplicates: true` after the existing `facilityIds` rewrite. Test
locks the behavior.
