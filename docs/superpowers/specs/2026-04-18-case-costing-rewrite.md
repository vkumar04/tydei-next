# Case Costing Rewrite — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** continue in `contracts-rewrite-00-schema`
**Status:** Design approved by Vick (2026-04-18) via batch approval
**Brainstormed via:** superpowers:brainstorming
**Related specs:**
- Required dependency: `2026-04-18-contracts-rewrite.md` (true-margin engine from subsystem 6 is the foundation)
- Required dependency: `2026-04-18-cog-data-rewrite.md` (enriched COG rows tag supplies to contracts)
- Required dependency: `2026-04-18-platform-data-model-reconciliation.md` (facility scoping + vendor resolve)
- Optional: `2026-04-18-ai-integration-foundation.md` (division-inference feature assists when supplies need specialty categorization)

**Goal:** Rewrite the three case-costing pages:
- `/dashboard/case-costing` — cases list + surgeon scorecards
- `/dashboard/case-costing/compare` — surgeon-vs-surgeon comparison
- `/dashboard/case-costing/reports` — exportable case/surgeon reports

Use the true-margin engine from contracts-rewrite subsystem 6, pull real case data from tydei's `Case` + `CaseSupply` + `CaseProcedure` models, and surface surgeon-level metrics (margin, spend efficiency, payor mix, CPT volume).

**Architecture:** Tydei already has `Case` + `CaseSupply` + `SurgeonUsage` models. This spec wires the UI against them, pulls reimbursement from `PayorContract`, computes margins via contracts-rewrite's `calculateMargins`, and builds a surgeon derivation layer that aggregates cases by surgeon. Three pages share one server-action surface.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, TanStack Query, recharts, Zod, shadcn/ui. Reuses true-margin engine (`lib/contracts/true-margin.ts`) + existing `CaseSupply.contractId` linkage.

---

## 1. Scope

### In scope

- **Cases list tab** — case records with CPT code, supply cost, total spend, reimbursement, margin (standard + true), rebate contribution
- **Surgeons tab** — aggregated surgeon scorecards with scores (payor mix, spend efficiency, overall), CPT volume, margin %, trend
- **Surgeon derivation** — walks cases, aggregates by surgeon name, infers specialty from primary CPT code, computes scores
- **Facility averages** — baseline metrics for comparison ("Dr. Smith's avg case cost is 12% below facility avg")
- **Compare page** — surgeon-vs-surgeon side-by-side with charts + what-if savings calculator
- **Reports page** — 9 date-range options, 4 tabs (Overview / Cases / Surgeons / Comparison), export actions (CSV, PDF stub)
- **Purchasing vs clinical spend rule** — categorizes case spend as clinical or purchasing
- **Contract pricing lookup** — per-supply-item lookup into contract pricing to compute savings per case
- **Tech debt:** audit `lib/actions/cases.ts` (695 lines) + `components/facility/case-costing/case-import-dialog.tsx` (811 lines); split if needed

### Out of scope

- **Case import** — existing import UX stays; not rewriting the import flow in this spec
- **Case-level CRUD** — cases come from ERP imports, not manually edited
- **Surgeon-level CRUD** — surgeons are derived, not managed (no surgeon directory)
- **Payor contract management** — lives under `/admin/payor-contracts`; this page only reads `PayorContract` rates
- **AI-generated surgeon narratives** — reserved for future AI layer
- **Multi-facility case rollup** — scoped to active facility

### Non-goals (preserved)

- No stack swaps. No new Prisma models.

---

## 2. Translation notes — canonical prototype → tydei

| Prototype pattern | Tydei equivalent |
|---|---|
| IndexedDB case data | `Case` + `CaseSupply` + `CaseProcedure` Prisma tables |
| `deriveSurgeonsFromCases(cases)` | Same algorithm; server-side in `lib/case-costing/surgeon-derivation.ts` |
| `finalizeSurgeonData(surgeons, payorContracts)` | Keeps margin-layer step; uses `PayorContract` rates via `lookupReimbursement(cptCode, payorType)` |
| `calculateCaseMargin(caseRecord)` | Uses `calculateMargins` from contracts-rewrite subsystem 6 |
| File-type taxonomy (cases / supplies / procedures / etc.) | Import flow unchanged; tagged at `CaseCostingFile.fileType` |
| `ScoreIndicator` color coding (green ≥75, amber ≥50, red <50) | Shared component `components/shared/case-costing/score-indicator.tsx` |
| Facility averages computed client-side | Pre-computed server-side in `getFacilityAverages(facilityId, dateRange)` |
| Compare page with local state for 2 surgeons | Same; local state works fine |
| Purchasing vs Clinical rule: `category in ['implant', 'biologic'] → purchasing; else clinical` | Same rule; exposed as `classifySupplySpend(category)` helper |

---

## 3. Data model changes

**None.** Tydei already has:
- `Case` — case record
- `CaseProcedure` — CPT-code join table
- `CaseSupply` — per-supply spend (with `contractId` + `isOnContract` fields)
- `SurgeonUsage` — derived aggregate data
- `PayorContract` — reimbursement rates per CPT / payor

If the existing schema is missing fields the canonical doc references, subsystem 0 files a gap list for an additive-migration PR.

---

## 4. Subsystems — priority-ordered

### Subsystem 0 — Data audit + surgeon derivation engine (P0)

**Priority:** P0.

**Files:**
- Audit: `lib/actions/cases.ts` (695 lines) — catalog functions; flag overlong ones
- Create: `lib/case-costing/surgeon-derivation.ts` — `deriveSurgeons(cases, payorContracts)` pure function
- Create: `lib/case-costing/score-calc.ts` — payor-mix score, spend-efficiency score, overall score
- Create: `lib/case-costing/specialty-infer.ts` — CPT-prefix-based inference (`27xx/29xx → Ortho`, `22xx/63xx → Spine`, `33xx → Cardiac`, `43xx/44xx → General`) per canonical doc
- Create: `lib/case-costing/facility-averages.ts` — baseline metrics
- Create: `lib/case-costing/__tests__/surgeon-derivation.test.ts`
- Modify: `lib/actions/cases.ts::getCasesForFacility`, `getSurgeonsForFacility`, `getFacilityAverages`, `getPayorMix` — server actions returning shaped data

**Scoring formulas (canonical §6):**
- `payorMixScore` = `(commercialOrPrivatePayors / totalPayors) × 100`
- `spendScore` = `max(0, min(100, 100 - (avgSpendPerCase / 500)))`
- `overallScore` = `round((payorMixScore + spendScore) / 2)`

**Color mapping:**
- ≥75 → green
- ≥50 → amber
- <50 → red

**Margin layer (canonical §4):**
- `grossMargin = totalReimbursement - totalSpend`
- `marginPct = (grossMargin / totalReimbursement) × 100`
- `trend = marginPct ≥ 30 ? 'UP' : 'DOWN'`

**Acceptance:**
- Derivation returns typed `Surgeon[]` with all scores computed.
- Tests cover CPT-prefix inference for 4+ specialties.
- Facility averages return `avgCaseCost`, `avgMarginPct`, `avgTimeInOr`, etc.

**Plan detail:** On-demand — `00-derivation-engine-plan.md`.

---

### Subsystem 1 — Cases list tab (P1)

**Priority:** P1.

**Files:**
- Modify: `components/facility/case-costing/case-list.tsx` (existing; audit) — wire to new action
- Modify: column definitions to include:
  - Case #, date, surgeon, CPT code, description
  - Total cost (with breakdown: supply / implant / other)
  - Reimbursement (via payor lookup)
  - Standard margin %, true margin % (with rebate contribution)
  - Payor mix (pill list)
  - Compliance status (% on-contract)
- Filters (canonical §7):
  - Date range (9 presets)
  - Surgeon (multi-select)
  - CPT code (multi-select)
  - Patient type (inpatient / outpatient)
  - Payor type
  - Facility (when user has cross-facility access)

**Acceptance:**
- Cases list renders with real `Case` data.
- Margin columns reflect true-margin engine output.
- Filters compose correctly (AND across dimensions).

**Plan detail:** On-demand — `01-cases-list-plan.md`.

---

### Subsystem 2 — Surgeons tab (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/case-costing/surgeon-scorecard-list.tsx`
- Create: `components/facility/case-costing/surgeon-score-card.tsx` — per-surgeon card with:
  - Name, specialty, total cases, avg spend, margin %
  - 3 score indicators (payor mix / spend efficiency / overall)
  - CPT volume top 3
  - Trend arrow (UP if marginPct ≥ 30, DOWN otherwise)
  - Link to compare page pre-filled with this surgeon
- Filters + sort (canonical §8):
  - Specialty filter
  - Sort: by overall score, by total cases, by margin %, by avg spend

**Acceptance:**
- Surgeons list renders derived data.
- Score colors match the ≥75/≥50/<50 mapping.
- Cards link to compare page.

**Plan detail:** On-demand — `02-surgeons-tab-plan.md`.

---

### Subsystem 3 — Compare page (P1)

**Priority:** P1.

**Files:**
- Modify: `app/dashboard/case-costing/compare/page.tsx` — reads `?surgeon=<name>&compareTo=<name>` from URL
- Modify: `app/dashboard/case-costing/compare/compare-client.tsx` (existing) — audit + wire
- Create: sub-components for the compare view:
  - `compare-filter-card.tsx` — surgeon + procedure picker
  - `compare-benchmark-card.tsx` — facility average line + each surgeon's metric
  - `compare-surgeon-table.tsx` — side-by-side metric table
  - `compare-bar-charts.tsx` — supply spend + margin + volume
  - `compare-whatif-savings.tsx` — "if Dr. X matched Dr. Y's avg cost, facility would save $Z" calculator

**Acceptance:**
- Select two surgeons → side-by-side metrics render.
- What-if savings updates live based on case volume × delta in avg cost.
- Charts render correctly at all breakpoints.

**Plan detail:** On-demand — `03-compare-page-plan.md`.

---

### Subsystem 4 — Reports page (P1)

**Priority:** P1.

**Files:**
- Modify: `app/dashboard/case-costing/reports/page.tsx` — v0-aligned header + 4-card stat grid + tabs + 9-preset date-range picker (per v0 parity)
- Modify: `app/dashboard/case-costing/reports/reports-client.tsx` (existing) — audit + wire
- Tabs:
  - **Overview** — stats + spend trends
  - **Cases** — filtered case list view
  - **Surgeons** — filtered surgeon scorecards
  - **Comparison** — facility avg vs top N surgeons

**Export actions:**
- CSV export (current filter)
- PDF export (basic; full PDF infra is deferred)

**Acceptance:**
- All 4 tabs render with shared filter state.
- Date range presets work.
- CSV export respects current filter.

**Plan detail:** On-demand — `04-reports-plan.md`.

---

### Subsystem 5 — Mega-file splits (P1, tech debt)

**Priority:** P1.

**Files:**

**Audit `lib/actions/cases.ts` (695 lines):**
- Extract per-concern helpers into `lib/actions/cases/`:
  - `getCasesForFacility.ts`, `getSurgeonsForFacility.ts`, `getFacilityAverages.ts`, `compareSurgeons.ts`, `importCases.ts`
- Target: root `cases.ts` ≤300 lines

**Audit + split `components/facility/case-costing/case-import-dialog.tsx` (811 lines):**
- Extract pipeline logic into `useCaseImportPipeline` hook
- Split flow stages into focused files: `case-import-upload.tsx`, `case-import-mapping.tsx`, `case-import-preview.tsx`, `case-import-commit.tsx`
- Target: dialog ≤300 lines; hook ≤250 lines

**Acceptance:**
- No functional regression on case import.
- Split files each have a focused responsibility.
- `bunx tsc --noEmit` → 0 errors.

**Plan detail:** On-demand — `05-splits-plan.md`.

---

### Subsystem 6 — UI polish (P2)

**Priority:** P2.

**Files:**
- Empty states
- a11y
- Hydration safety
- Responsive

**Acceptance:**
- Lighthouse a11y pass on all 3 routes.
- Manual smoke at all breakpoints.

**Plan detail:** On-demand — `06-ui-polish-plan.md`.

---

## 5. Execution model

```
Subsystem 0 (derivation engine + data audit)
  ↓
Subsystem 1 (cases list)   Subsystem 2 (surgeons tab)
  ↓                          ↓
         Subsystem 3 (compare page)
                ↓
         Subsystem 4 (reports page)
                ↓
         Subsystem 5 (mega-file splits — parallelizable)
                ↓
         Subsystem 6 (UI polish)
```

**Global verification:**
```bash
bunx tsc --noEmit
bun run test
bun run build
bun run db:seed
bun run test lib/case-costing/__tests__/
```

---

## 6. Acceptance

- All 7 subsystems merged.
- Surgeons derived correctly; scores match canonical formulas.
- True-margin column reflects contracts-rewrite subsystem 6 output.
- Compare page loads 2 surgeons side-by-side with charts + what-if.
- Reports page supports 9 date-range presets + 4 tabs + CSV export.
- `bunx tsc --noEmit` → 0; `bun run test` → passing.

---

## 7. Known risks

1. **Surgeon name collisions.** "John Smith" vs "John Smith, MD" — might be the same surgeon. V1 exact-match only; surgeon deduplication is admin tooling out of scope.
2. **PayorContract lookup miss.** CPT/payor combinations without a matching rate fall back to Medicare base rate × payor multiplier (canonical §3). Document the fallback; UI flags "estimated" vs "contracted" reimbursement.
3. **Rebate contribution allocation.** Per-case rebate split uses `allocateRebatesToProcedures` from contracts-rewrite subsystem 6. Correctness depends on correct case-to-vendor mapping via `CaseSupply.contractId`. Mitigation: COG rewrite's subsystem 2 ensures `CaseSupply.contractId` is populated.
4. **Reports PDF stub.** PDF export is a nice-to-have; v1 ships CSV only. UI button for PDF is gated with "coming soon" tooltip.
5. **Case import dialog complexity.** 811 lines of state; split in subsystem 5 is risky. Mitigation: split is one commit with full smoke-test of upload → mapping → preview → commit.

---

## 8. Out of scope (explicit)

- Case import flow redesign
- Surgeon / case CRUD
- Payor contract management
- Cross-facility case rollup
- AI-generated surgeon narratives
- Full PDF export infrastructure

---

## 9. How to iterate

1. Start with subsystem 0.
2. Generate per-subsystem plan via superpowers:writing-plans.
3. Execute; commit each separately.
4. Verify; merge; proceed.
