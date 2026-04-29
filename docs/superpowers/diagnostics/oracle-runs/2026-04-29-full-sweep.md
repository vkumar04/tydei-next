# Oracle: full-sweep — PASS

**Run:** 2026-04-29T21:17:12.474Z
**Duration:** 40ms
**Checks:** 12/12 passed

## Results

- ✅ **status ∈ {active, expiring} so recompute will load this contract**
  - status=expiring
- ✅ **annualValue ≤ totalValue (Bug 1 refine)**
  - annual=$168,000.00  total=$420,000.00
- ✅ **annualValue within ±25% of (total / years) — broken-seed detector**
  - expected ~$162,580.65  got $168,000.00  years=2.583
- ✅ **contract has at least one term**
  - 1 terms
- ✅ **term "Spend Rebate" has at least one tier**
  - 3 tiers
- ✅ **term "Spend Rebate" dates non-sentinel on effectiveStart unless intended**
  - start=2024-04-01  end=2026-10-01
- ✅ **On-contract rows oracle == app**
  - oracle=2  app=2
- ✅ **On-contract spend oracle == app (penny)**
  - oracle=$4,075.00  app=$4,075.00  delta=$0.00
- ✅ **Off-contract rows oracle == app**
  - oracle=160  app=160
- ✅ **Off-contract spend oracle == app (penny)**
  - oracle=$548,150.00  app=$548,150.00
- ✅ **term "Spend Rebate" Retroactive rebate > 0 for $4,075 spend**
  - rebate=$81.50
- ✅ **no contract has BOTH effectiveDate=1970-01-01 AND expirationDate=9999-12-31**
  - 0 contracts would fail this check
