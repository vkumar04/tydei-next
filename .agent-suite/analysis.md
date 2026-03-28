# App Analysis: TYDEi Platform

## Overview
TYDEi Platform is a comprehensive healthcare contract management SaaS application designed for facilities (hospitals, ASCs, surgery centers) and medical device/supply vendors. It provides dual portals where facilities track vendor contracts, rebate tiers, cost-of-goods data, case costing, and invoice validation, while vendors manage their own contracts, submit proposals, track performance, and maintain market share compliance. The platform also includes an operator/admin portal for managing tenants (facilities and vendors), users, and billing.

## Source
- **Platform:** v0.dev
- **Analyzed on:** 2026-03-28
- **Tool:** Vinci (Analyzer Agent) -- local file analysis

## Target Users
- **Primary:** Healthcare facility supply chain managers and materials management staff who need to track vendor contracts, calculate rebates, validate invoices, and analyze cost of goods
- **Secondary:** Medical device/supply vendor sales representatives and account managers who need to submit contracts, track performance, and manage proposals across multiple facilities
- **Tertiary:** Platform operators/admins managing multi-tenant facility and vendor onboarding, billing, and user administration

## Pages & Routes

### Landing Page
- **Route:** `/`
- **Layout:** Standalone (no sidebar)
- **Description:** Marketing/landing page with hero section, value proposition cards, feature grid, capabilities section, and CTA. Includes stats bar and footer. Links to Facility Portal and Vendor Portal.
- **Key Components:** ThemeToggle, Card, Badge, Button
- **Data Sources:** Static content
- **User Actions:** Navigate to login, sign-up, facility portal, vendor portal

### Login
- **Route:** `/auth/login`
- **Layout:** Centered card (no sidebar)
- **Description:** Email/password login form with demo mode buttons for Facility and Vendor portals. Sets `demo_session` cookie for bypass. Links to admin portal.
- **Key Components:** Input, Button, Card
- **Data Sources:** Supabase Auth (with demo fallback)
- **User Actions:** Login with credentials, demo login as facility or vendor, navigate to sign-up or admin

### Sign Up
- **Route:** `/auth/sign-up`
- **Layout:** Centered card (no sidebar)
- **Description:** Registration form with full name, email, account type (facility/vendor), password, and confirm password. Uses Supabase Auth sign-up with email confirmation redirect.
- **Key Components:** Input, Select, Button, Card
- **Data Sources:** Supabase Auth
- **User Actions:** Create account (facility or vendor role)

### Sign Up Success
- **Route:** `/auth/sign-up-success`
- **Layout:** Centered card
- **Description:** Post-registration confirmation prompting user to check email for verification link.
- **Key Components:** Card, Button
- **Data Sources:** None
- **User Actions:** Navigate back to login

### Auth Error
- **Route:** `/auth/error`
- **Layout:** Centered card
- **Description:** Generic authentication error page with retry link.
- **Key Components:** Card, Button
- **Data Sources:** None
- **User Actions:** Retry login

---

### Facility Dashboard
- **Route:** `/dashboard`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Overview page with date-range filters, 4 metric cards (contract value, rebates, alerts, compliance), charts (earned rebate by month, spend by vendor, contract lifecycle), recent contracts table, and recent alerts list.
- **Key Components:** DashboardMetrics, DashboardCharts, DashboardFilters, RecentContracts, RecentAlerts
- **Data Sources:** contract-data-store, cog-data-store, alert-store
- **User Actions:** Filter by date range, navigate to contracts/alerts

### Contracts List
- **Route:** `/dashboard/contracts`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Tabbed view with "All Contracts" table and "Compare" mode. Summary cards for total contracts, total value, total rebates. Filters by search, status (active/pending/expired/draft), type (usage/pricing_only/capital/GPO), and facility. Table shows contract name, vendor, type, status, effective/expiration dates, value, rebate, and score badge. Actions: view, edit, delete, compare.
- **Key Components:** Table, Tabs, ContractScoreBadge, Dialog
- **Data Sources:** contract-data-store, cog-data-store, pending-contracts-store
- **User Actions:** Create new contract, search/filter, view details, edit, delete, compare contracts

### New Contract
- **Route:** `/dashboard/contracts/new`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Multi-step contract creation with three entry modes: AI (PDF upload with auto-extraction), Manual form, or PDF upload. Form fields include contract name, ID, type (usage/capital/tie-in/grouped/pricing_only), vendor selection, product categories, dates, performance/rebate pay periods, contract total/margin, multi-facility toggle, facility selection, and contract terms entry with tier structures. Supports linking pricing files and uploading contract documents.
- **Key Components:** ContractPDFUpload, ContractTermsEntry, AIContractDescription, Tabs, Calendar, Select
- **Data Sources:** vendor-store, category-store, cog-data-store, contract-data-store
- **User Actions:** Upload PDF for AI extraction, manually enter contract, add terms/tiers, link pricing file, submit

### Contract Detail
- **Route:** `/dashboard/contracts/[id]`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Placeholder page showing contract ID. Minimal implementation.
- **Key Components:** Card
- **Data Sources:** contract-data-store
- **User Actions:** View contract details

### Contract Edit
- **Route:** `/dashboard/contracts/[id]/edit`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Edit form for existing contracts with tabs for basic info, terms, and documents. Pre-fills from contract-data-store. Supports adding/editing terms and tiers.
- **Key Components:** ContractTermsEntry, Tabs, Dialog, Input, Select
- **Data Sources:** contract-data-store, cog-data-store
- **User Actions:** Edit contract fields, update terms, save changes

### Contract Score
- **Route:** `/dashboard/contracts/[id]/score`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Comprehensive contract scoring page with radar chart, bar charts, and line charts. Scores contracts across dimensions: financial value, rebate efficiency, compliance, market share, pricing competitiveness. Includes industry benchmark comparison and projected value analysis.
- **Key Components:** RadarChart, BarChart, LineChart (Recharts), Progress, Tabs
- **Data Sources:** contract-data-store, cog-data-store, vendor-benchmark-store
- **User Actions:** View score breakdown, compare against benchmarks

### Contract Terms
- **Route:** `/dashboard/contracts/[id]/terms`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Manage contract terms and tier structures. Table of terms with type (spend-based, volume-based, fixed, market-share) and tiers. CRUD operations for terms. Progress indicators for tier achievement.
- **Key Components:** Table, Dialog, Input, Select
- **Data Sources:** contract-data-store
- **User Actions:** Add/edit/delete terms, view tier progress

### COG Data
- **Route:** `/dashboard/cog-data`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Central hub for Cost of Goods data management. Tabs for COG records, pricing files, and uploaded files. Supports CSV/Excel import with column mapping, duplicate detection, vendor name matching, manual record entry, date filtering, search, and bulk operations. Linked to contract pricing.
- **Key Components:** COGCSVUpload (importer), PricingFileUpload, MassUpload, Table, Dialog, Tabs
- **Data Sources:** cog-data-store (IndexedDB), contract-data-store
- **User Actions:** Upload COG CSV/Excel, upload pricing files, mass upload, edit/delete records, search, filter by date/vendor

### Alerts
- **Route:** `/dashboard/alerts`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Alert management with tabs for all alerts, off-contract, expiring, tier threshold, and rebate due. Shows alert cards with type badges (off_contract, expiring_contract, tier_threshold, rebate_due, payment_due), priority indicators, timestamps, and action links. Bulk resolve/dismiss.
- **Key Components:** Tabs, Badge, Checkbox, ScrollArea
- **Data Sources:** alert-store
- **User Actions:** Read, resolve, dismiss alerts; navigate to related contracts

### Alert Detail
- **Route:** `/dashboard/alerts/[id]`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Detailed alert view with metadata table (PO ID, vendor, facility, item count, amount), related items, and action buttons.
- **Key Components:** Table, Badge, Button
- **Data Sources:** alert-store (mock data)
- **User Actions:** View details, resolve, navigate to related entity

### Financial Analysis
- **Route:** `/dashboard/analysis`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Capital contract financial analysis with MACRS depreciation, price decrease projections, vendor spend trends, category spend trends. Uses COG data for calculations. Includes file upload for analysis data.
- **Key Components:** BarChart, LineChart, ComposedChart (Recharts), Accordion, Tabs
- **Data Sources:** cog-data-store, contract-data-store
- **User Actions:** Upload analysis data, configure assumptions, view projections

### Prospective Analysis
- **Route:** `/dashboard/analysis/prospective`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Facility-side proposal analysis. Upload vendor contracts/proposals, compare pricing against COG data, deal scoring with radar chart, term comparison, financial projections. Supports pricing file upload to compare proposed vs. current prices.
- **Key Components:** RadarChart, BarChart (Recharts), Table, Slider, Dialog
- **Data Sources:** cog-data-store
- **User Actions:** Upload proposal, analyze pricing, score deal, compare terms

### Case Costing
- **Route:** `/dashboard/case-costing`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Surgical case cost analysis with surgeon scorecards. Upload case data, view per-case costs, surgeon performance metrics (payor mix, BMI, age, spend, time scores), CPT code analysis. Charts for cost distribution and surgeon comparison.
- **Key Components:** BarChart, RadarChart (Recharts), Table, Tabs, Progress
- **Data Sources:** case-data-store, contract-data-store
- **User Actions:** Upload case data, view surgeon metrics, filter by procedure/surgeon

### Compare Surgeons
- **Route:** `/dashboard/case-costing/compare`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Side-by-side surgeon comparison for specific procedures. Bar charts comparing costs, volumes, and outcomes across surgeons.
- **Key Components:** BarChart (Recharts), Select, Table
- **Data Sources:** case-data-store
- **User Actions:** Select procedure, select surgeons, compare metrics

### Case Costing Reports
- **Route:** `/dashboard/case-costing/reports`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Detailed case costing reports showing surgeon-level contract contribution, rebate attribution, and margin analysis.
- **Key Components:** BarChart, LineChart, PieChart (Recharts), Table
- **Data Sources:** case-data-store, contract-data-store
- **User Actions:** View reports, filter by surgeon/contract, download

### Rebate Optimizer
- **Route:** `/dashboard/rebate-optimizer`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Identifies rebate maximization opportunities across contracts. Analyzes current spend vs. tier thresholds, projects rebate earnings with bar charts, recommends spend redistribution to achieve higher tiers.
- **Key Components:** BarChart (Recharts), Table, Progress, Dialog
- **Data Sources:** contract-data-store, cog-data-store
- **User Actions:** View optimization suggestions, set spend targets

### Invoice Validation
- **Route:** `/dashboard/invoice-validation`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Compare invoiced prices against contract prices. Upload invoices, auto-match line items to contracts, flag discrepancies. Product search for manual matching. Tabs for pending, resolved, and flagged items.
- **Key Components:** Table, Dialog, Tabs, Progress
- **Data Sources:** cog-data-store, contract-data-store (mock discrepancy data)
- **User Actions:** Upload invoices, review discrepancies, approve/flag items, search products

### Reports
- **Route:** `/dashboard/reports`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Report generation hub with tabs for usage, service, tie-in, capital, and grouped report types. Shows period data in tables with spend, volume, rebate earned/collected, payment expected/actual. Charts for trends. Report scheduling (daily/weekly/monthly via email).
- **Key Components:** BarChart, LineChart, PieChart (Recharts), Table, Accordion, Dialog
- **Data Sources:** Mock report data, contract-data-store
- **User Actions:** View reports by type, download, schedule email delivery

### Price Discrepancy Report
- **Route:** `/dashboard/reports/price-discrepancy`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Detailed report on pricing discrepancies between invoiced and contracted prices. Table with variance percentages, flagging capability, vendor dispute dialogs.
- **Key Components:** Table, Dialog, Badge
- **Data Sources:** Mock discrepancy data
- **User Actions:** View discrepancies, flag items, send dispute to vendor

### Purchase Orders
- **Route:** `/dashboard/purchase-orders`
- **Layout:** Sidebar (DashboardShell)
- **Description:** PO management with create/view/track workflow. Product search from COG data, line item builder with price lookup, auto-calculation of extended prices. Status tracking (draft/pending/approved/sent/completed/cancelled).
- **Key Components:** Table, Dialog, Select, Input
- **Data Sources:** cog-data-store, contract-data-store
- **User Actions:** Create PO, add line items, search products, submit, track status

### Contract Renewals
- **Route:** `/dashboard/contract-renewals`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Track expiring and renewable contracts. Timeline view with days until expiry, renewal window indicators, spend and rebate summary. Automated notification scheduling.
- **Key Components:** Table, Progress, Dialog, ScrollArea
- **Data Sources:** contract-data-store, cog-data-store
- **User Actions:** View renewal timeline, set reminders, initiate renewal

### AI Agent (Facility)
- **Route:** `/dashboard/ai-agent`
- **Layout:** Sidebar (DashboardShell)
- **Description:** AI chat assistant for facility users using Vercel AI SDK (`useChat`). Suggested questions for contract performance, market share, rebate projections, and spend analysis. Supports document upload for AI analysis. Uses tool-calling for structured data retrieval.
- **Key Components:** ScrollArea, Avatar, Input, Tabs, Dialog
- **Data Sources:** API route `/api/ai-agent`
- **User Actions:** Ask questions, upload documents, view AI-generated insights

### Settings (Facility)
- **Route:** `/dashboard/settings`
- **Layout:** Sidebar (DashboardShell)
- **Description:** Facility settings with tabs for profile, notifications, vendors, team, feature flags, AI credits, and integrations. Profile editing, notification preferences, vendor management CRUD, team member invites with role assignment, feature toggles (purchase orders, AI agent, case costing), AI credit usage tracking.
- **Key Components:** Tabs, Switch, Avatar, Table, Dialog, Select
- **Data Sources:** feature-flags-store, credit-store
- **User Actions:** Edit profile, configure notifications, manage vendors, invite team members, toggle features

---

### Vendor Dashboard
- **Route:** `/vendor`
- **Layout:** Sidebar (VendorShell)
- **Description:** Vendor overview showing their contracts, spend metrics, and performance across facilities. Metric cards for total contracts, total spend, total rebates, and active facilities. Bar and line charts for spend trends.
- **Key Components:** BarChart, LineChart (Recharts), Card
- **Data Sources:** contract-data-store, cog-data-store, vendor-context
- **User Actions:** View metrics, navigate to contracts/performance

### Vendor Contracts
- **Route:** `/vendor/contracts`
- **Layout:** Sidebar (VendorShell)
- **Description:** Vendor's contract list with tabs for active contracts, pending submissions, and expired. Supports contract creation with term entry, pricing file upload, and multi-facility selection. Collapsible term details.
- **Key Components:** Table, Tabs, Dialog, ContractTermsEntry, Progress
- **Data Sources:** pending-contracts-store, contract-data-store
- **User Actions:** View contracts, create new, upload pricing, manage pending submissions

### Vendor New Contract
- **Route:** `/vendor/contracts/new`
- **Layout:** Sidebar (VendorShell)
- **Description:** Vendor contract submission form with contract type, facility selection (ScalableFacilitySelector), date pickers, term entry with tier structures, AI contract description generation, pricing file upload, and document upload.
- **Key Components:** ContractTermsEntry, AIContractDescription, ScalableFacilitySelector, Tabs, Calendar
- **Data Sources:** pending-contracts-store, vendor-identity-store, cog-data-store
- **User Actions:** Create contract, select facilities, add terms, upload documents, submit for approval

### Vendor Contract Detail
- **Route:** `/vendor/contracts/[id]`
- **Layout:** Sidebar (VendorShell)
- **Description:** Contract detail view with spend tracking, tier progress, rebate calculations, document management (amendment upload with AI extraction), and transaction history.
- **Key Components:** Tabs, Table, ContractTransactions, AmendmentExtractor, Dialog
- **Data Sources:** pending-contracts-store
- **User Actions:** View details, upload amendments, track transactions

### Vendor Contract Edit
- **Route:** `/vendor/contracts/[id]/edit`
- **Layout:** Sidebar (VendorShell)
- **Description:** Edit existing vendor contract. Supports term change proposals with before/after comparison, vendor messaging, and AI-generated term suggestions.
- **Key Components:** ContractTermsEntry, Alert, Dialog
- **Data Sources:** contract-change-proposals-store, vendor-identity-store
- **User Actions:** Propose term changes, edit contract, submit changes

### Vendor Pending Contract Edit
- **Route:** `/vendor/contracts/pending/[id]/edit`
- **Layout:** Sidebar (VendorShell)
- **Description:** Edit a pending/draft contract submission before approval. Same form fields as new contract.
- **Key Components:** ContractTermsEntry, Calendar, Alert
- **Data Sources:** pending-contracts-store, vendor-identity-store
- **User Actions:** Edit draft contract, resubmit

### Vendor Alerts
- **Route:** `/vendor/alerts`
- **Layout:** Sidebar (VendorShell)
- **Description:** Vendor-specific alerts for contract expiry, compliance issues, rebate tier thresholds, and renewal windows. Filterable by type and severity.
- **Key Components:** Card, Badge, Tabs
- **Data Sources:** alert-store
- **User Actions:** View, acknowledge, dismiss alerts

### Vendor Invoices
- **Route:** `/vendor/invoices`
- **Layout:** Sidebar (VendorShell)
- **Description:** Invoice management for vendors. Upload invoices, track status, view line items, submit for validation.
- **Key Components:** Table, Dialog, Tabs, Badge
- **Data Sources:** Mock invoice data
- **User Actions:** Upload invoices, view status, track payments

### Vendor Market Share
- **Route:** `/vendor/market-share`
- **Layout:** Sidebar (VendorShell)
- **Description:** Market share analytics with AI-detected category normalization (merging similar category names). Bar charts, line charts, and pie charts for market share by facility, category, and trend. Facility-specific breakdowns with pending contract integration.
- **Key Components:** BarChart, LineChart, PieChart (Recharts), Progress, Dialog
- **Data Sources:** cog-data-store, pending-contracts-store
- **User Actions:** View market share, normalize categories, filter by facility

### Vendor Performance
- **Route:** `/vendor/performance`
- **Layout:** Sidebar (VendorShell)
- **Description:** Performance tracking across facilities with KPIs (compliance rate, on-time delivery, quality scores). Radar chart for multi-dimension scoring. Historical trend analysis.
- **Key Components:** RadarChart, BarChart, AreaChart (Recharts), Table, Select
- **Data Sources:** Mock performance data
- **User Actions:** View performance metrics, filter by facility/period

### Vendor Prospective
- **Route:** `/vendor/prospective`
- **Layout:** Sidebar (VendorShell)
- **Description:** Vendor-side proposal builder with multi-facility support, pricing file upload, usage history analysis, deal scoring, AI-powered negotiation advice, and competitive strategy. Grouped proposals across divisions.
- **Key Components:** Table, Dialog, Slider, Tabs, Collapsible
- **Data Sources:** cog-data-store, vendor-benchmark-store
- **User Actions:** Create proposals, upload pricing, analyze deal, get AI advice

### Vendor Purchase Orders
- **Route:** `/vendor/purchase-orders`
- **Layout:** Sidebar (VendorShell)
- **Description:** View and manage purchase orders from facilities. Track PO status, view line items, manage fulfillment.
- **Key Components:** Table, Dialog, Tabs, Select
- **Data Sources:** Mock PO data
- **User Actions:** View POs, update status, view line items

### Vendor Renewals
- **Route:** `/vendor/renewals`
- **Layout:** Sidebar (VendorShell)
- **Description:** Track contract renewals with timeline, spend performance review, renewal strategy planning. Dialog for initiating renewal discussions.
- **Key Components:** Table, Progress, Dialog, Tabs
- **Data Sources:** contract-data-store
- **User Actions:** View renewal pipeline, initiate renewal, set strategy

### Vendor Reports
- **Route:** `/vendor/reports`
- **Layout:** Sidebar (VendorShell)
- **Description:** Vendor-specific reports for spend analysis, rebate tracking, market share, and compliance. Report generation and download.
- **Key Components:** Table, Dialog, Select, Progress
- **Data Sources:** Mock report data
- **User Actions:** Generate reports, download, schedule delivery

### Vendor AI Agent
- **Route:** `/vendor/ai-agent`
- **Layout:** Sidebar (VendorShell)
- **Description:** AI chat assistant for vendor users. Suggested questions for market share analysis, contract strategy, pricing optimization. Uses same AI SDK infrastructure as facility agent.
- **Key Components:** ScrollArea, Avatar, Input, Tabs
- **Data Sources:** API route `/api/ai-agent`
- **User Actions:** Ask questions, get AI-generated market insights

### Vendor Settings
- **Route:** `/vendor/settings`
- **Layout:** Sidebar (VendorShell)
- **Description:** Vendor settings with profile management, notification preferences, team management, AI credit usage (credit tiers: Starter/Professional/Enterprise), and facility connections (invite/accept/reject system).
- **Key Components:** Tabs, Switch, Avatar, Table, Dialog, Progress
- **Data Sources:** credit-store, connection-store, vendor-identity-store
- **User Actions:** Edit profile, manage team, buy credits, manage facility connections

---

### Admin Dashboard
- **Route:** `/admin`
- **Layout:** Sidebar (admin-specific)
- **Description:** Operator dashboard showing platform-wide stats: total facilities/vendors/users, MRR, active contracts. Recent activity feed and pending actions (new facility setup, trial expiration, failed payments).
- **Key Components:** Card, Badge, Button
- **Data Sources:** Mock admin data
- **User Actions:** View stats, navigate to manage facilities/vendors

### Admin Facilities
- **Route:** `/admin/facilities`
- **Layout:** Sidebar
- **Description:** CRUD table for managing facility tenants. Shows name, location, status, user count, contract count. Create/edit/delete with dialogs.
- **Key Components:** Table, Dialog, Input, DropdownMenu
- **Data Sources:** Mock facility data
- **User Actions:** Add, edit, delete, search facilities

### Admin Vendors
- **Route:** `/admin/vendors`
- **Layout:** Sidebar
- **Description:** CRUD table for managing vendor tenants. Shows name, category, status, rep count, contract count.
- **Key Components:** Table, Dialog, Input, DropdownMenu
- **Data Sources:** Mock vendor data
- **User Actions:** Add, edit, delete, search vendors

### Admin Users
- **Route:** `/admin/users`
- **Layout:** Sidebar
- **Description:** User management with tabs and role-based filtering. CRUD for users with role assignment (facility, vendor, admin). Bulk operations.
- **Key Components:** Table, Tabs, Dialog, Checkbox, Avatar, DropdownMenu
- **Data Sources:** Mock user data
- **User Actions:** Add, edit, delete users, assign roles, bulk actions

### Admin Billing
- **Route:** `/admin/billing`
- **Layout:** Sidebar
- **Description:** Platform billing dashboard with invoice history, subscription management, MRR tracking. Shows paid/pending/overdue invoices.
- **Key Components:** Table, Card, Badge
- **Data Sources:** Mock billing data
- **User Actions:** View invoices, download receipts

### Admin Payor Contracts
- **Route:** `/admin/payor-contracts`
- **Layout:** Sidebar
- **Description:** Manage payor (insurance) contracts with CPT code rate schedules, grouper rates, multi-procedure rules, and implant passthrough settings. Upload payor contract PDFs for extraction.
- **Key Components:** Table, Tabs, Dialog, Select
- **Data Sources:** payor-contract-store, facility-identity-store
- **User Actions:** Upload payor contracts, manage rates, assign to facilities

---

### Utility Pages
- **Route:** `/clear-cog` -- Clears all COG data from IndexedDB and localStorage
- **Route:** `/force-clear` -- Force clears all application data

## Data Models

### Profile
- **Fields:** id (string), email (string), full_name (string|null), role (UserRole), facility_id (string|null), vendor_id (string|null), created_at (string), updated_at (string)
- **Relationships:** belongs to Facility or Vendor
- **Enums:** role: facility | vendor | admin

### Facility
- **Fields:** id (UUID), name (string), type (string: hospital/asc/clinic/surgery_center), address/city/state/zip (string|null), health_system_id (UUID|null), status (string: active/inactive), source (string), beds (number|null), created_at (timestamp), updated_at (timestamp)
- **Relationships:** belongs to HealthSystem, has many Contracts, has many Users

### HealthSystem
- **Fields:** id (UUID), name (string), code (string), headquarters (string), logo_url (string|null), primary_contact_email (string|null), phone (string|null), website (string|null), created_at (timestamp)
- **Relationships:** has many Facilities

### Vendor
- **Fields:** id (UUID), name (string), code (string|null), display_name (string|null), division (string|null), parent_vendor_id (string|null), source (string: manual/contract/pricing_file/cog), contact_name/email/phone (string|null), website (string|null), address (string|null), status (string: active/inactive), tier (string: standard/premium), is_active (boolean), created_at (timestamp), updated_at (timestamp)
- **Relationships:** has many Contracts, has many VendorDivisions
- **Notes:** Vendor name normalization with alias matching

### VendorCompany (identity store)
- **Fields:** id (string), name (string), logo (string|null), divisions (VendorDivision[])
- **Relationships:** has many VendorDivisions

### VendorDivision
- **Fields:** id (string), name (string), code (string), categories (string[])
- **Relationships:** belongs to VendorCompany

### Contract
- **Fields:** id (UUID), contract_number (string|null), name (string), vendor_id (UUID), vendor_name (string), facility_id (UUID|null), contract_type (string), status (string), effective_date (date), expiration_date (date), auto_renewal (boolean), termination_notice_days (integer), total_value (decimal), annual_value (decimal), description (string|null), notes (string|null), gpo_affiliation (string|null), performance_period (string), rebate_pay_period (string), is_grouped (boolean), is_multi_facility (boolean), tie_in_capital_contract_id (string|null), created_at (timestamp), updated_at (timestamp)
- **Relationships:** belongs to Vendor, belongs to Facility, has many ContractTerms, has many ContractPricingItems, has many ContractDocuments
- **Enums:** contract_type: usage | capital | service | tie_in | grouped | pricing_only; status: active | expired | expiring | draft | pending; performance_period: monthly | quarterly | semi_annual | annual

### ContractTerm
- **Fields:** id (UUID), contract_id (UUID), term_name (string), term_type (string), baseline_type (string), evaluation_period (string), payment_timing (string), applies_to (string), effective_start (string), effective_end (string), volume_type (string|null), spend_baseline (number|null), volume_baseline (number|null), growth_baseline_percent (number|null), desired_market_share (number|null), created_at (timestamp), updated_at (timestamp)
- **Relationships:** belongs to Contract, has many ContractTiers, has many ContractTermProducts, has many ContractTermProcedures
- **Enums:** term_type: spend_rebate | volume_rebate | price_reduction | market_share | market_share_price_reduction | capitated_price_reduction | capitated_pricing_rebate | po_rebate | carve_out | payment_rebate | growth_rebate | compliance_rebate | fixed_fee | locked_pricing

### ContractTier
- **Fields:** id (UUID), term_id (UUID), tier_number (integer), spend_min (decimal), spend_max (decimal|null), volume_min (integer|null), volume_max (integer|null), market_share_min (decimal|null), market_share_max (decimal|null), rebate_type (string), rebate_value (decimal), created_at (timestamp)
- **Relationships:** belongs to ContractTerm
- **Enums:** rebate_type: percent_of_spend | fixed_rebate | fixed_rebate_per_unit | per_procedure_rebate

### ContractPricing (pricing items)
- **Fields:** id (UUID), contract_id (UUID), vendor_item_no (string), description (string|null), category (string|null), unit_price (decimal), uom (string), list_price (decimal|null), discount_percentage (decimal|null), effective_date (date|null), expiration_date (date|null), created_at (timestamp)
- **Relationships:** belongs to Contract

### ContractDocument
- **Fields:** id (string), name (string), type (string: main/amendment/addendum/exhibit/pricing), upload_date (string), effective_date (string|null), size (number|null), url (string|null)
- **Relationships:** belongs to Contract

### PendingContract (vendor submissions)
- **Fields:** id (string), vendor_name (string), vendor_id (string), facility_name (string), facility_id (string), contract_name (string), contract_type (string), start_date (string), end_date (string), terms (string), status (string), submitted_at (string), reviewed_at (string|null), reviewed_by (string|null), review_notes (string|null), documents (array), pricing_data (object|null), rebate_terms (object|null)
- **Enums:** status: draft | pending | approved | rejected | revision_requested | withdrawn; contract_type: Usage | Tie-In | Capital | Service | Pricing

### ContractChangeProposal
- **Fields:** id (string), contract_id (string), contract_name (string), vendor_name/id (string), facility_name/id (string), proposal_type (string), status (string), submitted_at (string), reviewed_at (string|null), reviewed_by (string|null), review_notes (string|null), vendor_message (string|null), changes (TermChange[])
- **Enums:** proposal_type: term_change | new_term | remove_term | contract_edit; status: pending | approved | rejected | revision_requested

### COGData (Cost of Goods)
- **Fields:** id (string), facility_id (string), vendor_id (string|null), vendor (string), inventory_number (string), inventory_description (string), vendor_item_no (string|null), manufacturer_no (string|null), unit_cost (number), extended_price (number), quantity (number), transaction_date (string), category (string|null), effective_date (string), created_by (string|null), created_at (string), updated_at (string)
- **Relationships:** belongs to Facility, belongs to Vendor
- **Storage:** IndexedDB for large datasets (localStorage has 5MB limit)

### PricingFile
- **Fields:** id (string), vendor_id (string), facility_id (string), vendor_item_no (string), manufacturer_no (string|null), product_description (string), list_price (number|null), contract_price (number|null), effective_date (string), expiration_date (string|null), category (string|null), uom (string), created_at (string), updated_at (string)
- **Relationships:** belongs to Vendor, belongs to Facility

### PurchaseOrder
- **Fields:** id (string), po_id (string), facility_id (string), vendor_id (string), order_date (string), total_po_cost (number|null), status (string), is_off_contract (boolean), line_items (POLineItem[]), created_at (string)
- **Enums:** status: draft | pending | approved | sent | completed | cancelled

### POLineItem
- **Fields:** id (string), purchase_order_id (string), sku (string), description (string), vendor_item_no (string|null), quantity (number), unit_price (number), extended_price (number), uom (string), is_off_contract (boolean), contract_id (string|null), created_at (string)

### Invoice
- **Fields:** id (string), invoice_number (string), facility_id (string), vendor_id (string), purchase_order_id (string|null), invoice_date (string), total_invoice_cost (number|null), line_items (InvoiceLineItem[]), created_at (string)

### InvoiceLineItem
- **Fields:** id (string), invoice_id (string), inventory_description (string), vendor_item_no (string|null), invoice_price (number), invoice_quantity (number), total_line_cost (number), created_at (string)

### Alert
- **Fields:** id (string), type (AlertType), title (string), message (string), description (string|null), status (AlertStatus), priority (AlertPriority), created_at (Date), metadata (Record|null), action_link (string|null)
- **Enums:** type: off_contract | expiring_contract | tier_threshold | rebate_due | pricing_error | contract_expiry | compliance; status: new | read | resolved | dismissed; priority: high | medium | low

### Case (surgical)
- **Fields:** id (string), case_id (string), facility_id (string), surgeon_name (string|null), surgeon_id (string), patient_dob (string|null), date_of_surgery (string), time_in_or (string|null), time_out_or (string|null), procedure_code (string), total_spend (number), total_reimbursement (number), created_at (string)
- **Relationships:** has many CaseProcedures, has many CaseSupplies

### CaseProcedure
- **Fields:** id (string), case_id (string), cpt_code (string), procedure_description (string|null), created_at (string)

### CaseSupply
- **Fields:** id (string), case_id (string), material_name (string), vendor_item_no (string|null), used_cost (number), quantity (number), created_at (string)

### PayorContract
- **Fields:** id (string), payor_name (string), payor_type (string), facility_id (string), facility_name (string), contract_number (string), effective_date (string), expiration_date (string), status (string), cpt_rates (PayorContractRate[]), grouper_rates (PayorContractGrouper[]), multi_procedure_rule (object), implant_passthrough (boolean), implant_markup (number), uploaded_at (string), uploaded_by (string), file_name (string), notes (string)
- **Enums:** payor_type: commercial | medicare_advantage | medicaid_managed | workers_comp

### Connection (facility-vendor)
- **Fields:** id (string), facility_id (string), facility_name (string), vendor_id (string), vendor_name (string), status (ConnectionStatus), invite_type (string), invited_by (string), invited_by_email (string), invited_at (string), responded_at (string|null), expires_at (string), message (string|null)
- **Enums:** status: pending | accepted | rejected | expired; invite_type: facility_to_vendor | vendor_to_facility

### ProductBenchmark (vendor)
- **Fields:** id (string), product_code (string), product_name (string), category (string), national_asp (number), hard_floor (number), target_rate_guide (number|null), target_margin (number), cost_basis (number), gpo_admin_fee (number), market_share_pricing (MarketShareTier[]), volume_pricing (VolumeTier[]), last_updated (string)

### ReportSchedule
- **Fields:** id (string), facility_id (string), report_type (ReportType), frequency (string), day_of_week (number|null), day_of_month (number|null), email_recipients (string[]), is_active (boolean), last_sent_at (string|null), created_at (string), updated_at (string)
- **Enums:** report_type: contract_performance | rebate_summary | spend_analysis | market_share | case_costing; frequency: daily | weekly | monthly

### FeatureFlags
- **Fields:** purchase_orders_enabled (boolean), ai_agent_enabled (boolean), vendor_portal_enabled (boolean), advanced_reports_enabled (boolean), case_costing_enabled (boolean)
- **Storage:** localStorage

### CreditAccount
- **Fields:** tier_id (string), monthly_credits (number), used_credits (number), overage_rate (number), rollover_limit (number)
- **Tiers:** Starter ($99/mo, 500 credits), Professional ($299/mo, 2000 credits), Enterprise ($799/mo, 10000 credits)

## User Flows

### Facility Contract Creation (AI-assisted)
1. Facility user navigates to Contracts > New Contract
2. Selects "AI" entry mode
3. Uploads contract PDF
4. AI extracts contract name, vendor, type, dates, terms, tier structures
5. User reviews and edits extracted data
6. User selects facility assignment (single or multi-facility)
7. User links pricing file from COG data
8. User submits contract
9. Contract appears in contracts list as active

### Vendor Contract Submission
1. Vendor logs in to Vendor Portal
2. Navigates to Contracts > New Contract
3. Selects facility/facilities to submit to
4. Enters contract type, dates, terms with tier structures
5. Optionally uploads pricing file and contract documents
6. Submits contract for facility review
7. Contract appears in vendor's "Pending" tab
8. Facility reviews, approves/rejects/requests revision
9. On approval, contract becomes active in both portals

### COG Data Import
1. Facility user navigates to COG Data
2. Uploads CSV or Excel file
3. System parses columns, user maps to target fields
4. Duplicate detection runs, user resolves conflicts
5. Vendor names are matched/normalized against known vendors
6. Records are imported to IndexedDB
7. Contract spend calculations update automatically

### Invoice Validation
1. Facility user navigates to Invoice Validation
2. Uploads vendor invoice or enters manually
3. System matches line items against contract pricing
4. Discrepancies flagged with variance percentages
5. User reviews, approves matching items, flags discrepancies
6. Flagged items can be disputed with vendor

### Vendor Prospective Proposal
1. Vendor navigates to Prospective page
2. Selects target facility/facilities
3. Uploads pricing file with proposed prices
4. System compares proposed prices against COG data (current pricing)
5. Deal scoring generates radar chart and recommendations
6. AI analyzes deal and provides negotiation advice
7. Vendor adjusts pricing and submits proposal

### Rebate Optimization
1. Facility user navigates to Rebate Optimizer
2. System loads all contracts with rebate tiers
3. Current spend is compared against tier thresholds
4. Optimizer identifies contracts close to next tier
5. Shows projected additional rebate if threshold is met
6. User can set spend targets and track progress

## Feature List

### MVP
| Feature | Priority | Description |
|---------|----------|-------------|
| Dual Portal System | P0 | Separate facility and vendor portals with role-based access |
| Contract CRUD | P0 | Create, read, update, delete contracts with full term/tier structures |
| Contract Types | P0 | Usage, Capital, Service, Tie-In, Grouped, Pricing Only |
| Rebate Tier Management | P0 | Multi-tier rebate structures with spend/volume/market-share baselines |
| COG Data Import | P0 | CSV/Excel upload with column mapping and vendor name matching |
| Dashboard Analytics | P0 | Metric cards, charts for spend/rebate/compliance |
| Alert System | P0 | Off-contract, expiring, tier threshold, rebate due alerts |
| Authentication | P0 | Auth with email/password, role-based routing |
| Vendor Contract Submission | P1 | Vendors submit contracts for facility approval workflow |
| Invoice Validation | P1 | Compare invoiced vs. contracted prices, flag discrepancies |
| Reports | P1 | Usage, service, tie-in, capital reports with export |
| Purchase Orders | P1 | PO creation with product search and contract price lookup |
| Contract Renewals | P1 | Track expiring contracts, renewal windows, notifications |
| Settings and Team Management | P1 | Profile, notifications, feature flags, team invites |
| Pricing File Management | P1 | Upload and link pricing files to contracts |

### Future Phases
| Feature | Priority | Description |
|---------|----------|-------------|
| AI Contract PDF Extraction | P2 | AI-powered PDF parsing to auto-extract contract terms |
| AI Chat Agent | P2 | Conversational AI for contract analysis |
| AI Deal Analysis | P2 | AI-powered negotiation advice for vendor proposals |
| AI Supply Matching | P2 | Match surgical supplies to contract pricing via AI |
| Case Costing | P2 | Surgical case cost analysis with surgeon scorecards |
| Prospective Analysis | P2 | Capital contract financial analysis with MACRS depreciation |
| Rebate Optimizer | P2 | AI-assisted spend redistribution to maximize rebates |
| Contract Scoring | P2 | Multi-dimension contract scoring with radar charts |
| Market Share Analytics | P2 | Vendor market share tracking with AI category normalization |
| Vendor Performance Tracking | P2 | Multi-dimension vendor performance metrics |
| Payor Contract Management | P3 | Insurance/payor contract rates with CPT code schedules |
| Admin/Operator Portal | P3 | Multi-tenant management, billing, user administration |
| Credit System | P3 | AI feature credit consumption with tiered pricing |
| Facility-Vendor Connections | P3 | Invitation system for facility-vendor relationships |
| Vendor Benchmarking | P3 | Industry benchmark data for pricing negotiation |
| Report Scheduling | P3 | Automated email delivery of reports |
| Forecasting | P3 | Linear regression and seasonal decomposition for spend/rebate predictions |
| Contract Change Proposals | P3 | Vendor proposes term changes, facility approves/rejects |

## Authentication & Authorization

### Auth Provider
- **Supabase Auth** in v0 prototype (production target: Better Auth with Prisma adapter)
- Demo mode with cookie-based session bypass (`demo_session=true`)

### Roles
1. **facility** -- Access to `/dashboard/*` routes. Full COG data, all contracts, case costing, invoice validation
2. **vendor** -- Access to `/vendor/*` routes. Filtered view of their own contracts, market share data (no access to full COG)
3. **admin** -- Access to `/admin/*` routes. Platform-wide management

### Vendor Sub-Roles (within vendor portal)
1. **admin** -- Full access including AI assistant and team management
2. **manager** -- Most access except AI assistant
3. **rep** -- Limited to viewing assigned contracts and basic dashboards

### Data Isolation
- Facility users see all vendor data for their facility
- Vendor users only see their own data filtered by vendor identity
- Admin users see platform-wide aggregated data
- Multi-facility users can switch active facility context

### Authorization Pattern
- Middleware for session validation on all routes except static assets
- Layout-level role checks with redirects (vendor to vendor portal, facility to dashboard)
- VendorRoleGuard component for vendor sub-role permission checks
- Feature flags for gating optional features per tenant

## Integrations

### AI / LLM
- **Vercel AI SDK** (`ai` package, `@ai-sdk/react`) for streaming chat in v0 prototype
- **OpenAI GPT-4o-mini** via `openai/gpt-4o-mini` model identifier
- Uses `streamText`, `generateText`, `tool` from AI SDK
- Structured output via `Output.object` with Zod schemas
- Tools for: contract performance analysis, market share analysis, prospective rebate calculation, spend optimization
- AI contract PDF extraction with structured Zod schema for terms, tiers, facilities
- AI deal analysis for vendor proposals
- AI supply matching for case costing

### File Processing
- **xlsx** library for Excel/CSV parsing (server-side in API routes)
- Client-side CSV parsing for COG data import
- PDF processing via AI extraction (no raw PDF parsing library)
- File upload via drag-and-drop (react-dropzone)

### Data Storage (v0 prototype)
- **Supabase** (Postgres) for auth and planned backend (SQL schemas exist but mostly unused)
- **localStorage** for most state (contracts, vendors, facilities, settings, alerts)
- **IndexedDB** for COG data (large datasets exceeding localStorage 5MB limit)
- **Zustand** for payor-contract-store and facility-identity-store (with persist middleware)
- Custom event-based reactivity (`window.dispatchEvent`) for cross-component state sync

### Charts
- **Recharts** for all data visualization (BarChart, LineChart, PieChart, RadarChart, AreaChart, ComposedChart)

### Forecasting
- Custom linear regression and seasonal decomposition utility (`lib/forecasting.ts`)

## Theme & Design Preferences

### Vibe
Professional healthcare SaaS with a modern, Vercel-inspired dark mode. Clean surfaces with subtle gradients and glass morphism effects. Data-dense but well-organized with card-based layouts and comprehensive use of Recharts for visualization.

### Colors
- **Primary:** Deep teal (light: oklch 0.45 0.12 195, dark: oklch 0.72 0.16 175) -- trustworthy healthcare feel
- **Accent:** Vibrant blue (light: oklch 0.58 0.18 255, dark: oklch 0.68 0.18 250)
- **Background:** Near-white (light) / very dark blue-gray (dark: oklch 0.12 0.01 250)
- **Card:** White (light) / slightly elevated dark (dark: oklch 0.155 0.012 250)
- **Sidebar:** Slate dark (oklch 0.16 0.015 250) in light mode, even darker (oklch 0.1 0.01 250) in dark
- **Destructive:** Red-orange (oklch 0.55-0.58 0.22 25)
- **Semantic:** Success green, warning amber, info blue
- **Charts:** 8-color palette (teal, blue, amber, orange, purple, cyan, yellow, indigo)

### Patterns
- Gradient text utility (`.gradient-text` with primary-to-accent gradient)
- Glass morphism cards in dark mode (`.glass-card`)
- Primary glow effect in dark mode (`.glow-primary`)
- Animated gradient borders (`.gradient-border`)
- Custom dark mode scrollbars
- Theme transition animations (0.2s ease)
- `--radius: 0.625rem` (10px) base border radius

### Typography
- **Font:** Inter (sans-serif), Geist Mono (monospace)
- Font feature settings: `rlig` and `calt` ligatures

### Component Style
- shadcn/ui "new-york" style
- Lucide icons throughout
- Sonner toast notifications (top-right, rich colors)
- next-themes for light/dark/system toggle

## Navigation Structure

### Facility Sidebar (DashboardShell)
1. Dashboard
2. Contracts
3. Renewals
4. Rebate Optimizer
5. Analysis
6. COG Data
7. Case Costing (feature flag: caseCostingEnabled)
8. Purchase Orders (feature flag: purchaseOrdersEnabled)
9. Invoice Validation
10. Reports
11. Alerts (with unread count badge)
12. AI Agent (feature flag: aiAgentEnabled)
13. Settings

### Vendor Sidebar (VendorShell)
1. Dashboard
2. My Contracts
3. Renewals
4. Prospective
5. Market Share
6. Performance
7. Purchase Orders (permission: viewPurchaseOrders)
8. Invoices (permission: viewPurchaseOrders)
9. Alerts (with unread count badge)
10. Reports
11. AI Assistant (permission: useAiAssistant)
12. Settings (permission: manageTeam)

### Admin Sidebar
1. Dashboard
2. Facilities
3. Payor Contracts
4. Vendors
5. Users
6. Billing
7. Analytics (no page implemented)
8. Settings (no page implemented)

### Header
- Both portals: Logo, theme toggle, user avatar dropdown (profile, settings, sign out)
- Vendor portal: Division/company selector, role indicator badge
- Facility portal: Health system/facility selector, mass upload button, global search

## Open Questions

1. **Database Backend:** The prototype uses localStorage/IndexedDB for all data. The Supabase SQL schemas exist but are largely disconnected from the UI. The real build uses TanStack Start with Prisma (per CLAUDE.md), which is already partially built.

2. **Multi-Tenancy Model:** The admin portal suggests SaaS multi-tenancy, but the data isolation model between facilities, health systems, and vendors needs formal specification. How are vendor users scoped to specific facilities? How does a health-system-level user see aggregated data?

3. **Vendor Portal Access Control:** How do vendors get invited/onboarded? The connection-store has an invitation system, but the actual vendor sign-up flow and approval process is unclear.

4. **AI Credit Billing:** The credit-store defines tiers (Starter/Professional/Enterprise) but no actual payment integration exists. Stripe integration is already configured in the real build.

5. **Contract Approval Workflow:** The pending-contracts-store supports draft/pending/approved/rejected/revision_requested states, but the facility-side approval UI is minimal. A formal approval workflow needs design.

6. **Payor Contracts Integration:** The payor contract system (insurance reimbursement rates) is only in the admin portal. How does this integrate with case costing margin calculations on the facility side?

7. **Report Generation:** Reports currently use mock data. The scheduled report delivery (email) has no backend implementation.

8. **Off-Contract Detection:** Alert generation logic for off-contract purchases is not fully implemented -- alerts are currently static/mock. How should the system detect off-contract purchases from COG data in real-time?

9. **File Storage:** Contract documents, pricing files, and uploaded CSVs need persistent storage. S3-compatible storage is already configured in the real build.

10. **Forecasting Accuracy:** The forecasting utility uses simple linear regression. Should more sophisticated models be considered, or is this sufficient for MVP?
