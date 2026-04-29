# Oracle: schema-invariants — PASS

**Run:** 2026-04-29T21:17:12.504Z
**Duration:** 29ms
**Checks:** 15/15 passed

## Results

- ✅ **schema reachable for invariant checks**
  - contracts=20 rebates=152 periods=240 terms=13
- ✅ **no Contract has effectiveDate > expirationDate**
  - 20 contracts checked
- ✅ **no Rebate has payPeriodStart > payPeriodEnd**
  - 152 rebate periods checked
- ✅ **no ContractPeriod has periodStart > periodEnd**
  - 240 contract periods checked
- ✅ **no Contract with status=active but expirationDate in the past**
  - 15 active contracts checked
- ✅ **no tie_in contract without either tieInCapitalContractId or capital line items**
  - 1 tie-in contracts checked
- ✅ **no Rebate with negative rebateEarned or rebateCollected**
  - 152 rebate rows checked
- ✅ **no Rebate has collectionDate before payPeriodStart**
  - 12 collected rebates checked
- ✅ **ContractTier.rebateValue (percent_of_spend) within [0, 1]**
  - 32 tier rows checked
- ✅ **no ContractTerm has duplicate tierNumber values**
  - 12 terms-with-tiers checked
- ✅ **every ContractCapitalLineItem has termMonths > 0**
  - 2 capital line items checked
- ✅ **no ContractCapitalLineItem with initialSales > contractTotal**
  - 2 capital items checked
- ✅ **ContractCapitalLineItem.interestRate within [0, 1)**
  - 2 capital items checked
- ✅ **no Rebate has rebateCollected > rebateEarned**
  - 152 rebate rows checked
- ✅ **status=expiring contracts have expirationDate within 180 days**
  - 2 expiring contracts checked
