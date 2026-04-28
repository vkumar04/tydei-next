# Oracle: schema-invariants — FAIL

**Run:** 2026-04-28T14:32:20.500Z
**Duration:** 41ms
**Checks:** 0/1 passed

## Results

- ❌ **oracle threw**
  - 
Invalid `prisma.contract.count()` invocation in
/Users/vickkumar/code/tydei-next/scripts/oracles/schema-invariants.ts:25:25

  22 // discrepancy means a botched migration or direct-SQL surgery).
  23 const [contractCount, rebateCount, periodCount, termCount] =
  24   await Promise.all([
→ 25     prisma.contract.count(

