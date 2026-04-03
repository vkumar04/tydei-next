# Gap Plan: Closing Sherlock FAIL + PARTIAL Items

**Date:** 2026-04-01
**Author:** Sun Tzu (Planner Agent)
**Objective:** Close 14 FAIL and 6 PARTIAL items identified by Sherlock, ordered by demo impact and dependency.

---

## Phase 1 — Quick Wins: Badges, Tooltips, and Explainer
**Objective:** Ship small, visually impressive components that make the existing UI feel richer — zero backend work.

### Item 10: Contract Score Badge on Contracts List (PARTIAL)
**What:** A compact inline badge showing AI deal score (A/B/C/D/F with color) rendered in the contracts list table beside each contract name.

**Files to create:**
- `components/shared/badges/score-badge.tsx`

**Files to modify:**
- `components/contracts/contract-columns.tsx` — add ScoreBadge to the "Contract Name" column cell

**Component spec:**
```tsx
// components/shared/badges/score-badge.tsx
interface ScoreBadgeProps {
  score: number | null | undefined   // 0–100 scale, nullable
  size?: "sm" | "md"                  // sm=inline table, md=card header
}
```
- Renders a `<Badge>` with letter grade (A >= 80, B >= 60, C >= 40, D >= 20, F < 20)
- Color variants: A=green, B=blue, C=yellow, D=orange, F=red
- If `score` is null/undefined, renders nothing (no empty badge)
- Uses `@/components/ui/badge` with `className` color overrides

**Column modification in `contract-columns.tsx`:**
- Import `ScoreBadge` from `@/components/shared/badges/score-badge`
- In the `name` column cell, render `<ScoreBadge score={row.original.aiScore} size="sm" />` after the contract number `<div>`
- The `Contract` Prisma model already has no `aiScore` field — add an optional field to the query `select` if it exists, otherwise use `null` and the badge hides itself. **Check:** If `aiScore` doesn't exist on the model, the badge simply renders nothing. No schema change needed.

**Existing code used:** `Badge` from `@/components/ui/badge`, `contractStatusConfig` from `@/lib/constants`, existing `StatusBadge` pattern in `@/components/shared/badges/status-badge.tsx`

**Acceptance criteria:**
- ScoreBadge renders inline on contracts list when score data exists
- No visual change when score is null
- Badge links to `/dashboard/contracts/[id]/score` on click

---

### Item 6: Case Costing Explainer Component (FAIL)
**What:** An educational/explainer component that breaks down how case costing calculations work — clinical supply cost vs. purchasing cost, rebate contribution, margin calculation. Shown as an expandable info panel on the case costing page.

**Files to create:**
- `components/facility/case-costing/case-costing-explainer.tsx`

**Files to modify:**
- `app/dashboard/case-costing/page.tsx` — import and render explainer above the main client component

**Component spec:**
```tsx
// components/facility/case-costing/case-costing-explainer.tsx
// No props — static educational content
export function CaseCostingExplainer(): JSX.Element
```
- Uses `Collapsible` from `@/components/ui/collapsible` (or `Accordion`) 
- Header: "How Case Costing Works" with `HelpCircle` icon and toggle
- Content sections:
  1. "Supply Cost vs. Purchase Cost" — explains clinical supply cost (what the surgeon used) vs. purchasing cost (what the facility paid)
  2. "Rebate Contribution" — explains how on-contract spend generates rebates
  3. "Margin Calculation" — formula: Reimbursement - Purchase Cost = Margin
  4. "On-Contract vs. Off-Contract" — explains compliance tracking
- Each section: icon + heading + 2-3 sentence explanation
- Collapsed by default, remembers state via localStorage key `tydei:explainer:case-costing`

**Existing code used:** `Card`, `CardContent`, `CardHeader`, `CardTitle` from `@/components/ui/card`, `Accordion`/`AccordionItem` from `@/components/ui/accordion`, lucide icons (`HelpCircle`, `DollarSign`, `PiggyBank`, `TrendingUp`, `Shield`)

**Acceptance criteria:**
- Renders above the CaseCostingClient on the case-costing page
- Collapsible, starts collapsed
- Accessible (keyboard navigable)

---

### Item 3: Definition Tooltips + Contract Definitions Library (FAIL)
**What:** A tooltip component that shows definitions for healthcare contract terminology (e.g., "Market Share", "Capitated Pricing", "GPO Affiliation", "Performance Period") when users hover over underlined terms.

**Files to create:**
- `components/shared/definition-tooltip.tsx`
- `lib/contract-definitions.ts`

**Files to modify:**
- `components/contracts/contract-terms-display.tsx` — wrap term type labels with DefinitionTooltip
- `components/contracts/contract-terms-entry.tsx` — wrap term type labels with DefinitionTooltip
- `components/contracts/contract-detail-overview.tsx` — wrap key field labels

**Component spec:**
```tsx
// lib/contract-definitions.ts
export const CONTRACT_DEFINITIONS: Record<string, string> = {
  spend_rebate: "A rebate earned when cumulative spend reaches defined thresholds...",
  volume_rebate: "A rebate based on the number of units purchased...",
  market_share: "The percentage of a facility's total category spend...",
  capitated_pricing: "A pricing model where the vendor sets a ceiling price per procedure...",
  gpo_affiliation: "Group Purchasing Organization membership that provides access to pre-negotiated pricing...",
  performance_period: "The time window over which spend/volume is measured against tier thresholds...",
  rebate_pay_period: "The cadence at which earned rebates are paid out...",
  auto_renewal: "A clause that automatically extends the contract unless terminated...",
  termination_notice: "The number of days advance notice required to terminate...",
  tier: "A threshold level in a rebate structure...",
  compliance_rebate: "A rebate earned by meeting specific compliance requirements...",
  growth_rebate: "A rebate based on spend growth compared to a prior baseline period...",
  // ... 15-20 total definitions
}

// components/shared/definition-tooltip.tsx
interface DefinitionTooltipProps {
  term: string            // key into CONTRACT_DEFINITIONS
  children: ReactNode     // the label text to wrap
}
```
- Uses `Tooltip`, `TooltipTrigger`, `TooltipContent` from `@/components/ui/tooltip`
- Renders children with a dotted underline (`border-b border-dotted border-muted-foreground/50 cursor-help`)
- Tooltip shows the definition text, max-width 300px
- If term not found in definitions, renders children without tooltip (graceful fallback)

**Existing code used:** `Tooltip` / `TooltipContent` / `TooltipTrigger` from `@/components/ui/tooltip` (already imported in `contract-score-client.tsx`), `TooltipProvider` wraps at app level

**Acceptance criteria:**
- Hovering over a term type in contract-terms-display shows the definition
- Dotted underline indicates a term is hoverable
- Works on touch devices (tap to show)
- No visual regression on contract detail page

---

**Phase 1 dependencies:** None
**Estimated effort:** Small (3 components, 1 data file, 4 file modifications)

---

## Phase 2 — Forecast Components
**Objective:** Complete the forecast visualization suite — the backend (`lib/actions/forecasting.ts`) already exists with `getSpendForecast` and `getRebateForecast` returning `ForecastResult` data. Just need the UI.

### Item 5: Forecast Table Component (FAIL)
**What:** A data table showing forecast periods with actual vs. projected values, confidence bands, and trend indicators.

**Files to create:**
- `components/facility/analysis/forecast-table.tsx`

**Files to modify:**
- `components/facility/analysis/analysis-client.tsx` — add ForecastTable below the existing PriceProjectionChart or in a new "Forecasts" tab

**Component spec:**
```tsx
// components/facility/analysis/forecast-table.tsx
import type { ForecastPoint, ForecastResult } from "@/lib/actions/forecasting"

interface ForecastTableProps {
  result: ForecastResult
  label?: string        // "Spend" | "Rebate" — column header prefix
  formatValue?: (v: number) => string  // defaults to formatCurrency
}
```
- Renders a `<Table>` with columns: Period, Actual, Forecast, Lower Bound, Upper Bound, Variance
- Actual column: bold if present, "—" if null (future periods)
- Forecast column: always present for future periods
- Variance column: `(Actual - Forecast) / Forecast * 100` as percent, green if negative (under forecast), red if positive
- Footer row: R-squared value and trend direction arrow
- Uses `Table`, `TableBody`, `TableCell`, `TableHead`, `TableHeader`, `TableRow` from `@/components/ui/table`
- Uses `formatCurrency` from `@/lib/formatting`

**Existing code used:** `Table` components from `@/components/ui/table`, `formatCurrency`/`formatPercent` from `@/lib/formatting`, `ForecastResult`/`ForecastPoint` types from `@/lib/actions/forecasting`, `Card`/`CardHeader`/`CardTitle`/`CardContent` wrapping

**Acceptance criteria:**
- Table renders with actual data for historical periods and forecast data for future periods
- Variance column shows correct color coding
- R-squared and trend shown in footer

---

### Item 11: Forecast Chart UI Enhancement (PARTIAL)
**What:** Enhance the existing `PriceProjectionChart` area with a dedicated forecast chart that shows actual vs. forecast with confidence interval shading, using the `ForecastResult` data shape from the forecasting action.

**Files to create:**
- `components/facility/analysis/forecast-chart.tsx`

**Files to modify:**
- `components/facility/analysis/analysis-client.tsx` — add a "Forecast" section using ForecastChart + ForecastTable together

**Component spec:**
```tsx
// components/facility/analysis/forecast-chart.tsx
import type { ForecastResult } from "@/lib/actions/forecasting"

interface ForecastChartProps {
  result: ForecastResult
  title?: string
  description?: string
}
```
- Uses Recharts: `AreaChart`, `Area`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `ResponsiveContainer`
- Renders:
  - Solid line for `actual` values (blue)
  - Dashed line for `forecast` values (primary color)
  - Shaded area between `lower` and `upper` bounds (primary/10 opacity)
  - Vertical reference line at the boundary between actual and forecast data
- Wrapped in `ChartCard` from `@/components/shared/charts/chart-card`
- Uses `chartTooltipStyle` from `@/lib/chart-config`
- Tooltip formatter uses `formatCurrency`

**Existing code used:** `ChartCard` from `@/components/shared/charts/chart-card`, `chartTooltipStyle` from `@/lib/chart-config`, `PriceProjectionChart` as reference pattern (same Recharts setup), `ForecastResult` type from `@/lib/actions/forecasting`

**Acceptance criteria:**
- Chart renders actual historical data as a solid line
- Future forecast renders as a dashed line with confidence band
- Vertical divider line separates historical from forecast
- Responsive, matches existing chart styling

---

**Phase 2 dependencies:** None (backend already exists in `lib/actions/forecasting.ts`)
**Estimated effort:** Medium (2 new components, 1 file modification)

---

## Phase 3 — Contract Terms Page + Vendor Edit Pages
**Objective:** Add the three missing route pages that Sherlock flagged as FAIL.

### Item 7: `/dashboard/contracts/[id]/terms` Page (FAIL)
**What:** A standalone page for viewing and editing contract terms for an existing contract, separate from the main contract edit form.

**Files to create:**
- `app/dashboard/contracts/[id]/terms/page.tsx`
- `components/facility/contracts/contract-terms-page-client.tsx`

**Component spec:**
```tsx
// app/dashboard/contracts/[id]/terms/page.tsx
// Server component — fetches contract ID from params
export default async function ContractTermsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ContractTermsPageClient contractId={id} />
}

// components/facility/contracts/contract-terms-page-client.tsx
interface ContractTermsPageClientProps {
  contractId: string
}
```
- Client component that:
  1. Fetches contract name via `useContract(contractId)` from `@/hooks/use-contracts`
  2. Fetches existing terms via `useQuery` calling `getContractTerms(contractId)` from `@/lib/actions/contract-terms`
  3. Renders `PageHeader` with title "{Contract Name} — Terms" and back button to `/dashboard/contracts/[id]`
  4. Renders `ContractTermsDisplay` (read-only) from `@/components/contracts/contract-terms-display`
  5. Edit button opens an inline `ContractTermsEntry` from `@/components/contracts/contract-terms-entry` for adding/modifying terms
  6. Save calls `createContractTerm` / `updateContractTerm` from `@/lib/actions/contract-terms`

**Existing code used:** `PageHeader` from `@/components/shared/page-header`, `ContractTermsDisplay` from `@/components/contracts/contract-terms-display`, `ContractTermsEntry` from `@/components/contracts/contract-terms-entry`, `useContract` from `@/hooks/use-contracts`, `getContractTerms`/`createContractTerm`/`updateContractTerm` from `@/lib/actions/contract-terms`, `Button` from `@/components/ui/button`

**Acceptance criteria:**
- Page loads at `/dashboard/contracts/[id]/terms`
- Shows existing terms in read-only display
- Edit mode allows adding/removing terms with tier structures
- Save persists changes via server actions
- Back button returns to contract detail

---

### Item 8: `/vendor/contracts/[id]/edit` Page (FAIL)
**What:** A vendor-side contract edit page that allows vendors to propose changes to an existing contract via the change proposal system.

**Files to create:**
- `app/vendor/contracts/[id]/edit/page.tsx`
- `components/vendor/contracts/vendor-contract-edit-client.tsx`

**Component spec:**
```tsx
// app/vendor/contracts/[id]/edit/page.tsx
export default async function VendorContractEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <VendorContractEditClient contractId={id} />
}

// components/vendor/contracts/vendor-contract-edit-client.tsx
interface VendorContractEditClientProps {
  contractId: string
}
```
- Client component that:
  1. Fetches contract detail via `useQuery` calling `getVendorContractDetail(contractId)` from `@/lib/actions/vendor-contracts`
  2. Renders `PageHeader` with title "Edit Contract: {name}" and back button
  3. Renders `VendorContractOverview` (read-only summary) from `@/components/vendor/contracts/vendor-contract-overview`
  4. Below, renders `ChangeProposalForm` from `@/components/vendor/contracts/change-proposal-form` pre-filled with contract data
  5. Submit calls `createChangeProposal` from `@/lib/actions/change-proposals`
  6. On success, redirects to `/vendor/contracts/[id]` with toast

**Existing code used:** `PageHeader` from `@/components/shared/page-header`, `VendorContractOverview` from `@/components/vendor/contracts/vendor-contract-overview`, `ChangeProposalForm` from `@/components/vendor/contracts/change-proposal-form`, `getVendorContractDetail` from `@/lib/actions/vendor-contracts`, `createChangeProposal` from `@/lib/actions/change-proposals`, `useVendorContract` or inline `useQuery`, `toast` from `sonner`

**Acceptance criteria:**
- Page accessible at `/vendor/contracts/[id]/edit`
- Shows current contract overview (read-only)
- Change proposal form allows vendors to propose edits
- Submission creates a change proposal, shows success toast, redirects

---

### Item 9: `/vendor/contracts/pending/[id]/edit` Page (FAIL)
**What:** A vendor-side edit page for pending (not-yet-approved) contract submissions that allows the vendor to revise before facility review.

**Files to create:**
- `app/vendor/contracts/pending/[id]/edit/page.tsx`
- `components/vendor/contracts/pending-contract-edit-client.tsx`

**Component spec:**
```tsx
// app/vendor/contracts/pending/[id]/edit/page.tsx
export default async function PendingContractEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <PendingContractEditClient pendingContractId={id} />
}

// components/vendor/contracts/pending-contract-edit-client.tsx
interface PendingContractEditClientProps {
  pendingContractId: string
}
```
- Client component that:
  1. Fetches pending contract via `useQuery` calling `getVendorPendingContract(pendingContractId)` — may need to add this action to `@/lib/actions/pending-contracts` (a single-item fetch variant of `getVendorPendingContracts`)
  2. Renders `PageHeader` with title "Edit Pending Contract: {name}" and back button
  3. Renders a form mirroring the vendor contract submission form (reuse fields from `@/components/vendor/contracts/submission/` if they exist, otherwise build a form with contract name, type, dates, terms, pricing file upload)
  4. Save calls `updatePendingContract` from `@/lib/actions/pending-contracts`
  5. Status badge shows current pending status
  6. Only editable if status is `draft` or `revision_requested`

**Existing code used:** `PageHeader` from `@/components/shared/page-header`, `PendingContractCard` pattern from `@/components/vendor/contracts/pending-contract-card` (for status config), `updatePendingContract` from `@/lib/actions/pending-contracts`, `Field` from `@/components/shared/forms/field`, `Input`/`Select`/`Textarea`/`Button` from `@/components/ui/*`, `toast` from `sonner`

**Files to modify (if needed):**
- `lib/actions/pending-contracts.ts` — add `getVendorPendingContract(id: string)` single-item fetch if it doesn't exist

**Acceptance criteria:**
- Page accessible at `/vendor/contracts/pending/[id]/edit`
- Form pre-filled with existing pending contract data
- Only editable when status is draft or revision_requested
- Save persists changes, shows success toast
- Read-only mode with message when status doesn't allow edits

---

**Phase 3 dependencies:** None (all server actions already exist)
**Estimated effort:** Medium (3 pages, 3 client components, possibly 1 action addition)

---

## Phase 4 — Mass Upload + Amendment Extraction
**Objective:** Build the AI-powered document classification hub and amendment extraction workflow — the two most feature-rich missing items.

### Item 4: Mass Upload with AI Classification (FAIL)
**What:** A standalone mass upload component accessible from the Import Data dialog in the portal shell. Users drop multiple files (PDFs, CSVs, Excel) and the system classifies each as contract, amendment, COG data, or pricing file, then routes to the appropriate import workflow.

**Files to create:**
- `components/import/mass-upload.tsx`
- `components/import/file-classification-card.tsx`

**Files to modify:**
- `components/shared/shells/portal-shell.tsx` — update the "Contract / Mass Upload" link card to open mass upload inline (or route to a dedicated page)

**Component spec:**
```tsx
// components/import/mass-upload.tsx
interface MassUploadProps {
  facilityId: string
  onComplete?: () => void
}

// Internal state manages a queue of files with classification results
type FileClassification = "contract" | "amendment" | "cog_data" | "pricing_file" | "unknown"
interface QueuedFile {
  file: File
  status: "pending" | "classifying" | "classified" | "error"
  classification: FileClassification | null
  confidence: number
  s3Key?: string
}

// components/import/file-classification-card.tsx
interface FileClassificationCardProps {
  queuedFile: QueuedFile
  onReclassify: (classification: FileClassification) => void
  onRemove: () => void
  onProcess: () => void
}
```
- `MassUpload`:
  - Multi-file dropzone (reuses pattern from `@/components/shared/file-upload` or `@/components/facility/cog/file-dropzone`)
  - On drop, uploads each file to S3 via `getUploadUrl` from `@/lib/actions/uploads`
  - Calls `/api/ai/classify-document` (POST with s3Key + fileName) to classify each file
  - Shows a grid/list of `FileClassificationCard` for each file
  - "Process All" button routes each file to its handler:
    - contract -> opens `AIExtractDialog` with the file
    - amendment -> opens amendment extractor (Phase 4 item 2)
    - cog_data -> navigates to `/dashboard/cog-data` with file ref
    - pricing_file -> navigates to `/dashboard/cog-data?tab=pricing` with file ref
  - Badge shows classification + confidence percentage

- `FileClassificationCard`:
  - Shows file name, size, detected type badge, confidence
  - Dropdown to override classification
  - Process / Remove buttons

**API endpoint to create:**
- `app/api/ai/classify-document/route.ts` — POST handler that:
  - Takes `{ s3Key: string, fileName: string }`
  - Reads first few KB of the file (or uses file extension + name heuristics)
  - For PDFs: calls AI to classify based on first page content
  - For CSV/Excel: inspects column headers
  - Returns `{ classification: FileClassification, confidence: number }`

**Portal shell modification:**
- In `portal-shell.tsx`, change the "Contract / Mass Upload" card's `<Link>` to instead set state opening a `MassUpload` dialog, or navigate to a new `/dashboard/import` page

**Existing code used:** `FileUpload` / `file-dropzone` pattern, `getUploadUrl` from `@/lib/actions/uploads`, `AIExtractDialog` from `@/components/contracts/ai-extract-dialog`, `Card`/`Badge`/`Button`/`Progress` from `@/components/ui/*`, `toast` from `sonner`

**Acceptance criteria:**
- Multiple files can be dropped simultaneously
- Each file gets classified with type + confidence
- Users can override classification
- "Process All" routes each file to correct workflow
- Integrates with existing Import Data dialog in portal shell

---

### Item 2: Amendment Extractor Component (FAIL)
**What:** A component that extracts amendment-specific data from uploaded amendment PDFs — identifies what changed (pricing, terms, dates, etc.) and presents a diff-style view for the user to confirm before applying changes.

**Files to create:**
- `components/contracts/amendment-extractor.tsx`

**Files to modify:**
- `components/contracts/contract-detail-client.tsx` — add "Extract Amendment" button in the action bar
- `components/contracts/document-upload.tsx` — when doc type is "amendment", offer to extract after upload

**Component spec:**
```tsx
// components/contracts/amendment-extractor.tsx
interface AmendmentExtractorProps {
  contractId: string
  s3Key: string           // uploaded amendment PDF location
  fileName: string
  onApplied: () => void   // callback after changes applied
  onCancel: () => void
}

interface ExtractedAmendment {
  effectiveDate: string | null
  changes: AmendmentChange[]
}

interface AmendmentChange {
  field: string          // e.g. "expirationDate", "term:spend_rebate:tier_1"
  label: string          // human-readable label
  oldValue: string       // from existing contract
  newValue: string       // from amendment
  type: "modified" | "added" | "removed"
}
```
- Renders as a `Dialog` or inline panel
- On mount, calls `/api/ai/extract-amendment` POST with `{ contractId, s3Key }`
- Shows loading state with progress steps (similar pattern to `AIExtractDialog`)
- Displays diff table: Field | Current Value | Amendment Value | Change Type
  - Modified rows: yellow highlight
  - Added rows: green highlight  
  - Removed rows: red highlight/strikethrough
- "Apply Changes" button calls server action to update contract + terms
- "Reject" button dismisses without changes

**API endpoint to create:**
- `app/api/ai/extract-amendment/route.ts` — POST handler that:
  - Takes `{ contractId: string, s3Key: string }`
  - Fetches current contract data from DB
  - Parses amendment PDF via AI
  - Diffs against current contract
  - Returns `ExtractedAmendment`

**Existing code used:** `AIExtractDialog` as pattern reference, `Dialog` from `@/components/ui/dialog`, `Table` from `@/components/ui/table`, `Badge` from `@/components/ui/badge`, `getContract` from `@/lib/actions/contracts`, `updateContract` from `@/lib/actions/contracts`, `toast` from `sonner`

**Acceptance criteria:**
- Amendment PDF uploaded and parsed via AI
- Diff view shows current vs. proposed changes
- Apply writes changes to the contract
- Accessible from contract detail page and from document upload when type = "amendment"

---

**Phase 4 dependencies:** Phase 1 (definition tooltips used in diff view is nice-to-have). The amendment extractor can be used standalone but integrates with mass upload's classification routing.
**Estimated effort:** Large (2 components, 2 API routes, 3 file modifications)

---

## Phase 5 — Contract Transaction Ledger
**Objective:** Add the contract transaction ledger — the only item requiring a new database table.

### Item 1: Contract Transaction Ledger Component (FAIL)
**What:** A ledger view showing all financial transactions (PO spend, rebate payments, adjustments, credits) associated with a contract, with running totals and period summaries.

**Files to create:**
- `components/facility/contracts/contract-transactions.tsx`
- `lib/actions/contract-transactions.ts`

**Files to modify:**
- `components/contracts/contract-detail-client.tsx` — add "Transactions" tab/section
- `prisma/schema.prisma` — add `ContractTransaction` model (if needed — may already be derivable from existing `CogRecord` + `ContractPeriod` data)

**Schema addition (if needed):**
```prisma
model ContractTransaction {
  id            String   @id @default(cuid())
  contractId    String
  facilityId    String
  type          String   // "po_spend" | "rebate_payment" | "adjustment" | "credit"
  amount        Decimal  @db.Decimal(14, 2)
  description   String?
  referenceId   String?  // PO number, invoice number, etc.
  referenceType String?  // "purchase_order" | "invoice" | "manual"
  periodStart   DateTime @db.Date
  periodEnd     DateTime @db.Date
  createdAt     DateTime @default(now())

  contract Contract  @relation(fields: [contractId], references: [id])
  facility Facility  @relation(fields: [facilityId], references: [id])

  @@index([contractId, periodStart])
  @@index([facilityId])
}
```

**NOTE:** Before adding a new model, check if transaction data can be derived from existing `CogRecord` data (which has `contractId`, `extendedPrice`, dates). If COG records serve as the transaction source, skip the schema addition and query COG records grouped by period instead. The component should work either way.

**Server action spec:**
```tsx
// lib/actions/contract-transactions.ts
export interface ContractTransactionRow {
  id: string
  date: string
  type: "po_spend" | "rebate_payment" | "adjustment" | "credit"
  description: string
  reference: string | null
  amount: number
  runningTotal: number
}

export interface TransactionSummary {
  totalSpend: number
  totalRebates: number
  netCost: number
  periodCount: number
}

export async function getContractTransactions(input: {
  contractId: string
  page?: number
  pageSize?: number
}): Promise<{ transactions: ContractTransactionRow[]; summary: TransactionSummary; total: number }>
```

**Component spec:**
```tsx
// components/facility/contracts/contract-transactions.tsx
interface ContractTransactionsProps {
  contractId: string
}
```
- Client component using `useQuery` to fetch transactions
- Renders:
  - Summary cards row: Total Spend, Total Rebates, Net Cost, Periods
  - DataTable with columns: Date, Type (badge), Description, Reference, Amount (green for credits/rebates, default for spend), Running Total
  - Pagination via the shared `DataTable` component
- Type badges use color coding: po_spend=default, rebate_payment=green, adjustment=yellow, credit=blue
- Running total column shows cumulative sum

**Existing code used:** `DataTable` from `@/components/shared/tables/data-table`, `Card`/`Badge`/`Button` from `@/components/ui/*`, `formatCurrency`/`formatDate` from `@/lib/formatting`, `requireFacility` from `@/lib/actions/auth`, `prisma` from `@/lib/db`, `serialize` from `@/lib/serialize`

**Integration in contract-detail-client.tsx:**
- Add a `Tabs` section (or new tab if tabs already exist) with "Transactions" tab
- Tab content renders `<ContractTransactions contractId={contractId} />`

**Acceptance criteria:**
- Transaction ledger shows on contract detail page
- Summary cards display aggregate figures
- Table is paginated and sortable
- Running total column is accurate
- Type badges are color-coded

---

**Phase 5 dependencies:** None technically, but best after Phase 3 (terms page) so the contract detail page has a complete feature set
**Estimated effort:** Large (1 component, 1 server action, 1 possible schema change, 1 file modification + migration)

---

## Phase 6 — PARTIAL Fixes: COG Import, Vendor Aliases, Facility Selector, AI Description
**Objective:** Close out the remaining PARTIAL items that need minor enhancements to existing components.

### Item 14: COG Import Accessible from Nav "Import Data" Button (PARTIAL)
**What:** The Import Data dialog in the portal shell already exists and links to COG data. The issue is that the file drop doesn't actually trigger the COG import flow — it just navigates. Enhance to pass the dropped file through to the destination page.

**Files to modify:**
- `components/shared/shells/portal-shell.tsx`

**Changes:**
- When a file is dropped/selected in the Import Data dialog:
  - For CSV/Excel: Instead of `window.location.href = "/dashboard/cog-data"`, use `router.push("/dashboard/cog-data?autoImport=true")` and store the file reference in a shared state/context or sessionStorage
  - Alternatively (simpler): just ensure the navigation works correctly and the COG import dialog auto-opens on the destination page when `?autoImport=true` query param is present
- Modify `components/facility/cog/cog-data-client.tsx` to check for `autoImport` search param and auto-open the import dialog

**Files to modify:**
- `components/shared/shells/portal-shell.tsx` — add `useRouter` for proper navigation
- `components/facility/cog/cog-data-client.tsx` — auto-open import dialog when `autoImport=true`

**Acceptance criteria:**
- Dropping a CSV in the Import Data dialog navigates to COG data page with import dialog auto-opened
- The flow feels seamless — one drop, arrives at import

---

### Item 13: Vendor Alias Matching Table for Known Vendors (PARTIAL)
**What:** The `VendorMappingTable` component already exists at `components/facility/vendors/vendor-mapping-table.tsx` with full CRUD. The PARTIAL status is because it's not surfaced in a discoverable location.

**Files to modify:**
- `components/facility/settings/settings-client.tsx` — add a "Vendor Aliases" tab or section that renders `VendorMappingTable`
- OR: `app/dashboard/cog-data/page.tsx` — add a "Vendor Mappings" tab that shows the table

**Changes:**
- Import `VendorMappingTable` from `@/components/facility/vendors/vendor-mapping-table`
- Add as a new tab in Settings page ("Vendor Aliases" tab) or as a section in COG Data page
- Recommendation: Settings page is more appropriate since vendor aliases are a configuration concern

**Acceptance criteria:**
- `VendorMappingTable` is accessible from the Settings page (or COG data page)
- Users can confirm, reassign, or delete vendor name mappings
- Navigation to this section is discoverable

---

### Item 15: Scalable Facility Selector with Search/Filter (PARTIAL)
**What:** The existing `FacilitySelector` at `components/vendor/prospective/builder/facility-selector.tsx` is tightly coupled to the proposal builder. Need a reusable version with search/filter for use in contract forms and other contexts.

**Files to create:**
- `components/shared/forms/facility-selector.tsx`

**Files to modify:**
- `components/vendor/prospective/builder/facility-selector.tsx` — refactor to use the shared component internally (optional, can be done later)

**Component spec:**
```tsx
// components/shared/forms/facility-selector.tsx
interface FacilitySelectorProps {
  facilities: { id: string; name: string }[]
  selected: string[]                    // selected facility IDs
  onChange: (ids: string[]) => void
  mode?: "single" | "multi"            // default "single"
  placeholder?: string
  disabled?: boolean
}
```
- For `mode="single"`: renders a `Combobox` (command-based select) with search input
- For `mode="multi"`: renders a multi-select with checkboxes, search, and selected badges
- Search filters facilities by name (client-side, case-insensitive)
- Uses `Command`, `CommandInput`, `CommandList`, `CommandItem`, `CommandEmpty` from `@/components/ui/command`
- Uses `Popover`, `PopoverContent`, `PopoverTrigger` from `@/components/ui/popover`
- Selected items shown as `Badge` pills with remove button

**Existing code used:** `Command` + `Popover` pattern (standard shadcn combobox), `Badge` from `@/components/ui/badge`, `Button` from `@/components/ui/button`, `Check` + `ChevronsUpDown` from `lucide-react`

**Acceptance criteria:**
- Searchable facility selection with typeahead
- Works in both single and multi-select modes
- Renders selected items as removable badges in multi mode
- Usable in contract forms and proposal builder

---

### Item 12: AI Free-Text Contract Description Input (PARTIAL)
**What:** The AI extract dialog exists (`ai-extract-dialog.tsx`) for PDF upload, but the original v0 spec also had a free-text input mode where users paste contract description text and AI structures it. This is marked PARTIAL because PDF extract works but free-text doesn't have a dedicated input.

**Files to modify:**
- `components/contracts/ai-extract-dialog.tsx` — add a "Paste Text" tab alongside the file upload

**Changes:**
- In the `upload` stage of `AIExtractDialog`, add a `Tabs` component with two tabs: "Upload PDF" (existing dropzone) and "Paste Text" (new textarea)
- "Paste Text" tab: `Textarea` with placeholder "Paste contract description, terms, or key details here..."
- On submit, POST to `/api/ai/extract-contract` with `{ text: string }` instead of file
- The extraction flow (`extracting` -> `review`) remains the same

**API modification:**
- `app/api/ai/extract-contract/route.ts` — if this endpoint already exists, ensure it accepts `{ text: string }` in addition to `{ s3Key: string }`. If only file-based, add a text branch.

**Existing code used:** `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` from `@/components/ui/tabs`, `Textarea` from `@/components/ui/textarea`, existing `AIExtractDialog` stages and progress flow

**Acceptance criteria:**
- AI Extract dialog has two tabs: Upload PDF and Paste Text
- Pasting text and submitting triggers AI extraction
- Same review flow (AIExtractReview) works for both input modes

---

**Phase 6 dependencies:** None
**Estimated effort:** Medium (1 new component, 4 file modifications)

---

## Summary Matrix

| Phase | Items | New Files | Modified Files | Effort | Demo Impact |
|-------|-------|-----------|----------------|--------|-------------|
| 1 — Quick Wins | #10, #6, #3 | 3 components + 1 data file | 4 files | Small | HIGH — tooltips + badges are instantly visible |
| 2 — Forecast | #5, #11 | 2 components | 1 file | Medium | HIGH — charts + tables are demo-impressive |
| 3 — Pages | #7, #8, #9 | 3 pages + 3 clients | 1 action file | Medium | HIGH — fills navigation gaps |
| 4 — Mass Upload + Amendments | #4, #2 | 2 components + 2 API routes | 3 files | Large | MEDIUM — power-user feature |
| 5 — Transaction Ledger | #1 | 1 component + 1 action | 2 files + schema | Large | MEDIUM — important but backend-heavy |
| 6 — PARTIAL Fixes | #14, #13, #15, #12 | 1 component | 4 files | Medium | MEDIUM — polish and completeness |

**Total: 12 new files, 15 modified files across 6 phases**

**Demo Friday priority:** Phases 1-3 should be completed first — they close 8 of the 15 items with the highest visual payoff and lowest risk. Phase 2 charts are particularly demo-impressive. Phase 4-6 can follow in parallel or be deferred to post-demo.
