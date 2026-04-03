# UI Component Audit: v0 Prototype vs Production

Generated: 2026-04-01

## Summary

- **Total components audited:** 27
- **MATCH:** 14
- **PARTIAL:** 10
- **MISSING:** 3

---

## Dashboard Components

| Component | v0 Path | Production Path | Status | Notes |
|-----------|---------|-----------------|--------|-------|
| `dashboard-metrics` | `components/dashboard/dashboard-metrics.tsx` | `components/facility/dashboard/dashboard-stats.tsx` | **MATCH** | Same 4 stat cards (Active Contracts, Total Spend, Rebates, Pending Alerts). Same icons: `FileSignature`, `DollarSign`, `TrendingUp`, `AlertTriangle`. Same `ArrowUpRight`/`ArrowDownRight` trend indicators. Same secondary value row for on-contract and collected. Production refactored to use shared `MetricCard` component + framer-motion. Props: v0 fetches data internally; production receives pre-computed `stats` object (server-driven). Loading skeleton preserved in MetricCard. |
| `dashboard-charts` | `components/dashboard/dashboard-charts.tsx` | `components/facility/dashboard/total-spend-chart.tsx`, `spend-by-vendor-chart.tsx`, `spend-by-category-chart.tsx` | **MATCH** | v0 had one monolithic component with 3 charts (LineChart, BarChart, PieChart). Production split into 3 focused components. All 3 chart types preserved: same recharts components, same colors (`#10b981`), same `COLORS` array for pie, same icons (`TrendingUp`, `Building2`, `Tag`). Same empty states with matching copy. Same formatCurrency helper. Production adds `chartTooltipStyle` for consistent theming. |
| `dashboard-filters` | `components/dashboard/dashboard-filters.tsx` | `components/facility/dashboard/dashboard-filters.tsx` | **MATCH** | Same JSX structure: Calendar popover with presets sidebar, Facility select, Vendor select, Contract Type select, active filters Badge with clear button. Same icons: `CalendarIcon`, `X`, `Filter`. Same preset ranges. Same vendor/contract-type lists. Props: v0 used optional `DateRange`; production uses required `DateRange` with ISO strings instead of Date objects. Facilities: v0 loaded from localStorage; production has TODO to fetch from server (currently empty array). |
| `recent-contracts` | `components/dashboard/recent-contracts.tsx` | `components/facility/dashboard/recent-contracts.tsx` | **MATCH** | Same card layout, same table columns (Contract, Vendor, Type, Status, Expires). Same empty state with "Create your first contract" CTA. Same `ArrowRight` icon for "View all". Same `typeLabels` map. Production uses Prisma `Contract` type + shared `StatusBadge` and `formatDate` instead of manual status colors. |
| `recent-alerts` | `components/dashboard/recent-alerts.tsx` | `components/facility/dashboard/recent-alerts.tsx` | **MATCH** | Same card layout, same ScrollArea h-[350px], same alert item structure (icon + title + badge + description + time). Same icons pattern (type-specific icons). Same `formatDistanceToNow`. Production uses Prisma `Alert` type, shared `alertTypeIconConfig`, and receives data as props. Added empty state ("No active alerts") that v0 lacked. |

---

## Contract Components

| Component | v0 Path | Production Path | Status | Notes |
|-----------|---------|-----------------|--------|-------|
| `contract-pdf-upload` | `components/contracts/contract-pdf-upload.tsx` | `components/contracts/ai-extract-dialog.tsx` + `components/contracts/document-upload.tsx` | **PARTIAL** | v0 had a monolithic multi-doc upload with review step, inline preview, and tabs for contract/pricing/amendment. Production split into: (1) `ai-extract-dialog.tsx` -- PDF upload + AI extraction with progress steps (Upload, Reading, Structuring) using real `/api/ai/extract-contract` endpoint; (2) `document-upload.tsx` -- simple dialog for uploading docs to S3 with doc-type selector. The multi-document queue/classification from v0 moved to `components/import/mass-upload.tsx`. Missing: inline preview/review step within the single-doc upload flow (production uses `AIExtractReview` as a separate step). |
| `contract-terms-entry` | `components/contracts/contract-terms-entry.tsx` | `components/contracts/contract-terms-entry.tsx` | **MATCH** | Same term type selector with icons and descriptions. Same term types: spend_rebate, volume_rebate, price_reduction, market_share, etc. Production adds capitated types and growth_rebate. Same tier entry structure. Production uses shared `Field` component, `DefinitionTooltip`, dedicated `ContractTierRow` component, and Accordion instead of Collapsible. Same icons: `Plus`, `Trash2`, `DollarSign`, `Percent`, `TrendingUp`, `PieChart`, `BarChart3`. |
| `contract-score-badge` | `components/contracts/contract-score-badge.tsx` | `components/contracts/ai-score-page.tsx` + `components/facility/contracts/contract-score-client.tsx` | **PARTIAL** | v0 had `ContractScoreBadge`, `ContractScoreInline`, `SimpleContractScoreBadge` with client-side score calculation (weighted composite: rebateEfficiency, tierProgress, marketShare, pricePerformance, compliance). Production replaced with AI-powered scoring via `/api/ai/score-deal` endpoint using `DealScoreRadar` visualization. The inline badge components (`ContractScoreBadge`, `SimpleContractScoreBadge`) do NOT exist in production -- scores are shown on a dedicated page instead. Missing: quick inline badge for contract tables. |
| `contract-transactions` | `components/contracts/contract-transactions.tsx` | `components/contracts/contract-transactions.tsx` | **PARTIAL** | v0 had full financial ledger with 3 summary cards (Rebates, Credits, Payments), tabs to filter by type, AddTransactionDialog with type selector grid, approve/reject workflow for vendor submissions. Production reimplemented as a period-based view using `getContractPeriods` server action with TanStack Query. Shows period table (start, end, spend, rebate earned, collected, tier). Missing from production: Credits/Payments as separate types, the AddTransactionDialog, approve/reject workflow, transaction-level CRUD. |
| `ai-contract-description` | `components/contracts/ai-contract-description.tsx` | `components/contracts/ai-text-extract.tsx` | **MATCH** | Same concept: free-text textarea with AI extraction. Same icons: `Sparkles`, `Loader2`, `Wand2`, `CheckCircle2`, `Info`. Same example prompts pattern (clickable badges). v0 used client-side regex parsing; production uses real AI endpoint (`/api/ai/extract-contract`). Production adds a review step via `AIExtractReview` component. Same success/error feedback pattern. |
| `amendment-extractor` | `components/contracts/amendment-extractor.tsx` | `components/contracts/amendment-extractor.tsx` | **PARTIAL** | v0 had file upload + simulated AI extraction with progress, confidence indicator, diff view for term/pricing changes, validation questions with RadioGroup/Select/Input. Production reimplemented as a Dialog with real AI endpoint (`/api/ai/extract-amendment`), step-based progress (Upload, Reading, Extracting, Comparing), and diff table for changes with `Plus`/`Minus`/`RefreshCw` icons per change. Missing from production: validation questions step, confidence badge. Present in both: file upload, progress bar, change review table. |
| `definition-tooltip` | `components/contracts/definition-tooltip.tsx` | `components/shared/definition-tooltip.tsx` | **PARTIAL** | v0 had rich tooltips with multiple variants (`icon`, `inline`, `badge`), formula display, examples, pros/cons, notes, and pre-built helpers (`ContractTypeInfo`, `RebateTypeInfo`, etc.), plus a `ContractDefinitionsPanel`. Production simplified to a single variant: `TooltipProvider` + `Tooltip` wrapping children with `border-b border-dotted` styling, pulling definitions from `CONTRACT_DEFINITIONS`. Missing: `icon`/`badge` variants, formula/examples/pros-cons display, pre-built helpers, full definitions panel. |

---

## COG Components

| Component | v0 Path | Production Path | Status | Notes |
|-----------|---------|-----------------|--------|-------|
| `cog-importer` | `components/cog/cog-importer.tsx` | `components/facility/cog/cog-import-dialog.tsx` | **PARTIAL** | v0 had inline wizard with file upload, column mapping, preview, vendor matching, duplicate validation, facility selector. Production reimplemented as a Dialog using dedicated sub-components: `FileDropzone`, `COGColumnMapper`, `COGImportPreview`, plus hooks `useCOGImport`, `useFileParser`. Same flow preserved (upload -> map -> preview -> import). Production adds real S3 upload, server-side vendor matching via `matchVendorByAlias`, server-side duplicate check via `checkCOGDuplicates`. |
| `cog-csv-upload` | `components/cog/cog-csv-upload.tsx` | `components/facility/cog/file-dropzone.tsx` + `cog-column-mapper.tsx` | **MATCH** | v0's `cog-csv-upload.tsx` was just a re-export of `cog-importer`. Production has dedicated `FileDropzone` for file selection and `COGColumnMapper` for column mapping. Functionally equivalent. |
| `vendor-name-matcher` | `components/cog/vendor-name-matcher.tsx` | `components/facility/cog/vendor-name-matcher.tsx` | **MATCH** | Same Dialog-based UI with vendor matching. Both use: Dialog, Badge, Input, ScrollArea, Select, `CheckCircle2`, `AlertTriangle`, `Plus`, `Search`. v0 used client-side Levenshtein matching against hardcoded vendor list. Production uses `findBestMatches` utility with server-fetched vendor list. Same `VendorMapping` interface pattern. |
| `duplicate-validator` | `components/cog/duplicate-validator.tsx` | `components/facility/cog/duplicate-validator.tsx` | **MATCH** | Same Dialog-based duplicate resolution UI with Table, Badge, ScrollArea, `AlertTriangle`, `CheckCircle2`, `FileWarning`. v0 had resolution options (keep existing, use new, keep both) per duplicate group. Production has same pattern with `skip`, `overwrite`, `keep_both` resolutions. Production uses server-side `DuplicateMatch` types. |

---

## Import Components

| Component | v0 Path | Production Path | Status | Notes |
|-----------|---------|-----------------|--------|-------|
| `mass-upload` | `components/import/mass-upload.tsx` | `components/import/mass-upload.tsx` | **PARTIAL** | v0 had multi-file upload with AI classification, drag-and-drop, file queue with type badges, classification options (contract, pricing, COG, invoice, amendment), review before import. Production reimplemented as a Dialog with real AI classification via `/api/ai/classify-document`, S3 uploads, and `FileClassificationCard` sub-component. Same concept but production has proper server integration. |
| `contract-import-modal` | `components/import/contract-import-modal.tsx` | N/A | **MISSING** | v0 had a dedicated contract import dialog with zod schema validation, multi-step wizard (upload -> AI extract -> review -> import), integrated `MassUpload`. Production handles contract creation through `components/contracts/new-contract-client.tsx` with `AIExtractDialog` + `ContractForm`. The dedicated bulk import modal for contracts does not exist as a separate component. |
| `vendor-matcher` | `components/import/vendor-matcher.tsx` | N/A | **MISSING** | v0 had a general-purpose vendor matching dialog (separate from the COG-specific one) with `Building2`, `Link2`, `HelpCircle`, `Tooltip`, table-based matching UI, search, and "create new vendor" flow. Production has vendor matching only within the COG import flow (`components/facility/cog/vendor-name-matcher.tsx`). No standalone reusable vendor matcher for general imports. |

---

## Case Costing Components

| Component | v0 Path | Production Path | Status | Notes |
|-----------|---------|-----------------|--------|-------|
| `payor-contracts-manager` | `components/case-costing/payor-contracts-manager.tsx` | `components/facility/case-costing/payor-contracts-manager.tsx` | **MATCH** | Same component: Tabs-based UI for managing payor contracts, Dialog for add/edit, Table with contract details, icons (`Upload`, `FileText`, `DollarSign`, `Building2`, `Calendar`, `Trash2`, `Eye`, `Plus`, `Sparkles`, `Loader2`, `CheckCircle2`). Production uses same structure with proper server integration. |
| `ai-supply-matcher` | `components/case-costing/ai-supply-matcher.tsx` | `components/facility/case-costing/ai-supply-match.tsx` | **PARTIAL** | v0 had batch matching for all supplies with progress bar, summary stats (matched/unmatched/rate), results table. Production reimplemented as single-item matcher using real `/api/ai/match-supplies` endpoint with TanStack Query `useMutation`. Same concept, different scope (batch vs. per-item). Same icons: `Sparkles`, `Loader2`, `Check`. |
| `case-costing-explainer` | `components/case-costing/case-costing-explainer.tsx` | `components/facility/case-costing/case-costing-explainer.tsx` | **PARTIAL** | v0 had a collapsible explainer with data summary (totalCases, totalSurgeons, totalSpend, onContractPercent) that showed compact summary when data exists, full explainer when no data. Production redesigned as a dismissible educational panel with 4 sections (Supply Cost vs Purchase Cost, Rebate Contribution, Margin Calculation, On-Contract vs Off-Contract), using `localStorage` persistence. Different icons (`HelpCircle`, `DollarSign`, `PiggyBank`, `TrendingUp`, `Shield`). No data-dependent compact/expanded modes. |

---

## Chart Components

| Component | v0 Path | Production Path | Status | Notes |
|-----------|---------|-----------------|--------|-------|
| `forecast-chart` | `components/charts/forecast-chart.tsx` | `components/facility/analysis/forecast-chart.tsx` | **PARTIAL** | v0 used `ComposedChart` with Bar + Line + Area for confidence interval, subscription tier gating, `TrendingUp`/`TrendingDown`/`Sparkles`/`Lock` icons, toggle switches for confidence interval. Production uses `AreaChart` with Area + Line, `ReferenceLine` for boundary, shared `ChartCard` wrapper. Takes a `ForecastResult` from server action instead of client-side `generateForecast`. Missing: subscription tier gating, toggle switches, bar rendering mode. |
| `forecast-table` | `components/charts/forecast-table.tsx` | `components/facility/analysis/forecast-table.tsx` | **MATCH** | Same Table structure with period rows showing actual vs forecast values, trend icons (`TrendingUp`, `TrendingDown`, `Minus`), totals footer. v0 had subscription-tier gating; production removed that. Production takes `ForecastResult` type from server action, adds empty state message. |

---

## Vendor Components

| Component | v0 Path | Production Path | Status | Notes |
|-----------|---------|-----------------|--------|-------|
| `scalable-facility-selector` | `components/vendor/scalable-facility-selector.tsx` | `components/vendor/prospective/builder/facility-selector.tsx` | **PARTIAL** | v0 had a standalone facility picker with search, region/state/type filtering, checkbox multi-select, summary badges, 250 mock facilities. Production has a more focused `FacilitySelector` embedded in the proposal builder flow, using `allFacilities` prop, checkbox selection, and add-new-facility capability. Missing: region/state/type filtering, mock data generation, standalone reusable component. |
| `vendor-shell` | `components/vendor/vendor-shell.tsx` | `app/vendor/layout.tsx` + `components/shared/shells/portal-shell.tsx` | **MATCH** | v0 had a client-side shell with sidebar nav, mobile sheet, user dropdown, theme toggle, alert badge, vendor role switching. Production uses a shared `PortalShell` component (server-rendered layout) with `role="vendor"`, `vendorNav` from constants, and server-fetched alert count. Same nav items pattern, proper auth via `requireVendor()`. |

---

## Missing Components (Action Required)

| # | Component | Impact | Recommendation |
|---|-----------|--------|----------------|
| 1 | `ContractScoreBadge` / `SimpleContractScoreBadge` (inline) | No quick score visibility in contract tables | Create a lightweight badge that reads from the AI score cache or shows a computed fallback score |
| 2 | `contract-import-modal` | No dedicated bulk contract import from files | Consider adding bulk import flow to `mass-upload.tsx` with contract-specific post-classification handling |
| 3 | `vendor-matcher` (standalone) | No reusable vendor matching outside COG imports | Extract COG vendor-name-matcher into a shared component that can be used in import flows |

## Partial Components (Review Recommended)

| # | Component | Key Gaps |
|---|-----------|----------|
| 1 | `contract-transactions` | Missing: credits/payments as separate types, AddTransactionDialog, approve/reject workflow |
| 2 | `definition-tooltip` | Missing: icon/badge/inline variants, formula display, pros/cons, pre-built type helpers |
| 3 | `amendment-extractor` | Missing: validation questions step, confidence badge |
| 4 | `ai-supply-matcher` | Missing: batch matching mode (production is per-item only) |
| 5 | `case-costing-explainer` | Missing: data-dependent compact/expanded mode |
| 6 | `forecast-chart` | Missing: subscription tier gating, toggle switches, bar rendering |
| 7 | `scalable-facility-selector` | Missing: region/state/type filtering, standalone reusable form |
| 8 | `contract-pdf-upload` | Missing: inline preview within upload flow |
| 9 | `mass-upload` | Structurally different but functionally equivalent with real AI |
