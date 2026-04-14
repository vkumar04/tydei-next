# v0 Prototype Ingest Report: TYDEi Healthcare Contract Management Platform

**Export Type:** v0.dev (Next.js 16 + React 19 + Tailwind 4 + Zustand localStorage + Supabase auth)  
**Generated:** 2026-04-14  
**Status:** Comprehensive mapping for production port to Next.js + Prisma + Better Auth + S3

---

## 1. App Router Pages & Route Structure

### Root Level
- `/app/page.tsx` - Landing page (home)
- `/app/layout.tsx` - Root layout with ThemeProvider, Toaster, Vercel Analytics, global CSS import

### Auth Routes (`/app/auth/`)
- `/auth/login/page.tsx` - Login form with demo mode support (GOTCHA: demo credentials hardcoded: `demo@tydei.com`/`demo123` for facility, `vendor@tydei.com`/`vendor123` for vendor)
- `/auth/sign-up/page.tsx` - Sign-up form
- `/auth/sign-up-success/page.tsx` - Sign-up confirmation
- `/auth/error/page.tsx` - Auth error display

### Dashboard Routes (`/app/dashboard/`) - Facility Admin Portal
**Layout:** `/app/dashboard/layout.tsx` - Gated with Supabase auth + demo fallback, wraps in `DashboardShell` component
- `/dashboard/page.tsx` - Contract performance overview (KPIs, charts, alerts, recent contracts)
- `/dashboard/cog-data/page.tsx` - Cost of goods (COG) data management
- `/dashboard/purchase-orders/page.tsx` - PO tracking and analysis
- `/dashboard/invoice-validation/page.tsx` - Invoice audit
- `/dashboard/analysis/page.tsx` - Performance analysis dashboard
- `/dashboard/analysis/prospective/page.tsx` - Forward-looking analysis
- `/dashboard/contracts/page.tsx` - Contract list/table
- `/dashboard/contracts/new/page.tsx` - Create new contract (form)
- `/dashboard/contracts/[id]/page.tsx` - Contract detail view
- `/dashboard/contracts/[id]/edit/page.tsx` - Edit contract
- `/dashboard/contracts/[id]/terms/page.tsx` - View/manage contract terms
- `/dashboard/contracts/[id]/score/page.tsx` - Contract performance scoring
- `/dashboard/contract-renewals/page.tsx` - Renewal tracking
- `/dashboard/case-costing/page.tsx` - Case costing analysis
- `/dashboard/case-costing/compare/page.tsx` - Case costing comparison
- `/dashboard/case-costing/reports/page.tsx` - Case costing reports
- `/dashboard/alerts/page.tsx` - Alert center (read, resolve, dismiss)
- `/dashboard/alerts/[id]/page.tsx` - Alert detail view
- `/dashboard/rebate-optimizer/page.tsx` - Rebate optimization tool
- `/dashboard/reports/page.tsx` - Report generation center
- `/dashboard/reports/price-discrepancy/page.tsx` - Price discrepancy report
- `/dashboard/settings/page.tsx` - User preferences, facility selection

### Admin Routes (`/app/admin/`) - System Administration
**Layout:** `/app/admin/layout.tsx` - Admin-only access
- `/admin/page.tsx` - Admin dashboard
- `/admin/users/page.tsx` - User management
- `/admin/facilities/page.tsx` - Facility management
- `/admin/vendors/page.tsx` - Vendor management
- `/admin/payor-contracts/page.tsx` - Payor contract management
- `/admin/billing/page.tsx` - Billing and usage

### Vendor Portal Routes (`/app/vendor/`) - Vendor/Supplier Portal
**Layout:** `/app/vendor/layout.tsx` - Vendor role check, wraps in `VendorShell` + `VendorRoleGuard`
- `/vendor/page.tsx` - Vendor dashboard
- `/vendor/contracts/page.tsx` - Active contracts list
- `/vendor/contracts/new/page.tsx` - Submit new contract
- `/vendor/contracts/[id]/page.tsx` - View contract
- `/vendor/contracts/[id]/edit/page.tsx` - Edit contract
- `/vendor/contracts/pending/[id]/edit/page.tsx` - Edit pending contract awaiting approval
- `/vendor/invoices/page.tsx` - Invoice history and submission
- `/vendor/purchase-orders/page.tsx` - PO visibility
- `/vendor/market-share/page.tsx` - Market share tracking
- `/vendor/performance/page.tsx` - Performance analytics
- `/vendor/prospective/page.tsx` - Prospective analysis
- `/vendor/renewals/page.tsx` - Contract renewal tracking
- `/vendor/alerts/page.tsx` - Vendor-specific alerts
- `/vendor/ai-agent/page.tsx` - AI assistant (vendor version)
- `/vendor/reports/page.tsx` - Vendor reports
- `/vendor/settings/page.tsx` - Vendor preferences

### Special Routes
- `/app/dashboard/ai-agent/page.tsx` - AI-powered contract analysis (facility side)
- `/app/clear-cog/page.tsx` - Utility page to clear COG data (demo/testing)
- `/app/force-clear/page.tsx` - Utility page to force clear all state (demo/testing)

---

## 2. Domain Entities & Data Model

### Extracted from Zustand Stores

#### Entity: Contract
**File:** `lib/contract-data-store.ts`
- `id` - string (unique identifier)
- `name` - string
- `contractId` - string (external/reference ID)
- `vendor` / `vendorName` - string
- `vendorId` - string
- `type` - 'usage' | 'pricing_only' | 'capital' | 'tie_in' | 'grouped'
- `status` - 'active' | 'expiring' | 'expired' | 'pending'
- `effectiveDate` - string (ISO date)
- `expirationDate` - string (ISO date)
- `totalValue` - number
- `rebateEarned` - number
- `currentSpend` - number
- `rebatesCollected` - number
- `currentTier` - number
- `maxTier` - number
- `marketShareCommitment` - number (%)
- `currentMarketShare` - number (%)
- `complianceRate` - number (%)
- `productCategory` - string
- `commitmentThreshold` - number
- `pricingData[]` / `pricingItems[]` - PricingItem[]
- `rebateTiers[]` - RebateTier[] (tiered rebate structure)
- `terms[]` - ContractTerm[] (contract clauses)
- `documents[]` - ContractDocument[] (uploaded PDFs, exhibits)
- `facilities[]` / `selectedFacilities[]` - string[] (facility IDs this contract applies to)
- `facilityId` - string (legacy single facility)

**Relationships:**
- References Vendor by vendorId
- References Facilities by facilityId/selectedFacilities
- Contains PricingItems (pricing file data)
- Contains RebateTiers (rebate schedule)
- Contains ContractTerms (contract clauses)
- Contains ContractDocuments (uploaded files)

---

#### Entity: PendingContract
**File:** `lib/pending-contracts-store.ts`
- `id` - string
- `vendorName` - string
- `vendorId` - string
- `facilityName` - string
- `facilityId` - string
- `contractName` - string
- `contractType` - 'Usage' | 'Tie-In' | 'Capital' | 'Service' | 'Pricing'
- `startDate` - string
- `endDate` - string
- `terms` - string (description)
- `status` - 'draft' | 'pending' | 'approved' | 'rejected' | 'revision_requested' | 'withdrawn'
- `submittedAt` - string (ISO timestamp)
- `reviewedAt` - string (optional)
- `reviewedBy` - string (optional, admin name)
- `reviewNotes` - string (optional, feedback from facility)
- `documents[]` - { id, name, type: 'contract' | 'pricing' | 'amendment' | 'other', size, uploadedAt }
- `pricingData?` - { fileName, itemCount, totalValue, categories, uploadedAt }
- `rebateTerms?` - { type: 'spend' | 'volume' | 'market_share', tiers: [{ threshold, rate }] }

**Relationships:**
- References Vendor by vendorId
- References Facility by facilityId
- Bridges to Contract when approved

---

#### Entity: Vendor
**File:** `lib/vendor-store.ts`
- `id` - string (unique)
- `name` - string
- `displayName` - string (optional)
- `division` - string (optional, for multi-divisions)
- `parentVendorId` - string (optional, for hierarchy)
- `source` - 'manual' | 'contract' | 'pricing_file' | 'cog' (where it came from)
- `sourceId` - string (optional, ID from source system)
- `contactName` - string (optional)
- `contactEmail` - string (optional)
- `contactPhone` - string (optional)
- `website` - string (optional)
- `address` - string (optional)
- `notes` - string (optional)
- `isActive` - boolean
- `createdAt` - string (ISO timestamp)
- `updatedAt` - string (ISO timestamp)

**Relationships:**
- One-to-many with Contract (vendor can have multiple contracts)
- One-to-many with PendingContract
- Can be parent of other Vendors (parentVendorId)

**Vendor Aliases (hardcoded):**
```typescript
'stryker': ['stryker', 'stryker corporation', 'stryker orthopaedics']
'arthrex': ['arthrex', 'arthrex inc']
'zimmer biomet': ['zimmer biomet', 'zimmer', 'biomet']
'depuy synthes': ['depuy synthes', 'depuy', 'synthes']
'smith nephew': ['smith nephew', 'smith and nephew']
'medtronic': ['medtronic', 'medtronic plc']
```

---

#### Entity: PayorContract
**File:** `lib/payor-contract-store.ts`
- `id` - string
- `payorName` - string (insurance company name)
- `payorType` - 'commercial' | 'medicare_advantage' | 'medicaid_managed' | 'workers_comp'
- `facilityId` - string
- `facilityName` - string
- `contractNumber` - string
- `effectiveDate` - string
- `expirationDate` - string
- `status` - 'active' | 'expired' | 'pending'
- `cptRates[]` - PayorContractRate[] (CPT code to reimbursement rate mapping)
- `grouperRates[]` - PayorContractGrouper[] (grouper-based rates)
- `multiProcedureRule` - { primary: number, secondary: number } (% of rate for primary/secondary procedures)
- `implantPassthrough` - boolean (whether implants billed at cost)
- `implantMarkup` - number (% markup if not pass-through)
- `uploadedAt` - string
- `uploadedBy` - string (user who uploaded)
- `fileName` - string
- `notes` - string

**Sample Data:** Anthem Blue Cross contract with CPT rates for joint replacement, shoulder, spine, arthroscopy procedures

**Relationships:**
- References Facility
- Contains PayorContractRate[] (one rate per CPT code)
- Contains PayorContractGrouper[] (Alternative rate structure by grouper)

---

#### Entity: CaseRecord
**File:** `lib/case-data-store.ts`
- `id` - string
- `caseId` - string (clinical system primary key)
- `caseDate` - string
- `surgeonId` - string
- `surgeonName` - string
- `procedureCode` - string (CPT code)
- `procedureDescription` - string
- `patientType` - 'Inpatient' | 'Outpatient' | 'Observation'
- `facilityId` - string
- `facilityName` - string
- `supplies[]` - CaseSupply[] (from clinical supply file)
- `totalSupplyCost` - number (from clinical system, no rebate impact)
- `purchaseData[]` - CasePurchase[] (from PO/invoice system)
- `totalPurchaseCost` - number (from purchasing, affects rebates)
- `onContractSpend` - number (calculated)
- `offContractSpend` - number (calculated)
- `rebateContribution` - number (calculated from purchasing only)
- `payorMix[]` - PayorMix[] (reimbursement breakdown)
- `totalReimbursement` - number
- `margin` - number (reimbursement - totalPurchaseCost)
- `marginPercent` - number

**Sub-entities:**
- `CaseSupply` - supplies used in case (linked via vendor item #, doesn't affect rebates)
- `CasePurchase` - items purchased for case (linked via vendor item #, affects rebates)
- `PayorMix` - { payorType, payorName, reimbursementAmount, percentOfTotal }

**Relationships:**
- Links clinical data (surgeon, procedure, facility) with purchasing data
- Key linking field: `vendorItemNo` (cross-references between clinical and purchasing systems)

---

#### Entity: Alert
**File:** `lib/alert-store.ts`
- `id` - string
- `type` - AlertType (off_contract | expiring_contract | tier_threshold | rebate_due | pricing_error | contract_expiry | compliance | rebate)
- `title` - string
- `message` - string
- `description` - string (optional)
- `status` - AlertStatus (new | read | resolved | dismissed)
- `priority` - AlertPriority (high | medium | low)
- `severity` - 'high' | 'medium' | 'low' (optional)
- `createdAt` - Date
- `metadata` - Record<string, unknown> (contextual data, varies by type)
- `actionLink` - string (optional, URL to related resource)
- `action` - string (optional)
- `facility` - string (optional)
- `date` - string (optional)

**Sample Alerts (Facility):**
- Expiring contracts (28-day notice)
- Tier threshold approaching ($110k to next tier)
- Rebate collection due (quarterly)
- Off-contract purchases detected
- Market share compliance at risk

**Sample Alerts (Vendor):**
- Contract renewal opportunity
- Rebate payment processed

**Relationships:**
- Stores resolved/dismissed IDs persistently via localStorage
- No direct DB relationship in v0 (demo data seeded)

---

#### Entity: Facility
**File:** `lib/facility-identity-store.ts`
- `id` - string
- `name` - string
- `code` - string (facility abbreviation)
- `type` - 'hospital' | 'asc' | 'clinic' | 'surgery_center' | 'health_system'
- `address` - { city, state, region }
- `beds` - number (optional, for hospitals)
- `parentSystemId` - string (optional, if part of health system)
- `parentSystemName` - string (optional)

**Sample Health Systems:**
- Memorial Health System (Houston) - 4 facilities
- St. Luke's Health (Chicago) - 4 facilities
- Pacific Healthcare Network (San Diego) - 3 facilities
- Northeast Medical Partners (Boston) - 3 facilities
- Independent facilities (Valley, Coastal, Mountain)

**Relationships:**
- Belongs to HealthSystem (optional, via parentSystemId)
- One-to-many with Contract (facility in contract.facilities[])
- One-to-many with User (facility_id in user role)

---

#### Entity: FacilityUserIdentity
**File:** `lib/facility-identity-store.ts`
- `userId` - string
- `userName` - string
- `email` - string
- `role` - 'system_admin' | 'facility_admin' | 'manager' | 'analyst' | 'viewer'
- `assignedFacilities[]` - string[] (facility IDs user can access)
- `activeFacilityId` - string | null (currently selected facility)
- `healthSystemAccess[]` - string[] (optional, health system IDs for system-wide access)

**Role Permissions:**
```
system_admin: [view, edit, approve, admin, manage_users]
facility_admin: [view, edit, approve, admin]
manager: [view, edit, approve]
analyst: [view, analyze]
viewer: [view]
```

**Relationships:**
- Created from Supabase user_metadata (role field)
- Defines accessible Facilities dynamically

---

#### Entity: COGData
**File:** `lib/cog-data-store.ts`
- Imported CSV/Excel data structure
- Fields: po_date, vendor_name, catalog_number, description, quantity, unit_of_measure, cost, purchase_price, contract_number, category, manufacturer, lot_number, expiration_date, case_id, surgeon, facility
- Linked to Vendor by vendor_name matching
- No hardcoded/demo data - only imported records

---

### Supporting Value Objects

#### PricingItem
```typescript
{
  itemNumber: string // Catalog or reference #
  description: string
  unitPrice: number
  contractPrice: number
  savings: number (contractPrice - unitPrice)
  category: string
}
```

#### RebateTier
```typescript
{
  tier: number
  minSpend: number
  maxSpend: number | null
  rebatePercentage: number
}
```

#### ContractTerm
```typescript
{
  id: string
  termType: string (e.g., 'spend_rebate', 'volume_rebate', 'price_reduction')
  description: string
  value: string (optional)
  effectiveDate: string (optional)
}
```

#### ContractDocument
```typescript
{
  id: string
  name: string (filename)
  type: 'main' | 'amendment' | 'addendum' | 'exhibit' | 'pricing'
  uploadDate: string
  effectiveDate: string (optional)
  size: number (optional, bytes)
  url: string (optional, Supabase storage URL)
}
```

---

## 3. Features & User Flows

### Feature: Contract Management (Facility Admin)
**Pages Involved:** `/dashboard/contracts`, `/dashboard/contracts/new`, `/dashboard/contracts/[id]`, `/dashboard/contracts/[id]/edit`, `/dashboard/contracts/[id]/terms`, `/dashboard/contracts/[id]/score`

**Stores Used:**
- `contract-data-store.ts` (active contracts)
- `pending-contracts-store.ts` (pending vendor submissions)
- `active-contracts-store.ts` (approved contracts)
- `facility-identity-store.ts` (user access control)

**User Flow:**
1. View all contracts in table (status, vendor, spend, rebates, dates)
2. Create new contract (manual entry + upload docs)
3. View contract detail (performance, terms, pricing, documents)
4. Edit contract (update terms, pricing, dates)
5. Review pending contracts from vendors (approve, request revision, reject)
6. View contract terms/clauses
7. View contract performance score

**Key Components:**
- ContractList (DataTable with filters, sorting)
- ContractForm (create/edit with dynamic fields)
- ContractDetail (tabs for overview, terms, pricing, documents)
- ContractScore (performance dashboard)
- PendingContractsList (vendor submissions queue)

---

### Feature: COG (Cost of Goods) Import & Matching
**Pages Involved:** `/dashboard/cog-data`

**Stores Used:**
- `cog-data-store.ts` (imported COG records)
- `vendor-store.ts` (vendor matching)
- `contract-data-store.ts` (contract price lookups)

**API Routes:**
- `/api/cog-parser/route.ts` - CSV/Excel parsing, column mapping, field detection

**User Flow:**
1. Open COG Import Modal (file upload)
2. System auto-detects column headers and suggests mappings (95% confidence)
3. User reviews and adjusts column-to-field mappings
4. Vendor name matching (via vendor-matcher component)
5. System parses & imports records to cog-data-store
6. Records linked to contracts for pricing override

**File Format Support:**
- CSV (custom parser handling quoted values, currency symbols, decimal separators)
- Excel/XLSX (via XLSX library)

**Target Fields Detected:**
- po_date, vendor_name, catalog_number, description, quantity, unit_of_measure, cost, purchase_price, contract_number, category, manufacturer, lot_number, expiration_date, case_id, surgeon, facility, skip

**Key Components:**
- COGImportModal (multi-step wizard)
- VendorMatcher (rename/deduplicate vendors during import)
- ColumnMappingUI (drag-to-map headers)

---

### Feature: Purchase Order Management
**Pages Involved:** `/dashboard/purchase-orders`, `/vendor/purchase-orders`

**Stores Used:**
- `case-data-store.ts` (PO records from purchasing system)
- `contract-data-store.ts` (on-contract verification)
- `vendor-store.ts` (vendor identification)

**User Flow (Facility):**
1. View PO history table (vendor, items, dates, costs)
2. Flag off-contract items for review
3. Link POs to contracts manually
4. View PO spend against contract tiers

**User Flow (Vendor):**
1. View POs placed with them
2. See spend tracking and tier progress
3. Monitor off-contract purchases

---

### Feature: Case Costing Analysis
**Pages Involved:** `/dashboard/case-costing`, `/dashboard/case-costing/compare`, `/dashboard/case-costing/reports`

**Stores Used:**
- `case-data-store.ts` (case records with clinical + purchasing data)
- `payor-contract-store.ts` (reimbursement rates)
- `contract-data-store.ts` (contract pricing overrides)

**User Flow:**
1. Import case data from clinical system (procedures, supplies used)
2. Link with purchasing data (POs, invoices, actual costs)
3. Calculate case margin (reimbursement - total purchase cost)
4. Break down by payor type (Medicare %, Medicaid %, Commercial %)
5. Identify high-cost supplies
6. Compare cases for pricing analysis

**Key Calculations:**
- Case Cost = Sum of purchasing data for items used
- Case Revenue = Payor reimbursement (from CPT code rates)
- Case Margin = Revenue - Cost
- Rebate Contribution = On-contract spend × rebate rate (by contract)

---

### Feature: Contract Pricing & Rebate Tier Management
**Pages Involved:** `/dashboard/contracts/[id]/edit`, contract form

**Stores Used:**
- `contract-data-store.ts` (pricing items, rebate tiers)

**User Flow:**
1. Upload pricing file (CSV/Excel with catalog #, unit price, contract price)
2. Define rebate tiers (spend threshold → rebate % mapping)
3. Set market share commitments
4. View tier progress (current spend vs. next tier threshold)
5. Simulate spend scenarios ("how much to reach Tier 3?")

---

### Feature: Alert Management & Notifications
**Pages Involved:** `/dashboard/alerts`, `/dashboard/alerts/[id]`, `/vendor/alerts`

**Stores Used:**
- `alert-store.ts` (alert state + resolved/dismissed tracking)

**User Flow (Facility):**
1. View inbox of system-generated alerts (expiring contracts, off-contract, rebate due, compliance, pricing issues)
2. Mark alert as read
3. Resolve alert (action taken)
4. Dismiss alert (acknowledged, no action)
5. Click alert to navigate to resource (contract, PO, etc.)

**User Flow (Vendor):**
1. View contract renewal opportunities
2. View rebate payment notifications
3. Same read/resolve/dismiss lifecycle

---

### Feature: AI-Powered Contract Analysis
**Pages Involved:** `/dashboard/ai-agent`, `/vendor/ai-agent`

**API Route:** `/api/ai-agent/route.ts`

**Stores/Data Used:**
- `contract-data-store.ts` (contract data)
- `case-data-store.ts` (case/spend data)

**Libraries:** `ai` SDK (v6.0+), `@ai-sdk/gateway` for model access, `@ai-sdk/react` (useChat hook)

**AI Tools Available:**
- `analyzeContractPerformance` - spend, rebates, tier progress, compliance
- `getMarketShareAnalysis` - vendor share by category
- (Other tools as per route implementation)

**User Flow:**
1. Open AI Agent chatbot
2. Ask natural language questions about contracts
3. System calls appropriate tools with extracted parameters
4. Streams structured responses back to UI

---

### Feature: Invoice Validation
**Pages Involved:** `/dashboard/invoice-validation`

**Stores Used:**
- `case-data-store.ts` (invoice records from purchasing)
- `contract-data-store.ts` (pricing verification)

**User Flow:**
1. View invoices table
2. Validate pricing matches contract rates
3. Flag discrepancies (overcharges, unapproved items)
4. Batch approve invoices

---

### Feature: Analysis & Reporting
**Pages Involved:** `/dashboard/analysis`, `/dashboard/analysis/prospective`, `/dashboard/reports`, `/dashboard/reports/price-discrepancy`, `/vendor/reports`

**Stores Used:**
- `contract-data-store.ts`
- `case-data-store.ts`
- `payor-contract-store.ts`
- `alert-store.ts`

**Reports:**
- Spend by vendor/category
- Rebate analysis (earned vs. collected)
- Contract performance scorecard
- Price discrepancy report (what's being paid vs. contract)
- Prospective analysis (forecasting future spend/rebates)
- Market share tracking

---

### Feature: Vendor Contract Submission (Bidirectional)
**Pages Involved:** `/vendor/contracts/new`, `/vendor/contracts/[id]/edit`, `/dashboard/contracts` (review queue)

**Stores Used:**
- `pending-contracts-store.ts`
- `contract-data-store.ts` (on approval)

**User Flow (Vendor):**
1. Submit new contract proposal with docs, pricing, rebate terms
2. Facility reviews (approval queue)
3. Vendor gets feedback (revision requested)
4. Vendor resubmits
5. Contract approved → moved to active contracts

**User Flow (Facility Admin):**
1. See pending contracts in queue
2. Review documents, pricing, terms
3. Approve → becomes active contract
4. Reject → contract removed
5. Request revision → vendor notified with feedback

---

### Feature: Settings & Configuration
**Pages Involved:** `/dashboard/settings`, `/vendor/settings`

**Facility Admin Settings:**
- Multi-facility access (select active facility)
- User preferences
- Data export

**Vendor Settings:**
- Company info
- Contact preferences
- Role-based access controls (see vendor-role-store.ts)

---

## 4. Components Inventory

### Layout Components (`components/dashboard/`, `components/vendor/`)
- `dashboard-shell.tsx` - Main layout wrapper for facility portal (sidebar nav, header)
- `vendor-shell.tsx` - Main layout wrapper for vendor portal
- `vendor-role-guard.tsx` - Role-based access control for vendor features
- `dashboard-sidebar.tsx` - Navigation sidebar (facility)
- `vendor-sidebar.tsx` - Navigation sidebar (vendor)

### Dashboard Components (`components/dashboard/`)
- `dashboard-metrics.tsx` - KPI cards (total value, spend, rebates, compliance)
- `dashboard-charts.tsx` - Charts (spend trend, rebate by vendor, etc.)
- `dashboard-filters.tsx` - Date range and vendor filters
- `recent-contracts.tsx` - Table of recent contracts
- `recent-alerts.tsx` - Recent alerts widget

### Contract Components (`components/contracts/`)
- `contract-list.tsx` - DataTable with contracts
- `contract-form.tsx` - Form for create/edit contract (Zod validation)
- `contract-detail.tsx` - Tab view (overview, terms, pricing, docs)
- `contract-pdf-upload.tsx` - File upload for contract documents (dropzone)
- `contract-pricing-table.tsx` - Pricing items table
- `contract-rebate-tiers.tsx` - Rebate tier configuration UI
- `contract-document-list.tsx` - Uploaded documents list
- `contract-performance-chart.tsx` - Spend vs. rebate visualization

### COG Import Components (`components/cog/`)
- `cog-import-modal.tsx` - Multi-step wizard (upload → mapping → vendor match → preview → import)
- `cog-parser.tsx` - Column mapping interface

### Import Components (`components/import/`)
- `cog-import-modal.tsx` - Wrapper/alias for COG import
- `vendor-matcher.tsx` - Vendor deduplication/renaming during import

### Pricing Components (`components/pricing/`)
- `pricing-file-upload.tsx` - Pricing file upload

### Case Costing Components (`components/case-costing/`)
- `case-costing-analysis.tsx` - Main case analysis dashboard
- `case-margin-breakdown.tsx` - Revenue/cost breakdown
- `case-payor-mix.tsx` - Payor distribution chart

### Chart Components (`components/charts/`)
- `spend-trend-chart.tsx` - Line chart of spend over time (recharts)
- `rebate-by-vendor-chart.tsx` - Bar chart rebates by vendor
- `contract-status-chart.tsx` - Pie chart contract status
- `market-share-chart.tsx` - Market share visualization

### UI Components (`components/ui/`) - shadcn/ui Radix-based
**59 total shadcn/ui components** installed including:
- `button.tsx`, `input.tsx`, `label.tsx` - Form basics
- `card.tsx`, `dialog.tsx`, `drawer.tsx`, `sheet.tsx` - Containers
- `table.tsx` - Data table (with sorting/filtering capability)
- `select.tsx`, `checkbox.tsx`, `radio-group.tsx`, `toggle.tsx`, `toggle-group.tsx` - Inputs
- `tabs.tsx`, `accordion.tsx` - Organization
- `popover.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`, `menubar.tsx`, `navigation-menu.tsx` - Menus
- `alert.tsx`, `alert-dialog.tsx` - Alerts
- `toast.tsx` (sonner integration) - Notifications
- `progress.tsx`, `slider.tsx` - Progress indicators
- `badge.tsx` - Tags/labels
- `breadcrumb.tsx` - Navigation breadcrumbs
- `calendar.tsx`, `date-picker.tsx` - Date selection (via react-day-picker)
- `command.tsx` - Command palette (cmdk)
- `scroll-area.tsx` - Scrollable container
- `resizable.tsx` - Resizable panels (react-resizable-panels)
- `carousel.tsx` - Image carousel (embla-carousel-react)
- `chart.tsx` - Chart wrapper (recharts integration)
- `input-otp.tsx` - OTP input
- `kbd.tsx`, `separator.tsx`, `avatar.tsx`, `aspect-ratio.tsx` - Utility components
- `collapsible.tsx`, `hover-card.tsx`, `tooltip.tsx` - Interactions
- `field.tsx`, `input-group.tsx`, `button-group.tsx`, `item.tsx` - Custom abstractions
- `spinner.tsx` - Loading indicator
- `empty.tsx` - Empty state
- `skeleton.tsx` - Skeleton loaders
- `use-mobile.tsx` - Mobile detection hook

### Theme Components
- `theme-provider.tsx` - next-themes integration (light/dark mode)
- `theme-toggle.tsx` - Theme switcher UI

---

## 5. External Integrations

### Supabase Auth & Storage
**Files:**
- `/lib/supabase/client.ts` - Browser Supabase client
- `/lib/supabase/server.ts` - Server-side client
- `/lib/supabase/middleware.ts` - Auth middleware
- `/middleware.ts` - Next.js middleware integration

**Usage:**
- Authentication (email/password, sign-up, session management)
- User metadata (role, facility_id)
- Auth state persistence across requests (SSR safety)

**Env Vars Required:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**GOTCHA:** Demo mode fallback when Supabase not configured - login endpoints accept hardcoded credentials

---

### Vercel AI SDK (v6.0+)
**Files:**
- `/app/api/ai-agent/route.ts` - Chat endpoint with tool calling

**Libraries Used:**
- `ai` (main SDK)
- `@ai-sdk/gateway` (model routing)
- `@ai-sdk/react` (client hooks)

**Features:**
- `useChat()` hook for streaming responses
- `tool()` for defining callable functions
- `streamText()` for server-side streaming
- Tools: analyzeContractPerformance, getMarketShareAnalysis, (extensible)

---

### Data Parsing Libraries
**Libraries:**
- `papaparse` (v5.4.1) - CSV parsing (client-side fallback)
- `xlsx` (v0.18.5) - Excel/XLSX parsing (server-side via `/api/cog-parser`)

**Usage in Components:**
- `components/import/cog-import-modal.tsx` - Papa.parse for client-side preview
- `/app/api/cog-parser/route.ts` - XLSX for server-side parsing (50MB file limit, 60s timeout)

---

### File Upload & Dropzone
**Library:** `react-dropzone` (v14.2.3)

**Usage:**
- Contract document upload (PDF, exhibits)
- Pricing file upload (CSV, XLSX)
- COG data import
- Case data import

---

### Form & Validation
**Libraries:**
- `react-hook-form` (v7.54.1) - Form state management
- `@hookform/resolvers` (v3.9.1) - Zod integration with RHF
- `zod` (v3.24.1) - Schema validation

**Usage:**
- Contract creation/edit forms
- User settings forms
- All input validation with type-safe schemas

---

### UI & Visualization
**Libraries:**
- `recharts` (v2.15.0) - Charts (line, bar, pie, area)
- `lucide-react` (v0.564.0) - Icons (50+ used throughout)
- `sonner` (v1.7.1) - Toast notifications
- `class-variance-authority` (v0.7.1) - Component styling
- `clsx` (v2.1.1) - Conditional classnames
- `tailwind-merge` (v3.3.1) - Tailwind utility merging

---

### Other Libraries
- `date-fns` (v4.1.0) - Date formatting and utilities
- `next-themes` (v0.4.6) - Theme persistence
- `react-resizable-panels` (v2.1.7) - Resizable panel layouts
- `swr` (v2.2.5) - Client-side data fetching (optional, not heavily used in v0)
- `vaul` (v1.1.2) - Drawer component primitives
- `cmdk` (v1.1.1) - Command/search palette
- `embla-carousel-react` (v8.6.0) - Carousel component
- `input-otp` (v1.4.2) - OTP input
- `react-day-picker` (v9.13.2) - Calendar picker

---

### Analytics
- `@vercel/analytics` (v1.6.1) - Vercel Analytics integration

---

## 6. File Upload & Import Flows

### COG (Cost of Goods) Import Flow
**Entry Point:** Modal in `/dashboard/cog-data`

**Steps:**
1. **Upload** - Dropzone accepts CSV or Excel file
   - Client-side Papa.parse preview (optional)
2. **Analyze** - POST to `/api/cog-parser?action=analyze`
   - Server reads file (XLSX or CSV)
   - Auto-detects column headers (regex patterns for vendor_name, catalog_number, etc.)
   - Returns column mappings with confidence scores (0-95%)
3. **Mapping** - User reviews/adjusts column-to-field mappings
   - Select correct field for each column
   - Set currency symbol, decimal separator if needed
4. **Vendor Matching** - Deduplicate vendor names
   - VendorMatcher component shows unique vendor names in file
   - User can rename vendors to match canonical names
5. **Import** - POST to `/api/cog-parser?action=import` with:
   - File + mappings + vendor name mappings
   - Server returns parsed records array
6. **Store** - Records stored in `cog-data-store` (localStorage)

**Output Schema (per record):**
```typescript
{
  po_date?: string
  vendor_name: string
  catalog_number?: string
  description: string
  quantity: number
  unit_of_measure?: string
  cost: number
  purchase_price?: number
  contract_number?: string
  category?: string
  manufacturer?: string
  lot_number?: string
  expiration_date?: string
  case_id?: string
  surgeon?: string
  facility?: string
}
```

---

### Contract Document Upload
**Entry Point:** Contract form (`/dashboard/contracts/new` or edit)

**Flow:**
1. Dropzone accepts PDF, Word, Excel, images
2. Uploaded to Supabase Storage (bucket: presumably `contracts`)
3. Metadata stored in contract document array:
   - name, type (main|amendment|addendum|exhibit|pricing), size, uploadDate, url

---

### Pricing File Upload (Pricing-Specific)
**Entry Point:** PricingFileUpload component

**Flow:**
1. Dropzone accepts CSV or Excel
2. Parsed server-side (similar to COG parser)
3. Stored as `pricingData` in contract:
   ```typescript
   {
     itemNumber: string
     description: string
     unitPrice: number
     contractPrice: number
     savings: number
     category: string
   }
   ```

---

### Case Data Import
**Entry Point:** Case Costing page

**Flow:**
1. User uploads clinical data file (cases, procedures, supplies)
2. User uploads purchasing data file (POs, invoices)
3. System links via caseId and vendorItemNo
4. Results stored in `case-data-store`

**Clinical File Schema:**
- Case Procedures: caseId, cptCode, procedureDescription
- Supply Field: caseId, materialName (contains vendor item #), usedCost, quantity
- Patient Fields: caseId, surgeonName, facilityName, dateOfSurgery

**Purchasing File Schema:**
- PO Records: poId, vendorName, vendorItemNo, quantity, unitCost
- Invoice Records: invoiceNumber, poId, vendorItemNo, invoicePrice, invoiceQuantity

---

## 7. Gotchas & Implementation Notes

### Auth & Security
1. **Demo Mode Hardcoded Credentials**
   - Facility: `demo@tydei.com` / `demo123`
   - Vendor: `vendor@tydei.com` / `vendor123`
   - Used when Supabase not configured (no .env vars)
   - Demo session cookie: `demo_session=true`
   - **NEEDS REMOVAL in production** - replace with Better Auth

2. **User ID Hardcoded in Demo**
   - Demo user ID: `demo-user-id` (static)
   - **NEEDS REPLACEMENT with actual user IDs from Better Auth**

3. **Auth Fallback Chain**
   - Try Supabase → Fall back to demo mode
   - `/dashboard/layout.tsx` and `/vendor/layout.tsx` implement this pattern
   - No explicit error if Supabase env vars missing; silently uses demo

### Data Persistence
1. **All stores use localStorage, not database**
   - `localStorage.getItem()` / `localStorage.setItem()` everywhere
   - **MUST REPLACE with Prisma queries + server functions**
   - Storage keys:
     - `tydei_contracts` - contracts
     - `tydei_vendors` - vendors
     - `tydei_active_contracts` - approved contracts
     - `tydei_pending_contracts` - pending submissions
     - `truecontract_active_contracts` - alternative naming
     - `facility-alerts-state` - facility alerts
     - `vendor-alerts-state` - vendor alerts
     - `tydei_feature_flags` - feature toggles
     - `payor-contracts` - payor contracts
     - Various case/COG/alert stores

2. **No database schema exists** - only TS interfaces
   - Must create Prisma schema from data model documented above

### Feature Flags
- All features currently enabled by default
- Flags stored in localStorage, not database
- Features: purchaseOrdersEnabled, aiAgentEnabled, vendorPortalEnabled, advancedReportsEnabled, caseCostingEnabled

### File Upload Size Limits
- COG Parser API: 50MB file size limit
- Timeout: 60 seconds
- **MUST INCREASE for S3 production use** (multipart uploads)

### Supabase Usage
- Auth only (no RLS policies)
- No Supabase Storage integration in v0 (files not actually uploaded to Supabase)
- Contract documents have optional `url` field but never populated
- **NEEDS IMPLEMENTATION: S3 integration for document storage**

### Vendor Aliasing
- 6 major vendor aliases hardcoded (Stryker, Arthrex, Zimmer, DePuy, Smith & Nephew, Medtronic)
- **NEEDS MIGRATION to database** for extensibility

### Sample Data
- Demo contracts: Arthrex, Stryker, Medtronic, Zimmer Biomet (hardcoded in contract-data-store)
- Demo facilities: Multiple health systems + independent clinics (hardcoded in facility-identity-store)
- Demo alerts: 5 facility + 2 vendor (hardcoded in alert-store)
- Demo payor contract: Anthem BCBS with sample CPT rates (hardcoded in payor-contract-store)
- **All hardcoded data MUST BE REMOVED or migrated to database seed file**

### Missing Auth Checks
- Some pages don't enforce role-based access (e.g., admin pages callable without verification)
- Vendor role checking only in client component (VendorRoleGuard)
- **NEEDS: Server-side middleware + Better Auth authorization**

### Layout & Navigation
- Facility portal uses `DashboardShell` component (not visible in route exports, must be in components/)
- Vendor portal uses `VendorShell` component
- No explicit nav structure config - must be in shell components
- **NEEDS REVIEW: Navigation architecture for production**

### AI Agent
- Tools return mock data, not real contract data
- `/api/ai-agent/route.ts` uses `streamText()` but no system prompt visible
- **NEEDS IMPLEMENTATION: Proper prompt engineering + real data integration**

### Missing Error Handling
- Many API routes don't validate input thoroughly
- No centralized error handling or logging
- **NEEDS: Error boundary + structured logging (e.g., Sentry)**

---

## 8. Design Tokens & Theme Configuration

### Global CSS (`app/globals.css`)
**System:** Tailwind 4 with oklch() color space
**Build:** `@import 'tailwindcss'` and `@import 'tw-animate-css'`

### Color Palette

**Light Mode (`:root`):**
- Background: `oklch(0.99 0.002 250)` - Off-white
- Foreground: `oklch(0.14 0.02 250)` - Dark text
- Primary: `oklch(0.45 0.12 195)` - Deep teal (healthcare feel)
- Secondary: `oklch(0.965 0.003 250)` - Light gray
- Accent: `oklch(0.58 0.18 255)` - Vibrant blue
- Destructive: `oklch(0.55 0.22 25)` - Red
- Success: `oklch(0.62 0.18 155)` - Green/teal
- Warning: `oklch(0.75 0.16 75)` - Amber
- Info: `oklch(0.58 0.18 255)` - Blue

**Dark Mode (`.dark`):**
- Background: `oklch(0.12 0.01 250)` - Near black
- Foreground: `oklch(0.94 0.005 250)` - Off-white
- Primary: `oklch(0.72 0.16 175)` - Bright teal
- Secondary: `oklch(0.2 0.012 250)` - Dark surface
- Accent: `oklch(0.68 0.18 250)` - Electric blue
- Sidebar: `oklch(0.1 0.01 250)` - Even darker for layering

### Chart Colors (8 colors)
```
--chart-1: oklch(0.65 0.18 160) - Teal
--chart-2: oklch(0.58 0.18 255) - Blue
--chart-3: oklch(0.72 0.16 75)  - Amber
--chart-4: oklch(0.62 0.20 25)  - Orange
--chart-5: oklch(0.58 0.16 300) - Purple
--chart-6: oklch(0.55 0.15 180) - Cyan
--chart-7: oklch(0.68 0.18 55)  - Yellow
--chart-8: oklch(0.52 0.18 280) - Indigo
```

### Border Radius
- `--radius: 0.625rem` (10px base)
- `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl` derived

### Fonts
- **Sans:** Inter (system fallback)
- **Mono:** Geist Mono
- Loaded via `next/font/google`

### Custom Utilities
- `.gradient-text` - Gradient text from primary to accent
- `.glass-card` - Glassmorphism effect (dark mode only)
- `.glow-primary` - Subtle glow for primary elements
- `.gradient-border` - Animated gradient border

### Smooth Transitions
- Theme switch: 0.2s ease on background-color and color

### Scrollbar Styling (Dark Mode)
- Custom webkit scrollbar styling
- Thumb color: `oklch(0.3 0.01 250)`

---

## 9. Production Porting Checklist

### Phase 1: Replace Zustand/localStorage with Prisma
- [ ] Create Prisma schema from data model (Section 2)
- [ ] Generate migration scripts
- [ ] Create database (PostgreSQL recommended)
- [ ] Replace all `localStorage.getItem/setItem` with Prisma queries
- [ ] Convert Zustand hooks to server functions or API routes
- [ ] Implement database transactions for multi-entity operations

### Phase 2: Auth Migration (Supabase → Better Auth)
- [ ] Install Better Auth dependency
- [ ] Remove Supabase auth imports
- [ ] Implement Better Auth session management
- [ ] Migrate user metadata (role, facility_id) to Better Auth session
- [ ] Update `/middleware.ts` for Better Auth
- [ ] Update `/app/layout.tsx` and layout wrappers
- [ ] Remove demo mode fallback (demo_session cookie)
- [ ] Set up password reset/email verification
- [ ] Implement multi-factor auth (optional)

### Phase 3: File Storage (localStorage → S3)
- [ ] Create S3 bucket for contract documents
- [ ] Create S3 bucket for pricing files
- [ ] Implement pre-signed URL generation for uploads
- [ ] Update upload components to use S3 client
- [ ] Store S3 object keys in Prisma (not Supabase)
- [ ] Implement file deletion on contract/vendor deletion
- [ ] Add virus scanning (ClamAV or equivalent)
- [ ] Configure bucket CORS and lifecycle policies

### Phase 4: API Routes & Server Functions
- [ ] Convert `/api/cog-parser` to use Prisma + S3
- [ ] Convert `/api/ai-agent` to use real contract data from Prisma
- [ ] Create CRUD endpoints for contracts, vendors, facilities, users
- [ ] Implement proper authorization checks (Better Auth + role checks)
- [ ] Add input validation (Zod schemas)
- [ ] Add error logging/monitoring

### Phase 5: Remove Hardcoded Data
- [ ] Remove demo contracts from contract-data-store
- [ ] Remove demo facilities from facility-identity-store
- [ ] Remove demo alerts from alert-store
- [ ] Remove demo payor contract from payor-contract-store
- [ ] Remove vendor alias hardcoding (migrate to database)
- [ ] Create database seed script for initial data if needed
- [ ] Remove DEMO_CREDENTIALS from login page
- [ ] Remove demo session logic from layouts

### Phase 6: Component Updates
- [ ] Update stores imports (remove Zustand, use server functions)
- [ ] Update forms to use server actions (mutations)
- [ ] Update data fetching to use `revalidatePath()` for cache
- [ ] Remove `use client` where possible (move logic to server)
- [ ] Add loading/error states using Suspense boundaries
- [ ] Update TypeScript types from interfaces to Prisma types

### Phase 7: Testing & Deployment
- [ ] Set up test database (ephemeral for CI)
- [ ] Create E2E tests for critical flows (contract creation, import, approval)
- [ ] Set up CI/CD pipeline (GitHub Actions, Vercel, etc.)
- [ ] Configure production environment variables
- [ ] Set up monitoring/error tracking (Sentry)
- [ ] Load testing for file uploads
- [ ] Security audit (OWASP Top 10)
- [ ] Deploy to staging, then production

### Phase 8: Feature Enhancements
- [ ] Implement real AI agent with LLM integration
- [ ] Add email notifications for alerts, contract renewals
- [ ] Implement audit logging (all data changes)
- [ ] Add approval workflows (multi-step contract approval)
- [ ] Implement contract versioning (document history)
- [ ] Add data export (PDF, Excel) functionality
- [ ] Implement webhook support for external systems
- [ ] Add API for vendor integration (contract submission)

---

## 10. Key Files Summary

### Core Stores (22 total)
| File | Exports | Key Type |
|------|---------|----------|
| contract-data-store.ts | Contract interface + functions | Core domain entity |
| vendor-store.ts | Vendor interface + CRUD | Core domain entity |
| active-contracts-store.ts | useActiveContracts hook | Combined state |
| pending-contracts-store.ts | PendingContract interface | Workflow state |
| payor-contract-store.ts | usePayorContractStore (Zustand) | Insurance rates |
| case-data-store.ts | CaseRecord interface + functions | Clinical + purchasing |
| cog-data-store.ts | COG functions (import only) | Data import |
| alert-store.ts | useAlerts hook | Notifications |
| facility-identity-store.ts | useFacilityIdentity (Zustand) | Multi-facility access |
| vendor-identity-store.ts | VendorIdentity interface | Vendor user profile |
| vendor-role-store.ts | useVendorRole hook + permissions | Role-based access |
| category-store.ts | Category functions | Taxonomy |
| credit-store.ts | Credit tracking | Financial |
| contract-change-proposals-store.ts | Change proposal tracking | Workflow |
| connection-store.ts | Facility-vendor connections | Relationships |
| vendor-benchmark-store.ts | Benchmark data | Performance |
| feature-flags-store.ts | useFeatureFlags hook | Feature toggles |

### API Routes (7 total)
| Route | Method | Purpose |
|-------|--------|---------|
| /api/cog-parser | POST | CSV/Excel import |
| /api/ai-agent | POST | Chat endpoint |
| /api/parse-cog-csv | POST | Alternative CSV parser |
| /api/extract-payor-contract | POST | Contract extraction |
| /api/analyze-deal | POST | Deal analysis |
| /api/match-supplies | POST | Supply matching |
| /api/parse-contract-pdf | POST | PDF extraction |

### Page Anatomy (53 total pages)
- 3 auth pages
- 32 dashboard/facility pages
- 16 vendor pages
- 6 admin pages
- Utility pages: force-clear, clear-cog

### Component Breakdown
- 59 shadcn/ui components
- 30+ custom feature components
- 5 layout shells
- 3 theme components

---

## 11. Recommended Production Architecture

### Database Schema (Prisma)
```prisma
model User {
  id String @id @default(cuid())
  email String @unique
  name String?
  role Role // system_admin | facility_admin | manager | analyst | viewer | vendor_admin | vendor_rep
  
  // Better Auth session management
  emailVerified DateTime?
  image String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  // Role-specific data
  facilityAdmin FacilityAdmin?
  vendorAdmin VendorAdmin?
  vendorRep VendorRep?
  
  // Access control
  assignedFacilities Facility[] @relation("assigned")
  healthSystemAccess HealthSystem[] @relation("systemAccess")
  
  // Activity logging
  auditLogs AuditLog[]
}

model Facility {
  id String @id @default(cuid())
  name String @unique
  code String @unique
  type FacilityType
  parentSystem HealthSystem? @relation(fields: [parentSystemId], references: [id])
  parentSystemId String?
  address String
  city String
  state String
  region String
  beds Int?
  
  // Relationships
  contracts Contract[] @relation("facilityContracts")
  users User[] @relation("assigned")
  cases CaseRecord[]
  alerts Alert[]
  payorContracts PayorContract[]
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Vendor {
  id String @id @default(cuid())
  name String @unique // Canonical name
  displayName String?
  aliases String[] // For matching variants
  division String?
  parentVendor Vendor? @relation("divisions", fields: [parentVendorId], references: [id])
  parentVendorId String?
  childVendors Vendor[] @relation("divisions")
  
  source VendorSource // manual | contract | pricing_file | cog
  sourceId String? // ID from source system
  
  contact ContactInfo?
  isActive Boolean @default(true)
  
  contracts Contract[]
  pendingContracts PendingContract[]
  purchaseOrders PurchaseOrder[]
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Contract {
  id String @id @default(cuid())
  name String
  contractId String @unique // Reference ID
  vendor Vendor @relation(fields: [vendorId], references: [id])
  vendorId String
  
  type ContractType // usage | pricing_only | capital | etc.
  status ContractStatus
  
  facilities Facility[] @relation("facilityContracts")
  
  effectiveDate DateTime
  expirationDate DateTime
  
  // Financial
  totalValue Decimal
  rebateEarned Decimal @default(0)
  currentSpend Decimal @default(0)
  rebatesCollected Decimal @default(0)
  
  // Performance
  currentTier Int @default(1)
  maxTier Int
  marketShareCommitment Decimal?
  currentMarketShare Decimal @default(0)
  complianceRate Decimal @default(100)
  productCategory String
  commitmentThreshold Decimal?
  
  // Content
  pricing PricingItem[]
  rebateTiers RebateTier[]
  terms ContractTerm[]
  documents ContractDocument[]
  
  // Workflow
  createdBy String
  approvedBy String?
  approvedAt DateTime?
  
  // Audit
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// ... (continue with PendingContract, CaseRecord, PayorContract, etc.)
```

### Server Function Patterns
```typescript
// app/actions/contracts.ts
'use server'

import { betterAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { contractSchema } from '@/lib/schemas'
import { revalidatePath } from 'next/cache'

export async function createContract(data: typeof contractSchema) {
  const session = await betterAuth.api.getSession()
  if (!session || !['facility_admin', 'manager'].includes(session.user.role)) {
    throw new Error('Unauthorized')
  }
  
  const contract = await prisma.contract.create({
    data: {
      ...data,
      createdBy: session.user.id,
    },
  })
  
  revalidatePath('/dashboard/contracts')
  return contract
}
```

### S3 Integration
```typescript
// lib/s3.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const s3 = new S3Client({ region: 'us-east-1' })

export async function getUploadUrl(key: string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: 'tydei-documents',
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(s3, command, { expiresIn: 3600 })
}
```

---

## Summary Table

| Category | Count | Status |
|----------|-------|--------|
| Pages (routes) | 53 | Mapped |
| Stores (Zustand + custom) | 22 | Need Prisma replacement |
| Components (custom) | 30+ | Need integration |
| UI Components (shadcn) | 59 | Ready |
| API Routes | 7 | Need validation |
| Design Tokens | Custom oklch | Ready |
| Auth | Supabase | Need Better Auth |
| Storage | localStorage | Need Prisma + S3 |
| External APIs | Supabase, Vercel AI | Need Better Auth + LLM |

**Estimated Effort:** 4-6 weeks for full production port (with experienced team)

