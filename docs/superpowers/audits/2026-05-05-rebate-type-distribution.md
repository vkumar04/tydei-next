# Audit — `ContractTier.rebateType` distribution (2026-05-05)

## Why

Confirm whether tiers in the local Postgres carry a usable `rebateType`, since
the engine bridge `scaleRebateValueForEngine`
(`lib/rebates/calculate.ts:230`) only multiplies by 100 when
`rebateType === "percent_of_spend"`. Any tier with a missing/wrong
`rebateType` would scale incorrectly (off by 100×).

Context: per-type engine wiring landed in commits `ec5c14f..8df905c`. We
want to make sure no historical tiers slipped through with a NULL/wrong
type.

## Method

Connected via `docker exec tydei-next-postgres-1 psql -U tydei -d tydei`
(local `psql` was not on PATH; the running container is the same
`postgresql://tydei:tydei_dev_password@localhost:5432/tydei` instance).

Tables are snake_case (Prisma `@@map`), columns are camelCase.

## Schema observation (important)

`contract_tier.rebateType` is **NOT NULL with default
`'percent_of_spend'`**. There is no NULL state to audit — Postgres rejects
inserts that omit the column. So the "tiers without rebateType" failure
mode the bridge would exhibit cannot occur for this column at the schema
level.

`contract_term` does not have a `rebateType` column at all
(only `termType`, `rebateMethod`, `volumeType`, `baselineType`). The
audit prompt's second query against `ContractTerm.rebateType` is a
schema mismatch — there is nothing to count there. Closest analogues
(`termType` + `rebateMethod`) are reported below for context.

## Tier rebateType distribution (local DB)

| rebate_type             | tier_count | term_count | avg_value | min_value | max_value |
|-------------------------|-----------:|-----------:|----------:|----------:|----------:|
| `percent_of_spend`      |         27 |         10 |    0.0326 |    0.0100 |    0.0600 |
| `fixed_rebate_per_unit` |          5 |          2 |   60.0000 |   25.0000 |  100.0000 |

`RebateType` enum has four values
(`percent_of_spend`, `fixed_rebate`, `fixed_rebate_per_unit`,
`per_procedure_rebate`). Only two are present in the local seed.

## Drift-hazard probes

All three returned **0 rows**:

1. Tiers with `rebateType <> 'percent_of_spend'` and `rebateValue < 1`
   — would suggest a fractional value mistyped as a unit-based type.
2. Tiers with `rebateType = 'percent_of_spend'` and `rebateValue > 1`
   — would suggest an integer percent (e.g., 3) entered where a fraction
   (0.03) is expected; the engine would scale to 300%.
3. Tiers with `rebateType = 'fixed_rebate_per_unit'` and `rebateValue < 1`
   — would suggest a fractional percent mistyped as a per-unit rebate.

The data is internally consistent: every `percent_of_spend` tier has
`rebateValue` in (0, 1) and every `fixed_rebate_per_unit` tier has
`rebateValue` >= 25 (real per-unit dollar amounts).

## Term-level cross-check

Tier rebate-type × parent-term method/type:

| tier rebateType         | term rebateMethod | term termType        | tier_count |
|-------------------------|-------------------|----------------------|-----------:|
| `percent_of_spend`      | cumulative        | `spend_rebate`       |         12 |
| `percent_of_spend`      | cumulative        | `compliance_rebate`  |          7 |
| `fixed_rebate_per_unit` | cumulative        | `volume_rebate`      |          5 |
| `percent_of_spend`      | cumulative        | `market_share`       |          3 |
| `percent_of_spend`      | marginal          | `spend_rebate`       |          3 |
| `percent_of_spend`      | cumulative        | `growth_rebate`      |          2 |

`fixed_rebate_per_unit` tiers exclusively belong to `volume_rebate`
terms — semantically correct (per-unit rebates require a volume context).
No rebate types appear under term types where they don't belong.

## Conclusion

- **No drift hazards in the local DB.** All 32 tiers have a
  `rebateType` set (NOT NULL constraint enforces this) and a
  `rebateValue` in the unit range expected for that type.
- The audit prompt's NULL hypothesis cannot occur for
  `ContractTier.rebateType` due to the schema. If a future migration
  ever drops the default or makes the column nullable, this audit
  needs to be re-run.
- The audit prompt's `ContractTerm.rebateType` query targets a column
  that does not exist; the closest meaningful breakdown
  (`termType` × `rebateMethod`) is shown above.

## Reproducibility

```bash
docker exec tydei-next-postgres-1 psql -U tydei -d tydei -c "
SELECT
  COALESCE(\"rebateType\"::text, 'NULL') as rebate_type,
  COUNT(*) as tier_count,
  COUNT(DISTINCT \"termId\") as term_count,
  ROUND(AVG(\"rebateValue\")::numeric, 4) as avg_value,
  MIN(\"rebateValue\") as min_value,
  MAX(\"rebateValue\") as max_value
FROM contract_tier
GROUP BY \"rebateType\"
ORDER BY tier_count DESC;
"
```
