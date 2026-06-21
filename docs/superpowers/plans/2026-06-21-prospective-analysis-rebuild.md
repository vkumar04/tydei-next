# 2026-06-21 — Prospective / Analysis page rebuild (Charles spec)

**Source:** Charles write-up + screenshots (`~/Desktop/Untitled.rtfd`).
**Decisions (Vick, 2026-06-21):** Facility = REPLACE the proposal-scoring hub with the
financial dashboard. Depth = screenshots **+** the AI layer. Data = fully
assumption-driven (sliders + editable top-line; everything recalculates instantly).

"Analysis" = facility side. "Prospective" = vendor side. Only the **content** of the
two pages changes — no nav/routing work.

## Verified formulas (match the screenshots)

- EBITDA = netRevenue × ebitdaMarginPct  ($41.7M × 30% = $12.5M)
- Distributable cash/yr = EBITDA × dcfPctOfEbitda (80%) = $10M
- DCF = growing-annuity PV over `dcfYears` @ discountRate, cashFlowGrowth ≈ $40.1M
- Prospective impact of annual supply savings `S`:
  - ΔEBITDA = S ; ΔMargin pts = S / netRevenue × 100 (+1.50 pts) ; ΔDCF = S × dcfPct (+$500.7K)
  - $/case = S / annualCaseVolume
  - EV impact = S × {10, 12, 14} (Conservative / Expected / Aggressive)

## Facility — `/dashboard/analysis` (replace hub)

### Pure engines (lib/financial-analysis/)
- `prospective-impact-model.ts` — assumptions → current state + prospective impact + EV (above formulas). Tested against screenshot numbers.
- `facility-opportunity-score.ts` — Contract Opportunity Score 0-100, weighted
  EBITDA 30 / Margin 20 / DCF 15 / CashFlowTiming 10 / VendorConcentration 10 /
  GrowthAlignment 10 / Tech 5. Deterministic sub-scores.
- `ebitda-ev-waterfall.ts` — Current EBITDA → +Implant Savings +Rebate +Growth +Labor +Throughput = Future EBITDA; Current EV → Future EV; incremental EV.
- `conversion-targets.ts` — rank categories by savings opportunity; "Converting X% of Y yields Z% of benefit."
- `payback-analysis.ts` — Conservative/Expected/Aggressive payback yrs for capital/robotics/SPD/nav.
- `managed-care-predictor.ts` — deterministic reimbursement %-of-Medicare range from case-mix/volume inputs.
- `growth-simulator.ts` — what-if (volume, payer mix, vendor share, robotics, new surgeons) → EBITDA/DCF/EV/margin.

### UI (components/facility/analysis/dashboard/)
- `analysis-dashboard-client.tsx` — orchestrator owning the assumption state.
- Current State cards (Vendor Spend, Net Revenue, EBITDA, DCF).
- Financial Assumptions sliders (supply cost %, EBITDA margin, DCF % of EBITDA, discount rate, cash-flow growth, DCF years).
- Category Spend & ASP table + Vendor Market Share table (assumption-allocated, editable seed).
- Contribution Margin by Procedure table.
- Prospective Impact Engine (savings slider → 4 impact cards) + Enterprise Value Impact (3 multiples) + Individual Impact by Category & Case.
- AI layer cards: Opportunity Score, EBITDA & EV Waterfall, EV Impact Predictor, Conversion Targets, Payback, Managed Care Predictor, Growth Simulator.

## Vendor — `/vendor/prospective` (add "Opportunity Engine" tab)

### Pure engines (lib/prospective-analysis/)
- `opportunity-engine.ts` — scenario (price change, target share, volume growth) →
  Win Probability, Incremental Revenue, Net Unit Impact, Blended Market Share,
  Territory Recurring Revenue, Capital/Robotic Revenue. Tested.
- `vendor-opportunity-score.ts` — financial + strategic weighted score; AI Win
  Probability with Risk Level / Competitive Threat / Recommended Action;
  Recommended Offer Structure.

### UI (app/vendor/prospective/sections/)
- `OpportunityEngineSection.tsx` — Deal Scenario sliders + 6 output cards + the
  AI score / win-prob / offer-structure block. New tab between Benchmarks and Analytics.

## Verify
- `bunx tsc --noEmit` → 0 ; vitest green ; engines have unit tests pinned to screenshot numbers.
</content>
</invoke>
