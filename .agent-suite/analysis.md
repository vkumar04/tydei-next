# App Analysis: TYDEi Platform

## Overview
TYDEi Platform is a comprehensive healthcare contract management SaaS application designed for facilities (hospitals, ASCs, surgery centers) and medical device/supply vendors. It provides a dual-portal architecture where facilities track vendor contracts, rebate tiers, cost-of-goods data, case costing, and invoice validation, while vendors manage their own contracts, submit proposals, track performance, and maintain market share compliance. The platform also includes an operator/admin portal for managing tenants (facilities and vendors), users, and billing. An AI agent (chat) is embedded in both facility and vendor portals for natural-language contract queries.

## Source
- **Platform:** v0.dev (downloaded project)
- **Location:** `/Users/vickkumar/Downloads/b_FtKM0pV2dZE-1775131904894/`
- **Analyzed on:** 2026-04-01
- **Tool:** Vinci (Analyzer Agent) -- local file analysis of v0 source code

## Target Users
- **Primary:** Healthcare facility supply chain managers and materials management staff who need to track vendor contracts, calculate rebates, validate invoices, and analyze cost of goods
- **Secondary:** Medical device/supply vendor sales representatives and account managers who need to submit contracts, track performance, and manage proposals across multiple facilities
- **Tertiary:** Platform operators/admins managing multi-tenant facility and vendor onboarding, billing, and user administration

---

## Pages & Routes

### Landing Page (Marketing)
- **Route:** `/`
- **Layout:** Standalone (no sidebar), public
- **Description:** Marketing landing page with hero section, value props ("Make Your Vendors Manage Your Contracts"), feature grid, capabilities section, CTA, and footer
- **Components:** ThemeToggle, hero stats, feature cards (6 features), capabilities section, contract performance preview card
- **Actions:** Links to `/auth/login`, `/auth/sign-up`, `/dashboard` (Facility Portal), `/vendor` (Vendor Portal)

### Auth Pages
- **Route:** `/auth/login` -- Login form with email/password, demo credentials (demo@tydei.com / vendor@tydei.com), Supabase auth
- **Route:** `/auth/sign-up` -- Sign-up form with email, password, full name, role selector (facility/vendor), Supabase auth
- **Route:** `/auth/sign-up-success` -- Success confirmation page
- **Route:** `/auth/error` -- Auth error page
- **Layout:** Standalone, public
- **Data:** Demo credentials bypass Supabase; sets cookie `demo_session=true`

### Facility Dashboard Layout
- **Route:** `/dashboard/*`
- **Layout:** `DashboardShell` -- collapsible sidebar with nav, top bar with user menu, theme toggle, mass upload dialog, facility identity selector, alert bell with count
- **Auth:** Supabase auth check; redirects vendors to `/vendor`; demo mode fallback
- **Nav Items:**
  1. Dashboard (`/dashboard`)
  2. Contracts (`/dashboard/contracts`)
  3. Renewals (`/dashboard/contract-renewals`)
  4. Rebate Optimizer (`/dashboard/rebate-optimizer`)
  5. Analysis (`/dashboard/analysis`)
  6. COG Data (`/dashboard/cog-data`)
  7. Case Costing (`/dashboard/case-costing`) -- feature flag: caseCostingEnabled
  8. Purchase Orders (`/dashboard/purchase-orders`) -- feature flag: purchaseOrdersEnabled
  9. Invoice Validation (`/dashboard/invoice-validation`)
  10. Reports (`/dashboard/reports`)
  11. Alerts (`/dashboard/alerts`)
  12. AI Agent (`/dashboard/ai-agent`) -- feature flag: aiAgentEnabled
  13. Settings (`/dashboard/settings`)

### Facility Dashboard Page
- **Route:** `/dashboard`
- **Description:** Main dashboard with metrics cards, charts (spend trends, rebate overview), date range filter, recent contracts table, recent alerts list
- **Components:** DashboardMetrics, DashboardCharts, DashboardFilters, RecentContracts, RecentAlerts
- **Data:** Contract data store, COG data store, alert store

### Contracts List
- **Route:** `/dashboard/contracts`
- **Description:** Filterable/searchable table of all contracts with status badges, vendor, type, dates, spend, rebates. Tabs for active/pending/expired. Includes pending vendor submissions.
- **Components:** Table with sort/filter, search, status badges, dropdown actions (view, edit, score)
- **Actions:** Add new contract, view detail, edit, filter by status/vendor/type

### New Contract
- **Route:** `/dashboard/contracts/new`
- **Description:** Multi-step contract creation form with three entry modes: AI (PDF extract), Manual, PDF Upload
- **Form Fields:** contractName, contractId, contractType (usage/capital/service/tie_in/grouped/pricing_only), vendorId, productCategory, effectiveDate, expirationDate, performancePeriod, rebatePayPeriod, description, isMultiFacility, selectedFacilities
- **Components:** ContractPDFUpload, ContractTermsEntry, AIContractDescription, vendor selector with inline add, category selector, facility selector
- **Actions:** Save draft, submit, AI extract from PDF

### Contract Detail
- **Route:** `/dashboard/contracts/[id]`
- **Description:** Placeholder page for contract detail view
- **Route:** `/dashboard/contracts/[id]/edit` -- Edit contract page
- **Route:** `/dashboard/contracts/[id]/terms` -- Contract terms entry/management with tier structures
- **Route:** `/dashboard/contracts/[id]/score` -- AI-powered contract scoring with radar chart, compliance metrics, tier analysis

### COG Data
- **Route:** `/dashboard/cog-data`
- **Description:** Cost of Goods data management. Upload CSV files, view/edit/delete records, pricing file management, vendor name matching, duplicate detection.
- **Components:** COG table with search/filter/sort, CSV upload dialog, vendor name matcher, pricing file viewer, edit dialog, delete confirmation, duplicate validator
- **Data:** COGRecord (poNumber, poDate, inventoryNumber, inventoryDescription, vendorItemNo, vendor, uom, quantity, unitCost, extendedPrice, hasContractPricing, contractPrice, savings, surgeonId, surgeonName, caseNumber)
- **Storage:** IndexedDB for large datasets (overcomes localStorage 5MB limit)
- **Actions:** Upload CSV, manual entry, edit record, delete record, bulk delete, sync pricing data, refresh

### Case Costing
- **Route:** `/dashboard/case-costing`
- **Description:** Surgical case cost analysis. Import case data from clinical systems, link supplies to purchasing data via Vendor Item No, calculate margins with payor reimbursement rates.
- **Sub-routes:**
  - `/dashboard/case-costing/compare` -- Surgeon/procedure comparison
  - `/dashboard/case-costing/reports` -- Case costing reports by CPT code, surgeon, facility
- **Components:** Case table with search/sort, surgeon scorecards (radar chart), CPT analysis table, cost distribution chart, payor contracts manager, AI supply matcher
- **Data:** CaseRecord, CaseSupply, CasePurchase, PayorMix; national reimbursement rates by CPT code; payor contract rates (Anthem sample)
- **Key Feature:** Links clinical system data (supply usage) with purchasing system data (PO/invoices) via Vendor Item No for true margin calculation

### Purchase Orders
- **Route:** `/dashboard/purchase-orders`
- **Description:** Purchase order management. Search products from COG data, create POs, track status. Links to contract pricing for on-contract detection.
- **Components:** PO table, product search, PO create dialog, line item builder
- **Data:** ProductSearchResult from COG and contract data

### Invoice Validation
- **Route:** `/dashboard/invoice-validation`
- **Description:** Compare invoice prices against contract prices. Detect discrepancies, flag overpayments, dispute management.
- **Components:** Invoice table, discrepancy flags, dispute dialog, approval workflow
- **Data:** Links invoices to contracts via vendor item numbers

### Contract Renewals
- **Route:** `/dashboard/contract-renewals`
- **Description:** Track expiring contracts, initiate renewal workflows, set reminders, compare current vs. proposed terms
- **Components:** Renewal pipeline, timeline, dialog for initiating renewal, email notifications

### Rebate Optimizer
- **Route:** `/dashboard/rebate-optimizer`
- **Description:** Identify opportunities to increase rebates. Analyze spend vs. tier thresholds, suggest purchasing adjustments.
- **Components:** Opportunity cards, spend target dialog, optimizer chart

### Analysis (Financial)
- **Route:** `/dashboard/analysis`
- **Description:** Financial analysis for capital contracts. MACRS depreciation schedules, NPV/IRR calculations, price projections with annual decrease assumptions.
- **Sub-routes:**
  - `/dashboard/analysis/prospective` -- Upload vendor proposals, AI deal scoring, pricing comparison against COG data, term analysis
- **Components:** Contract inputs tab, financial analysis tab (depreciation, NPV), projections tab, summary report
- **Data:** Uses COG data for spend trends, contract data for current terms

### Prospective Analysis (Facility Side)
- **Route:** `/dashboard/analysis/prospective`
- **Description:** Facility-side tool to evaluate vendor proposals. Upload pricing files, compare against current COG prices, AI deal scoring, manual entry for what-if analysis.
- **Components:** Proposal upload, pricing comparison table, deal score panel (radar chart), analysis overview

### Reports
- **Route:** `/dashboard/reports`
- **Description:** Contract performance reports by type (Usage, Service, Tie-In). Period-level data for spend, volume, rebates, payments, balances. Includes report scheduling (daily/weekly/monthly email delivery).
- **Sub-routes:**
  - `/dashboard/reports/price-discrepancy` -- Price discrepancy analysis comparing invoice vs. contract prices
- **Components:** Report type tabs, period data tables, trend charts, schedule dialog, export button
- **Data:** Usage report (spend, volume, rebateEarned, rebateCollected), Service report (paymentExpected/Actual, balanceExpected/Actual), Tie-In report (spendTarget/Actual, volumeTarget/Actual)

### Alerts
- **Route:** `/dashboard/alerts`
- **Route:** `/dashboard/alerts/[id]` -- Alert detail
- **Description:** Alert management with tabs for active/resolved. Alert types: off_contract, expiring_contract, tier_threshold, rebate_due, pricing_error.
- **Components:** Alert cards with priority badges, resolve/dismiss actions, bulk operations, filter by type
- **Data:** Alert store with localStorage persistence, cross-tab sync

### AI Agent
- **Route:** `/dashboard/ai-agent`
- **Description:** AI chat assistant for contract queries. Uses Vercel AI SDK with tool calling for contract analysis, market share, rebate calculations.
- **Components:** Chat interface, suggested questions, credit indicator
- **API:** `/api/ai-agent` -- streamText with tools: analyzeContractPerformance, getMarketShareAnalysis

### Settings
- **Route:** `/dashboard/settings`
- **Description:** User profile, notification preferences, facility management, team members, billing, feature flags, AI credits, connections (vendor invites).
- **Components:** Tabs for profile, notifications, facilities, members, billing, features, AI credits, connections

---

### Vendor Portal Layout
- **Route:** `/vendor/*`
- **Layout:** `VendorShell` -- sidebar with nav, vendor identity selector, role-based nav filtering (admin/manager/rep permissions)
- **Auth:** Supabase auth; redirects non-vendors to `/dashboard`; demo mode fallback
- **Nav Items:**
  1. Dashboard (`/vendor`)
  2. My Contracts (`/vendor/contracts`)
  3. Renewals (`/vendor/renewals`)
  4. Prospective (`/vendor/prospective`)
  5. Market Share (`/vendor/market-share`)
  6. Performance (`/vendor/performance`)
  7. Purchase Orders (`/vendor/purchase-orders`)
  8. Invoices (`/vendor/invoices`)
  9. Alerts (`/vendor/alerts`)
  10. Reports (`/vendor/reports`)
  11. AI Assistant (`/vendor/ai-agent`)
  12. Settings (`/vendor/settings`)

### Vendor Dashboard
- **Route:** `/vendor`
- **Description:** Vendor overview showing aggregate metrics (active contracts, total spend, market share, rebates paid), spend trend chart, market share by category chart, contract status breakdown, recent contracts list
- **Components:** Metric cards, LineChart (spend trend), BarChart (market share by category), contract status card, recent contracts
- **Data:** Filters COG data and contracts by vendor identity

### Vendor Contracts
- **Route:** `/vendor/contracts`
- **Description:** All contracts for this vendor across facilities. Tabs for active, pending (submitted for review), expired. Includes submission tracking.
- **Route:** `/vendor/contracts/new` -- Submit new contract proposal with facility selection, terms entry, pricing file upload
- **Route:** `/vendor/contracts/[id]` -- Contract detail view
- **Route:** `/vendor/contracts/[id]/edit` -- Edit submitted contract
- **Route:** `/vendor/contracts/pending/[id]/edit` -- Edit pending contract revision
- **Components:** Contract table, submission form (ContractTermsEntry, AIContractDescription, ScalableFacilitySelector), pricing file upload, status tracking

### Vendor Prospective
- **Route:** `/vendor/prospective`
- **Description:** Vendor-side proposal management. Build proposals with pricing files, usage history, deal analysis. Multi-facility support, grouped proposals. AI-powered pricing analysis.
- **Components:** Proposal builder, pricing file parser, usage history viewer, deal score, facility selector

### Vendor Market Share
- **Route:** `/vendor/market-share`
- **Description:** Market share analysis by category and facility. AI-detected similar categories for merging. Trend charts, pie charts, facility breakdown.
- **Components:** Market share charts (bar, line, pie), category merge suggestions, facility filter

### Vendor Performance
- **Route:** `/vendor/performance`
- **Description:** Vendor performance dashboard with radar chart, KPI metrics (delivery, quality, pricing, compliance), trend analysis.
- **Components:** Radar chart, performance metrics table, trend charts (area, line)

### Vendor Renewals
- **Route:** `/vendor/renewals`
- **Description:** Track upcoming contract renewals, initiate renewal discussions, view renewal pipeline
- **Components:** Renewal pipeline, timeline, initiate dialog

### Vendor Purchase Orders
- **Route:** `/vendor/purchase-orders`
- **Description:** View purchase orders related to this vendor across facilities
- **Components:** PO table, filter by facility/status

### Vendor Invoices
- **Route:** `/vendor/invoices`
- **Description:** Invoice management for vendor. Create, submit, track payment status.
- **Components:** Invoice table, create dialog, status tracking, payment progress

### Vendor Alerts
- **Route:** `/vendor/alerts`
- **Description:** Vendor-specific alerts: contract expiry, compliance warnings, rebate thresholds
- **Components:** Alert cards with severity badges, action links

### Vendor Reports
- **Route:** `/vendor/reports`
- **Description:** Vendor reporting on contract performance, spend tracking, rebate summaries
- **Components:** Report table, export dialog

### Vendor AI Agent
- **Route:** `/vendor/ai-agent`
- **Description:** AI chat for vendor queries about contracts, performance, pricing
- **Components:** Same chat interface as facility, vendor-contextualized

### Vendor Settings
- **Route:** `/vendor/settings`
- **Description:** Vendor profile, team management, notification preferences
- **Components:** Profile form, team table, notification toggles

---

### Admin Portal Layout
- **Route:** `/admin/*`
- **Layout:** Sidebar with admin nav (Dashboard, Facilities, Payor Contracts, Vendors, Users, Billing, Analytics, Settings)
- **Auth:** Client-side only (no server auth check in v0)
- **Nav Items:**
  1. Dashboard (`/admin`)
  2. Facilities (`/admin/facilities`)
  3. Payor Contracts (`/admin/payor-contracts`)
  4. Vendors (`/admin/vendors`)
  5. Users (`/admin/users`)
  6. Billing (`/admin/billing`)
  7. Analytics (`/admin/analytics`) -- defined in nav but no page file
  8. Settings (`/admin/settings`) -- defined in nav but no page file

### Admin Dashboard
- **Route:** `/admin`
- **Description:** Platform-wide stats (facilities, vendors, users, MRR), pending actions, quick actions, recent activity feed, platform performance metrics

### Admin Facilities
- **Route:** `/admin/facilities`
- **Description:** Manage facilities. CRUD operations, status management.
- **Components:** Table, add/edit dialog

### Admin Payor Contracts
- **Route:** `/admin/payor-contracts`
- **Description:** Manage payor contracts (Anthem, BCBS, etc.) with CPT code rates, grouper rates, multi-procedure rules, implant passthrough settings

### Admin Vendors
- **Route:** `/admin/vendors`
- **Description:** Manage vendors. CRUD operations, activation/deactivation.

### Admin Users
- **Route:** `/admin/users`
- **Description:** User management with role assignment, facility/vendor association, bulk operations

### Admin Billing
- **Route:** `/admin/billing`
- **Description:** Subscription management, invoice history, MRR tracking

---

### API Routes
- `/api/ai-agent` -- AI chat with tool calling (contract analysis, market share)
- `/api/parse-contract-pdf` -- AI extraction of contract terms from PDF
- `/api/parse-cog-csv` -- Parse COG CSV files
- `/api/match-supplies` -- AI supply matching for case costing
- `/api/analyze-deal` -- AI deal analysis for proposals
- `/api/extract-payor-contract` -- Extract payor contract rates from PDF
- `/api/cog-parser` -- COG data parsing
- `/api/import/contract-pdf` -- Import contract from PDF
- `/api/import/cog-csv` -- Import COG from CSV

### Utility Pages
- `/force-clear` -- Force clear localStorage/IndexedDB
- `/clear-cog` -- Clear COG data from IndexedDB

---

## Data Models

### Contract
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique identifier |
| name | string | yes | Contract display name |
| contractId | string | yes | External contract ID |
| vendor | string | yes | Vendor name |
| vendorId | string | yes | Vendor reference |
| type | 'usage' \| 'pricing_only' \| 'capital' \| 'tie_in' \| 'grouped' | yes | Contract type |
| status | 'active' \| 'expiring' \| 'expired' \| 'pending' | yes | Current status |
| effectiveDate | string (date) | yes | Start date |
| expirationDate | string (date) | yes | End date |
| totalValue | number | yes | Total contract value |
| rebateEarned | number | yes | Rebates earned to date |
| currentSpend | number | yes | Current period spend |
| rebatesCollected | number | yes | Rebates collected |
| currentTier | number | yes | Current rebate tier |
| maxTier | number | yes | Max available tier |
| marketShareCommitment | number | yes | Market share % target |
| currentMarketShare | number | yes | Current market share % |
| complianceRate | number | yes | Compliance rate % |
| productCategory | string | yes | Product category name |
| commitmentThreshold | number | yes | Min spend for eligibility |
| pricingData | PricingItem[] | no | Line-item pricing |
| rebateTiers | RebateTier[] | no | Tier structure |
| terms | ContractTerm[] | no | Contract terms |
| documents | ContractDocument[] | no | Uploaded documents |
| facilities | string[] | no | Associated facilities |

### COGRecord
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique identifier |
| poNumber | string | yes | Purchase order number |
| poDate | string (date) | yes | PO date |
| inventoryNumber | string | yes | Facility inventory number |
| inventoryDescription | string | yes | Product description |
| vendorItemNo | string | yes | Vendor catalog number (key linking field) |
| vendor | string | yes | Vendor name |
| uom | string | yes | Unit of measure |
| quantity | number | yes | Quantity ordered |
| unitCost | number | yes | Per-unit cost |
| extendedPrice | number | yes | Total line cost |
| hasContractPricing | boolean | yes | Whether contract price found |
| contractPrice | number | no | Contract price if matched |
| savings | number | yes | Savings vs. contract price |
| surgeonId | string | no | Linked surgeon |
| surgeonName | string | no | Surgeon name |
| caseNumber | string | no | Case number link |
| contractId | string | no | Matched contract |
| category | string | no | Product category |
| facility | string | no | Facility name |

### CaseRecord
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique identifier |
| caseId | string | yes | Primary key linking all data |
| caseDate | string (date) | yes | Date of surgery |
| surgeonId | string | yes | Surgeon identifier |
| surgeonName | string | yes | Surgeon name |
| procedureCode | string | yes | CPT code |
| procedureDescription | string | yes | Procedure description |
| patientType | 'Inpatient' \| 'Outpatient' \| 'Observation' | yes | Patient type |
| facilityId | string | yes | Facility identifier |
| facilityName | string | yes | Facility name |
| supplies | CaseSupply[] | yes | Clinical supplies used |
| totalSupplyCost | number | yes | Total supply cost (clinical) |
| purchaseData | CasePurchase[] | yes | Purchasing system data |
| totalPurchaseCost | number | yes | Total purchase cost (affects rebates) |
| onContractSpend | number | yes | On-contract portion |
| offContractSpend | number | yes | Off-contract portion |
| rebateContribution | number | yes | Rebate from purchasing only |
| payorMix | PayorMix[] | yes | Payor breakdown |
| totalReimbursement | number | yes | Total reimbursement |
| margin | number | yes | Reimbursement - purchase cost |
| marginPercent | number | yes | Margin percentage |

### PayorContract
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique identifier |
| payorName | string | yes | Insurance company name |
| payorType | 'commercial' \| 'medicare_advantage' \| 'medicaid_managed' \| 'workers_comp' | yes | Payor classification |
| facilityId | string | yes | Facility reference |
| contractNumber | string | yes | Contract number |
| effectiveDate / expirationDate | string (date) | yes | Contract period |
| cptRates | PayorContractRate[] | yes | CPT-specific reimbursement rates |
| grouperRates | PayorContractGrouper[] | yes | Grouper-based rates |
| multiProcedureRule | { primary: number, secondary: number } | yes | Multi-procedure discount rules |
| implantPassthrough | boolean | yes | Whether implants pass through at cost |
| implantMarkup | number | yes | Markup on implant cost |

### PendingContract (Vendor Submission)
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique identifier |
| vendorName | string | yes | Vendor company name |
| vendorId | string | yes | Vendor reference |
| facilityName | string | yes | Target facility |
| facilityId | string | yes | Facility reference |
| contractName | string | yes | Proposed contract name |
| contractType | 'Usage' \| 'Tie-In' \| 'Capital' \| 'Service' \| 'Pricing' | yes | Contract type |
| startDate / endDate | string (date) | yes | Proposed period |
| terms | string | yes | Term description |
| status | 'draft' \| 'pending' \| 'approved' \| 'rejected' \| 'revision_requested' \| 'withdrawn' | yes | Submission status |
| documents | Document[] | yes | Uploaded files |
| pricingData | PricingData | no | Pricing file data |
| rebateTerms | RebateTerms | no | Proposed rebate structure |

### Vendor
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique identifier |
| name | string | yes | Company name |
| displayName | string | no | Display name |
| division | string | no | Division name |
| parentVendorId | string | no | Parent company link |
| source | 'manual' \| 'contract' \| 'pricing_file' \| 'cog' | yes | How vendor was added |
| contactName/Email/Phone | string | no | Contact info |
| isActive | boolean | yes | Active status |

### Alert
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique identifier |
| type | AlertType | yes | off_contract, expiring_contract, tier_threshold, rebate_due, pricing_error, contract_expiry, compliance, rebate |
| title | string | yes | Alert title |
| message | string | yes | Detail message |
| status | 'new' \| 'read' \| 'resolved' \| 'dismissed' | yes | Current status |
| priority | 'high' \| 'medium' \| 'low' | yes | Priority level |
| createdAt | Date | yes | When created |
| metadata | Record | no | Extra context data |
| actionLink | string | no | Link to relevant page |

### ContractChangeProposal
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique identifier |
| contractId | string | yes | Target contract |
| proposalType | 'term_change' \| 'new_term' \| 'remove_term' \| 'contract_edit' | yes | Change type |
| status | 'pending' \| 'approved' \| 'rejected' \| 'revision_requested' | yes | Review status |
| changes | TermChange[] | yes | Proposed changes |
| vendorMessage | string | no | Vendor explanation |

### Additional Entities
- **Facility** (id, name, type, address, status, source, npi, taxId)
- **Category** (id, name, parentId, source, vendorId)
- **Connection** (facility-vendor link with invite workflow)
- **VendorIdentity** (company, division, user context for vendor portal)
- **VendorRoleConfig** (admin/manager/rep permissions)
- **ProductBenchmark** (vendor pricing floors, target margins, GPO fees, market share tiers)
- **FeatureFlags** (purchaseOrders, aiAgent, vendorPortal, advancedReports, caseCosting)
- **CreditTier** (AI credit consumption system with tier pricing)

---

## Enums & Type Unions

| Type | Values |
|------|--------|
| ContractType | usage, pricing_only, capital, tie_in, grouped |
| ContractStatus | active, expiring, expired, pending, draft |
| TermType | spend_rebate, volume_rebate, price_reduction, market_share, market_share_price_reduction, capitated_price_reduction, capitated_pricing_rebate, po_rebate, carve_out, payment_rebate |
| VolumeType | product_category, catalog_cap_based, procedure_code |
| RebateType | percent_of_spend, fixed_rebate, fixed_rebate_per_unit, per_procedure_rebate |
| BaselineType | spend_based, volume_based, growth_based |
| AlertType | off_contract, expiring_contract, tier_threshold, rebate_due, pricing_error, contract_expiry, compliance, rebate |
| AlertStatus | new, read, resolved, dismissed |
| PerformancePeriod | monthly, quarterly, semi_annual, annual |
| UserRole | facility, vendor, admin |
| VendorRole | admin, manager, rep |
| PayorType | commercial, medicare_advantage, medicaid_managed, workers_comp |
| ReportType | contract_performance, rebate_summary, spend_analysis, market_share, case_costing |
| ConnectionStatus | pending, accepted, rejected, expired |

---

## User Flows

### 1. Contract Creation (Facility)
1. Navigate to `/dashboard/contracts/new`
2. Choose entry mode: AI (PDF extract), Manual, or PDF Upload
3. For AI mode: upload contract PDF, AI extracts terms via `/api/parse-contract-pdf`
4. Fill/review: contract name, type, vendor, category, dates, performance period
5. Enter contract terms (tier structures, rebate types, baselines)
6. Optionally upload pricing file
7. Save as draft or submit

### 2. Contract Submission (Vendor)
1. Navigate to `/vendor/contracts/new`
2. Select target facility/facilities (ScalableFacilitySelector)
3. Enter contract details: name, type, dates, terms
4. Upload pricing file with line items
5. Define rebate tiers
6. Submit for facility review (status: pending)
7. Facility approves/rejects/requests revision at `/dashboard/contracts`

### 3. COG Data Import
1. Navigate to `/dashboard/cog-data`
2. Click Upload CSV
3. System parses CSV, maps columns, detects vendors
4. Vendor name matcher resolves vendor aliases
5. Duplicate validator checks for existing records
6. Records saved to IndexedDB
7. Pricing data from contracts auto-matched to COG records

### 4. Case Costing Analysis
1. Import clinical data files (case procedures, supply fields, patient fields)
2. System links clinical supplies to purchasing data via Vendor Item No
3. Payor contract rates applied for reimbursement calculation
4. Surgeon scorecards generated (radar chart: payor mix, cost, time, compliance)
5. Margin analysis: reimbursement - purchase cost
6. Compare surgeons/procedures at `/dashboard/case-costing/compare`
7. Generate reports at `/dashboard/case-costing/reports`

### 5. Vendor Prospective Proposal
1. Vendor navigates to `/vendor/prospective`
2. Build proposal: select facilities, upload pricing file, define terms
3. System provides deal score analysis
4. Submit proposal to facility
5. Facility evaluates at `/dashboard/analysis/prospective`
6. Facility compares proposed pricing against current COG data

### 6. Invoice Validation
1. Navigate to `/dashboard/invoice-validation`
2. Import or create invoices
3. System compares invoice prices against contract prices
4. Discrepancies flagged with severity
5. Dispute workflow for resolution

### 7. Rebate Optimization
1. Navigate to `/dashboard/rebate-optimizer`
2. System analyzes current spend vs. tier thresholds
3. Identifies contracts where small spend increases unlock higher tiers
4. Prioritizes opportunities by ROI
5. Tracks progress toward targets

### 8. Alert Management
1. System generates alerts (off-contract purchases, expiring contracts, tier thresholds)
2. Alerts appear in bell icon count and alerts page
3. User can resolve, dismiss, or take action
4. State persists via localStorage with cross-tab sync

---

## Feature List

### MVP Features (Core)
1. **Contract Management** -- CRUD for contracts with types (usage, capital, service, tie-in, grouped, pricing)
2. **Contract Term Entry** -- Multi-tier rebate structures with baselines, spend ranges, market share
3. **COG Data Management** -- CSV import, IndexedDB storage, vendor matching, pricing file linking
4. **Dashboard Analytics** -- Metrics cards, spend/rebate charts, contract lifecycle overview
5. **Alert System** -- Off-contract, expiring, tier threshold, rebate due alerts
6. **Vendor Portal** -- Separate portal for vendors with filtered data access
7. **Vendor Contract Submission** -- Vendors submit contracts for facility review
8. **Dual Portal Auth** -- Role-based access (facility vs. vendor) with Supabase
9. **Reports** -- Usage, Service, Tie-In reports with period data and scheduling
10. **Settings** -- User profile, notifications, facility management, feature flags

### MVP Features (Advanced)
11. **Case Costing** -- Surgical case analysis with CPT codes, payor rates, margin calculation
12. **AI PDF Extract** -- Extract contract terms from uploaded PDFs
13. **AI Chat Agent** -- Natural language contract queries with tool calling
14. **Prospective Analysis** -- Evaluate vendor proposals with deal scoring
15. **Invoice Validation** -- Compare invoice vs. contract prices
16. **Purchase Orders** -- PO creation with product search from COG data
17. **Rebate Optimizer** -- Identify tier upgrade opportunities
18. **Contract Renewals** -- Track and manage expiring contracts
19. **Price Discrepancy Reports** -- Flag and track pricing inconsistencies

### Future Features
20. **Admin Portal** -- Multi-tenant management (facilities, vendors, users, billing)
21. **Payor Contract Management** -- CPT rate management for reimbursement analysis
22. **Vendor Benchmarks** -- Pricing floors, target margins, GPO fee tracking
23. **Market Share Analysis** -- Category-level market share with AI category merging
24. **Vendor Performance** -- Radar chart KPIs (delivery, quality, pricing, compliance)
25. **Connection System** -- Facility-vendor invite and linking
26. **AI Credits** -- Consumption-based AI feature billing
27. **Mass Upload** -- Bulk document import with queue processing
28. **Contract Change Proposals** -- Vendor-initiated term change requests with review workflow

---

## Authentication & Authorization

### Auth Provider
- **Supabase Auth** with email/password
- Demo mode bypass with cookie-based session (`demo_session=true`)
- Demo credentials: `demo@tydei.com` / `demo123` (facility), `vendor@tydei.com` / `vendor123` (vendor)

### Role System
| Role | Portal | Access |
|------|--------|--------|
| facility | `/dashboard/*` | Full COG, pricing, contracts, case costing, reports |
| vendor | `/vendor/*` | Own contracts, filtered market share, no competitor pricing |
| admin | `/admin/*` | All facilities, vendors, users, billing, platform config |

### Vendor Sub-Roles
| Role | Permissions |
|------|-------------|
| admin | All vendor features + team management |
| manager | View/submit contracts, POs, market share, performance, reports, AI |
| rep | View dashboard, contracts, POs, alerts only |

### Middleware
- Supabase session refresh middleware on all routes
- Dashboard layout: server-side auth check, redirect to login if unauthenticated
- Vendor layout: redirect non-vendors to dashboard

---

## Integrations

| Integration | Purpose | Status |
|-------------|---------|--------|
| Supabase | Auth, database (v0 uses localStorage) | Configured but optional |
| Vercel AI SDK | AI chat, tool calling | Active |
| OpenAI (via AI SDK) | PDF extraction, deal analysis, contract descriptions | Active |
| Vercel Analytics | Page view tracking | Active |
| IndexedDB | Large dataset storage (COG records) | Active |
| localStorage | State persistence for stores | Active |
| Recharts | Charts (bar, line, pie, radar, area, composed) | Active |
| react-dropzone | File upload drag-and-drop | Active |
| date-fns | Date formatting and calculations | Active |
| sonner | Toast notifications | Active |
| zustand | State management (payor contracts, facilities) | Active |

---

## Theme & Design Preferences

### Color System (oklch)
- **Primary (Light):** Deep teal `oklch(0.45 0.12 195)` -- trustworthy healthcare feel
- **Primary (Dark):** Bright teal `oklch(0.72 0.16 175)`
- **Accent (Light):** Vibrant blue `oklch(0.58 0.18 255)`
- **Accent (Dark):** Electric blue `oklch(0.68 0.18 250)`
- **Background (Light):** Near white `oklch(0.99 0.002 250)`
- **Background (Dark):** Deep navy `oklch(0.12 0.01 250)`
- **Sidebar:** Slate dark `oklch(0.16 0.015 250)` with teal accents
- **Semantic:** success (green), warning (amber), info (blue), destructive (red)
- **Chart palette:** 8 distinct colors for data visualization

### Design Tokens
- **Border radius:** `0.625rem` (10px)
- **Font:** Inter (variable, sans-serif)
- **Dark mode:** System preference with manual toggle
- **Sidebar:** Always dark (independent of page theme)

### Component Library
- **shadcn/ui** components throughout
- Custom Field/FieldGroup/FieldLabel components
- Custom Empty state component
- Sonner for toasts (top-right, rich colors)

---

## Navigation Structure

```
/                           -- Landing page (public)
/auth/login                 -- Login (public)
/auth/sign-up               -- Sign up (public)
/auth/sign-up-success       -- Success (public)
/auth/error                 -- Error (public)

/dashboard                  -- Facility dashboard (authenticated, facility role)
  /contracts                -- Contract list
    /new                    -- New contract
    /[id]                   -- Contract detail
    /[id]/edit              -- Edit contract
    /[id]/terms             -- Terms management
    /[id]/score             -- AI scoring
  /contract-renewals        -- Renewal management
  /rebate-optimizer         -- Rebate optimization
  /analysis                 -- Financial analysis
    /prospective            -- Proposal evaluation
  /cog-data                 -- COG data management
  /case-costing             -- Case cost analysis
    /compare                -- Surgeon comparison
    /reports                -- Case costing reports
  /purchase-orders          -- PO management
  /invoice-validation       -- Invoice vs. contract
  /reports                  -- Contract reports
    /price-discrepancy      -- Price discrepancy
  /alerts                   -- Alert management
    /[id]                   -- Alert detail
  /ai-agent                 -- AI assistant
  /settings                 -- Settings

/vendor                     -- Vendor dashboard (authenticated, vendor role)
  /contracts                -- Vendor contracts
    /new                    -- Submit contract
    /[id]                   -- Contract detail
    /[id]/edit              -- Edit contract
    /pending/[id]/edit      -- Edit pending revision
  /renewals                 -- Vendor renewals
  /prospective              -- Proposal builder
  /market-share             -- Market share analysis
  /performance              -- Performance dashboard
  /purchase-orders          -- Vendor POs
  /invoices                 -- Vendor invoices
  /alerts                   -- Vendor alerts
  /reports                  -- Vendor reports
  /ai-agent                 -- Vendor AI assistant
  /settings                 -- Vendor settings

/admin                      -- Admin dashboard
  /facilities               -- Facility management
  /payor-contracts          -- Payor contract management
  /vendors                  -- Vendor management
  /users                    -- User management
  /billing                  -- Billing management
```

---

## Production Gap Analysis

Comparing v0 prototype at `/Users/vickkumar/Downloads/b_FtKM0pV2dZE-1775131904894/` against production at `/Users/vickkumar/code/tydei-next/`.

| Feature | v0 Status | Production Status | Gap | Priority |
|---------|-----------|-------------------|-----|----------|
| **Landing Page (Marketing)** | COMPLETE | COMPLETE | None -- production has componentized version (hero, features, value-props, capabilities, CTA, footer) | -- |
| **Auth (Login/SignUp)** | COMPLETE | COMPLETE | Production adds forgot-password, reset-password, componentized forms, auth-card wrapper | -- |
| **Dashboard Layout (Shell)** | COMPLETE | COMPLETE | Production has PortalShell (shared), SidebarNav, AlertBell, CommandSearch, EntitySelector, UserMenu as separate components | -- |
| **Dashboard Home** | COMPLETE | COMPLETE | Production componentized: DashboardClient, DashboardStats, DashboardFilters, spend charts (vendor, category, total), RecentAlerts, RecentContracts | -- |
| **Contracts List** | COMPLETE | COMPLETE | Production has ContractColumns, ContractFilters, ContractsListClient, PendingContractsTab, ProposalReviewList | -- |
| **New Contract** | COMPLETE | COMPLETE | Production has ContractForm, ContractFormReview, NewContractClient, AI extract (AiExtractDialog, AiExtractReview), PricingColumnMapper, DocumentUpload | -- |
| **Contract Detail** | PARTIAL (placeholder) | COMPLETE | Production has ContractDetailClient, ContractDetailOverview, ContractDocumentsList, ContractTermsDisplay | P1 |
| **Contract Edit** | COMPLETE | COMPLETE | Production has EditContractClient | -- |
| **Contract Score** | COMPLETE | COMPLETE | Production has AiScorePage, ContractScoreClient | -- |
| **Contract Terms Entry** | COMPLETE | COMPLETE | Production has ContractTermsEntry, ContractTierRow | -- |
| **COG Data** | COMPLETE | COMPLETE | Production has CogDataClient, CogImportDialog, CogColumnMapper, CogImportPreview, CogRecordsTable, CogUploadHistory, DuplicateValidator, VendorNameMatcher, CogManualEntry, PricingFilesTable, PricingImportDialog, FileDropzone | -- |
| **Case Costing** | COMPLETE | COMPLETE | Production has CaseCostingClient, CaseColumns, CaseTable, CaseDetail, CaseImportDialog, SurgeonScorecard, SurgeonScorecardsGrid, SurgeonComparisonChart, CostDistributionChart, CptAnalysisTable, PayorContractsManager, AiSupplyMatch | -- |
| **Case Costing Compare** | COMPLETE | COMPLETE | Production page exists | -- |
| **Case Costing Reports** | COMPLETE | COMPLETE | Production page exists | -- |
| **Purchase Orders** | COMPLETE | COMPLETE | Production has PO list, detail, create (new/), form components (OrderHeader, LineItemsTable, ProductAddMethods, PatientBillingInfo, OrderTotalAndNotes, DialogFooterActions), PoColumns, PoCreateForm, PoDetail, PoLineItemBuilder | -- |
| **Invoice Validation** | COMPLETE | COMPLETE | Production has InvoiceValidationClient, InvoiceValidationTable, InvoiceColumns, InvoiceImportDialog, DisputeDialog, detail page `/[id]` | -- |
| **Contract Renewals** | COMPLETE | COMPLETE | Production at `/dashboard/renewals` (slightly different path), has RenewalsClient, RenewalSummaryCard, RenewalTimeline, RenewalInitiateDialog | -- |
| **Rebate Optimizer** | COMPLETE | COMPLETE | Production has OptimizerClient, OpportunityCard, OpportunityList, OptimizerChart, SpendTargetDialog | -- |
| **Analysis (Financial)** | COMPLETE | COMPLETE | Production has AnalysisClient with capital analysis tabs (UploadTab, ContractInputsTab, FinancialAnalysisTab, ProjectionsTab, SummaryReportTab), DepreciationCalculator, DepreciationChart, PriceProjectionChart, SpendTrendChart | -- |
| **Prospective Analysis (Facility)** | COMPLETE | COMPLETE | Production has ProspectiveClient with sub-components: ProposalUploadTab, ProposalListTab, ManualEntryForm, AnalysisOverviewTab, PricingComparisonTab, DealScorePanel, ProposalComparisonTable | -- |
| **Reports** | COMPLETE | COMPLETE | Production has ReportsClient with sections (OverviewTab, DataReportTabContent, CalculationAuditTab, ReportsHeader, ReportFilters, QuickAccessCards, MetricCard, ScheduleReportDialog, ScheduledReportsCard), ReportColumns, ReportPeriodTable, ReportTrendChart, ReportExportButton, ScheduleFormDialog, ScheduleTable | -- |
| **Price Discrepancy Reports** | COMPLETE | COMPLETE | Production has PriceDiscrepancyTable | -- |
| **Alerts** | COMPLETE | COMPLETE | Production has AlertCard, AlertDetailCard, AlertsList (shared components), both facility and vendor alerts | -- |
| **Alert Detail** | COMPLETE | COMPLETE | Both have `/alerts/[id]` | -- |
| **AI Agent (Facility)** | COMPLETE | COMPLETE | Production has AiAgentClient (facility), ChatInterface, ChatMessage, CreditIndicator, CreditUsageCard, SuggestedQuestions (shared components) | -- |
| **Settings** | COMPLETE | COMPLETE | Production has SettingsClient with tabs: ProfileTab, NotificationsTab, FacilitiesTab, MembersTab, BillingTab, FeaturesTab, AiCreditsTab, ConnectionsTab, AddonsTab. Has ProfileForm, NotificationSettings, FeatureFlagsPanel | -- |
| **Vendor Dashboard** | COMPLETE | COMPLETE | Production has VendorDashboardClient, VendorStats, VendorSpendChart, VendorMarketShareChart, VendorContractStatus, VendorRecentContracts | -- |
| **Vendor Contracts** | COMPLETE | COMPLETE | Production has VendorContractList, VendorContractColumns, VendorContractOverview, VendorContractSubmission with sub-components (BasicInformationCard, ContractDatesCard, ContractTermsCard, EntryModeTabs, FinancialDetailsCard, GroupContractSettingsCard, SubmissionSidebar) | -- |
| **Vendor Contract New** | COMPLETE | COMPLETE | Production has submission form components | -- |
| **Vendor Contract Detail** | COMPLETE | COMPLETE | Production has VendorContractOverview | -- |
| **Vendor Prospective** | COMPLETE | COMPLETE | Production has ProposalBuilder with sub-components (ProposalHeader, FacilitySelector, ContractParameters, ContractTerms, ProductsSection, ProposalActions, AiDealNotes), DealScoreView | -- |
| **Vendor Market Share** | COMPLETE | COMPLETE | Production has MarketShareClient, MarketShareCharts | -- |
| **Vendor Performance** | COMPLETE | COMPLETE | Production has PerformanceClient, PerformanceDashboard, PerformanceRadar | -- |
| **Vendor Renewals** | COMPLETE | COMPLETE | Production has VendorRenewalsClient, VendorRenewalPipeline | -- |
| **Vendor Purchase Orders** | COMPLETE | COMPLETE | Production has PurchaseOrdersClient (vendor), PoCreateDialog, PoFilterBar, PoStatsCards, PoTable, PoViewDialog | -- |
| **Vendor Invoices** | COMPLETE | COMPLETE | Production has VendorInvoiceList | -- |
| **Vendor Alerts** | COMPLETE | COMPLETE | Production uses shared AlertsList component | -- |
| **Vendor Reports** | COMPLETE | COMPLETE | Production has ReportsClient (vendor) | -- |
| **Vendor AI Agent** | COMPLETE | COMPLETE | Production has AiAgentClient (vendor) | -- |
| **Vendor Settings** | COMPLETE | COMPLETE | Production has VendorSettingsClient, VendorProfileForm, ConnectionManager | -- |
| **Admin Dashboard** | COMPLETE | COMPLETE | Production at `/admin/dashboard` (different path), has AdminDashboardClient, AdminStats, PendingActions, ActivityFeed, MrrChart | -- |
| **Admin Facilities** | COMPLETE | COMPLETE | Production has FacilityTable, FacilityColumns, FacilityFormDialog | -- |
| **Admin Payor Contracts** | COMPLETE | COMPLETE | Production has PayorContractTable, PayorRateEditor, PayorGrouperEditor | -- |
| **Admin Vendors** | COMPLETE | COMPLETE | Production has VendorTable, VendorColumns | -- |
| **Admin Users** | COMPLETE | COMPLETE | Production has UserTable, UserColumns | -- |
| **Admin Billing** | COMPLETE | COMPLETE | Production has BillingClient, BillingOverview, InvoiceTable | -- |
| **Vendor Pending Contract Edit** | COMPLETE | MISSING | v0 has `/vendor/contracts/pending/[id]/edit`; production does not have this route | P2 |
| **Contract Change Proposals** | COMPLETE (store) | COMPLETE (action) | Production has `change-proposals` action and validator; v0 has store-based approach | -- |
| **Mass Upload** | COMPLETE (component) | MISSING (component) | v0 has MassUpload component in shell; production shell does not appear to have bulk document upload queue | P3 |
| **Force Clear / Clear COG** | COMPLETE | MISSING | Utility pages for clearing data; not needed in production (debug only) | -- |
| **Vendor Benchmark Store** | COMPLETE | PARTIAL | v0 has detailed ProductBenchmark with pricing floors, target margins, GPO fees; production has `benchmarks` action but no dedicated page | P3 |
| **Connection Invite System** | COMPLETE (store) | COMPLETE | Production has `connections` action, ConnectionManager component, ConnectionsTab in settings | -- |
| **AI Credit System** | COMPLETE (store) | COMPLETE | Production has `ai-credits` action, AiCreditsTab, CreditIndicator, CreditUsageCard | -- |
| **Feature Flags** | COMPLETE (store) | COMPLETE | Production has FeatureFlagsPanel, FeaturesTab | -- |
| **Admin Analytics Page** | DEFINED (nav only) | MISSING | v0 defines `/admin/analytics` in nav but no page file; production also missing | P4 |
| **Admin Settings Page** | DEFINED (nav only) | MISSING | v0 defines `/admin/settings` in nav but no page file; production also missing | P4 |
| **Data Layer** | localStorage/IndexedDB | Server actions + Prisma/Supabase | Production uses proper server-side data with Zod validators -- this is an architecture improvement, not a gap | -- |
| **Shared Components** | Inline in pages | Extracted to component library | Production has reusable shared components (DataTable, MetricCard, ChartCard, EmptyState, FileUpload, PageHeader, etc.) -- architecture improvement | -- |
| **Category Management** | COMPLETE (store) | COMPLETE | Production has `categories` action, CategoryFormDialog, CategoryTree | -- |
| **Vendor Name Mapping** | COMPLETE (store) | COMPLETE | Production has `vendor-mappings` action, VendorMappingTable | -- |
| **National Reimbursement Rates** | COMPLETE (in case-data-store) | COMPLETE | Production has dedicated `national-reimbursement-rates.ts` | -- |
| **Search (Global)** | MISSING | COMPLETE | Production has CommandSearch and `search` action; v0 has no global search | -- |

### Summary
The production codebase has achieved near-complete parity with the v0 prototype. All major features, pages, and data models from v0 have been implemented in production with proper architecture (server actions, Zod validators, componentized structure). The remaining gaps are:

1. **P1:** Contract detail page was a placeholder in v0 but is fully built in production (no gap)
2. **P2:** Vendor pending contract edit route (`/vendor/contracts/pending/[id]/edit`) exists in v0 but not production
3. **P3:** Mass upload queue component and vendor benchmark dedicated page
4. **P4:** Admin analytics and admin settings pages (defined in nav only in v0, also missing in production)

Production has additional features not in v0: global search, forgot/reset password, enhanced component architecture, server-side data persistence, Prisma schema generation, email system, rate limiting, S3 storage, Stripe billing, PDF generation, and audit logging.
