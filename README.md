# TYDEi Platform

Healthcare contract management SaaS with dual portals for facilities and vendors. Facilities track vendor contracts, rebate tiers, cost-of-goods data, case costing, and invoice validation. Vendors manage their own contracts, submit proposals, and track performance.

## Tech Stack

| Category | Choice |
|----------|--------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript (strict mode) |
| ORM | Prisma 7 (driver adapters, PostgreSQL) |
| Database | PostgreSQL 16 (Docker local, Railway prod) |
| Auth | Better Auth (prismaAdapter, org plugin, stripe plugin) |
| Email | Resend |
| Styling | Tailwind CSS v4 + shadcn/ui (new-york) |
| Validation | Zod + zod-prisma-types |
| Forms | react-hook-form + @hookform/resolvers/zod |
| Data Fetching | TanStack Query |
| Tables | TanStack Table |
| Charts | Recharts |
| AI | Vercel AI SDK + Anthropic Claude & Google Gemini |
| File Storage | S3-compatible (Railway Object Storage) |
| Payments | Stripe (via @better-auth/stripe) |
| Icons | Lucide React |
| Toasts | Sonner |
| Linting | Oxlint |
| Package Manager | Bun |
| Deployment | Railway |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) (v1.1+)
- [Docker](https://docs.docker.com/get-docker/) (for local PostgreSQL)

### Setup

```bash
# Clone and install
cd tydei-next
bun install

# Start PostgreSQL
docker compose up -d

# Copy env file and fill in your keys
cp .env.example .env

# Push schema to database
bun run db:push

# Generate Prisma client + Zod types
bunx prisma generate

# Seed demo data
bun run db:seed

# Start dev server
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

### Demo Accounts

After seeding, use the demo login buttons on the login page or these credentials:

| Email | Password | Portal |
|-------|----------|--------|
| demo-facility@tydei.com | demo-facility-2024 | `/dashboard` (Facility) |
| demo-vendor@tydei.com | demo-vendor-2024 | `/vendor` (Vendor) |
| demo-admin@tydei.com | demo-admin-2024 | `/admin` (Admin) |

## Environment Variables

Copy `.env.example` to `.env` and fill in values:

```env
# Database (Docker default works out of the box)
# Host port is 5435 (docker-compose maps 5435→5432, since 5432 is often
# taken by other local Postgres instances).
DATABASE_URL=postgresql://tydei:tydei_dev_password@localhost:5435/tydei

# Auth
BETTER_AUTH_SECRET=         # Generate: openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Stripe (billing)
STRIPE_SECRET_KEY=          # sk_test_...
STRIPE_WEBHOOK_SECRET=      # whsec_...
STRIPE_PRO_PRICE_ID=        # price_...
STRIPE_ENTERPRISE_PRICE_ID= # price_...
NEXT_PUBLIC_STRIPE_PRICE_ID=# price_...

# Email (Resend)
RESEND_API_KEY=             # re_...

# AI (Gemini)
GOOGLE_API_KEY=             # AIza...

# File Storage (S3-compatible)
S3_ENDPOINT=                # https://....storageapi.dev
S3_REGION=auto
S3_BUCKET=                  # bucket-name
S3_ACCESS_KEY_ID=           # tid_...
S3_SECRET_ACCESS_KEY=       # tsec_...
```

**Required for local dev:** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_SITE_URL`

**Optional for local dev:** All others (Stripe, Resend, AI, S3). Features degrade gracefully without them.

## Scripts

```bash
bun dev              # Start dev server (Turbopack, port 3000)
bun run build        # Production build (prisma generate + next build)
bun start            # Start production server

bun run db:push      # Push Prisma schema to database
bun run db:migrate   # Run Prisma migrations
bun run db:seed      # Seed demo data
bun run db:studio    # Open Prisma Studio

bun run lint         # Run Oxlint
```

## Project Structure

```
tydei-next/
├── app/
│   ├── (auth)/              # Login, sign-up, forgot/reset password
│   ├── (marketing)/         # Landing page (public)
│   ├── dashboard/           # Facility portal (protected)
│   │   ├── contracts/       # Contract CRUD, term/tier management
│   │   ├── cog-data/        # COG data import, pricing files
│   │   ├── alerts/          # Alert management
│   │   ├── reports/         # Reports + price discrepancy
│   │   ├── purchase-orders/ # PO creation + tracking
│   │   ├── invoice-validation/ # Invoice validation + disputes
│   │   ├── renewals/        # Contract renewal tracking
│   │   ├── rebate-optimizer/# Rebate tier optimization
│   │   ├── case-costing/    # Surgical case analysis
│   │   ├── analysis/        # Financial + prospective analysis
│   │   ├── ai-agent/        # AI chat assistant
│   │   └── settings/        # Profile, team, notifications, vendors
│   ├── vendor/              # Vendor portal (protected)
│   │   ├── dashboard/       # Vendor metrics + spend charts
│   │   ├── contracts/       # Vendor contract list + submissions
│   │   ├── alerts/          # Vendor-scoped alerts
│   │   ├── invoices/        # Invoice management
│   │   ├── market-share/    # Market share analytics
│   │   ├── performance/     # Performance metrics + radar
│   │   ├── prospective/     # Proposal stepper (constructs → opportunity → report)
│   │   ├── renewals/        # Renewal pipeline
│   │   ├── ai-agent/        # Vendor AI assistant
│   │   └── settings/        # Profile, team, connections
│   ├── admin/               # Admin portal (protected)
│   │   ├── dashboard/       # Platform stats + activity
│   │   ├── facilities/      # Facility tenant management
│   │   ├── vendors/         # Vendor tenant management
│   │   ├── users/           # User management
│   │   ├── billing/         # Stripe subscriptions + MRR
│   │   └── payor-contracts/ # Insurance contract rates
│   └── api/
│       ├── auth/[...all]/   # Better Auth catch-all
│       ├── ai/              # AI endpoints (chat, extract, score, match)
│       ├── upload/          # S3 presigned URL generation
│       └── webhooks/stripe/ # Stripe webhook handler
├── components/
│   ├── ui/                  # shadcn/ui components (29)
│   ├── shared/              # Reusable across all portals
│   │   ├── shells/          # PortalShell, SidebarNav, EntitySelector, UserMenu
│   │   ├── tables/          # DataTable, TableActionMenu, TableFilters
│   │   ├── forms/           # FormDialog, ConfirmDialog, Field, DateRangePicker
│   │   ├── cards/           # MetricCard
│   │   ├── badges/          # StatusBadge (config-driven)
│   │   ├── alerts/          # AlertCard, AlertsList, AlertDetailCard
│   │   ├── charts/          # ChartCard
│   │   ├── ai/              # ChatInterface, ChatMessage, CreditIndicator
│   │   └── settings/        # TeamTable, InviteMemberDialog
│   ├── contracts/           # Shared contract components (both portals)
│   ├── facility/            # Facility-specific components
│   ├── vendor/              # Vendor-specific components
│   ├── admin/               # Admin-specific components
│   ├── auth/                # Auth forms + demo login
│   └── marketing/           # Landing page sections
├── lib/
│   ├── actions/             # Server actions (38 files, grouped by entity)
│   │   ├── auth.ts          # requireAuth, requireFacility, requireVendor, requireAdmin
│   │   ├── contracts.ts     # Contract CRUD
│   │   ├── alerts.ts        # Alert CRUD + generation
│   │   ├── admin/           # Admin-scoped actions (6 files)
│   │   └── ...              # 30+ more action files
│   ├── validators/          # Zod schemas (20 files)
│   ├── ai/                  # AI config, prompts, tools, schemas
│   ├── alerts/              # Alert generation logic
│   ├── analysis/            # MACRS depreciation, forecasting
│   ├── generated/zod/       # Auto-generated Zod types from Prisma
│   ├── auth-server.ts       # Better Auth server config
│   ├── auth.ts              # Better Auth client
│   ├── db.ts                # Prisma client singleton
│   ├── s3.ts                # S3 client (upload, download, delete)
│   ├── stripe.ts            # Stripe SDK singleton
│   ├── email.ts             # Resend client
│   ├── formatting.ts        # formatCurrency, formatDate, formatPercent
│   ├── constants.ts         # Nav configs, status badge configs
│   ├── query-keys.ts        # TanStack Query key factory
│   └── utils.ts             # cn() helper
├── hooks/                   # TanStack Query hooks (25 files)
├── prisma/
│   ├── schema.prisma        # 44 models, 24 enums
│   ├── prisma.config.ts     # Prisma 7 config with dotenv
│   └── seed.ts              # Demo data seeder
├── proxy.ts                 # Next.js 16 route protection
├── docker-compose.yml       # PostgreSQL 16
├── railway.toml             # Railway deployment config
└── package.json
```

## Architecture

### Three Portals

| Portal | URL Prefix | Role | Purpose |
|--------|-----------|------|---------|
| Facility | `/dashboard` | `facility` | Contract management, COG data, analytics, POs, invoices |
| Vendor | `/vendor` | `vendor` | Contract submissions, performance tracking, proposals |
| Admin | `/admin` | `admin` | Platform management, billing, user administration |

All portals share a single `PortalShell` layout component. Nav items, auth guards, and data scoping differ by role.

### Auth Flow

- Better Auth handles registration, login, sessions, organizations
- `proxy.ts` (Next.js 16) protects routes at the edge — redirects unauthenticated users to `/login`
- Server actions use `requireFacility()` / `requireVendor()` / `requireAdmin()` for role-specific access
- **Tenant isolation is enforced per-query.** Every read/write that takes a client id is scoped to the caller's own facility/vendor via canonical helpers — `contractOwnershipWhere` / `contractsOwnedByFacility` (`lib/actions/contracts-auth.ts`) and `contractsOwnedByVendor` (`lib/actions/contracts-vendor-auth.ts`). A static guard, `lib/actions/__tests__/server-action-auth-scope-scanner.test.ts`, fails the build on any unscoped `where: { id }` in a `"use server"` file, preventing cross-tenant IDORs.
- **File uploads** are bounded against decompression bombs — all `.xlsx` parsing flows through `parseXlsxMatrixBounded` (`lib/xlsx/parse-xlsx-bounded.ts`), which checks the ZIP's declared uncompressed size/ratio before decompressing.

### Data Model (69 Prisma Models)

**Core:** HealthSystem, Facility, Vendor, Contract, ContractTerm, ContractTier, ContractPricing

**Operations:** PurchaseOrder, Invoice, InvoiceLineItem, COGRecord, PricingFile, Alert

**Financial:** ContractPeriod, Rebate, Payment, Credit

**Clinical:** Case, CaseProcedure, CaseSupply, SurgeonUsage

**Admin:** PayorContract, ProductBenchmark, ReportSchedule, FeatureFlag, AICredit

**Auth:** User, Session, Account, Verification, Organization, Member, Invitation

### Key Patterns

- **Thin pages** (30-80 lines) — fetch data, pass to components
- **Small components** (50-150 lines) — split if bigger
- **Server actions** grouped by entity in `lib/actions/`
- **Zod validation** on all inputs, auto-generated from Prisma where possible
- **TanStack Query** for all data fetching with factory-pattern query keys — reads and invalidations both derive from the `lib/query-keys.ts` factory (never inline literals) so a query and the mutation that should refresh it can't drift apart
- **Config-driven** status badges, nav items, alert types
- **CSS vars** in oklch format — never wrap in `hsl()`
- **Canonical reducers** — every business metric (rebates earned/collected, COG in-scope spend, vendor compliance, per-supply rebate, reimbursement backfill) has ONE helper that owns the filter; all surfaces call it so numbers can't drift. The full invariants table lives in `CLAUDE.md`.
- **Stable list keys + atomic writes** — editable/reorderable lists key by a stable id (never the array index); multi-write server-action sequences run inside `prisma.$transaction`. See `CLAUDE.md` → "Client-side & data-access conventions".

### Notable surfaces

- **Contracts** — per-type terms/tiers (usage/service/capital/tie-in/grouped/pricing), AI contract extraction (PDF → terms + capital line items, with OCR for scanned docs), rebate accrual engine, tie-in capital amortization.
- **Case Costing** — surgeon scorecards, payor-mix, and a per-procedure **True-Margin** report (revenue from CPT payor-rate reimbursement, rebate allocated by matching each supply's product number to its contract's rebate terms).
- **Reports** — facility Reports Hub and a vendor-scoped **Vendor Reports Hub** at full parity (Overview / per-contract-type / By Rebate Type / Calculations), reusing the same presentational components. The vendor hub's **facility filter** scopes every trend/table to one facility the vendor serves (`scopeContractWhereToFacility`). Report cards (Rebate Statement / Performance Summary / Contract Roster) export **PDF or CSV** — PDFs render server-side through the one generator in `lib/pdf.ts` (`generateTableReportPDF`) via `/api/reports/pdf`, never a client-side jsPDF.
- **Analysis (facility CFO dashboard)** — assumption-driven current-state model: Current Vendor Spend, Net Revenue, EBITDA, and a **DCF enterprise value** (explicit-period PV **plus a Gordon-Growth terminal value** — `TV = FCF_N × (1+g) / (r − g)`). Net Revenue is an **Actuals / Manual** control (summed case-costing reimbursement, or avg-reimbursement-per-case × cases) — never the old spend ÷ 30% proxy; **Annual cases** is editable. PDF/CSV export leads with a plain-English **narrative** of the data, not just tables.
- **Prospective (vendor) — a guided proposal stepper** (`Opportunities` list · `Proposals` stepper · `Benchmarks` · `Analytics`). **Step 1 Usage & Pricing:** the deal is modeled as **constructs** — one row per product, added from the vendor's **benchmark list**; a 12-month **usage** file (volume reference) and a **current-price** file fill each construct's Volume + Current by SKU, and the vendor enters Floor / Target / Ask. The constructs blend into the tested scenario engine (`blendConstructsToScenarios`). **Step 2 Opportunity Engine:** auto-seeded from the Step-1 deal — per-facility **Current State** panel (reuses the facility DCF model), win-probability / penetration / DCF, and strategic inputs (top competitor, incumbent share, rebate cost, multi-BU breadth) **derived from the vendor's real COG/contract data**, not hardcoded. One unified **PDF/CSV export** carries the whole deal, including a per-product breakdown. The facility side keeps the unified proposal analyzer (PDF terms + price file + lookback + legal scan → one verdict) whose report leads with a plain-English **narrative**.

## Deployment (Railway)

```bash
# railway.toml is pre-configured
# 1. Create Railway project with Postgres
# 2. Set env vars (use Railway variable references for DATABASE_URL)
# 3. Deploy

# Build: bun install && bunx prisma generate && bun run build
# Pre-deploy: bunx prisma migrate deploy
# Start: bun run start
```

**Key Railway settings:**
- Use `${{Postgres.DATABASE_URL}}` for database URL
- Set `BETTER_AUTH_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`
- Migrations in `preDeployCommand` (not start script)

## Stats

| Metric | Count |
|--------|-------|
| TypeScript/TSX files | ~1,560 |
| Pages | 63 |
| Components | 506 |
| Server Action files | 149 (424 exported actions) |
| API routes | 26 |
| Hooks | 32 |
| Prisma Models | 69 |
| Prisma Enums | 41 |
| Tests | 3,264 passing |
