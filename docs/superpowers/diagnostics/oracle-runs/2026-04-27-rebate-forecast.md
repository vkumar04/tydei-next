# Oracle: rebate-forecast — FAIL

**Run:** 2026-04-27T01:42:55.725Z
**Duration:** 12ms
**Checks:** 0/1 passed

## Results

- ❌ **oracle threw**
  - 
Invalid `prisma.contractPeriod.findMany()` invocation in
/Users/vickkumar/code/tydei-next/scripts/oracles/rebate-forecast.ts:48:49

  45 // ── Naive oracle baseline: trailing 12mo period spend ──────
  46 const since = new Date()
  47 since.setMonth(since.getMonth() - 12)
→ 48 const periods = await prisma.contractPeriod.findMany({
       where: {
         contractId: "cmof7h07z0029xehl7a2wv7ct",
         payPeriodEnd: {
         ~~~~~~~~~~~~
           gte: new Date("2025-04-27T01:42:55.724Z")
         },
     ?   AND?: ContractPeriodWhereInput | ContractPeriodWhereInput[],
     ?   OR?: ContractPeriodWhereInput[],
     ?   NOT?: ContractPeriodWhereInput | ContractPeriodWhereInput[],
     ?   id?: StringFilter | String,
     ?   facilityId?: StringNullableFilter | String | Null,
     ?   periodStart?: DateTimeFilter | DateTime,
     ?   periodEnd?: DateTimeFilter | DateTime,
     ?   totalSpend?: DecimalFilter | Decimal,
     ?   totalVolume?: IntFilter | Int,
     ?   rebateEarned?: DecimalFilter | Decimal,
     ?   rebateCollected?: DecimalFilter | Decimal,
     ?   paymentExpected?: DecimalFilter | Decimal,
     ?   paymentActual?: DecimalFilter | Decimal,
     ?   balanceExpected?: DecimalFilter | Decimal,
     ?   balanceActual?: DecimalFilter | Decimal,
     ?   tierAchieved?: IntNullableFilter | Int | Null,
     ?   createdAt?: DateTimeFilter | DateTime,
     ?   updatedAt?: DateTimeFilter | DateTime,
     ?   contract?: ContractScalarRelationFilter | ContractWhereInput,
     ?   facility?: FacilityNullableScalarRelationFilter | FacilityWhereInput | Null,
     ?   rebates?: RebateListRelationFilter
       },
       select: {
         totalSpend: true
       }
     })

Unknown argument `payPeriodEnd`. Did you mean `periodEnd`? Available options are marked with ?.
