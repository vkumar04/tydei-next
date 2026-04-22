# Oracle — Arthrex contract ground truth

_Generated: 2026-04-22T23:39:17.988944+00:00Z_

## Inputs

- COG: `/Users/vickkumar/Desktop/experiment COG vendor short NEW.csv`
- Pricing: `/Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx`
- Contract: `/Users/vickkumar/Desktop/Arthrex Ada Format.numbers`
- Today: 2026-04-22
- Trailing-12mo window: [2025-04-22, 2026-04-22]
- YTD window: [2026-01-01, 2026-04-22]

## 1. Raw input stats

- Arthrex contract scope: **10394** line items
- Pricing catalog: **10394** items
- Arthrex POs in COG CSV: **4259**
- Grand total Arthrex spend (all dates): **$4,947,930.83**

## 2. Spend classification — lifetime

| bucket | rows | spend | % of Arthrex total |
|---|---:|---:|---:|
| on_contract | 1037 | $1,829,277.40 | 37.0% |
| priced_off_contract | 0 | $0.00 | 0.0% |
| not_priced | 3222 | $3,118,653.43 | 63.0% |
| **total** | **4259** | **$4,947,930.83** | 100.0% |

## 3. Spend classification — trailing 12 months

| bucket | rows | spend | % of trailing |
|---|---:|---:|---:|
| on_contract | 947 | $1,724,298.27 | 42.3% |
| priced_off_contract | 0 | $0.00 | 0.0% |
| not_priced | 2341 | $2,350,941.66 | 57.7% |
| **total** | **3288** | **$4,075,239.93** | 100.0% |

## 4. Spend classification — YTD (year-to-date)

| bucket | rows | spend |
|---|---:|---:|
| on_contract | 924 | $1,705,976.66 |
| priced_off_contract | 0 | $0.00 |
| not_priced | 2058 | $2,166,741.06 |
| **total** | **2982** | **$3,872,717.72** |

## 5. Spend by date year (all years present)

| year | total | on_contract | priced_off | not_priced |
|---|---:|---:|---:|---:|
| 2025 | $1,076,508.11 | $123,675.74 | $0.00 | $952,832.37 |
| 2026 | $3,872,717.72 | $1,705,976.66 | $0.00 | $2,166,741.06 |

## 6. Top 10 unmatched (not_priced) refs by spend

| ref | product (50ch) | rows | spend |
|---|---|---:|---:|
|  | TAXES | 7 | $82,145.40 |
| CON EMPWR KNEE | CONSTRUCT TOTAL KNEE TIER 3 CON EMPWR KNEE | 18 | $61,200.00 |
| HF10C | SYSTEM NERVE STIMULATOR IMPLANT AND PATIENT CONTRO | 3 | $57,300.00 |
| 32400 | CONSTRUCT ETERNA IPG PT CONTROLLER/CHARGER | 3 | $57,000.00 |
| 71701830 | CONSTRUCT JUK UNI OX FEM W/ UNI TIB & INSRT CAP 71 | 14 | $48,048.00 |
|  | HVAC | 6 | $45,164.74 |
| SC-1240C | CONSTRUCT ALPHA 16 IPG CHARGE SYSTEM RC 2 LINEAR S | 2 | $41,700.00 |
|  | 3.5MM BEVELED FT SCREWS | 1 | $35,059.50 |
| MDK-0001-CS | KIT MILD DEVICE MDK-0001-CS | 3 | $34,875.00 |
| AR-300-B203 | SHORTFALL ROSA | 1 | $28,566.00 |

## 7. Category breakdown (on-contract only, lifetime)

| category | spend |
|---|---:|
| Ortho-Sports Med | $1,210,298.54 |
| Ortho-Extremity | $410,045.98 |
| Disposables-Capital | $208,932.88 |

## 8. Carveout check (on-contract rows with carveout != 0)

- Rows: **0**
- Spend with non-zero carveout: **$0.00**

## 9. Side-by-side vs. Charles's screenshots

| surface | screenshot | oracle | delta |
|---|---:|---:|---:|
| On-Contract (lifetime) | $0 | $1,829,277.40 | $1,829,277.40 |
| Not-Priced (lifetime) | $3,389,667 | $3,118,653.43 | $-271,013.57 |
| Arthrex grand total | n/a | $4,947,930.83 | — |
| Current Spend (trailing 12mo) | $1,559,528 | $4,075,239.93 | $2,515,711.93 |
| Rebates Earned YTD (header) | $0 | needs tier struct | — |
| Rebates Earned lifetime (tab) | $639,390 | needs tier struct | — |

## 10. Interpretation

- **Bug 1 (Nothing on contract).** If the oracle's on-contract spend is > $0 but
  the app's On/Off card shows $0, the matcher is broken — CSV refs are not being
  joined to the contract catalog.
- **Bug 2 (current-spend flicker).** The oracle's trailing-12mo total is a single
  deterministic number. The app's two values ($0 on first load, $1.56M on reload)
  cannot both be right.
- **Bugs 3–4 (rebate disagreement).** Cannot be computed without the contract's
  tier structure. Send me the tier thresholds and rebate percentages and this
  script will extend section 9 with expected rebate per period + lifetime.

