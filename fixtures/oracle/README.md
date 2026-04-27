# fixtures/oracle/

Source-level oracle scenarios load their pricing and COG fixtures from
this directory. Layout:

```
fixtures/oracle/
  <scenario-name>/
    pricing.csv      # ScenarioPricingRow[] (vendorItemNo, unitCost, [category, manufacturer])
    cog.csv          # ScenarioCogRow[] (vendorItemNo, quantity, unitCost, [extendedPrice], transactionDate, [category, inventoryNumber, inventoryDescription])
```

Small fixtures (under ~1MB) get checked in. Larger files use an
env-var-pointed override:

```
ORACLE_PRICING_<SCENARIO_NAME>=/abs/path/to/pricing.csv
ORACLE_COG_<SCENARIO_NAME>=/abs/path/to/cog.csv
```

Where `<SCENARIO_NAME>` is the scenario's `name` field upper-cased with
hyphens replaced by underscores. So a scenario named
`arthrex-canonical` looks up `ORACLE_PRICING_ARTHREX_CANONICAL`.

## Conventions

- CSVs are UTF-8, comma-separated, with a header row.
- Header names are exact (case-sensitive). Required columns:
  - pricing: `vendorItemNo`, `unitCost`
  - cog: `vendorItemNo`, `quantity`, `unitCost`, `transactionDate`
- Optional columns are read if present, ignored if absent.
- `extendedPrice` defaults to `quantity × unitCost` when blank.
- Dates are ISO `YYYY-MM-DD`.

## When to inline vs file

Inline JSON in the scenario `.ts` file when the fixture has fewer than
~50 rows. Use checked-in CSV files in `fixtures/oracle/<scenario>/`
when there are more rows or the data should be human-editable. Use an
env-var override only when the file is too large or sensitive to check
in.
