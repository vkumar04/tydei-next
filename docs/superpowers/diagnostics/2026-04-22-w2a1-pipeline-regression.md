# W2.A.1 pipeline regression — 2026-04-23T00:08:20.656Z

Runtime: 0.9s

## Inputs

- COG CSV: `/Users/vickkumar/Desktop/experiment COG vendor short NEW.csv` (all rows = 31297)
- Arthrex rows in CSV: 4259
- Price file: `/Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx` (10423 items)

## matchStatus distribution (Arthrex)

| Status | Count |
|---|---:|
| on_contract      | 3767 |
| price_variance   | 491 |
| off_contract_item| 1 |
| out_of_scope     | 0 |
| unknown_vendor   | 0 |
| pending          | 0 |
| **total**        | **4259** |

## Oracle check

Expected: on_contract + price_variance ≥ 1000
Actual:   4258

**PASS** — matched 4258 ≥ 1000
