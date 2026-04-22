# W2A1 — pure matcher vs. oracle (Arthrex cluster)

_Generated: 2026-04-22T23:48:01.470Z_

## Inputs

- COG CSV: `/Users/vickkumar/Desktop/experiment COG vendor short NEW.csv` (31297 rows, 4259 Arthrex)
- Pricing xlsx: `/Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx` (10422 priced items)
- Contract: synthetic ContractForMatch (active, 2024-01-01 → 2027-12-31, no term scope)
- Facility scope: `TEST_FACILITY` / Vendor: `TEST_VENDOR`

## 1. Matcher output distribution

| status | rows | spend (extendedCost) |
|---|---:|---:|
| off_contract_item | 3,222 | $3,054,828.78 |
| on_contract | 667 | $271,142.48 |
| price_variance | 370 | $594,410.97 |
| **total** | **4,259** | **$3,920,382.23** |

## 2. Oracle vs. matcher

| bucket | oracle rows | matcher rows | delta | oracle spend | matcher spend | delta |
|---|---:|---:|---:|---:|---:|---:|
| on_contract | 1,037 | 667 | -370 | $1,829,277.40 | $271,142.48 | $-1,558,134.92 |
| not_priced (off_contract_item + price_variance) | 3,222 | 3,592 | 370 | — | — | — |
| total rows | 4,259 | 4,259 | 0 | — | — | — |

## 3. Disagreements

- matcher-missed (catalog has ref, matcher says `!=on_contract`): **370**
- matcher-extra (catalog does NOT have ref, matcher says `on_contract`): **0**

### First 10 matcher-missed rows

| csvRef | productName (40ch) | qty | unitCost | date | ext | matcherStatus | reason |
|---|---|---:|---:|---|---:|---|---|
| `AR-6535` | PLATE BROAD Y 5 HOLE 626995 | 1 | 1382.0000 | 1/11/25 | $1,382.00 | price_variance |  |
| `AR-6411` | SCREW 7.0MM HEADLESS COMPRESSION LONG TI | 1 | 798.7600 | 1/11/25 | $798.76 | price_variance |  |
| `AR-9815` | SCREW HEADLESS COMPRESSION TITANIUM SHOR | 1 | 798.7600 | 1/11/25 | $798.76 | price_variance |  |
| `AR-6570` | SCREW FULLY THREADED LOCKING 2.7 X 16MM  | 1 | 227.8800 | 1/11/25 | $227.88 | price_variance |  |
| `AR-7281` | SCREW 2.7MM FULLY THREADED NON-LOCKING 2 | 2 | 138.2700 | 1/11/25 | $276.54 | price_variance |  |
| `AR-6530` | SCREW BONE FULL THREADED NON-LOCKING TIT | 1 | 138.2700 | 1/11/25 | $138.27 | price_variance |  |
| `AR-8400CDS` | SCREW 2.7MM FULLY THREADED NON-LOCKING 3 | 1 | 138.2700 | 1/11/25 | $138.27 | price_variance |  |
| `AR-8550PR` | GUIDEWIRE THREADED 3.2 X 230MM 705236 | 10 | 0.0100 | 1/11/25 | $0.10 | price_variance |  |
| `AR-13995N` | Y-PLATE BROAD 3 SHAFT HOLES 626993 | 1 | 1382.0000 | 1/11/25 | $1,382.00 | price_variance |  |
| `AR-8954-02` | SUTURE PROLENE 2-0 FS-1 REVERSE CUTTING  | 1 | 72.7800 | 1/17/25 | $72.78 | price_variance |  |

### First 10 matcher-extra rows

| csvRef | productName (40ch) | qty | unitCost | date | ext |
|---|---|---:|---:|---|---:|

## 4. Verdict

**Ref-normalization AGREES with oracle.** The pure matcher joins 1,037 CSV rows against catalog refs (on_contract + price_variance), which matches the oracle's 1,037 `in-catalog` rows. The 370-row split between `on_contract` and `price_variance` is the matcher's `PRICE_VARIANCE_THRESHOLD` (2%) at work — the oracle doesn't model this threshold, so the row counts diverge on pricing variance but not on catalog membership.

**Conclusion:** the production bug (0 on_contract in the demo DB) is NOT in `lib/contracts/match.ts`. It lives downstream — recompute pipeline, vendor resolution during import, or the demo DB's COG rows never being enriched out of `pending`.

matcher on_contract = 667, price_variance = 370, in-catalog total = 1037, oracle on_contract = 1037, delta on_contract = -370, delta in-catalog = 0.
