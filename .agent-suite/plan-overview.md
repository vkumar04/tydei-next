# TYDEi Platform -- High-Level Build Plan

## Architecture Summary

TYDEi is a multi-tenant healthcare contract management SaaS with three portals (Facility, Vendor, Admin). The core domain is the contract lifecycle: creation, term/tier management, spend tracking against tiers, rebate calculation, invoice validation, and renewal. All data flows through a dependency chain:

```
Auth -> Users -> Facilities/HealthSystems/Vendors
  -> Contracts -> Terms -> Tiers
  -> COG Data / Pricing Files
  -> Purchase Orders -> Invoices
  -> Alerts
  -> Rebates / Payments / Credits
  -> Cases -> Procedures / Supplies
  -> Reports / Analytics
```

The build is organized into 11 phases. Each phase is independently deployable and functional. Phases 0-5 cover the full MVP. Phases 6-10 cover P2/P3 features (AI, case costing, admin portal, advanced analytics).

---

## Phase 0 -- Scaffold

**Next.js 16 project setup with all infrastructure, zero business logic.**

Set up the project skeleton with all tooling configured so every subsequent phase can focus purely on features. This includes the database running locally via Docker Compose, the ORM configured, the UI system installed, and the folder structure established.

### Key Deliverables
- Next.js 16 (App Router) project initialized with Bun
- TypeScript strict mode, Oxlint configuration
- Tailwind CSS v4 with `theme.css` applied (teal/blue healthcare theme from `.agent-suite/theme.css`)
- shadcn/ui installed (new-york style) with base components: Button, Card, Input, Select, Dialog, Tabs, Badge, Table, ScrollArea, Avatar, DropdownMenu, Separator, Switch, Checkbox, Progress, Accordion, Collapsible, Tooltip, Popover, Calendar, Sheet, Skeleton, Label, Textarea, Command
- Docker Compose for local PostgreSQL (port 5432)
- Prisma 7 initialized with `prisma.config.ts` and `@prisma/adapter-pg`
- Inter + Geist Mono fonts configured
- next-themes for dark/light/system toggle (dark default)
- Sonner toast provider
- TanStack Query provider (`QueryClientProvider`)
- Recharts installed (no charts yet)
- Lucide React installed
- Folder structure:
  ```
  app/
    (auth)/          -- login, sign-up, auth-error routes
    (facility)/      -- facility portal routes (behind auth)
    (vendor)/        -- vendor portal routes (behind auth)
    (admin)/         -- admin portal routes (behind auth)
    (marketing)/     -- landing page, public routes
    api/             -- API routes
    layout.tsx       -- root layout with providers
  components/
    ui/              -- shadcn components
    shared/          -- cross-portal shared components
    facility/        -- facility-specific components
    vendor/          -- vendor-specific components
    admin/           -- admin-specific components
  lib/
    db.ts            -- Prisma client singleton
    auth.ts          -- Better Auth client
    auth-server.ts   -- Better Auth server config
    utils.ts         -- cn() and shared utilities
    validators.ts    -- shared Zod schemas
  hooks/             -- custom React hooks
  ```
- `proxy.ts` stub (Next.js 16 -- NOT middleware.ts)
- `.env.example` with all required variables
- `railway.toml` stub for future deployment

### Dependencies
- None (first phase)

---

## Phase 1 -- Foundation (Schema + Auth + Layouts)

**Prisma schema with all core models, Better Auth with Prisma plugin + org plugin + Resend emails, seed data, and the three portal shell layouts.**

This phase establishes the entire data model (translated from the v0 SQL schemas), authentication with role-based access, and the navigational chrome for all three portals. After this phase, a user can register, log in, and see an empty but navigable portal.

### Key Deliverables
- **Prisma schema** with all core models:
  - `User` (Better Auth managed) with role enum (facility / vendor / admin)
  - `Organization` (Better Auth org plugin) for multi-tenant facility and vendor orgs
  - `HealthSystem` with one-to-many Facilities
  - `Facility` (id, name, type, address, city, state, zip, healthSystemId, status)
  - `Vendor` (id, name, code, displayName, division, parentVendorId, contactName, contactEmail, contactPhone, website, status, tier)
  - `ProductCategory` (id, name, description, parentId -- self-referential tree)
  - `Contract` (id, contractNumber, name, vendorId, facilityId, contractType enum, status enum, effectiveDate, expirationDate, autoRenewal, terminationNoticeDays, totalValue, annualValue, description, notes, gpoAffiliation, performancePeriod enum, rebatePayPeriod enum, isGrouped, isMultiFacility, tieInCapitalContractId, createdById)
  - `ContractTerm` (id, contractId, termName, termType enum, baselineType enum, evaluationPeriod, paymentTiming, appliesTo, effectiveStart, effectiveEnd, volumeType, spendBaseline, volumeBaseline, growthBaselinePercent, desiredMarketShare)
  - `ContractTier` (id, termId, tierNumber, spendMin, spendMax, volumeMin, volumeMax, marketShareMin, marketShareMax, rebateType enum, rebateValue)
  - `ContractPricing` (id, contractId, vendorItemNo, description, category, unitPrice, uom, listPrice, discountPercentage, effectiveDate, expirationDate)
  - `ContractDocument` (id, contractId, name, type enum, uploadDate, effectiveDate, size, url)
  - `PendingContract` (vendor submissions with approval workflow status)
  - `Alert` (id, portalType, alertType enum, title, description, severity, status, relatedContractId, relatedVendorId, metadata)
  - `COGRecord` (id, facilityId, vendorId, inventoryNumber, inventoryDescription, vendorItemNo, manufacturerNo, unitCost, extendedPrice, quantity, transactionDate, category)
  - `PricingFile` (id, vendorId, facilityId, vendorItemNo, manufacturerNo, productDescription, listPrice, contractPrice, effectiveDate, expirationDate)
  - `PurchaseOrder` + `POLineItem`
  - `Invoice` + `InvoiceLineItem`
  - `ContractPeriod` (spend/rebate tracking per period)
  - `Rebate`, `Payment`, `Credit`
  - `VendorNameMapping`, `CategoryMapping` (for COG import matching)
  - All enums: ContractType, ContractStatus, TermType, VolumeType, RebateType, BaselineType, AlertType, AlertStatus, PerformancePeriod, etc.
- **Zod validators** auto-generated from Prisma via zod-prisma-types
- **Better Auth** setup:
  - Email/password authentication
  - Organization plugin (facilities and vendors as organizations)
  - Role-based access (facility, vendor, admin)
  - Session management
- **`proxy.ts`** with route protection:
  - `/dashboard/*` requires facility role
  - `/vendor/*` requires vendor role
  - `/admin/*` requires admin role
  - Unauthenticated users redirect to `/auth/login`
- **Seed script** (`prisma/seed.ts`):
  - 2 health systems, 4 facilities, 3 vendors, 5 product categories
  - Demo users for each role (facility, vendor, admin)
  - 5-8 sample contracts with terms and tiers
- **Portal shell layouts**:
  - Facility sidebar layout (DashboardShell) with all nav items from analysis
  - Vendor sidebar layout (VendorShell) with all nav items
  - Admin sidebar layout with all nav items
  - Shared header with theme toggle, user avatar dropdown, portal-specific selectors
  - Responsive: collapsible sidebar on mobile
- **Empty dashboard pages** (just the layout + "Coming soon" placeholder) for all three portals

### Dependencies
- Phase 0 (scaffold)

---

## Phase 2 -- Contract Management (Core CRUD)

**Full contract CRUD for the facility portal: list, create, edit, view, delete. This is the primary value driver of the entire platform.**

Contracts are the central entity. This phase delivers the complete contract management experience for facility users, including the complex term/tier structures, multi-step creation form, and contract listing with search/filter/sort.

### Key Deliverables
- **Contracts list page** (`/dashboard/contracts`):
  - TanStack Table with columns: name, vendor, type, status, effective/expiration dates, value, rebate
  - Search by name/vendor, filter by status (active/pending/expired/draft), filter by type, filter by facility
  - Summary cards: total contracts, total value, total rebates
  - Row actions: view, edit, delete (with confirm dialog)
- **New contract form** (`/dashboard/contracts/new`):
  - Multi-step form using TanStack Form
  - Step 1: Basic info (name, ID, type, vendor select, product category, dates, performance/rebate pay periods, total/margin, description)
  - Step 2: Terms entry -- add multiple terms, each with type, baseline, tiers (dynamic tier rows with spend/volume/market-share ranges and rebate type/value)
  - Step 3: Facilities selection (single or multi-facility toggle)
  - Step 4: Review and submit
  - All fields validated with Zod
- **Contract detail page** (`/dashboard/contracts/[id]`):
  - Overview card with all contract metadata
  - Terms section with tier visualization (progress bars showing spend vs. thresholds)
  - Documents section (list uploaded files -- upload comes in Phase 5)
  - Quick actions: edit, delete, view score (placeholder)
- **Contract edit page** (`/dashboard/contracts/[id]/edit`):
  - Pre-populated form matching creation form
  - Tabs: Basic Info, Terms, Documents
  - Term add/edit/delete with tier management
- **Server actions** for all CRUD operations with proper auth checks
- **Vendor and ProductCategory selectors** (reusable components querying from DB)

### Dependencies
- Phase 1 (schema, auth, layouts)

---

## Phase 3 -- COG Data + Pricing Files + Vendor Management

**COG data import pipeline, pricing file management, and vendor CRUD. These feed the contract spend tracking and invoice validation that come later.**

COG (Cost of Goods) data is the transaction-level spend data that facilities import from their ERP/purchasing systems. This phase builds the import pipeline, vendor management (since vendor names in COG data need normalization), and pricing file management.

### Key Deliverables
- **COG Data page** (`/dashboard/cog-data`):
  - Tabs: COG Records, Pricing Files, Upload History
  - COG records table with search, date range filter, vendor filter
  - Manual record entry dialog
  - Bulk delete capability
- **CSV/Excel import pipeline**:
  - File upload (drag-and-drop) accepting CSV and XLSX
  - Server-side parsing with `xlsx` library
  - Column mapping UI (map uploaded columns to target fields)
  - Duplicate detection with resolution options (skip, overwrite, keep both)
  - Vendor name matching against known vendors (fuzzy match with VendorNameMapping table)
  - Import progress indicator
  - Import summary (records added, duplicates skipped, errors)
- **Pricing file management**:
  - Upload pricing files (CSV/XLSX) linked to vendor + facility
  - Pricing file list with vendor, effective date, item count
  - View pricing file contents in table
  - Link pricing files to contracts
- **Vendor CRUD** (facility-side):
  - Vendors list in Settings > Vendors tab
  - Add vendor dialog, edit vendor, deactivate vendor
  - Vendor name normalization: when COG import finds unknown vendor names, create mapping records
  - VendorNameMapping management UI
- **Category management**:
  - Product category tree (hierarchical)
  - Category CRUD in settings
  - CategoryMapping for COG import matching

### Dependencies
- Phase 2 (contracts exist to link pricing files to)

---

## Phase 4 -- Alerts + Dashboard Analytics + Reports

**Alert system, facility dashboard with charts, and report generation. This phase makes the data actionable.**

With contracts and COG data in place, the system can now generate alerts (expiring contracts, tier thresholds), calculate dashboard metrics, and produce reports. This is where the platform transitions from data entry to data intelligence.

### Key Deliverables
- **Alert system**:
  - Alert generation logic (server-side, triggered on data changes):
    - Expiring contracts (30/60/90 days out)
    - Tier threshold proximity (within 10% of next tier)
    - Rebate payment due dates
    - Off-contract purchase detection (COG items not matching any contract pricing)
  - Alerts page (`/dashboard/alerts`) with tabs: All, Off-Contract, Expiring, Tier Threshold, Rebate Due
  - Alert cards with type badge, severity indicator, timestamp, action link
  - Bulk resolve/dismiss
  - Alert detail page (`/dashboard/alerts/[id]`) with metadata and related entity links
  - Unread count badge in sidebar nav
- **Facility dashboard** (`/dashboard`):
  - Date range filter (default: current quarter)
  - 4 metric cards: Total Contract Value, Total Rebates Earned, Active Alerts, Compliance Rate
  - Charts (Recharts):
    - Earned rebate by month (stacked bar by vendor)
    - Total spend by vendor (horizontal bar)
    - Contract lifecycle (donut: active/expired/expiring)
    - Spend needed for next tier (grouped bar)
  - Recent contracts table (5 most recent)
  - Recent alerts list (5 most recent)
- **Reports page** (`/dashboard/reports`):
  - Report types: Usage, Service, Tie-In, Capital, Grouped
  - Period data tables: spend, volume, rebate earned/collected, payment expected/actual
  - Trend charts per report type
  - Export to CSV/PDF
  - Price discrepancy report (`/dashboard/reports/price-discrepancy`)

### Dependencies
- Phase 3 (COG data needed for spend calculations, off-contract detection)

---

## Phase 5 -- Vendor Portal + File Storage + Purchase Orders + Invoices

**Complete vendor portal, S3 file storage for documents, purchase order workflow, and invoice validation. This phase completes the dual-portal MVP.**

The vendor portal mirrors much of the facility portal but from the vendor's perspective. This phase also adds document upload (contract PDFs, amendments) via S3-compatible storage and the transactional workflows (POs and invoices).

### Key Deliverables
- **Vendor dashboard** (`/vendor`):
  - Metric cards: Total Contracts, Total Spend, Total Rebates, Active Facilities
  - Spend trend charts (bar + line)
- **Vendor contracts** (`/vendor/contracts`):
  - Tabs: Active, Pending Submissions, Expired
  - Contract list table (filtered to vendor's own contracts)
  - View contract detail with spend tracking and tier progress
- **Vendor contract submission** (`/vendor/contracts/new`):
  - Submission form: contract type, facility selector, dates, terms with tiers
  - Pricing file upload
  - Document upload
  - Submit for facility approval
- **Contract approval workflow** (facility side):
  - Pending contracts tab in facility contracts list
  - Review dialog: approve, reject, request revision with notes
  - Status transitions: submitted -> approved/rejected/revision_requested
  - Notification alerts on status change
- **Vendor alerts** (`/vendor/alerts`):
  - Vendor-specific alerts (contract expiry, compliance, tier thresholds)
- **S3-compatible file storage**:
  - Upload API route with presigned URLs
  - Contract document upload/download
  - Pricing file storage
  - COG file archive storage
  - File metadata tracking in ContractDocument model
- **Purchase orders** (`/dashboard/purchase-orders`):
  - PO creation form with product search from COG data
  - Line item builder with contract price lookup
  - Auto-calculate extended prices
  - Status workflow: draft -> pending -> approved -> sent -> completed/cancelled
  - PO list table with status filters
- **Invoice validation** (`/dashboard/invoice-validation`):
  - Invoice upload (CSV/XLSX)
  - Auto-match line items to contract pricing
  - Discrepancy flagging with variance percentages
  - Tabs: Pending, Resolved, Flagged
  - Dispute dialog for flagged items
- **Vendor invoices** (`/vendor/invoices`):
  - Invoice upload and tracking from vendor side
  - Status visibility

### Dependencies
- Phase 4 (alerts system, dashboard patterns established)

---

## Phase 6 -- Contract Renewals + Rebate Optimizer + Settings

**Contract renewal tracking, rebate optimization engine, and full settings pages for both portals. Rounds out the core experience.**

### Key Deliverables
- **Contract renewals** (`/dashboard/contract-renewals`):
  - Timeline view of expiring contracts (30/60/90/120 day windows)
  - Renewal window indicators with days until expiry
  - Spend and rebate summary per expiring contract
  - Renewal initiation dialog
  - Notification scheduling for upcoming renewals
- **Vendor renewals** (`/vendor/renewals`):
  - Vendor's renewal pipeline view
  - Strategy planning interface
- **Rebate optimizer** (`/dashboard/rebate-optimizer`):
  - Load all contracts with rebate tiers
  - Compare current spend against tier thresholds
  - Identify contracts close to next tier (within configurable threshold)
  - Project additional rebate if threshold is met
  - Bar chart visualization: current spend vs. tier thresholds
  - Spend target setting and progress tracking
- **Facility settings** (`/dashboard/settings`):
  - Tabs: Profile, Notifications, Vendors, Team, Feature Flags
  - Profile editing (facility name, address, contact info)
  - Notification preferences (email toggles for alert types)
  - Team management: invite users with role assignment, list/edit/remove members
  - Feature flags: toggle purchase orders, case costing, AI agent (stored per facility)
- **Vendor settings** (`/vendor/settings`):
  - Profile management (company info, logo, divisions)
  - Team management with vendor sub-roles (admin, manager, rep)
  - Notification preferences
  - Facility connections (invite/accept/reject system via Connection model)

### Dependencies
- Phase 5 (vendor portal, PO/invoice features to optimize around)

---

## Phase 7 -- Landing Page + Auth Polish + Marketing

**Public-facing landing page, sign-up flow, auth error handling, and marketing pages.**

### Key Deliverables
- **Landing page** (`/`):
  - Hero section with gradient text and CTA buttons
  - Value proposition cards (facility benefits, vendor benefits)
  - Feature grid with icons
  - Capabilities section
  - Stats bar (facilities, vendors, contracts managed)
  - Footer with links
  - Responsive design, glass-card effects in dark mode
- **Auth flow polish**:
  - Login page with email/password form
  - Sign-up page with role selection (facility/vendor), org creation
  - Sign-up success / email verification page
  - Auth error page
  - Forgot password / reset password flow
  - Demo mode with one-click demo login per role
- **Marketing pages** (if needed): About, Pricing, Contact

### Dependencies
- Phase 1 (auth must exist)
- Can be built in parallel with Phases 2-6

---

## Phase 8 -- Case Costing + Prospective Analysis

**Surgical case cost analysis with surgeon scorecards, and financial analysis tools (capital contract depreciation, prospective deal analysis).**

### Key Deliverables
- **Case costing** (`/dashboard/case-costing`):
  - Case data upload (CSV with case ID, surgeon, date, CPT code, supplies)
  - Case records table with search/filter
  - Per-case cost breakdown: supplies, on-contract vs. off-contract
  - Surgeon scorecards: payor mix, spend per case, compliance rate, OR time
  - CPT code analysis: average cost by procedure
  - Charts: cost distribution, surgeon comparison radar
- **Surgeon comparison** (`/dashboard/case-costing/compare`):
  - Side-by-side surgeon comparison for specific procedures
  - Bar charts comparing costs, volumes, and outcomes
- **Case costing reports** (`/dashboard/case-costing/reports`):
  - Surgeon-level contract contribution and rebate attribution
  - Margin analysis (reimbursement vs. supply cost)
- **Prisma models**: Case, CaseProcedure, CaseSupply, SurgeonUsage, CaseCostingFile
- **Financial analysis** (`/dashboard/analysis`):
  - Capital contract MACRS depreciation modeling
  - Price decrease projections
  - Vendor spend trends
  - Category spend trends
- **Prospective analysis** (`/dashboard/analysis/prospective`):
  - Upload vendor proposal/pricing
  - Compare proposed vs. current COG prices
  - Deal scoring with radar chart
  - Financial projections (future value analysis)
- **Vendor prospective** (`/vendor/prospective`):
  - Proposal builder with multi-facility support
  - Pricing file upload and analysis
  - Deal scoring from vendor perspective

### Dependencies
- Phase 3 (COG data for cost comparisons)
- Phase 4 (dashboard/reporting patterns)

---

## Phase 9 -- AI Features

**AI-powered contract extraction, chat agent, deal analysis, and supply matching. All AI features gated behind feature flags and credit system.**

### Key Deliverables
- **AI contract PDF extraction** (in contract creation flow):
  - PDF upload on new contract page
  - AI extracts: contract name, vendor, type, dates, terms, tier structures
  - Structured output via Zod schema
  - User reviews and edits extracted data before saving
- **AI chat agent** (`/dashboard/ai-agent` and `/vendor/ai-agent`):
  - Streaming chat interface using TanStack AI (or Vercel AI SDK -- TBD)
  - Suggested questions per portal
  - Tool-calling for structured data retrieval (contract performance, market share, spend analysis)
  - Document upload for AI analysis
- **AI deal analysis** (vendor prospective and facility contract scoring):
  - Contract scoring page (`/dashboard/contracts/[id]/score`) with radar chart
  - Multi-dimension scoring: financial value, rebate efficiency, compliance, market share, pricing competitiveness
  - AI-powered negotiation advice for vendor proposals
- **AI supply matching** (case costing):
  - Match surgical supplies to contract pricing via AI when vendor_item_no doesn't exact-match
- **Credit system**:
  - AI credit tracking per facility/vendor
  - Usage metering on AI API calls
  - Credit display in settings
  - Tier definitions (Starter/Professional/Enterprise) -- billing integration in Phase 10

### Dependencies
- Phase 8 (case costing for supply matching, prospective analysis for deal scoring)
- Phase 2 (contracts for PDF extraction)

---

## Phase 10 -- Admin Portal + Billing + Advanced Features

**Platform operator portal for multi-tenant management, billing with Stripe, and remaining P3 features.**

### Key Deliverables
- **Admin dashboard** (`/admin`):
  - Platform-wide stats: total facilities, vendors, users, MRR, active contracts
  - Recent activity feed
  - Pending actions (new facility setup, trial expiration, failed payments)
- **Admin facilities** (`/admin/facilities`):
  - CRUD table for facility tenants
  - Health system assignment
  - User count and contract count per facility
- **Admin vendors** (`/admin/vendors`):
  - CRUD table for vendor tenants
  - Status management (active/inactive/suspended)
- **Admin users** (`/admin/users`):
  - User management with role-based filtering
  - CRUD with role assignment
  - Bulk operations
- **Admin billing** (`/admin/billing`):
  - Stripe integration for subscription management
  - Invoice history (paid/pending/overdue)
  - MRR tracking
  - AI credit tier management
- **Payor contracts** (`/admin/payor-contracts`):
  - Payor (insurance) contract management
  - CPT code rate schedules, grouper rates
  - Multi-procedure rules, implant passthrough settings
  - Assign payor contracts to facilities
- **Contract change proposals** (vendor -> facility):
  - Vendor proposes term changes with before/after comparison
  - Facility reviews, approves/rejects
  - Messaging between vendor and facility on proposals
- **Vendor market share** (`/vendor/market-share`):
  - Market share by facility, category, and trend
  - AI category normalization (merge similar category names)
- **Vendor performance** (`/vendor/performance`):
  - KPIs: compliance rate, on-time delivery, quality scores
  - Radar chart for multi-dimension scoring
  - Historical trends
- **Vendor benchmarking**:
  - ProductBenchmark data management
  - National average pricing comparison
  - Percentile analysis
- **Report scheduling**:
  - Schedule report delivery (daily/weekly/monthly)
  - Email delivery via background job
  - ReportSchedule CRUD
- **Forecasting**:
  - Linear regression and seasonal decomposition for spend/rebate predictions
  - Projected spend and rebate charts on dashboard

### Dependencies
- Phase 5 (vendor portal complete)
- Phase 9 (AI features for credit billing)

---

## Phase Summary

| Phase | Name | Focus | Est. Complexity |
|-------|------|-------|----------------|
| 0 | Scaffold | Project setup, tooling, folder structure | Low |
| 1 | Foundation | Schema, auth, seed, layouts | High |
| 2 | Contract Management | Contract CRUD (facility) | High |
| 3 | COG Data + Pricing | Import pipeline, vendor mgmt | High |
| 4 | Alerts + Analytics | Alert system, dashboard, reports | Medium-High |
| 5 | Vendor Portal + PO/Invoice | Vendor portal, file storage, PO/invoice | High |
| 6 | Renewals + Optimizer + Settings | Renewal tracking, rebate optimizer, settings | Medium |
| 7 | Landing + Auth Polish | Marketing, auth flows, demo mode | Medium |
| 8 | Case Costing + Analysis | Surgical cases, financial analysis | High |
| 9 | AI Features | PDF extraction, chat agent, deal scoring | High |
| 10 | Admin + Billing + Advanced | Admin portal, Stripe, P3 features | High |

**MVP = Phases 0-5** (dual portal with contract management, COG data, alerts, dashboards, POs, invoices, file storage).

**Full Platform = Phases 0-10** (all features from v0 prototype, fully backed by PostgreSQL + Better Auth + S3).
