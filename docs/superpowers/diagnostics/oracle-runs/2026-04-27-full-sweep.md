# Oracle: full-sweep — FAIL

**Run:** 2026-04-27T01:42:55.713Z
**Duration:** 49ms
**Checks:** 7/9 passed

## Results

- ✅ **status ∈ {active, expiring} so recompute will load this contract**
  - status=expiring
- ✅ **annualValue ≤ totalValue (Bug 1 refine)**
  - annual=$210,000.00  total=$420,000.00
- ❌ **annualValue within ±1% of (total / years) — calendar math**
  - expected ~$162,580.65  got $210,000.00  years=2.583
- ❌ **contract has at least one term**
  - 0 terms
- ✅ **On-contract rows oracle == app**
  - oracle=2  app=2
- ✅ **On-contract spend oracle == app (penny)**
  - oracle=$4,075.00  app=$4,075.00  delta=$0.00
- ✅ **Off-contract rows oracle == app**
  - oracle=160  app=160
- ✅ **Off-contract spend oracle == app (penny)**
  - oracle=$531,400.00  app=$531,400.00
- ✅ **no contract has BOTH effectiveDate=1970-01-01 AND expirationDate=9999-12-31**
  - 0 contracts would fail this check
