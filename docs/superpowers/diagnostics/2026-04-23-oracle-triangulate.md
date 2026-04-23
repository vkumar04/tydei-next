# Triangulation oracle — three independent paths to on-contract classification

_Generated 2026-04-23T03:37:20.828797+00:00Z_

- Catalog: **10423** line items
- Arthrex POs (importer-parity, null-date skipped): **4257**
- Total lifetime spend: **$4,949,225.83**

## 1. Signal agreement

| signal | method | on-contract rows | on-contract spend |
|---|---|---:|---:|
| A | ref-number exact match | 1036 | $1,829,652.40 |
| B | ref appears in product name | 1135 | $2,012,008.80 |
| C | catalog description token overlap | 2072 | $2,619,203.25 |

## 2. Per-row consensus

Each row voted on by all three signals:

| signals agreeing | rows | spend | interpretation |
|---:|---:|---:|---|
| 3/3 | 776 | $1,477,434.60 | Strong on-contract (all three agree) |
| 2/3 | 427 | $635,651.04 | Probable on-contract (two of three) |
| 1/3 | 1061 | $757,258.57 | Weak signal (one of three — review) |
| 0/3 | 1993 | $2,078,881.62 | Strong off-contract (none agree) |

## 3. Pairwise agreement

**A vs B** — agree 3754/4257 (88.2%)

- both-on-contract: 834
- both-off-contract: 2920
- only first says on: 202
- only second says on: 301

**A vs C** — agree 2879/4257 (67.6%)

- both-on-contract: 865
- both-off-contract: 2014
- only first says on: 171
- only second says on: 1207

**B vs C** — agree 3162/4257 (74.3%)

- both-on-contract: 1056
- both-off-contract: 2106
- only first says on: 79
- only second says on: 1016

## 4. Algebraic cross-checks

- Lifetime spend: **$4,949,225.83**
  - 2025: $1,076,508.11
  - 2026: $3,872,717.72
  - **sum-of-years = $4,949,225.83** → equal to lifetime: True

- Time partition (trailing-12mo + pre-window + future-dated):
  - trailing: $1,596,582.47
  - pre-window: $883,433.84
  - future-dated: $2,469,209.52
  - **sum = $4,949,225.83** → equal to lifetime: True

- Signal-A partition:
  - on-contract: $1,829,652.40
  - off-contract: $3,119,573.43
  - **sum = $4,949,225.83** → equal to lifetime: True

## 5. Random 10-row sample per bucket (human eyeball)

_Seed = 42 so this is reproducible. For each sampled row, is the classification obviously right?_

### On-contract sample (should all be valid Arthrex catalog SKUs)

| ref | product name | extended | date |
|---|---|---:|---|
| `AR-9280NSR` | BLADE NANO SABRE 2.8MM X 11CM AR-9280NSR | $1,010.00 | 2026-02-07 |
| `AR-7235T` | TRIATHLON ASYMMETRIC X3 PATELLA 5551-G-299-E | $0.00 | 2025-03-11 |
| `AR-8400CTD` | BLADE SHAVER TORPEDO 4MMX13CM CURVED AR-8400CTD | $1,010.00 | 2026-03-21 |
| `AR-2924PHS` | ANCHOR PEEK MINI HIP PUSHLOCK 2.4 X 8.9MM AR-2924PHS | $3,170.00 | 2026-03-14 |
| `AR-8400TD` | BLADE SHAVER TORPEDO 4MMX13CM STRAIGHT AR-8400TD | $505.00 | 2026-03-07 |
| `AR-3638DHS` | KIT DISP STRAIGHT KNOTLESS HIP FIBERTAK AR-3638DHS | $1,155.00 | 2026-02-14 |
| `AR-3680` | SYSTEM 2.6 FIBERTAK BUTTON IMPLANT AR-3680 | $2,630.00 | 2026-02-07 |
| `AR-8933V-12` | SCREW LP VA LOCKING TITANIUM  3.0MM X 12MM AR-8933V-12 | $183.75 | 2026-02-01 |
| `AR-6411` | TUBING REDEUCE PUMP 8FT W/ CONNECTOR AR-6411 | $580.00 | 2026-07-20 |
| `AR-8933-28PT` | COMPONENT INSERT JRNY II UNI MED XLPE SZ 5-6 11MM 74026171 | $0.00 | 2025-04-02 |

### Off-contract sample (should be things NOT on the Arthrex catalog)

| ref | product name | extended | date |
|---|---|---:|---|
| `DYNJ908917` | BLADE SAW STRYKER SYSTEM 7 UNIV NARROW 200138107S | $196.00 | 2025-01-25 |
| `AMB408300001` | VISOR WRAP AROUND LENS STERI-SHIELD 0400-661-000 | $1,434.88 | 2025-02-28 |
| `INVOICE #I5583` | SCREW VAL KREULOCK TI 3.0X24MM AR-8933VCL-24 | $309.75 | 2025-05-01 |
| `INVOICE #64032330` | SUTURE TAPE AR-7521 | $504.00 | 2025-05-08 |
| `71362925` | DRILL FLEXIBLE REFLECTION 25MM 71362925 | $0.00 | 2026-08-09 |
| `CAT02589` | SLINGSHOT 45 DEG UP CAT02589 | $225.00 | 2026-10-02 |
| `ETHJ497G` | COMPONENT PREM ST/G7 CP/E1 LN/CER HD BUNDLE 98-B001-009-41 | $3,800.00 | 2025-01-24 |
| `1423573` | RX LIDOCAINE HCL SF 2% 25X5ML 63323020805 | $363.60 | 2026-09-12 |
| `DYNJ908910` | PACK BEACH CHAIR CUSTOM COG DYNJ908915 | $173.59 | 2025-04-22 |
| `ETHJ497G` | COMPONENT GII OVAL RESURFACING PAT 35MM 71421035 | $0.00 | 2026-12-04 |

## 6. Headline

- Signal A (ref exact): **1036 on-contract, $1,829,652.40**
- Signal B (ref in name): **1135 on-contract, $2,012,008.80**
- Signal C (description tokens): **2072 on-contract, $2,619,203.25**
- Unanimous on-contract (3/3): **776 rows, $1,477,434.60**
- Unanimous off-contract (0/3): **1993 rows, $2,078,881.62**
- Disputed (1/3 or 2/3): **1488 rows, $1,392,909.61**

