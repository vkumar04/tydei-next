# Oracle: market-share — FAIL

**Run:** 2026-04-27T01:43:01.415Z
**Duration:** 52ms
**Checks:** 0/1 passed

## Results

- ❌ **oracle threw**
  - 
Invalid `prisma.cOGRecord.findFirst()` invocation in
/Users/vickkumar/code/tydei-next/scripts/oracles/market-share.ts:23:46

  20 // Pick a vendor that has at least one categorizable COG row at the
  21 // demo facility. We don't care which — we just need one to drive
  22 // the comparison.
→ 23 const sampleRow = await prisma.cOGRecord.findFirst({
       where: {
         facilityId: "cmof7h0380003xehl3oc5ptx2",
         vendorId: {
           not: null
         },
         OR: [
           {
             category: {
               not: null
             }
           },
           {
             contract: {
               productCategory: {
                 isNot: null
               }
             }
           }
         ]
       },
       select: {
         vendorId: true
       }
     })

Unknown argument `contract`. Did you mean `contractId`? Available options are marked with ?.
