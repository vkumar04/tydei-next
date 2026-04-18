# Financial Analysis Rewrite — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** continue in `contracts-rewrite-00-schema`
**Status:** Design approved by Vick (2026-04-18) via batch approval
**Brainstormed via:** superpowers:brainstorming
**Related specs:**
- Required dependency: `2026-04-18-contracts-rewrite.md` (rebate engines produce inputs to NPV)
- Required dependency: `2026-04-18-cog-data-rewrite.md` (vendor/category spend trends feed the spend projection)
- Required dependency: `2026-04-18-platform-data-model-reconciliation.md` (vendor + facility scope)
- Optional: `2026-04-18-ai-integration-foundation.md` (narrative summary of the analysis at page-bottom)

**Goal:** Rewrite `/dashboard/analysis` as a **capital-contract ROI analyzer**. The page loads a contract (or accepts PDF upload), auto-populates spend/rebate/revenue assumptions from COG history + contract terms, and computes:
- **MACRS depreciation schedule** (5-year property, standard IRS half-year convention)
- **Tax savings from depreciation**
- **Projected rebates** over contract term
- **Price lock opportunity cost** (2% annual market decline assumption)
- **NPV** (discount rate configurable)
- **IRR** (bisection method, 100 iterations)

Pure decision-support. No state changes. Every number is transparent.

**Architecture:** Single page (`app/dashboard/analysis/page.tsx`) with an engine module (`lib/financial-analysis/`) containing the pure math. Server action loads the contract + COG context; client page renders form state + live-computed results. No schema changes.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, TanStack Query, recharts, Zod, react-hook-form, react-dropzone, shadcn/ui.

---

## 1. Scope

### In scope

- **Engine module** with all pure calculations (NPV, IRR, MACRS, tax-saving, price-lock, rebate projection)
- **Contract upload** via PDF dropzone (single-file) — simulated OCR in v1; real PDF extraction is an optional subsystem referenced in AI agent spec's document indexing
- **Auto-populate from existing contract** when page loads — picks first active contract + its rebate terms + vendor/category COG history
- **Two analysis types** — `capital` (the NPV/IRR flow) and `prospective` (light forecast; fuller version lives in prospective-analysis-rewrite)
- **Form state** for every input (contract total, years, discount rate, pay upfront, rebate %, growth %, tax rate, yearly overrides)
- **Result panels** — depreciation schedule table, NPV breakdown, IRR result, cash-flow chart, price-lock cost breakdown
- **AI narrative summary** (optional) — 1-paragraph Claude summary of the analysis result (advisory; AI foundation feature set; streams Opus 4.6)

### Out of scope

- **Save / load saved analyses** — ephemeral per-session only. "Save" button can be a future feature.
- **PDF export of analysis** — CSV export of the computed numbers is in scope; full PDF is out
- **Real-time OCR on PDF** — v1 simulates a delay; production OCR is in the ai-agent spec's document indexing pipeline
- **What-if comparison** (capital vs prospective side-by-side) — canonical doc mentions "Comparison Mode" tab; lives in prospective-analysis-rewrite spec
- **Multi-contract portfolio NPV** — one contract at a time

### Non-goals (preserved)

- No new schema.

---

## 2. Translation notes — canonical prototype → tydei

| Prototype pattern | Tydei equivalent |
|---|---|
| `contract-data-store.contracts[0]` | `prisma.contract.findFirst({where: {facilityId, status: 'active'}})` via `getDefaultAnalysisContract` action |
| `getAllCogRecords()` | `getCogRecordsForVendor(vendorId)` server action |
| Bi-directional substring vendor match | `vendorId` FK + `findVendorByName` cascade from platform-data-model §4.3 |
| Simulated 2500ms OCR delay | Kept for UX pacing in v1; documented as "simulated — real OCR ships with ai-agent doc indexing" |
| `calculateVendorSpendTrend` + `calculateCategorySpendTrend` | Server actions in `lib/financial-analysis/trend.ts` wrapping `getCogMonthlyAggregates` |
| IRR bisection | Same algorithm; ported to `lib/financial-analysis/irr.ts` |
| NPV cash-flow series | Same; ported to `lib/financial-analysis/npv.ts` |
| MACRS constants as array literal | `lib/financial-analysis/constants.ts` exporting `MACRS_5_YEAR_PROPERTY` |
| Bidirectional growth blend (vendor + category average) | Ported; `calculateBlendedGrowthRate` helper |

---

## 3. Data model changes

**None.**

---

## 4. Subsystems — priority-ordered

### Subsystem 0 — Engine module (P0)

**Priority:** P0 — blocks every UI subsystem.

**Files:**
- Create: `lib/financial-analysis/constants.ts`:
  - `MACRS_5_YEAR_PROPERTY = [0.20, 0.32, 0.192, 0.1152, 0.1152, 0.0576]`
  - `ANNUAL_PRICE_DECREASE = 0.02`
  - `DEFAULT_REVENUE_MULTIPLIER = 1.5` (revenue:spend default)
- Create: `lib/financial-analysis/depreciation.ts`:
  - `calculateMACRSSchedule(contractTotal, contractYears)` — returns `[{year, rate, amount, accumulated}]` capped at `min(schedule.length, years+1)`
- Create: `lib/financial-analysis/tax-savings.ts`:
  - `calculateTaxSavings(depreciation, taxRatePercent)` — per-year tax savings
- Create: `lib/financial-analysis/rebate-projection.ts`:
  - `projectRebates(yearlySpend, rebatePercent, years)` — per-year rebate + effective spend
- Create: `lib/financial-analysis/price-lock.ts`:
  - `calculatePriceLockOpportunityCost(yearlySpend, years, annualDecrease)` — returns `{total, yearly[]}`
- Create: `lib/financial-analysis/npv.ts`:
  - `calculateNPV({contractTotal, yearlySpend, yearlyRevenue, rebatePercent, taxRatePercent, discountRate, payUpfront, years})` — returns `{npv, cashFlows[]}`
- Create: `lib/financial-analysis/irr.ts`:
  - `calculateIRR(cashFlows)` — bisection method, 100 iterations, 0.0001 tolerance, sign-change precheck with average-rate-of-return fallback
- Create: `lib/financial-analysis/__tests__/` — one test file per engine

**IRR worked example (from canonical)** — cash flows `[-1000, 300, 400, 500]` → IRR ≈ 13.1%. Included as a baseline test.

**Acceptance:**
- All engine tests green.
- `calculateIRR` returns within 0.1% of the known-answer for 3 test cases.
- NPV at 0% discount rate equals simple cash-flow sum.
- `bunx tsc --noEmit` → 0 errors.

**Plan detail:** On-demand — `00-engine-plan.md`.

---

### Subsystem 1 — Auto-populate from contract + COG (P1)

**Priority:** P1.

**Files:**
- Create: `lib/actions/financial-analysis.ts`:
  - `getDefaultAnalysisContract(facilityId)` — returns first active contract (or null)
  - `getInitialAnalysisData(facilityId, contractId)` — returns `{ contractTotal, contractYears, rebatePercent, yearlySpend, yearlyRevenue, growthRate, linkedCategories, contract }`
  - `calculateBlendedGrowthRate(vendorId, categoryIds)` — blends vendor + category monthly trends

**Auto-populate rules (canonical §3):**
- `contractTotal` = `contract.totalValue`; fallback to sum of recent 12mo COG spend
- `contractYears` = years between `effectiveDate` and `expirationDate`, rounded
- `rebatePercent` = max tier rate across contract's terms
- `yearlySpend[]` = last N years of COG aggregated, sorted ascending
- `growthRate` = CAGR computed from first + last year
- `yearlyRevenue[i]` = `round(yearlySpend[i] * DEFAULT_REVENUE_MULTIPLIER)`
- Fallbacks when no data: `contractTotal: 0`, `years: 5`, `rebate: 3.5`, `growth: 0.03`, spend/revenue arrays empty

**Acceptance:**
- Page loads with real contract pre-filled.
- Changing selected contract resets the form via TanStack Query.
- Growth-rate blending works when vendor has data but category doesn't (and vice versa).

**Plan detail:** On-demand — `01-auto-populate-plan.md`.

---

### Subsystem 2 — Page layout + form state (P1)

**Priority:** P1.

**Files:**
- Modify: `app/dashboard/analysis/page.tsx` — tabs: `upload` / `assumptions` / `results`
- Create: `components/facility/analysis/analysis-client.tsx` — orchestrator + form state
- Create: `components/facility/analysis/upload-tab.tsx` — PDF dropzone + auto-populate trigger
- Create: `components/facility/analysis/assumptions-tab.tsx` — form inputs (contract total, years, discount rate, pay upfront, rebate %, growth %, tax rate, per-year overrides)
- Create: `components/facility/analysis/results-tab.tsx` — results panels (uses subsystems 3-5)

**Form state via react-hook-form:**

```ts
const defaultValues = {
  analysisType: 'capital',
  contractTotal: 0,
  contractYears: 5,
  discountRate: 8,
  payUpfront: false,
  projectedRebatePercent: 3.5,
  annualSpendGrowth: 3,
  taxRate: 25,
  yearlySpend: [] as number[],
  yearlyRevenue: [] as number[],
}
```

Debounced onChange → recomputes results in subsystem 3.

**Acceptance:**
- All form inputs bind two-way.
- Upload tab dropzone accepts PDF + triggers auto-populate.
- Tab navigation preserves state.

**Plan detail:** On-demand — `02-page-layout-plan.md`.

---

### Subsystem 3 — Results panels (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/analysis/depreciation-table.tsx` — 6-row MACRS table
- Create: `components/facility/analysis/cashflow-chart.tsx` — recharts line + bar overlay
- Create: `components/facility/analysis/npv-summary.tsx` — big NPV number + breakdown
- Create: `components/facility/analysis/irr-summary.tsx` — big IRR % + interpretation ("This exceeds your 8% cost of capital by 5.1pp")
- Create: `components/facility/analysis/price-lock-breakdown.tsx` — per-year market-price vs actual-price table
- Create: `components/facility/analysis/rebate-projection-table.tsx` — per-year rebate + effective spend

**Live recompute:**

- Form state change → debounced 200ms → call engine functions → update result panels
- All computation client-side (engines are pure); no server roundtrip per keystroke
- Audit log: if AI narrative subsystem 5 is enabled, each time user "requests narrative" the server action logs input + output

**Acceptance:**
- Results update within ~300ms of stopping typing.
- Charts render correctly; no NaN or Infinity leaks.
- Empty state when contractTotal is 0.

**Plan detail:** On-demand — `03-results-panels-plan.md`.

---

### Subsystem 4 — CSV export (P2)

**Priority:** P2.

**Files:**
- Create: `lib/financial-analysis/export.ts` — `buildAnalysisCSV(input, result)` returns CSV string covering depreciation schedule + cash flows + NPV/IRR + price-lock breakdown
- Client export button on results tab

**Acceptance:**
- CSV downloads as `financial-analysis-<contractname>-<date>.csv`.
- Numbers match display.

**Plan detail:** On-demand — `04-export-plan.md`.

---

### Subsystem 5 — AI narrative summary (P2, optional)

**Priority:** P2.

**Files:**
- Create: `components/facility/analysis/narrative-card.tsx` — "Summarize this analysis" button + streamed paragraph
- Wire: AI foundation structured outputs + context pack kind `"analysis_narrative"` (new; extends AI foundation)
- Model: Opus 4.6 (reasoning-heavy)
- Streams a 1-2 paragraph interpretation: "This capital contract has a positive NPV of $X at an 8% discount rate, indicating it creates value. IRR of Y% exceeds hurdle rate by Z pp. The biggest risk is the price-lock opportunity cost of $W over 5 years if market prices decline."

**Acceptance:**
- Narrative reads naturally; numbers align with the results panels.
- Credits deducted; audit logged.
- Fallback: "AI narrative unavailable" banner + manual summary.

**Plan detail:** On-demand — `05-narrative-plan.md`.

---

### Subsystem 6 — UI polish (P2)

Standard polish — empty states, a11y, responsive breakpoints, dropzone accessibility.

**Plan detail:** On-demand — `06-ui-polish-plan.md`.

---

### Subsystem 7 — Clause-risk adjustment to NPV (P2)

**Priority:** P2 — depends on prospective-analysis-rewrite subsystem 7 (PDF clause analyzer) shipping first.

**Goal:** When a capital contract has been through the PDF clause analyzer (from prospective-analysis spec), surface the clause risk alongside the NPV output. Early-termination-friendly + assignment-permitted contracts are worth more than exclusivity + minimum-commitment contracts at the same headline NPV.

**Files:**
- Create: `lib/financial-analysis/clause-risk-adjustment.ts`:
  - `adjustNPVForClauseRisk(baseNPV: number, clauses: ClauseAnalysis): AdjustedNPV`
  - Rules (starter set):
    - Exclusivity clause present + high risk → −5% NPV
    - Minimum commitment >80% of expected spend → −3% NPV
    - No termination-for-convenience → −2% NPV
    - Auto-renewal without opt-out window → −2% NPV
    - Price protection with cap → +2% NPV (de-risks inflation)
- Create: `lib/financial-analysis/__tests__/clause-risk-adjustment.test.ts`
- Modify: `components/facility/analysis/results-panel.tsx` — show "Risk-Adjusted NPV" alongside base NPV when a clause analysis is available; tooltip explains each adjustment with link to the clause finding.

**Return shape:**
```ts
type AdjustedNPV = {
  baseNPV: number
  adjustments: Array<{
    clauseCategory: ClauseCategory
    adjustmentPercent: number   // signed
    reason: string
    linkToFinding: string | null
  }>
  totalAdjustmentPercent: number
  riskAdjustedNPV: number
}
```

**Acceptance:**
- Adjustments apply deterministically from clause findings.
- UI surfaces the adjustment alongside NPV with a one-line reason.
- Missing clause analysis → UI hides the adjustment panel gracefully.

**Plan detail:** On-demand — `07-clause-risk-plan.md`.

---

## 5. Execution model

```
Subsystem 0 (engines)
  ↓
Subsystem 1 (auto-populate) 
  ↓
Subsystem 2 (page layout + form)
  ↓
Subsystem 3 (results panels)
  ↓                        ↘
Subsystem 4 (CSV)      Subsystem 5 (AI narrative)
  ↓
Subsystem 6 (UI polish)
```

**Global verification:**
```bash
bunx tsc --noEmit
bun run test
bun run build
bun run test lib/financial-analysis/__tests__/
```

---

## 6. Acceptance

- All 7 subsystems merged.
- Engine math correct against worked examples (NPV + IRR + MACRS + price-lock).
- Page auto-populates from active contract + COG.
- Results update live.
- CSV export works.
- `bunx tsc --noEmit` → 0; `bun run test` → passing.

---

## 7. Known risks

1. **IRR non-convergence.** Bisection handles most cases; sign-change precheck provides fallback. Edge cases: all-negative or all-positive cash flows return approximate rate-of-return.
2. **MACRS table cap edge case.** Contracts shorter than 5 years — depreciation schedule capped at `years + 1`, accumulated % won't hit 100%. Acceptable; mirrors IRS behavior.
3. **Revenue multiplier assumption.** `DEFAULT_REVENUE_MULTIPLIER = 1.5` is a placeholder when real revenue data isn't available. Tooltip explains the assumption; user can override per year.
4. **Simulated OCR UX.** 2500ms delay is a lie. Tooltip says "Simulated — real OCR integrates with document indexing." Set expectation up front.
5. **Price-lock math is approximate.** 2% annual decrease is a crude model of medical-device price decline; real markets vary. Documented assumption; user can argue with the number.

---

## 8. Out of scope (explicit)

- Save / load analyses
- Full PDF export
- Real-time OCR (lives in ai-agent spec)
- Multi-contract portfolio NPV
- Comparison mode (lives in prospective-analysis spec)

---

## 9. How to iterate

1. Start with subsystem 0.
2. Generate per-subsystem plan via superpowers:writing-plans.
3. Execute; commit each separately.
4. Verify; merge; proceed.
