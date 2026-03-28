# Phase 8 -- Case Costing + Prospective Analysis

## Objective

Build surgical case cost analysis with surgeon scorecards, CPT code analysis, and case costing reports for the facility portal. Also build financial analysis tools (capital contract MACRS depreciation, prospective deal analysis) and the vendor prospective proposal builder.

## Dependencies

- Phase 3 (COG data for cost comparisons)
- Phase 4 (dashboard/reporting patterns, chart components)

## Tech Stack

| Tool | Purpose |
|------|---------|
| Recharts | Cost distribution, surgeon comparison (radar, bar), depreciation projections |
| TanStack Table | Case records, supply tables |
| react-hook-form + Zod | Case data upload, proposal builder |
| xlsx | Case data CSV/XLSX parsing |

---

## Data Models

The Case, CaseProcedure, CaseSupply, CaseCostingFile, and SurgeonUsage models are already defined in Phase 1 schema. No new models needed -- just the server actions and UI.

---

## Server Actions

### `lib/actions/cases.ts`

```typescript
"use server"

// List cases with filters
export async function getCases(input: {
  facilityId: string
  surgeonName?: string
  dateFrom?: string
  dateTo?: string
  cptCode?: string
  page?: number
  pageSize?: number
}): Promise<{ cases: CaseWithRelations[]; total: number }>

// Get single case detail
export async function getCase(id: string): Promise<CaseDetail>

// Bulk import cases from CSV/XLSX
export async function importCases(input: {
  facilityId: string
  cases: CaseInput[]
}): Promise<{ imported: number; errors: number }>

// Import case supplies from CSV/XLSX
export async function importCaseSupplies(input: {
  caseId: string
  supplies: CaseSupplyInput[]
}): Promise<{ imported: number; matched: number }>

// Get surgeon scorecards
export async function getSurgeonScorecards(facilityId: string): Promise<SurgeonScorecard[]>
// Each scorecard: surgeonName, caseCount, totalSpend, avgSpendPerCase,
//   complianceRate, onContractPercent, topProcedures, payorMix

// Get CPT code analysis
export async function getCPTAnalysis(facilityId: string): Promise<CPTCodeAnalysis[]>
// Each: cptCode, description, caseCount, avgCost, minCost, maxCost, surgeonBreakdown

// Surgeon comparison
export async function compareSurgeons(input: {
  facilityId: string
  surgeonNames: string[]
  cptCode?: string
}): Promise<SurgeonComparison>

// Case costing report data
export async function getCaseCostingReportData(input: {
  facilityId: string
  surgeonName?: string
  contractId?: string
  dateFrom?: string
  dateTo?: string
}): Promise<CaseCostingReport>
```

### `lib/actions/analysis.ts`

```typescript
"use server"

// Capital contract MACRS depreciation
export async function calculateDepreciation(input: {
  contractId: string
  assetCost: number
  recoveryPeriod: 5 | 7 | 10 | 15
  convention: "half_year" | "mid_quarter"
}): Promise<DepreciationSchedule>

// Price decrease projections
export async function getPriceProjections(input: {
  facilityId: string
  vendorId?: string
  categoryId?: string
  periods: number
}): Promise<PriceProjection[]>

// Vendor spend trends
export async function getVendorSpendTrends(input: {
  facilityId: string
  dateFrom: string
  dateTo: string
}): Promise<VendorSpendTrend[]>

// Category spend trends
export async function getCategorySpendTrends(input: {
  facilityId: string
  dateFrom: string
  dateTo: string
}): Promise<CategorySpendTrend[]>
```

### `lib/actions/prospective.ts`

```typescript
"use server"

// Facility-side: analyze vendor proposal
export async function analyzeProposal(input: {
  facilityId: string
  proposedPricing: ProposedPricingItem[]
  vendorId?: string
}): Promise<ProposalAnalysis>
// Returns: itemComparisons (proposed vs current), totalSavings, dealScore, radarChart data

// Score a deal (multi-dimension)
export async function scoreDeal(input: {
  financialValue: number
  rebateEfficiency: number
  pricingCompetitiveness: number
  marketShareAlignment: number
  complianceLikelihood: number
}): Promise<DealScore>

// Financial projections (future value analysis)
export async function getFinancialProjections(input: {
  contractId: string
  projectionMonths: number
  growthRate?: number
}): Promise<FinancialProjection[]>

// Vendor-side: create proposal
export async function createProposal(input: {
  vendorId: string
  facilityIds: string[]
  pricingItems: ProposedPricingItem[]
  terms: ProposalTerms
}): Promise<VendorProposal>

// Vendor-side: get proposals
export async function getVendorProposals(vendorId: string): Promise<VendorProposal[]>
```

---

## Components

### Case Costing Components

#### `components/facility/case-costing/case-table.tsx`

- **Props:** `{ facilityId: string }`
- **shadcn deps:** uses DataTable, Select, Button
- **Description:** Case records table with surgeon/date/CPT filters. ~55 lines.

#### `components/facility/case-costing/case-columns.tsx`

- **Export:** `getCaseColumns(onView): ColumnDef<CaseWithRelations>[]`
- **Description:** Columns: case number, surgeon, date, CPT code, total spend, reimbursement, margin, compliance status. ~50 lines.

#### `components/facility/case-costing/case-import-dialog.tsx`

- **Props:** `{ facilityId: string; open: boolean; onOpenChange: (open: boolean) => void; onComplete: () => void }`
- **shadcn deps:** Dialog, Tabs, Button, Progress
- **Description:** Multi-file import: case procedures, supply data, patient fields. Reuses FileDropzone and column mapper from Phase 3. ~70 lines.

#### `components/facility/case-costing/case-detail.tsx`

- **Props:** `{ caseData: CaseDetail }`
- **shadcn deps:** Card, Table, Badge, Progress
- **Description:** Single case view with cost breakdown: procedures, supplies (on-contract vs off-contract), totals. ~60 lines.

#### `components/facility/case-costing/surgeon-scorecard.tsx`

- **Props:** `{ scorecard: SurgeonScorecard }`
- **shadcn deps:** Card, Progress, Badge
- **Description:** Individual surgeon scorecard with case count, avg spend, compliance rate, top procedures, payor mix. ~55 lines.

#### `components/facility/case-costing/surgeon-scorecards-grid.tsx`

- **Props:** `{ scorecards: SurgeonScorecard[] }`
- **shadcn deps:** uses SurgeonScorecard
- **Description:** Grid of surgeon scorecards with search/filter. ~30 lines.

#### `components/facility/case-costing/surgeon-comparison-chart.tsx`

- **Props:** `{ comparison: SurgeonComparison }`
- **shadcn deps:** uses ChartCard
- **Description:** Recharts RadarChart comparing surgeons across dimensions (cost, volume, compliance, outcomes). ~45 lines.

#### `components/facility/case-costing/cpt-analysis-table.tsx`

- **Props:** `{ analyses: CPTCodeAnalysis[] }`
- **shadcn deps:** uses DataTable
- **Description:** CPT code analysis table with avg cost, case count, surgeon breakdown. ~40 lines.

#### `components/facility/case-costing/cost-distribution-chart.tsx`

- **Props:** `{ cases: CaseWithRelations[] }`
- **shadcn deps:** uses ChartCard
- **Description:** Recharts BarChart showing cost distribution across cases. ~35 lines.

### Analysis Components

#### `components/facility/analysis/depreciation-calculator.tsx`

- **Props:** `{ onCalculate: (input: DepreciationInput) => Promise<DepreciationSchedule> }`
- **shadcn deps:** Card, Input, Select, Button
- **Description:** MACRS depreciation input form with recovery period, convention selection, and results table. ~65 lines.

#### `components/facility/analysis/depreciation-chart.tsx`

- **Props:** `{ schedule: DepreciationSchedule }`
- **shadcn deps:** uses ChartCard
- **Description:** Recharts BarChart showing annual depreciation amounts. ~30 lines.

#### `components/facility/analysis/price-projection-chart.tsx`

- **Props:** `{ projections: PriceProjection[] }`
- **shadcn deps:** uses ChartCard
- **Description:** Recharts LineChart showing projected price decreases over time. ~30 lines.

#### `components/facility/analysis/spend-trend-chart.tsx`

- **Props:** `{ data: SpendTrend[]; groupBy: "vendor" | "category" }`
- **shadcn deps:** uses ChartCard
- **Description:** Recharts ComposedChart for vendor or category spend trends. ~35 lines.

### Prospective Analysis Components

#### `components/facility/analysis/proposal-upload.tsx`

- **Props:** `{ facilityId: string; onAnalyzed: (result: ProposalAnalysis) => void }`
- **shadcn deps:** Card, Select, Button
- **Description:** Upload vendor proposal pricing file, select vendor. Reuses FileDropzone. ~45 lines.

#### `components/facility/analysis/proposal-comparison-table.tsx`

- **Props:** `{ comparisons: ItemComparison[] }`
- **shadcn deps:** uses DataTable, Badge
- **Description:** Table comparing proposed vs current prices with savings/loss per item. ~45 lines.

#### `components/facility/analysis/deal-score-radar.tsx`

- **Props:** `{ score: DealScore }`
- **shadcn deps:** uses ChartCard, Badge
- **Description:** Recharts RadarChart with 5 dimensions (financial, rebate, pricing, market share, compliance). Overall score badge. ~45 lines.

#### `components/vendor/prospective/proposal-builder.tsx`

- **Props:** `{ vendorId: string; facilities: FacilityOption[] }`
- **shadcn deps:** Card, Select, Input, Button, Tabs
- **Description:** Vendor proposal builder with multi-facility selection, pricing file upload, usage analysis. ~80 lines.

#### `components/vendor/prospective/deal-score-view.tsx`

- **Props:** `{ score: DealScore }`
- **shadcn deps:** uses DealScoreRadar (reuse), Card
- **Description:** Vendor view of deal score with recommendation. ~30 lines.

---

## Pages

### Case Costing Pages

#### `app/(facility)/dashboard/case-costing/page.tsx`

- **Route:** `/dashboard/case-costing`
- **Auth:** facility role
- **Data loading:** TanStack Query for cases, surgeon scorecards, CPT analysis
- **Content:** PageHeader + Tabs (Cases, Surgeon Scorecards, CPT Analysis) + import dialog
- **Lines:** ~55 lines

#### `app/(facility)/dashboard/case-costing/compare/page.tsx`

- **Route:** `/dashboard/case-costing/compare`
- **Auth:** facility role
- **Data loading:** TanStack Query `compareSurgeons()`
- **Content:** PageHeader + surgeon/procedure selectors + SurgeonComparisonChart + comparison table
- **Lines:** ~45 lines

#### `app/(facility)/dashboard/case-costing/reports/page.tsx`

- **Route:** `/dashboard/case-costing/reports`
- **Auth:** facility role
- **Data loading:** TanStack Query `getCaseCostingReportData()`
- **Content:** PageHeader + filters + report charts + data table
- **Lines:** ~45 lines

### Analysis Pages

#### `app/(facility)/dashboard/analysis/page.tsx`

- **Route:** `/dashboard/analysis`
- **Auth:** facility role
- **Data loading:** TanStack Query for depreciation, price projections, spend trends
- **Content:** PageHeader + Tabs (Depreciation, Price Projections, Vendor Trends, Category Trends). Each tab renders its chart/form components.
- **Lines:** ~55 lines

#### `app/(facility)/dashboard/analysis/prospective/page.tsx`

- **Route:** `/dashboard/analysis/prospective`
- **Auth:** facility role
- **Data loading:** None initially (upload-driven)
- **Content:** PageHeader + ProposalUpload + ProposalComparisonTable + DealScoreRadar
- **Lines:** ~45 lines

### Vendor Prospective Page

#### `app/(vendor)/prospective/page.tsx`

- **Route:** `/vendor/prospective`
- **Auth:** vendor role
- **Data loading:** TanStack Query `getVendorProposals()`
- **Content:** PageHeader + ProposalBuilder + DealScoreView
- **Lines:** ~40 lines

### Loading States

- [ ] All pages above get `loading.tsx` with skeleton UI

---

## Query Keys

```typescript
cases: {
  all: ["cases"],
  list: (facilityId: string, filters?) => ["cases", "list", facilityId, filters],
  detail: (id: string) => ["cases", "detail", id],
  surgeonScorecards: (facilityId: string) => ["cases", "surgeonScorecards", facilityId],
  cptAnalysis: (facilityId: string) => ["cases", "cptAnalysis", facilityId],
  surgeonComparison: (facilityId: string, surgeons: string[]) => ["cases", "comparison", facilityId, surgeons],
  reportData: (facilityId: string, filters?) => ["cases", "reportData", facilityId, filters],
},
analysis: {
  depreciation: (contractId: string, input) => ["analysis", "depreciation", contractId, input],
  priceProjections: (facilityId: string, filters) => ["analysis", "priceProjections", facilityId, filters],
  vendorSpendTrends: (facilityId: string, dateRange) => ["analysis", "vendorSpendTrends", facilityId, dateRange],
  categorySpendTrends: (facilityId: string, dateRange) => ["analysis", "categorySpendTrends", facilityId, dateRange],
  proposalAnalysis: (facilityId: string) => ["analysis", "proposalAnalysis", facilityId],
},
prospective: {
  vendorProposals: (vendorId: string) => ["prospective", "vendorProposals", vendorId],
},
```

---

## File Checklist

### Server Actions
- [ ] `lib/actions/cases.ts`
- [ ] `lib/actions/analysis.ts`
- [ ] `lib/actions/prospective.ts`

### Case Costing Components
- [ ] `components/facility/case-costing/case-table.tsx`
- [ ] `components/facility/case-costing/case-columns.tsx`
- [ ] `components/facility/case-costing/case-import-dialog.tsx`
- [ ] `components/facility/case-costing/case-detail.tsx`
- [ ] `components/facility/case-costing/surgeon-scorecard.tsx`
- [ ] `components/facility/case-costing/surgeon-scorecards-grid.tsx`
- [ ] `components/facility/case-costing/surgeon-comparison-chart.tsx`
- [ ] `components/facility/case-costing/cpt-analysis-table.tsx`
- [ ] `components/facility/case-costing/cost-distribution-chart.tsx`

### Analysis Components
- [ ] `components/facility/analysis/depreciation-calculator.tsx`
- [ ] `components/facility/analysis/depreciation-chart.tsx`
- [ ] `components/facility/analysis/price-projection-chart.tsx`
- [ ] `components/facility/analysis/spend-trend-chart.tsx`
- [ ] `components/facility/analysis/proposal-upload.tsx`
- [ ] `components/facility/analysis/proposal-comparison-table.tsx`
- [ ] `components/facility/analysis/deal-score-radar.tsx`

### Vendor Prospective Components
- [ ] `components/vendor/prospective/proposal-builder.tsx`
- [ ] `components/vendor/prospective/deal-score-view.tsx`

### Pages
- [ ] `app/(facility)/dashboard/case-costing/page.tsx`
- [ ] `app/(facility)/dashboard/case-costing/compare/page.tsx`
- [ ] `app/(facility)/dashboard/case-costing/reports/page.tsx`
- [ ] `app/(facility)/dashboard/analysis/page.tsx`
- [ ] `app/(facility)/dashboard/analysis/prospective/page.tsx`
- [ ] `app/(vendor)/prospective/page.tsx`
- [ ] All loading.tsx files

### Validators
- [ ] `lib/validators/cases.ts` -- CaseInput, CaseSupplyInput, CaseFilters
- [ ] `lib/validators/analysis.ts` -- DepreciationInput, PriceProjectionInput, ProposedPricingItem
- [ ] `lib/validators/prospective.ts` -- ProposalInput, ProposalTerms

---

## Acceptance Criteria

1. Case costing page shows tabs for Cases, Surgeon Scorecards, CPT Analysis
2. Case import accepts CSV/XLSX with case procedures and supply data
3. Imported cases appear in the table with cost breakdown
4. Surgeon scorecards show per-surgeon metrics (case count, avg spend, compliance)
5. Surgeon comparison page renders radar chart comparing selected surgeons
6. CPT analysis table shows average cost by procedure code
7. Analysis page has tabs for Depreciation, Price Projections, Vendor Trends, Category Trends
8. MACRS depreciation calculator produces correct depreciation schedules
9. Price projection chart shows projected trends
10. Prospective analysis accepts pricing file upload and compares against current COG prices
11. Deal score radar chart renders 5 dimensions with overall score
12. Proposal comparison table shows savings/loss per item
13. Vendor prospective page allows building multi-facility proposals
14. Vendor can see deal score from their perspective
15. All pages are THIN (30-80 lines)
