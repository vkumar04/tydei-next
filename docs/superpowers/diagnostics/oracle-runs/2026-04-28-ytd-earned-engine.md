# Oracle: ytd-earned-engine — PASS

**Run:** 2026-04-28T17:49:39.388Z
**Duration:** 0ms
**Checks:** 5/5 passed

## Results

- ✅ **lifetime: payPeriodEnd <= today**
  - oracle=360 app=360
- ✅ **YTD: payPeriodEnd <= today AND >= startOfYear**
  - oracle=150 app=150
- ✅ **lifetime ≥ YTD by definition**
  - lifetime=360 ytd=150
- ✅ **future-dated rows excluded from both**
  - expected lifetime=360 ytd=150, got lifetime=360 ytd=150
- ✅ **null payPeriodEnd excluded from both**
  - row with null payPeriodEnd must NOT contribute
