# TYDEi Platform — Complete Architecture & Feature Mapping Report

**Report Date:** April 14, 2026  
**Stack:** Next.js 16.2 (App Router, Turbopack) • React 19 • Prisma 7 + PostgreSQL • Better Auth • Stripe • TanStack Query/Table • Zod + react-hook-form • radix-ui • Tailwind v4 • S3 • Resend • Upstash • Vercel AI SDK (Google Gemini) • Bun  
**Database:** PostgreSQL 16 (Docker local, Railway prod)  
**Route Protection:** `proxy.ts` (Next.js 16 edge middleware, no `middleware.ts`)  
**Deployment:** Railway with Turbopack build

---

## 1. Conventions & Architecture

### 1.1 Directory Layout

```
tydei-next/
├── app/
│   ├── (auth)/              # Auth routes: login, sign-up, forgot/reset password
│   ├── (marketing)/         # Public landing page
│   ├── dashboard/           # Facility portal (protected, role: facility)
│   ├── vendor/              # Vendor portal (protected, role: vendor)
│   ├── admin/               # Admin portal (protected, role: admin)
│   └── api/
│       ├── auth/[...all]/   # Better Auth catch-all route handler
│       ├── ai/              # 8 AI endpoints (chat, extract, score, match, etc)
│       ├── upload/          # Presign URLs + file uploads
│       ├── webhooks/stripe/ # Stripe webhook handler
│       └── reports/pdf/     # PDF generation
├── components/
│   ├── ui/                  # shadcn/ui: 31 primitive components
│   ├── shared/              # Portal-agnostic: shells, tables, forms, cards, alerts, AI UI, settings
│   ├── contracts/           # Shared between facility & vendor portals
│   ├── facility/            # Facility-specific: contracts, COG, POs, invoices, analysis, dashboard, case-costing, rebate-optimizer, settings
│   ├── vendor/              # Vendor-specific: contracts, dashboard, analytics, settings
│   ├── admin/               # Admin-specific: dashboard, facilities, vendors, users, billing
│   ├── auth/                # Login, sign-up, demo buttons
│   └── marketing/           # Landing page sections
├── lib/
│   ├── actions/             # 45+ server actions grouped by entity
│   │   ├── auth.ts          # requireAuth, requireFacility, requireVendor, requireAdmin
│   │   ├── contracts.ts     # Contract CRUD, multi-facility support
│   │   ├── admin/           # 6 admin-scoped action files
│   │   └── ... (30+ more)
│   ├── validators/          # 20 Zod schemas (auto-generated from Prisma where available)
│   ├── ai/                  # config.ts, prompts.ts, schemas.ts, tools.ts
│   ├── alerts/              # Alert generation logic
│   ├── analysis/            # MACRS depreciation, forecasting logic
│   ├── generated/zod/       # Auto-generated Zod types from Prisma
│   ├── auth-server.ts       # Better Auth server config (prismaAdapter, org plugin, stripe plugin)
│   ├── auth.ts              # Better Auth client (createAuthClient, organizationClient, stripeClient)
│   ├── db.ts                # Prisma client singleton
│   ├── s3.ts                # S3 legacy wrapper (re-exports from storage.ts)
│   ├── storage.ts           # AWS SDK S3Client with presigned URLs
│   ├── stripe.ts            # Stripe SDK singleton
│   ├── email.ts             # Resend client: sendEmail, sendReportEmail
│   ├── email-templates.ts   # Email template functions
│   ├── formatting.ts        # formatCurrency, formatDate, formatPercent
│   ├── constants.ts         # Nav configs, status badge configs, role configs
│   ├── query-keys.ts        # TanStack Query factory pattern key definitions
│   ├── utils.ts             # cn() Tailwind merge utility
│   ├── types.ts             # Global TypeScript types
│   ├── audit.ts             # Audit logging helper
│   ├── pdf.ts               # PDF generation with jsPDF
│   ├── rate-limit.ts        # Upstash rate limiting
│   ├── serialize.ts         # Decimal serialization for JSON
│   ├── contract-definitions.ts # Contract type metadata
│   ├── map-columns.ts       # CSV/file column mapping logic
│   ├── national-reimbursement-rates.ts # CPT rate data
│   ├── vendor-aliases.ts    # Vendor name fuzzy matching
│   └── ... (8 more analysis/chart config files)
├── hooks/                   # 25+ TanStack Query custom hooks
├── prisma/
│   ├── schema.prisma        # 44 models, 24 enums, full schema
│   ├── prisma.config.ts     # Prisma 7 config with dotenv
│   └── seed.ts              # Demo data seeder
├── tests/                   # 2 Vitest + setup
├── proxy.ts                 # Edge route protection (no middleware.ts in Next.js 16)
├── next.config.ts           # Server external packages, server actions size limit
├── tsconfig.json            # Path alias: @/* → ./*
├── tailwind.config.ts       # Tailwind v4
└── vitest.config.ts         # Vitest config
```

### 1.2 Path Aliases (tsconfig.json)

```typescript
// @/* maps to project root
import { db } from "@/lib/db"
import { Button } from "@/components/ui/button"
import { useContracts } from "@/hooks/use-contracts"
```

### 1.3 Server Functions & Data Fetching

**Pages are thin server components** that call `requireAuth()` / `requireFacility()` / `requireVendor()` / `requireAdmin()` to guard access and fetch entity context. Example:

```typescript
// app/dashboard/contracts/page.tsx
export default async function ContractsPage() {
  const session = await requireFacility()
  return <ContractsListClient facilityId={session.facility.id} userId={session.user.id} />
}
```

**Server actions** (`"use server"`) in `lib/actions/`:
- All data mutations (create, update, delete)
- Auth guards at the top (requireFacility etc.)
- Zod validation on inputs
- Return serialized JSON (Decimal → string via `serialize()`)
- Log audit trail via `logAudit()`

**Client components** use TanStack Query hooks to fetch from server actions:
```typescript
// hooks/use-contracts.ts
const { data, isLoading } = useQuery({
  queryKey: queryKeys.contracts.list(facilityId, filters),
  queryFn: () => getContracts({ facilityId, ...filters }),
})
```

**API routes** (route.ts):
- Better Auth: `/api/auth/[...all]` catch-all
- AI: `/api/ai/chat`, `/api/ai/extract-contract`, `/api/ai/score-deal`, etc
- Upload: `/api/upload/presign`, `/api/upload` (direct S3)
- Webhooks: `/api/webhooks/stripe`
- Reports: `/api/reports/pdf` (jsPDF generation)

### 1.4 Forms

**Pattern:** react-hook-form + @hookform/resolvers/zod + custom Field component

```typescript
// lib/validators/contracts.ts
export const createContractSchema = z.object({
  name: z.string().min(1),
  vendorId: z.string(),
  status: ContractStatusSchema,
  // ...
})

// components/contracts/contract-form.tsx
export function ContractForm({ form, vendors, categories }: ContractFormProps) {
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Field label="Contract Name" {...form.register("name")} />
      <Field label="Vendor" as="select" {...form.register("vendorId")} />
      {/* Form dialog wrappers, confirm dialogs */}
    </form>
  )
}
```

**Shared form components:**
- `Field.tsx` — Unified input wrapper (text, select, textarea, etc)
- `FormDialog.tsx` — Modal form wrapper
- `ConfirmDialog.tsx` — Delete/destructive action confirmation
- `DateRangePicker.tsx` — Date range selection

### 1.5 Tables

**Pattern:** TanStack Table with custom DataTable wrapper

```typescript
// Reusable DataTable component in components/shared/tables/data-table.tsx
<DataTable
  columns={contractColumns}
  data={contracts}
  searchKey="name"
  filterComponent={<ContractFilters />}
  pagination={true}
  pageSize={20}
  onRowClick={(row) => navigate(`/contracts/${row.id}`)}
/>
```

**Features:**
- Search by column
- Sorting (client-side)
- Pagination (20–50 rows)
- Custom filter components per feature
- Row click handlers for navigation
- Action menus (edit, delete, etc)

**Column definitions** live in feature-specific files (e.g., `components/contracts/contract-columns.tsx`)

### 1.6 Auth & Session Management

**Better Auth server config** (`lib/auth-server.ts`):
```typescript
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  plugins: [
    organization(),      // Multi-organization support
    stripe({...}),       // Billing integration
  ],
  emailAndPassword: { enabled: true, sendResetPassword: async (...) => {...} },
  emailVerification: { sendVerificationEmail: async (...) => {...} },
  session: {
    expiresIn: 7 days,
    updateAge: 24 hours,
    cookieCache: { enabled: true, maxAge: 5 min },
    cookie: { httpOnly: true, secure: production, sameSite: "lax" },
  },
})
```

**Client setup** (`lib/auth.ts`):
```typescript
export const authClient = createAuthClient({
  plugins: [organizationClient(), stripeClient()],
})
export const { useSession, signIn, signUp, signOut } = authClient
```

**Route protection** (`proxy.ts` — no middleware.ts in Next.js 16):
- Edge function checks for `__Secure-better-auth.session_token` or `better-auth.session_token`
- Public API routes: `/api/auth/*`, `/api/webhooks/*`
- All other routes: redirect to `/login?callbackUrl=...` or return 401 for API
- Security headers added (CSP, X-Frame-Options, HSTS, etc)

**Session guards** (`lib/actions/auth.ts`):
- `requireAuth()` — checks session exists
- `requireRole(role)` — checks user role
- `requireFacility()` — returns `{ session, facility }`
- `requireVendor()` — returns `{ session, vendor }`
- `requireAdmin()` — checks admin role
- Demo accounts available via `getDemoCredentials()`

### 1.7 No CLAUDE.md or AGENTS.md

No special agent instructions files found in repo root.

### 1.8 README.md Summary

Production SaaS for healthcare contract management. Two portals:
- **Facility:** Track contracts, COG data, invoices, rebates, case costing, analytics
- **Vendor:** Submit contracts, track performance, proposals, renewals

44 Prisma models, 24 enums, 52 pages, 216+ components, 38 server action files, 25 hooks, 31 shadcn components, 297 total component files.

---

## 2. Prisma Schema Summary

### 2.1 Core Entities

**44 models, 24 enums.** Complete schema at `prisma/schema.prisma` (1269 lines).

#### Auth & Organization (Better Auth managed)
- **User** — id, name, email, emailVerified, image, role (facility|vendor|admin), createdAt, updatedAt
  - Relations: sessions, accounts, members, createdContracts, payments, credits, auditLogs
  - Indices: [role]
- **Session** — id, expiresAt, token, ipAddress, userAgent, userId, createdAt, updatedAt
  - Relations: user
- **Account** — id, accountId, providerId, userId, tokens, scope, password, timestamps
- **Verification** — id, identifier, value, expiresAt
- **Organization** — id, name, slug (unique), logo, metadata, createdAt
  - Relations: members, invitations, facility (one-to-one), vendor (one-to-one)
- **Member** — id, organizationId, userId, role, createdAt
  - Relations: organization, user
  - Composite key: (organizationId, userId)
- **Invitation** — id, organizationId, email, role, status, expiresAt, inviterId, timestamps

#### Business Entities
- **HealthSystem** — id, name, code (unique), headquarters, logoUrl, primaryContactEmail, phone, website
  - Relations: facilities (one-to-many)
- **Facility** — id, name, type (hospital|asc|clinic|surgery_center), address, city, state, zip, beds, healthSystemId, status, organizationId (unique one-to-one), timestamps
  - Relations: healthSystem, organization, and 16+ other entity relations
  - Indices: [status]
- **Vendor** — id, name, code, displayName, division, parentVendorId, logoUrl, contactInfo, website, address, status, tier (standard|premium), organizationId (unique), timestamps
  - Relations: parentVendor, childVendors (hierarchy), organization, and 12+ entity relations
- **VendorDivision** — id, vendorId, name, code, categories[], createdAt
  - Relations: vendor (onDelete: Cascade)
- **ProductCategory** — id, name, description, parentId, spendTotal, itemCount, createdAt
  - Relations: parent, children (hierarchy), contracts, contractCategories

#### Contracts
- **Contract** — id, contractNumber, name, vendorId, facilityId, productCategoryId, contractType (usage|capital|service|tie_in|grouped|pricing_only), status (active|expired|expiring|draft|pending), effectiveDate, expirationDate, autoRenewal, terminationNoticeDays, totalValue, annualValue, description, notes, gpoAffiliation, performancePeriod (monthly|quarterly|semi_annual|annual), rebatePayPeriod, isGrouped, isMultiFacility, tieInCapitalContractId, createdById, timestamps
  - Relations: vendor, facility, productCategory, createdBy, terms, pricingItems, documents, periods, rebates, payments, credits, alerts, purchaseOrders, surgeonUsages, contractFacilities, contractCategories, changeProposals
  - Indices: [vendorId, facilityId, status, expirationDate]

- **ContractProductCategory** — id, contractId, productCategoryId (unique composite)
- **ContractFacility** — id, contractId, facilityId (unique composite, for multi-facility contracts)
- **ContractTerm** — id, contractId, termName, termType (spend_rebate|volume_rebate|price_reduction|market_share|...), baselineType (spend_based|volume_based|growth_based), evaluationPeriod, paymentTiming, appliesTo, effectiveStart, effectiveEnd, volumeType (product_category|catalog_cap_based|procedure_code), spendBaseline, volumeBaseline, growthBaselinePercent, desiredMarketShare, timestamps
  - Relations: contract, tiers, products, procedures
  - Indices: [contractId]

- **ContractTier** — id, termId, tierNumber, spendMin/Max, volumeMin/Max, marketShareMin/Max, rebateType (percent_of_spend|fixed_rebate|fixed_rebate_per_unit|per_procedure_rebate), rebateValue, createdAt
  - Relations: term
  - Indices: [termId]

- **ContractTermProduct** — id, termId, vendorItemNo, productDescription, contractPrice
- **ContractTermProcedure** — id, termId, cptCode, procedureDescription, rebateAmount
- **ContractPricing** — id, contractId, vendorItemNo, description, category, unitPrice, uom, listPrice, discountPercentage, effectiveDate, expirationDate
  - Indices: [contractId, vendorItemNo]

- **ContractDocument** — id, contractId, name, type (main|amendment|addendum|exhibit|pricing), uploadDate, effectiveDate, size, url, createdAt
  - Relations: contract
  - Indices: [contractId]

- **ContractPeriod** — id, contractId, facilityId, periodStart, periodEnd, totalSpend, totalVolume, rebateEarned, rebateCollected, paymentExpected, paymentActual, balanceExpected, balanceActual, tierAchieved, timestamps
  - Relations: contract, facility, rebates
  - Indices: [contractId]

- **PendingContract** — id, vendorId, vendorName, facilityId, facilityName, contractName, contractType, status (draft|submitted|approved|rejected|revision_requested|withdrawn), dates, totalValue, terms (JSON), documents (JSON), pricingData (JSON), notes, reviewedAt, reviewedBy, reviewNotes, submittedAt
  - Relations: vendor, facility

- **ContractChangeProposal** — id, contractId, vendorId, vendorName, facilityId, facilityName, proposalType (term_change|new_term|remove_term|contract_edit), status (pending|approved|rejected|revision_requested), changes (JSON), proposedTerms (JSON), vendorMessage, submittedAt, reviewedAt, reviewedBy, reviewNotes
  - Relations: contract
  - Indices: [contractId, status]

#### COG Data & Pricing
- **COGRecord** — id, facilityId, vendorId, vendorName, inventoryNumber, inventoryDescription, vendorItemNo, manufacturerNo, unitCost, extendedPrice, quantity, transactionDate, category, createdBy, timestamps
  - Relations: facility, vendor
  - Indices: [facilityId, vendorId, transactionDate, vendorItemNo]

- **PricingFile** — id, vendorId, facilityId, vendorItemNo, manufacturerNo, productDescription, listPrice, contractPrice, effectiveDate, expirationDate, category, uom, timestamps
  - Relations: vendor, facility
  - Indices: [vendorId, facilityId, vendorItemNo]

#### Alerts
- **Alert** — id, portalType, alertType (off_contract|expiring_contract|tier_threshold|rebate_due|payment_due|pricing_error|compliance), title, description, severity (high|medium|low), status (new_alert|read|resolved|dismissed), contractId, facilityId, vendorId, metadata (JSON), actionLink, createdAt, readAt, resolvedAt, dismissedAt
  - Relations: contract, facility, vendor
  - Indices: [facilityId, vendorId, status, alertType]

#### Transactions & Financial
- **PurchaseOrder** — id, poNumber, facilityId, vendorId, contractId, orderDate, totalCost, status (draft|pending|approved|sent|completed|cancelled), isOffContract, timestamps
  - Relations: facility, vendor, contract, lineItems, invoices
  - Indices: [facilityId, vendorId, status]

- **POLineItem** — id, purchaseOrderId, sku, inventoryDescription, vendorItemNo, manufacturerNo, quantity, unitPrice, extendedPrice, uom, isOffContract, contractId, createdAt

- **Invoice** — id, invoiceNumber, facilityId, vendorId, purchaseOrderId, invoiceDate, totalInvoiceCost, status, createdAt
  - Relations: facility, vendor, purchaseOrder, lineItems
  - Indices: [facilityId, vendorId]

- **InvoiceLineItem** — id, invoiceId, inventoryDescription, vendorItemNo, invoicePrice, invoiceQuantity, totalLineCost, contractPrice, variancePercent, isFlagged, createdAt

- **Rebate** — id, contractId, facilityId, periodId, rebateEarned, rebateCollected, rebateUnearned, payPeriodStart, payPeriodEnd, collectionDate, notes, timestamps
  - Relations: contract, facility, period
  - Indices: [contractId]

- **Payment** — id, contractId, facilityId, paymentDate, paymentAmount, paymentType, notes, createdById, createdAt
  - Relations: contract, facility, createdBy

- **Credit** — id, contractId, facilityId, creditDate, creditAmount, creditReason, notes, createdById, createdAt
  - Relations: contract, facility, createdBy

#### Mappings & Benchmarks
- **VendorNameMapping** — id, cogVendorName, mappedVendorId, mappedVendorName, confidenceScore, isConfirmed, createdAt
  - Relations: vendor
  - Indices: [cogVendorName]

- **CategoryMapping** — id, cogCategory, contractCategory, similarityScore, isConfirmed, createdAt

- **ProductBenchmark** — id, vendorId, vendorItemNo, description, category, nationalAvgPrice, percentile25/50/75, minPrice, maxPrice, sampleSize, dataDate, source, createdAt
  - Relations: vendor
  - Indices: [vendorItemNo]

#### Case Costing
- **Case** — id, caseNumber (unique), facilityId, surgeonName, surgeonId, patientDob, dateOfSurgery, timeInOr, timeOutOr, primaryCptCode, totalSpend, totalReimbursement, margin, complianceStatus, timestamps
  - Relations: facility, procedures, supplies
  - Indices: [facilityId, surgeonName, dateOfSurgery]

- **CaseProcedure** — id, caseId, cptCode, procedureDescription, createdAt
  - Relations: caseRecord

- **CaseSupply** — id, caseId, materialName, vendorItemNo, usedCost, quantity, extendedCost, isOnContract, contractId, createdAt
  - Relations: caseRecord
  - Indices: [caseId, vendorItemNo]

- **CaseCostingFile** — id, fileType (case_procedures|supply_field|patient_fields|po_history|invoice_history), fileName, rowCount, columnHeaders[], uploadedAt

- **SurgeonUsage** — id, surgeonId, surgeonName, contractId, facilityId, periodStart, periodEnd, usageAmount, caseCount, complianceRate, createdAt
  - Relations: contract, facility

#### Payor & Financial
- **PayorContract** — id, payorName, payorType (commercial|medicare_advantage|medicaid_managed|workers_comp), facilityId, contractNumber, effectiveDate, expirationDate, status, cptRates (JSON), grouperRates (JSON), multiProcedureRule (JSON), implantPassthrough, implantMarkup, uploadedAt, uploadedBy, fileName, notes
  - Relations: facility
  - Unique: [facilityId, payorName, contractNumber]

- **Connection** — id, facilityId, facilityName, vendorId, vendorName, status (pending|accepted|rejected|expired), inviteType (facility_to_vendor|vendor_to_facility), invitedBy, invitedByEmail, invitedAt, respondedAt, respondedBy, expiresAt, message
  - Relations: facility, vendor
  - Indices: [facilityId, vendorId, status]

#### Platform & Feature Control
- **FeatureFlag** — id, facilityId, purchaseOrdersEnabled, aiAgentEnabled, vendorPortalEnabled, advancedReportsEnabled, caseCostingEnabled
  - Relations: facility
  - Unique: [facilityId]

- **AICredit** — id, facilityId, vendorId, tierId (starter|professional|enterprise|unlimited), monthlyCredits, usedCredits, rolloverCredits, billingPeriodStart, billingPeriodEnd, timestamps
  - Relations: facility, vendor, usageRecords
  - Indices: [facilityId, vendorId, billingPeriodStart]

- **AIUsageRecord** — id, creditId, action, creditsUsed, userId, userName, description, metadata (JSON), createdAt
  - Relations: credit (onDelete: Cascade)

- **AuditLog** — id, userId, action, entityType, entityId, metadata (JSON), ipAddress, createdAt
  - Relations: user
  - Indices: [userId, (entityType, entityId), createdAt]

- **ReportSchedule** — id, facilityId, reportType (contract_performance|rebate_summary|spend_analysis|market_share|case_costing), frequency (daily|weekly|monthly), dayOfWeek, dayOfMonth, emailRecipients[], isActive, lastSentAt, timestamps
  - Relations: facility

---

## 3. Routes & Pages

### 3.1 Public Routes

- **`/`** — Marketing landing page (`app/(marketing)/page.tsx`)
- **`/login`** — Better Auth login form with demo buttons
- **`/sign-up`** — Registration form (facility or vendor role select)
- **`/sign-up-success`** — Email verification page
- **`/forgot-password`** — Password reset request
- **`/reset-password`** — Token-based password reset
- **`/error`** — Generic error page

### 3.2 Facility Portal (`/dashboard/*`)

Protected by `requireFacility()`.

#### Main Pages
- **`/dashboard`** — Facility dashboard: spend, rebates, alerts, contract lifecycle, KPIs
- **`/dashboard/contracts`** — Contract list (search, filter by status/type), create/edit/delete contracts
- **`/dashboard/contracts/[id]`** — Contract detail: terms, tiers, documents, pricing, rebates, transactions
- **`/dashboard/contracts/[id]/edit`** — Edit contract metadata
- **`/dashboard/contracts/[id]/terms`** — Manage contract terms, tiers, pricing
- **`/dashboard/contracts/[id]/score`** — AI scoring & analysis page
- **`/dashboard/contracts/new`** — Create new contract

#### Operations & Analytics
- **`/dashboard/cog-data`** — COG data import, supply matching, vendor mapping
- **`/dashboard/purchase-orders`** — PO list (draft, pending, approved, sent, completed, cancelled)
- **`/dashboard/purchase-orders/new`** — Create new PO from contract pricing
- **`/dashboard/purchase-orders/[id]`** — Edit PO, add line items, submit
- **`/dashboard/invoice-validation`** — Invoice list with variance flagging, dispute workflow
- **`/dashboard/invoice-validation/[id]`** — Invoice detail: line items, variance analysis, resolve dispute
- **`/dashboard/alerts`** — Alert hub: off-contract, expiring, tier threshold, rebate due, payment due, pricing error, compliance
- **`/dashboard/alerts/[id]`** — Alert detail: context, action links, resolve/dismiss

#### Analytics & Reporting
- **`/dashboard/reports`** — Report list: contract performance, rebate summary, spend analysis, market share, case costing
- **`/dashboard/reports/price-discrepancy`** — Price vs benchmark analysis
- **`/dashboard/analysis`** — Financial & prospective analysis dashboard
- **`/dashboard/analysis/prospective`** — Prospective ROI analysis: capital equipment, service contracts
- **`/dashboard/renewals`** — Contract renewal pipeline (expiring within 90/180/365 days)
- **`/dashboard/rebate-optimizer`** — Tier threshold analysis, spend targets, optimization opportunities
- **`/dashboard/case-costing`** — Surgical case analysis: procedures, supplies, margin, surgeon performance
- **`/dashboard/case-costing/compare`** — Surgeon/case comparison charts
- **`/dashboard/case-costing/reports`** — Case costing reports

#### Settings & Configuration
- **`/dashboard/settings`** — Facility profile, team management, vendor connections, notification preferences, feature flags

### 3.3 Vendor Portal (`/vendor/*`)

Protected by `requireVendor()`.

- **`/vendor/dashboard`** — Vendor dashboard: active contracts, spend, market share, performance KPIs
- **`/vendor/contracts`** — Vendor contract list (scoped to vendor, no cross-vendor data)
- **`/vendor/contracts/[id]`** — View contract from vendor perspective
- **`/vendor/contracts/[id]/edit`** — Edit vendor's submitted contract metadata
- **`/vendor/contracts/new`** — Submit new contract proposal to facilities
- **`/vendor/contracts/pending/[id]/edit`** — Revision workflow for pending contracts
- **`/vendor/alerts`** — Vendor alerts (scoped)
- **`/vendor/invoices`** — Invoice list (vendor POs against their contracts)
- **`/vendor/purchase-orders`** — Purchase orders from facilities
- **`/vendor/renewals`** — Renewal pipeline
- **`/vendor/prospective`** — Proposal builder for new terms or term changes
- **`/vendor/market-share`** — Market share by category, facility breakdown
- **`/vendor/performance`** — Performance metrics, radar charts, compliance tracking
- **`/vendor/reports`** — Vendor-scoped reports
- **`/vendor/ai-agent`** — Vendor AI assistant (contract analysis, proposal drafting)
- **`/vendor/settings`** — Vendor profile, team, vendor connections

### 3.4 Admin Portal (`/admin/*`)

Protected by `requireAdmin()`.

- **`/admin/dashboard`** — Platform stats: MRR, subscription status, facility/vendor counts, activity
- **`/admin/facilities`** — Facility tenant management: create, edit, subscription status
- **`/admin/vendors`** — Vendor tenant management: create, edit, tier assignment
- **`/admin/users`** — User management: roles, invitations, deactivation
- **`/admin/billing`** — Stripe subscriptions, MRR tracking, payment history
- **`/admin/payor-contracts`** — Insurance contract rates for benchmarking

### 3.5 API Routes

- **`/api/auth/[...all]`** — Better Auth catch-all (login, logout, session, org management)
- **`/api/ai/chat`** — AI chat endpoint (facility/vendor context-aware)
- **`/api/ai/extract-contract`** — Document extraction from PDF/image
- **`/api/ai/extract-amendment`** — Amendment-specific extraction
- **`/api/ai/extract-payor-contract`** — Payor contract extraction
- **`/api/ai/classify-document`** — Document type classification
- **`/api/ai/match-supplies`** — COG supply matching to contract items
- **`/api/ai/score-deal`** — Contract scoring & analysis
- **`/api/ai/map-columns`** — CSV column mapping assistance
- **`/api/upload/presign`** — Presigned S3 URL generation for client-side upload
- **`/api/upload`** — Direct file upload handler
- **`/api/parse-file`** — File parsing endpoint
- **`/api/reports/pdf`** — PDF report generation
- **`/api/webhooks/stripe`** — Stripe webhook handler (subscription events)

---

## 4. Feature Surface — Built vs Partial vs Missing

### 4.1 Contracts

**Built (full CRUD)**
- Create, read, update, delete contracts
- Multi-facility contracts via `ContractFacility` join model
- Grouped contracts, tie-in contracts, capital contracts
- Contract terms (15 term types), tiers, pricing items
- Document upload (main, amendment, addendum, exhibit, pricing)
- Term change proposals from vendors
- Auto-renewal flag, termination notice days
- Contract status tracking (draft, pending, active, expiring, expired)
- Search, filter by status/type/vendor
- **Files:** `lib/actions/contracts.ts`, `lib/actions/contract-terms.ts`, `lib/validators/contracts.ts`, `components/contracts/contract-form.tsx`, `app/dashboard/contracts/page.tsx`, etc. (15+ files)

### 4.2 Vendors

**Built (full CRUD)**
- Create, read, update vendor records
- Vendor hierarchy (parent/child vendors)
- Vendor divisions with categories
- Vendor tier assignment (standard, premium)
- Vendor name mapping for COG reconciliation
- Contact info, website, logo
- Vendor alerts scoped to vendor
- **Files:** `lib/actions/vendors.ts`, `lib/validators/vendors.ts`, `components/facility/vendors/`, `app/admin/vendors/page.tsx`

### 4.3 Facilities

**Built (full CRUD)**
- Create, read, update facility records
- HealthSystem association
- Facility type (hospital, ASC, clinic, surgery center)
- Feature flags per facility (POs enabled, AI enabled, etc.)
- **Files:** `lib/actions/admin/facilities.ts`, `lib/validators/`, `app/admin/facilities/page.tsx`

### 4.4 COG Data

**Built (full feature set)**
- CSV import (parses column headers)
- COG record creation from import
- Vendor name mapping (fuzzy match, confidence score, confirm/override)
- Category mapping
- Supply matching to contract items (AI-assisted)
- Duplicate detection
- Query by facility, vendor, date range, item number
- **Files:** `lib/actions/cog-records.ts`, `lib/actions/cog-duplicate-check.ts`, `lib/actions/vendor-mappings.ts`, `lib/validators/cog-records.ts`, `components/facility/cog/`, `hooks/use-cog-import.ts`, `hooks/use-cog.ts`, `app/dashboard/cog-data/page.tsx`

### 4.5 Purchase Orders

**Built (full CRUD)**
- Create, read, update, delete POs
- Add line items from contract pricing or off-contract
- PO status workflow (draft → pending → approved → sent → completed/cancelled)
- Link to contract
- Attach to invoices
- Off-contract flag
- **Files:** `lib/actions/purchase-orders.ts`, `lib/validators/purchase-orders.ts`, `components/facility/purchase-orders/`, `app/dashboard/purchase-orders/page.tsx`

### 4.6 Invoices

**Built (full feature set)**
- Create, read, update invoice records
- Line items with variance flagging
- Match invoices to POs
- Invoice price vs contract price variance detection (%)
- Dispute resolution workflow
- Status tracking (pending, validated, flagged)
- **Files:** `lib/actions/invoices.ts`, `lib/validators/invoices.ts`, `components/facility/invoices/`, `app/dashboard/invoice-validation/page.tsx`

### 4.7 Rebates & Payments

**Built (partial)**
- Rebate tracking: earned, collected, unearned by contract period
- Rebate tiers by term type (percent of spend, fixed, fixed per unit, per procedure)
- Payment recording by facility
- Credit recording (adjustments, corrections)
- ContractPeriod model for periodic rebate calculation
- **Missing:** Automated rebate calculation engine (currently stored, not computed from spend)
- **Files:** `lib/actions/contracts.ts`, `components/contracts/contract-transactions.tsx`

### 4.8 Alerts

**Built (rule-based generation)**
- 7 alert types: off-contract, expiring contract, tier threshold, rebate due, payment due, pricing error, compliance
- Alert severity (high, medium, low)
- Alert status workflow (new_alert → read/dismissed/resolved)
- Portal-scoped alerts (facility vs vendor)
- Alert bell with unread count in sidebar
- Alert detail view with action links, resolution workflow
- Configurable alert generation rules
- **Files:** `lib/actions/alerts.ts`, `lib/actions/vendor-alerts.ts`, `lib/alerts/generate-alerts.ts`, `lib/validators/alerts.ts`, `components/shared/alerts/`, `app/dashboard/alerts/page.tsx`

### 4.9 Reports

**Built (feature-rich)**
- Contract performance report (spend, rebates, metrics by contract)
- Rebate summary report (earned, collected, outstanding)
- Spend analysis (by vendor, category, time)
- Market share analysis (vendor market share by category)
- Case costing report (surgical case margins, surgeon performance)
- Price discrepancy report (invoice price vs contract price vs benchmark)
- Report scheduling (daily, weekly, monthly delivery to emails)
- PDF export (jsPDF with tables, charts)
- **Files:** `lib/actions/reports.ts`, `lib/validators/report-scheduling.ts`, `lib/pdf.ts`, `components/shared/charts/`, `app/dashboard/reports/page.tsx`

### 4.10 Case Costing

**Built (full feature set)**
- Case entry: surgery date, surgeon, procedure codes, supplies used
- Supply cost tracking: item, vendor, unit cost, on-contract flag
- Case margin calculation: total spend vs reimbursement
- Surgeon usage tracking: cases per surgeon, compliance rate by period
- Surgeon comparison: spend, margin, compliance across surgeons
- CPT analysis (procedure code breakdown)
- Payor contract support (CPT rates, grouperRates, implant markup)
- **Files:** `lib/actions/cases.ts`, `lib/validators/cases.ts`, `components/facility/case-costing/`, `app/dashboard/case-costing/page.tsx`

### 4.11 AI Agent & Extraction

**Built (multiple endpoints)**
- Contract document extraction (PDF/image → JSON: terms, pricing, dates)
- Amendment extraction (identify changes from amendments)
- Payor contract extraction (CPT rates, grouperRates)
- Contract scoring & recommendations
- Supply matching (COG item ↔ contract item matching)
- Document classification (main contract, amendment, pricing file, etc)
- Chat interface (context-aware facility/vendor questions)
- Column mapping helper (CSV import column inference)
- AI credit system: per-facility tiers (starter, professional, enterprise, unlimited)
- **Files:** `lib/ai/config.ts`, `lib/ai/prompts.ts`, `lib/ai/schemas.ts`, `lib/ai/tools.ts`, `lib/actions/ai-credits.ts`, `app/api/ai/*.ts` (8 routes), `components/shared/ai/`, `hooks/use-ai-credits.ts`

### 4.12 Renewals

**Built (tracking & pipeline)**
- List expiring contracts within configurable window (90/180/365 days)
- Renewal summary per contract (current terms, notice period)
- Renewal proposals from vendor
- Status tracking (pending, approved, rejected)
- **Missing:** Automated renewal workflow, renewal negotiation workflow
- **Files:** `lib/actions/renewals.ts`, `lib/validators/`, `app/dashboard/renewals/page.tsx`, `app/vendor/renewals/page.tsx`

### 4.13 Rebate Optimizer

**Built (analysis & recommendations)**
- Identify tier threshold opportunities (if spend increases by X, rebate rate improves by Y%)
- Calculate spend targets for next tier
- Show rebate earning forecast
- Recommend category consolidation
- **Missing:** Automated tier optimization suggestions
- **Files:** `lib/actions/rebate-optimizer.ts`, `lib/validators/`, `components/facility/rebate-optimizer/`, `app/dashboard/rebate-optimizer/page.tsx`

### 4.14 Analysis Module

**Built (financial analysis)**
- MACRS depreciation calculations (capital equipment contracts)
- Price projection forecasting (historical spend trend extrapolation)
- Spend trends by vendor, category, time
- Prospective analysis (capital equipment ROI, service contract payback)
- Market share analysis
- **Files:** `lib/analysis/depreciation.ts`, `lib/analysis/forecasting.ts`, `lib/actions/analysis.ts`, `lib/actions/prospective.ts`, `lib/validators/analysis.ts`, `components/facility/analysis/`, `app/dashboard/analysis/page.tsx`

### 4.15 Connections (Facility ↔ Vendor)

**Built (invitation workflow)**
- Facility invites vendor (or vendor requests facility)
- Invitation status: pending, accepted, rejected, expired
- Bilateral relationship tracking
- Message support
- **Files:** `lib/actions/connections.ts`, `lib/validators/connections.ts`, `app/dashboard/settings/page.tsx`

### 4.16 Settings & Team Management

**Built (profile, team, notifications)**
- Facility/vendor profile edit (name, contact info, type, etc)
- Team member management (invite, assign role: admin, manager, rep)
- Invite workflow (email sent via Resend)
- Notification preferences (per facility/vendor)
- Feature flags UI (enable/disable POs, AI, etc)
- Vendor connections management (accept/reject)
- **Files:** `lib/actions/settings.ts`, `lib/validators/settings.ts`, `components/shared/settings/`, `components/facility/settings/`, `app/dashboard/settings/page.tsx`

### 4.17 Billing & Subscriptions

**Built (Stripe integration)**
- Stripe integration via `@better-auth/stripe` plugin
- Organization-level subscription (Standard, Pro, Enterprise tiers)
- MRR tracking
- Webhook handler for subscription events
- Admin billing page (list subscriptions, revenue)
- **Files:** `lib/auth-server.ts`, `lib/stripe.ts`, `app/api/webhooks/stripe/route.ts`, `lib/actions/admin/billing.ts`, `app/admin/billing/page.tsx`

### 4.18 Audit Logging

**Built (event tracking)**
- Log all major actions: contract.created, alert.resolved, cog.imported, payment.recorded, etc
- Captures userId, action, entityType, entityId, metadata, IP address, timestamp
- Audit trail queryable
- **Files:** `lib/audit.ts`, `lib/actions/` (all call logAudit), `prisma/schema.prisma` (AuditLog model)

### 4.19 Missing or Stubbed Features

- **Automated rebate calculation engine** — Rebates are recorded manually, not calculated from spend tiers
- **Vendor proposal negotiation workflow** — Proposals can be submitted, but negotiation back-and-forth is basic
- **Automated renewal workflow** — Renewals are tracked but not automatically initiated or workflow-managed
- **Complex spend forecasting** — Basic linear trend forecasting exists; no seasonality or advanced ML
- **Contract cloning** — Ability to clone a contract for quick renewal/multi-facility setup (mentioned in comments but not fully built)
- **Bulk import/export** — No bulk contract import; individual entry only
- **Email notifications** — Infrastructure exists (Resend), but notification scheduling may be partial
- **Real-time collaboration** — No multiplayer contract editing or live updates
- **Mobile app** — Web-only, responsive design but no native mobile
- **SAML/SSO** — Only email/password auth (Better Auth extensible but not configured)

---

## 5. Shared Components & UI Primitives

### 5.1 shadcn/ui Components (31 total)

`components/ui/` directory: accordion, alert-dialog, alert, avatar, badge, breadcrumb, button, calendar, card, checkbox, collapsible, command, dialog, dropdown-menu, input, label, popover, progress, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner (toast), switch, table, tabs, textarea, tooltip.

### 5.2 Shared Reusable Components

**Shells & Layout** (`components/shared/shells/`)
- `PortalShell` — Main layout wrapper for all three portals (facility, vendor, admin)
  - Sidebar nav with items from constants.ts
  - User menu (profile, switch org, logout)
  - Alert bell with unread count
  - Search/command palette
  - Theme toggle
- `SidebarNav` — Configurable navigation list
- `UserMenu` — User dropdown (profile, logout, org switch)
- `AlertBell` — Notification bell with unread count badge
- `CommandSearch` — Global search/command palette

**Tables** (`components/shared/tables/`)
- `DataTable` — TanStack Table wrapper with search, filter, sort, pagination, row click handlers
- `TableActionMenu` — Bulk action dropdown for rows
- `TableFilters` — Filter UI component (reusable filter UI)

**Forms** (`components/shared/forms/`)
- `Field` — Unified input wrapper (handles text, textarea, select, checkbox, date)
- `FormDialog` — Modal form wrapper (dialog + form with title, submit button)
- `ConfirmDialog` — Delete/destructive action confirmation modal
- `DateRangePicker` — Date range selection with calendar picker

**Cards** (`components/shared/cards/`)
- `MetricCard` — KPI display card (label, value, change %, trend icon)

**Badges** (`components/shared/badges/`)
- `StatusBadge` — Config-driven status badge (renders color, label based on statusConfig mapping)

**Alerts** (`components/shared/alerts/`)
- `AlertCard` — Individual alert display (title, severity badge, status, action button)
- `AlertsList` — List of alerts with filters
- `AlertDetailCard` — Full alert view with context, resolution workflow

**AI Components** (`components/shared/ai/`)
- `ChatInterface` — Facility/vendor AI chat (input, messages, credit indicator, clear history)
- `ChatMessage` — Individual message (user vs assistant, formatting)
- `CreditIndicator` — Display remaining AI credits

**Settings** (`components/shared/settings/`)
- `TeamTable` — Team member list (name, role, invite status, actions)
- `InviteMemberDialog` — Invite modal form

**Charts** (`components/shared/charts/`)
- `ChartCard` — Recharts wrapper (title, legend, responsive container, chart types)

**Utility**
- `PageHeader` — Page title, breadcrumb, action buttons
- `DefinitionTooltip` — Tooltip with definition (hover text)
- `FileUpload` — File input with drag-and-drop
- `VendorMatcherDialog` — AI-assisted vendor name matching
- `ThemeToggle` — Dark mode toggle
- `EmptyState` — "No data" page

### 5.3 Portal-Specific Components

**Facility** (`components/facility/`)
- Dashboard (spend charts, alerts, KPIs)
- Contracts (creation, editing, document upload)
- COG (import, mapping, matching)
- Purchase Orders (creation, editing workflow)
- Invoices (variance display, dispute workflow)
- Case Costing (case entry, surgeon comparison)
- Rebate Optimizer (tier analysis)
- Analysis (depreciation calculator, forecasting)
- Settings (profile, team, vendors)

**Vendor** (`components/vendor/`)
- Dashboard (contracts, spend trend, market share)
- Contracts (vendor's contracts view, submission form)
- Alerts (vendor-scoped)
- Performance (metrics, radar charts)
- Market Share (category breakdown)
- Prospective (proposal builder)
- Settings (profile, team, connections)

**Admin** (`components/admin/`)
- Dashboard (MRR, subscription status, tenant counts)
- Facilities (tenant management, create/edit)
- Vendors (tenant management, tier assignment)
- Users (role assignment, invite, deactivate)
- Billing (Stripe subscriptions, MRR)

**Contracts** (`components/contracts/`)
- `ContractForm` — Create/edit contract (shared between facility and vendor)
- `ContractColumns` — TanStack Table column definitions
- `ContractTermsEntry` — UI for adding contract terms and tiers
- `ContractTermsDisplay` — Display terms, tiers, pricing
- `ContractTierRow` — Tier editing (spend thresholds, rebate values)
- `DocumentUpload` — Upload contract documents (PDF, image)
- `AIExtractDialog` — Extract terms from document using AI
- `AIScorePage` — AI scoring & analysis display
- `ContractTransactions` — Rebates, payments, credits table

---

## 6. lib/ Helpers & Utilities

### 6.1 Authentication & Session

**`auth-server.ts`** — Better Auth server config (betterAuth instance, Prisma adapter, plugins, email/password, session config)

**`auth.ts`** — Better Auth client exports (authClient, useSession, signIn, signUp, signOut)

**`lib/actions/auth.ts`** — Session guards (requireAuth, requireFacility, requireVendor, requireAdmin), demo credentials, password reset functions

### 6.2 Database & Prisma

**`db.ts`** — Prisma client singleton (`export const prisma = new PrismaClient()`)

### 6.3 File Storage & S3

**`storage.ts`** — AWS SDK S3Client: uploadFile, getSignedUrl (download), deleteFile, getUploadPresignedUrl (client-side presign)

**`s3.ts`** — Legacy wrapper re-exporting storage functions (generatePresignedUploadUrl, generatePresignedDownloadUrl, deleteObject)

### 6.4 Email

**`email.ts`** — Resend client exports: sendEmail, sendReportEmail

**`email-templates.ts`** — Email template functions (contract reminder, rebate due, alert notification, etc)

### 6.5 Stripe & Billing

**`stripe.ts`** — Stripe SDK singleton (created via `new Stripe(process.env.STRIPE_SECRET_KEY!)`)

### 6.6 AI Integration

**`ai/config.ts`** — Gemini model config (`google("gemini-2.5-flash")`), AI credit cost mapping (document_extraction_per_page: 2, contract_analysis: 25, chat: 3, etc)

**`ai/prompts.ts`** — System prompts for AI chat, contract analysis, supply matching, scoring

**`ai/schemas.ts`** — Zod schemas for AI extraction output (ExtractedContract, ExtractedAmendment, etc)

**`ai/tools.ts`** — AI tool definitions for structured output and function calling

### 6.7 Data Formatting & Transformation

**`formatting.ts`** — formatCurrency, formatDate, formatPercent helpers

**`serialize.ts`** — Decimal serialization (convert Prisma Decimal to string for JSON)

**`utils.ts`** — cn() Tailwind merge utility for conditional classes

**`types.ts`** — Global TypeScript types (NavItem, StatusConfig, DateRange, etc)

### 6.8 Query & Data Fetching

**`query-keys.ts`** — TanStack Query key factory pattern (contracts, facilities, alerts, dashboard stats, vendors, etc)

### 6.9 Business Logic

**`contract-definitions.ts`** — Contract type metadata (TermTypes, RebateTypes, descriptions, validations)

**`national-reimbursement-rates.ts`** — CPT code reimbursement rates for payor contract analysis

**`vendor-aliases.ts`** — Vendor name fuzzy matching logic (detect similar vendor names from COG)

**`map-columns.ts`** — CSV column mapping inference (guess header format from sample rows)

### 6.10 Financial Analysis

**`analysis/depreciation.ts`** — MACRS depreciation calculation for capital equipment contracts

**`analysis/forecasting.ts`** — Spend forecasting: linear trend, growth rate, historical aggregation

### 6.11 Validation

**`validators.ts`** — Enum Zod schemas (UserRole, ContractType, ContractStatus, etc), auth schemas (loginSchema, signUpSchema)

**`validators/*.ts`** (20 files) — Feature-specific Zod schemas (contracts, invoices, cog-records, purchase-orders, etc)

**`generated/zod/*.ts`** — Auto-generated Zod types from Prisma (via zod-prisma-types generator)

### 6.12 Alerts & Notifications

**`alerts/generate-alerts.ts`** — Alert generation logic (detect off-contract spend, expiring contracts, tier thresholds, etc)

**`rate-limit.ts`** — Upstash rate limiting (prevent abuse of AI endpoints, uploads)

### 6.13 Audit & Logging

**`audit.ts`** — logAudit helper (capture action, entity, metadata, IP)

### 6.14 PDF & Reporting

**`pdf.ts`** — jsPDF + jspdf-autotable: generate PDF reports with tables, charts, headers/footers

### 6.15 Chart Configuration

**`chart-config.ts`** — Recharts color palettes, responsive container defaults

**`animations.ts`** — Framer Motion animation definitions

---

## 7. Integrations Wired Up

### 7.1 Better Auth (Authentication & Organizations)

**Configured:** Yes, fully integrated
- **Server:** `lib/auth-server.ts` (betterAuth instance, Prisma adapter, organization plugin, Stripe plugin)
- **Client:** `lib/auth.ts` (authClient, useSession hook)
- **Usage:** Edge protection in `proxy.ts`, session guards in `lib/actions/auth.ts`, user routes for login/signup
- **Database:** User, Session, Account, Verification, Organization, Member, Invitation models in schema
- **Email:** Integrated with Resend for password reset, email verification
- **Cookies:** __Secure-better-auth.session_token (production), better-auth.session_token (dev)

### 7.2 Stripe (Billing & Subscriptions)

**Configured:** Yes, via @better-auth/stripe plugin
- **Plugin:** Configured in `auth-server.ts` with stripeClient, stripeWebhookSecret
- **Webhook:** `/api/webhooks/stripe/route.ts` handles subscription_created, subscription_updated, invoice_payment_succeeded events
- **Usage:** Organization-level subscription tiers (standard, pro, enterprise), MRR tracking, subscription status in admin dashboard
- **Admin Endpoint:** `/admin/billing` lists subscriptions, revenue, MRR
- **Environment:** STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID, STRIPE_ENTERPRISE_PRICE_ID

### 7.3 AWS S3 / S3-Compatible Storage

**Configured:** Yes, with presigned URLs
- **Client:** AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`)
- **Usage:** Document uploads (contracts, amendments, COG files), file downloads, S3 presigned URLs for client-side uploads
- **Endpoints:** `/api/upload/presign` (generate upload URL), `/api/upload` (direct upload handler)
- **Implementation:** `lib/storage.ts` (uploadFile, getSignedUrl, deleteFile, getUploadPresignedUrl)
- **Environment:** S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
- **Notes:** Supports S3-compatible services (Railway Object Storage, Minio, etc) via S3_ENDPOINT config

### 7.4 Resend (Email Delivery)

**Configured:** Yes, fully integrated
- **Client:** Resend SDK
- **Usage:** Password reset emails, email verification, alert notifications, report scheduling, contract reminders
- **Implementation:** `lib/email.ts` (sendEmail, sendReportEmail), `lib/email-templates.ts` (template functions)
- **Better Auth Integration:** Password reset and email verification flows use Resend
- **Environment:** RESEND_API_KEY
- **From Address:** noreply@tydei.com (Better Auth), notifications@tydei.com (alerts), reports@tydei.com (reports)

### 7.5 Vercel AI SDK + Google Gemini

**Configured:** Yes, with streaming & structured output
- **Model:** `gemini-2.5-flash` (free tier, no Pro variant)
- **Usage:** Contract extraction, document classification, supply matching, AI chat, scoring, column mapping
- **Implementation:** `lib/ai/config.ts` (model config), `lib/ai/prompts.ts` (system prompts), `lib/ai/schemas.ts` (Zod schemas for structured output), `lib/ai/tools.ts` (tool definitions)
- **Endpoints:**
  - `/api/ai/chat` — Facility/vendor Q&A
  - `/api/ai/extract-contract` — PDF/image → contract JSON
  - `/api/ai/extract-amendment` — Amendment extraction
  - `/api/ai/extract-payor-contract` — CPT rate extraction
  - `/api/ai/classify-document` — Document type classification
  - `/api/ai/match-supplies` — COG item ↔ contract matching
  - `/api/ai/score-deal` — Contract analysis & scoring
  - `/api/ai/map-columns` — CSV column header inference
- **Credit System:** Per-facility tiers (starter, professional, enterprise, unlimited), credit costs defined in `AI_CREDIT_COSTS`
- **Environment:** GOOGLE_API_KEY
- **Rate Limiting:** Upstash Redis rate limit on AI endpoints

### 7.6 Upstash (Rate Limiting & Redis)

**Configured:** Partially wired, used for rate limiting
- **Usage:** Rate limit AI endpoints, file uploads to prevent abuse
- **Implementation:** `lib/rate-limit.ts` (Ratelimit instance configuration)
- **Environment:** UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (if configured)
- **Notes:** Optional; gracefully degrades if keys not set

### 7.7 TanStack Query (Data Fetching)

**Configured:** Yes, fully integrated
- **Usage:** All client-side data fetching in pages and components
- **Implementation:** 25+ custom hooks in `hooks/` (useContracts, useAlerts, useDashboard, etc)
- **Key Pattern:** `lib/query-keys.ts` (factory pattern for type-safe query keys)
- **Client Setup:** Imported in client components, hooks wrap server actions

### 7.8 TanStack Table (Data Tables)

**Configured:** Yes, core table functionality
- **Usage:** All data lists (contracts, facilities, vendors, invoices, alerts, etc)
- **Wrapper:** `components/shared/tables/data-table.tsx` (generic table component)
- **Features:** Search, sort, filter, pagination, row selection, bulk actions
- **Column Definitions:** Feature-specific files (contract-columns.tsx, facility-columns.tsx, etc)

### 7.9 Prisma (ORM)

**Configured:** Yes, v7 with driver adapters
- **Database:** PostgreSQL 16 via `@prisma/adapter-pg`
- **Config:** `prisma/prisma.config.ts` (dotenv integration)
- **Schema:** 44 models, 24 enums, full relational structure
- **Code Generation:** `prisma generate` creates PrismaClient + Zod types
- **Migrations:** `db:migrate` (dev), pre-deploy migrations on Railway

### 7.10 react-hook-form + Zod

**Configured:** Yes, all forms use this pattern
- **Usage:** Contract forms, facility forms, settings forms, dialog forms
- **Resolver:** @hookform/resolvers/zod
- **Validation:** All inputs validated against Zod schemas before submission
- **Error Display:** Field-level errors in custom Field component

---

## 8. Tests & CI

### 8.1 Unit Testing

**Framework:** Vitest
- **Config:** `vitest.config.ts` (node environment, globals: true, setupFiles: ./tests/setup.ts)
- **Test Files:** 2 existing tests
  - `tests/map-columns.test.ts` — Column mapping logic tests
  - `tests/serialize.test.ts` — Decimal serialization tests
- **Setup:** `tests/setup.ts` (global test utilities)

### 8.2 E2E Testing

**Framework:** Playwright
- **Config:** `playwright.config.ts`
- **Coverage:** No existing tests in repo (config present, awaiting test suite)

### 8.3 Linting

**Tool:** Oxlint
- **Config:** `oxlint.json`
- **Command:** `bun run lint`

### 8.4 CI/CD

**Deployment:** Railway
- **Config:** `railway.toml` (pre-configured)
- **Build:** `prisma generate && next build` (Turbopack)
- **Pre-Deploy:** `prisma migrate deploy`
- **Start:** `bun run start`
- **Env:** Uses Railway variable references (e.g., `${{Postgres.DATABASE_URL}}`)

**Git Hooks:** Not configured in repo (pre-commit hooks not present)

---

## 9. Open Gaps & TODOs

### 9.1 Code TODOs & FIXMEs

**`components/facility/dashboard/dashboard-filters.tsx:5`**
```typescript
// TODO: fetch facilities from server action instead of hardcoded empty list
```

### 9.2 Stubbed or Partial Features

1. **Automated Rebate Calculation** — Rebates tracked but not auto-calculated from spend tiers
2. **Vendor Negotiation Workflow** — Basic proposal workflow, no iterative back-and-forth
3. **Automated Renewal Initiation** — Renewals tracked but not auto-triggered
4. **Advanced Forecasting** — Linear trends only, no seasonality
5. **Contract Cloning** — Not implemented (mentioned in comments)
6. **Bulk Import/Export** — No bulk contract upload
7. **Email Notification Scheduling** — Infrastructure exists but may need completion
8. **SAML/SSO** — Not configured
9. **Real-Time Collaboration** — No live editing, multiplayer support
10. **Mobile App** — Web-responsive, no native iOS/Android

### 9.3 Database Gaps

- No soft-delete pattern (all deletes are hard)
- No time-series data (for trend analysis, only point-in-time snapshots)
- No full-text search indices

### 9.4 Integration Gaps

- Upstash Redis: configured in code but may not be deployed/active
- Stripe webhooks: handler exists but event processing may be incomplete

### 9.5 Testing Gaps

- Only 2 unit tests present (map-columns, serialize)
- No E2E tests (Playwright config present but no test files)
- No integration tests
- No component tests

### 9.6 Known Production Notes

- Next.js 16 uses `proxy.ts` instead of `middleware.ts` for edge route protection
- Server actions have 10mb body size limit (may need increase for large file uploads)
- Session cache enabled (5-minute TTL) for performance
- Decimal fields serialized to strings for JSON response

---

## 10. How to Use This Report for Your v0 Prototype Port

### Key Takeaways for Migration

1. **Architecture is modular:** Thin pages, fat components, server actions for mutations, hooks for queries. Your v0 components can map to this structure.

2. **Forms are standardized:** react-hook-form + Zod resolvers everywhere. Adapt your form components to use this pattern.

3. **Tables are wrapped:** TanStack Table with custom DataTable. Migrate your table UI to the shared wrapper.

4. **Auth is per-role:** requireFacility, requireVendor, requireAdmin. Your v0 probably has generic auth; add role-specific guards.

5. **Shared UI primitives:** Use `components/shared/` (Field, FormDialog, ConfirmDialog, DataTable) for common patterns. Don't duplicate.

6. **AI is integrated:** Gemini SDK + credit system. If your v0 has AI, wire it into the existing AI endpoints and credit tracking.

7. **No middleware.ts:** proxy.ts handles edge protection in Next.js 16. Keep using it.

8. **Validators are auto-generated:** Zod schemas come from Prisma via zod-prisma-types. Update schema.prisma and re-generate.

9. **Server actions are isolated:** Each feature has its own file in `lib/actions/`. Group yours by entity.

10. **Query keys are centralized:** `lib/query-keys.ts` is the source of truth. Add your new feature keys there.

### Migration Checklist

- [ ] Map v0 data models to Prisma schema (add/update models)
- [ ] Generate Prisma client & Zod types (`prisma generate`)
- [ ] Create server actions for your new feature (`lib/actions/feature.ts`)
- [ ] Add Zod validators (`lib/validators/feature.ts`)
- [ ] Add query keys (`lib/query-keys.ts`)
- [ ] Create custom hooks for fetching (`hooks/use-feature.ts`)
- [ ] Build client components using DataTable, FormDialog, Field wrappers
- [ ] Add pages under appropriate portal (`app/dashboard/feature/page.tsx`, etc)
- [ ] Wire up auth guards (requireFacility, requireVendor, requireAdmin)
- [ ] Test CRUD endpoints
- [ ] Add tests (vitest + playwright)
- [ ] Document new feature in this report

---

## 11. Quick Reference: Important File Paths

| Purpose | File |
|---------|------|
| Auth session guards | `/lib/actions/auth.ts` |
| Better Auth server | `/lib/auth-server.ts` |
| Database client | `/lib/db.ts` |
| S3 operations | `/lib/storage.ts` |
| Email sending | `/lib/email.ts` |
| Query key factory | `/lib/query-keys.ts` |
| Zod validators (enum) | `/lib/validators.ts` |
| Constants (nav, status) | `/lib/constants.ts` |
| AI config & prompts | `/lib/ai/config.ts`, `/lib/ai/prompts.ts` |
| Alert generation | `/lib/alerts/generate-alerts.ts` |
| PDF generation | `/lib/pdf.ts` |
| Shared data table | `/components/shared/tables/data-table.tsx` |
| Shared form field | `/components/shared/forms/field.tsx` |
| Portal shell layout | `/components/shared/shells/portal-shell.tsx` |
| Prisma schema | `/prisma/schema.prisma` |
| Edge route protection | `/proxy.ts` |
| Next.js config | `/next.config.ts` |
| Facility nav items | `/lib/constants.ts` (facilityNav) |
| Vendor nav items | `/lib/constants.ts` (vendorNav) |
| Admin nav items | `/lib/constants.ts` (adminNav) |

---

**Report Generated:** April 14, 2026  
**Last Updated:** During current mapping session  
**Total Files Analyzed:** 430+ TS/TSX files, 44 Prisma models, 8 API routes, 52 pages, 297 components

