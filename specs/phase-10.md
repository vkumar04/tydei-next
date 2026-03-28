# Phase 10 -- Admin Portal + Billing + Advanced Features

## Objective

Build the platform operator admin portal with facility/vendor/user management, Stripe billing integration, payor contract management, and remaining advanced features: contract change proposals, vendor market share analytics, vendor performance tracking, vendor benchmarking, report scheduling, and forecasting.

## Dependencies

- Phase 5 (vendor portal complete)
- Phase 9 (AI features for credit billing tiers)

## Tech Stack

| Tool | Purpose |
|------|---------|
| Stripe (`stripe`) | Subscription billing, invoice management |
| Recharts | Admin MRR charts, vendor performance radar, market share charts |
| TanStack Table | Admin CRUD tables, payor contract rates |
| react-hook-form + Zod | Admin entity forms, payor rate entry |
| Resend | Email delivery for report scheduling |

---

## Server Actions

### `lib/actions/admin/facilities.ts`

```typescript
"use server"

// List all facilities (admin)
export async function adminGetFacilities(input: {
  search?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ facilities: AdminFacilityRow[]; total: number }>
// AdminFacilityRow includes: facility fields + userCount, contractCount, healthSystemName

// Create facility (admin)
export async function adminCreateFacility(input: AdminCreateFacilityInput): Promise<Facility>

// Update facility (admin)
export async function adminUpdateFacility(id: string, input: AdminUpdateFacilityInput): Promise<Facility>

// Delete facility (admin)
export async function adminDeleteFacility(id: string): Promise<void>
```

### `lib/actions/admin/vendors.ts`

```typescript
"use server"

export async function adminGetVendors(input: {
  search?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ vendors: AdminVendorRow[]; total: number }>

export async function adminCreateVendor(input: AdminCreateVendorInput): Promise<Vendor>
export async function adminUpdateVendor(id: string, input: AdminUpdateVendorInput): Promise<Vendor>
export async function adminDeleteVendor(id: string): Promise<void>
```

### `lib/actions/admin/users.ts`

```typescript
"use server"

export async function adminGetUsers(input: {
  search?: string
  role?: UserRole
  page?: number
  pageSize?: number
}): Promise<{ users: AdminUserRow[]; total: number }>

export async function adminCreateUser(input: AdminCreateUserInput): Promise<User>
export async function adminUpdateUser(id: string, input: AdminUpdateUserInput): Promise<User>
export async function adminDeleteUser(id: string): Promise<void>
export async function adminBulkDeleteUsers(ids: string[]): Promise<{ deleted: number }>
```

### `lib/actions/admin/dashboard.ts`

```typescript
"use server"

export async function getAdminDashboardStats(): Promise<{
  totalFacilities: number
  totalVendors: number
  totalUsers: number
  totalContracts: number
  mrr: number
  activeSubscriptions: number
}>

export async function getAdminRecentActivity(limit?: number): Promise<ActivityEntry[]>

export async function getAdminPendingActions(): Promise<{
  newFacilitySetups: number
  trialExpirations: number
  failedPayments: number
}>
```

### `lib/actions/admin/billing.ts`

```typescript
"use server"

// Stripe subscription management
export async function getSubscriptions(input: {
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ subscriptions: SubscriptionRow[]; total: number }>

// Get Stripe invoices
export async function getStripeInvoices(input: {
  status?: "paid" | "pending" | "overdue"
  page?: number
  pageSize?: number
}): Promise<{ invoices: StripeInvoiceRow[]; total: number }>

// Get MRR data
export async function getMRRData(months: number): Promise<{ month: string; mrr: number }[]>

// Manage AI credit tiers per facility/vendor
export async function updateAICreditTier(input: {
  entityId: string
  entityType: "facility" | "vendor"
  tierId: CreditTierId
}): Promise<void>

// Create Stripe checkout session
export async function createCheckoutSession(input: {
  priceId: string
  organizationId: string
}): Promise<{ url: string }>

// Cancel subscription
export async function cancelSubscription(subscriptionId: string): Promise<void>
```

### `app/api/webhooks/stripe/route.ts`

```typescript
// Stripe webhook handler
// Events: checkout.session.completed, invoice.paid, invoice.payment_failed,
//         customer.subscription.updated, customer.subscription.deleted
```

### `lib/actions/admin/payor-contracts.ts`

```typescript
"use server"

// List payor contracts
export async function getPayorContracts(input: {
  facilityId?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ contracts: PayorContract[]; total: number }>

// Create payor contract
export async function createPayorContract(input: CreatePayorContractInput): Promise<PayorContract>

// Update payor contract
export async function updatePayorContract(id: string, input: UpdatePayorContractInput): Promise<PayorContract>

// Delete payor contract
export async function deletePayorContract(id: string): Promise<void>

// Import CPT rates from CSV
export async function importCPTRates(contractId: string, rates: PayorContractRate[]): Promise<{ imported: number }>

// Assign payor contract to facilities
export async function assignPayorContractToFacility(contractId: string, facilityId: string): Promise<void>
```

### `lib/actions/change-proposals.ts`

```typescript
"use server"

// Create change proposal (vendor -> facility)
export async function createChangeProposal(input: CreateChangeProposalInput): Promise<ContractChangeProposal>

// Get proposals for a contract
export async function getChangeProposals(contractId: string): Promise<ContractChangeProposal[]>

// Get pending proposals for facility
export async function getPendingProposals(facilityId: string): Promise<ContractChangeProposal[]>

// Approve/reject/request revision
export async function reviewChangeProposal(id: string, input: {
  action: "approve" | "reject" | "revision_requested"
  reviewedBy: string
  notes?: string
}): Promise<void>
```

### `lib/actions/vendor-analytics.ts`

```typescript
"use server"

// Market share by facility
export async function getVendorMarketShare(input: {
  vendorId: string
  facilityId?: string
  dateFrom?: string
  dateTo?: string
}): Promise<MarketShareData>

// Performance KPIs
export async function getVendorPerformance(vendorId: string): Promise<VendorPerformanceData>

// Benchmark comparison
export async function getProductBenchmarks(input: {
  vendorId: string
  category?: string
}): Promise<ProductBenchmark[]>
```

### `lib/actions/report-scheduling.ts`

```typescript
"use server"

// List report schedules
export async function getReportSchedules(facilityId: string): Promise<ReportSchedule[]>

// Create report schedule
export async function createReportSchedule(input: CreateReportScheduleInput): Promise<ReportSchedule>

// Update report schedule
export async function updateReportSchedule(id: string, input: UpdateReportScheduleInput): Promise<ReportSchedule>

// Delete report schedule
export async function deleteReportSchedule(id: string): Promise<void>

// Toggle active/inactive
export async function toggleReportSchedule(id: string): Promise<void>
```

### `lib/actions/forecasting.ts`

```typescript
"use server"

// Spend forecast (linear regression)
export async function getSpendForecast(input: {
  facilityId: string
  contractId?: string
  periods: number
}): Promise<ForecastResult>

// Rebate forecast
export async function getRebateForecast(input: {
  facilityId: string
  contractId?: string
  periods: number
}): Promise<ForecastResult>
```

---

## Components

### Admin Components

#### `components/admin/admin-stats.tsx`

- **Props:** `{ stats: AdminDashboardStats }`
- **shadcn deps:** uses MetricCard (6 instances)
- **Description:** Row of metric cards for admin dashboard. ~30 lines.

#### `components/admin/activity-feed.tsx`

- **Props:** `{ activities: ActivityEntry[] }`
- **shadcn deps:** Card, Badge, ScrollArea
- **Description:** Recent activity feed with type icon, description, timestamp. ~35 lines.

#### `components/admin/pending-actions.tsx`

- **Props:** `{ actions: PendingActions }`
- **shadcn deps:** Card, Badge, Button
- **Description:** Pending action cards (new setups, trial expirations, failed payments). ~30 lines.

#### `components/admin/facility-table.tsx`

- **Props:** none (uses TanStack Query internally)
- **shadcn deps:** uses DataTable, FormDialog
- **Description:** Facility CRUD table with search, status filter, create/edit/delete. ~55 lines.

#### `components/admin/facility-columns.tsx`

- **Export:** `getFacilityColumns(onEdit, onDelete): ColumnDef<AdminFacilityRow>[]`
- **Description:** Columns: name, type, health system, location, user count, contract count, status, actions. ~55 lines.

#### `components/admin/facility-form-dialog.tsx`

- **Props:** `{ facility?: Facility; healthSystems: HealthSystem[]; open: boolean; onOpenChange: (open: boolean) => void; onComplete: () => void }`
- **shadcn deps:** uses FormDialog, Field, Input, Select
- **Description:** Create/edit facility dialog. ~55 lines.

#### `components/admin/vendor-table.tsx`

- **Props:** none
- **shadcn deps:** uses DataTable, FormDialog
- **Description:** Vendor CRUD table. Same pattern as facility table. ~50 lines.

#### `components/admin/vendor-columns.tsx`

- **Export:** `getAdminVendorColumns(onEdit, onDelete): ColumnDef<AdminVendorRow>[]`
- **Description:** Columns: name, code, category, status, rep count, contract count, actions. ~50 lines.

#### `components/admin/user-table.tsx`

- **Props:** none
- **shadcn deps:** uses DataTable, Tabs, Checkbox, FormDialog
- **Description:** User CRUD table with role tabs, bulk operations. ~60 lines.

#### `components/admin/user-columns.tsx`

- **Export:** `getUserColumns(onEdit, onDelete): ColumnDef<AdminUserRow>[]`
- **Description:** Columns: avatar, name, email, role (badge), org, created, status, actions. ~50 lines.

#### `components/admin/billing-overview.tsx`

- **Props:** `{ mrr: number; subscriptions: number }`
- **shadcn deps:** Card, uses MetricCard
- **Description:** Billing overview cards. ~20 lines.

#### `components/admin/mrr-chart.tsx`

- **Props:** `{ data: MRRData[] }`
- **shadcn deps:** uses ChartCard
- **Description:** Recharts AreaChart showing MRR over time. ~30 lines.

#### `components/admin/invoice-table.tsx`

- **Props:** `{ invoices: StripeInvoiceRow[] }`
- **shadcn deps:** uses DataTable, Badge
- **Description:** Stripe invoice table with status badges (paid/pending/overdue). ~40 lines.

#### `components/admin/payor-contract-table.tsx`

- **Props:** none
- **shadcn deps:** uses DataTable, Tabs, Dialog
- **Description:** Payor contract CRUD with CPT rate management. ~55 lines.

#### `components/admin/payor-rate-editor.tsx`

- **Props:** `{ rates: PayorContractRate[]; onChange: (rates: PayorContractRate[]) => void }`
- **shadcn deps:** Table, Input, Button
- **Description:** Editable CPT rate table with add/remove/edit rows. ~60 lines.

#### `components/admin/payor-grouper-editor.tsx`

- **Props:** `{ groupers: PayorContractGrouper[]; onChange: (groupers: PayorContractGrouper[]) => void }`
- **shadcn deps:** Table, Input, Button, Collapsible
- **Description:** Grouper rate editor with CPT code assignment. ~55 lines.

### Contract Change Proposal Components

#### `components/vendor/contracts/change-proposal-form.tsx`

- **Props:** `{ contract: Contract; onSubmit: (proposal: CreateChangeProposalInput) => Promise<void> }`
- **shadcn deps:** Card, Input, Select, Textarea, Button, Dialog
- **Description:** Before/after comparison form for term changes. ~65 lines.

#### `components/facility/contracts/proposal-review-list.tsx`

- **Props:** `{ proposals: ContractChangeProposal[] }`
- **shadcn deps:** Card, Badge, Button, Dialog
- **Description:** List of pending proposals with before/after diffs and approve/reject/revision buttons. ~55 lines.

### Vendor Analytics Components

#### `components/vendor/market-share/market-share-charts.tsx`

- **Props:** `{ data: MarketShareData }`
- **shadcn deps:** uses ChartCard
- **Description:** Recharts PieChart for market share by category, BarChart by facility, LineChart for trend. ~60 lines.

#### `components/vendor/performance/performance-dashboard.tsx`

- **Props:** `{ data: VendorPerformanceData }`
- **shadcn deps:** Card, uses ChartCard, Progress
- **Description:** KPI cards + radar chart for multi-dimension vendor performance. ~55 lines.

#### `components/vendor/performance/performance-radar.tsx`

- **Props:** `{ scores: PerformanceScores }`
- **shadcn deps:** uses ChartCard
- **Description:** Recharts RadarChart with compliance, delivery, quality, pricing dimensions. ~35 lines.

### Report Scheduling Components

#### `components/facility/reports/schedule-table.tsx`

- **Props:** `{ schedules: ReportSchedule[] }`
- **shadcn deps:** uses DataTable, Switch, Badge, Button
- **Description:** Report schedule list with active toggle, frequency badge, email recipients. ~45 lines.

#### `components/facility/reports/schedule-form-dialog.tsx`

- **Props:** `{ schedule?: ReportSchedule; open: boolean; onOpenChange: (open: boolean) => void; onComplete: () => void }`
- **shadcn deps:** Dialog, Select, Input, Switch, Button
- **Description:** Create/edit schedule dialog with report type, frequency, day selector, email recipients. ~50 lines.

### Forecasting Components

#### `components/facility/dashboard/forecast-chart.tsx`

- **Props:** `{ actual: DataPoint[]; forecast: DataPoint[]; metric: "spend" | "rebate" }`
- **shadcn deps:** uses ChartCard
- **Description:** Recharts ComposedChart with solid line for actuals, dashed line for forecast, confidence band. ~45 lines.

---

## Pages

### Admin Pages

#### `app/(admin)/dashboard/page.tsx`

- **Route:** `/admin/dashboard`
- **Auth:** admin role
- **Data loading:** TanStack Query for admin stats, recent activity, pending actions
- **Content:** PageHeader + AdminStats + grid(ActivityFeed, PendingActions)
- **Lines:** ~45 lines

#### `app/(admin)/facilities/page.tsx`

- **Route:** `/admin/facilities`
- **Auth:** admin role
- **Data loading:** TanStack Query `adminGetFacilities()`
- **Content:** PageHeader + FacilityTable
- **Lines:** ~25 lines

#### `app/(admin)/vendors/page.tsx`

- **Route:** `/admin/vendors`
- **Auth:** admin role
- **Data loading:** TanStack Query `adminGetVendors()`
- **Content:** PageHeader + VendorTable
- **Lines:** ~25 lines

#### `app/(admin)/users/page.tsx`

- **Route:** `/admin/users`
- **Auth:** admin role
- **Data loading:** TanStack Query `adminGetUsers()`
- **Content:** PageHeader + UserTable
- **Lines:** ~25 lines

#### `app/(admin)/billing/page.tsx`

- **Route:** `/admin/billing`
- **Auth:** admin role
- **Data loading:** TanStack Query for subscriptions, invoices, MRR
- **Content:** PageHeader + BillingOverview + MRRChart + InvoiceTable
- **Lines:** ~45 lines

#### `app/(admin)/payor-contracts/page.tsx`

- **Route:** `/admin/payor-contracts`
- **Auth:** admin role
- **Data loading:** TanStack Query `getPayorContracts()`
- **Content:** PageHeader + PayorContractTable
- **Lines:** ~25 lines

### Vendor Analytics Pages

#### `app/(vendor)/market-share/page.tsx`

- **Route:** `/vendor/market-share`
- **Auth:** vendor role
- **Data loading:** TanStack Query `getVendorMarketShare()`
- **Content:** PageHeader + MarketShareCharts
- **Lines:** ~35 lines

#### `app/(vendor)/performance/page.tsx`

- **Route:** `/vendor/performance`
- **Auth:** vendor role
- **Data loading:** TanStack Query `getVendorPerformance()`
- **Content:** PageHeader + PerformanceDashboard
- **Lines:** ~30 lines

#### `app/(vendor)/purchase-orders/page.tsx`

- **Route:** `/vendor/purchase-orders`
- **Auth:** vendor role
- **Data loading:** TanStack Query `getPurchaseOrders({ vendorId })`
- **Content:** PageHeader + DataTable (reuse PO columns with vendor view adjustments)
- **Lines:** ~35 lines

#### `app/(vendor)/reports/page.tsx`

- **Route:** `/vendor/reports`
- **Auth:** vendor role
- **Data loading:** TanStack Query for vendor report data
- **Content:** PageHeader + Tabs + report tables (reuse shared report components)
- **Lines:** ~45 lines

### Loading States

All pages above get corresponding `loading.tsx` files.

---

## Stripe Configuration (`lib/stripe.ts`)

```typescript
// ~20 lines
import Stripe from "stripe"
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
```

---

## Email Configuration (`lib/email.ts`)

```typescript
// ~30 lines
import { Resend } from "resend"
export const resend = new Resend(process.env.RESEND_API_KEY)
export async function sendReportEmail(to: string[], subject: string, html: string): Promise<void>
```

---

## Query Keys

```typescript
admin: {
  stats: () => ["admin", "stats"],
  activity: () => ["admin", "activity"],
  pendingActions: () => ["admin", "pendingActions"],
  facilities: (filters?) => ["admin", "facilities", filters],
  vendors: (filters?) => ["admin", "vendors", filters],
  users: (filters?) => ["admin", "users", filters],
  subscriptions: (filters?) => ["admin", "subscriptions", filters],
  invoices: (filters?) => ["admin", "invoices", filters],
  mrr: (months: number) => ["admin", "mrr", months],
  payorContracts: (filters?) => ["admin", "payorContracts", filters],
},
vendorAnalytics: {
  marketShare: (vendorId: string, filters?) => ["vendorAnalytics", "marketShare", vendorId, filters],
  performance: (vendorId: string) => ["vendorAnalytics", "performance", vendorId],
  benchmarks: (vendorId: string, category?) => ["vendorAnalytics", "benchmarks", vendorId, category],
},
changeProposals: {
  byContract: (contractId: string) => ["changeProposals", "byContract", contractId],
  pendingForFacility: (facilityId: string) => ["changeProposals", "pending", facilityId],
},
reportSchedules: {
  list: (facilityId: string) => ["reportSchedules", facilityId],
},
forecasting: {
  spend: (facilityId: string, input) => ["forecasting", "spend", facilityId, input],
  rebate: (facilityId: string, input) => ["forecasting", "rebate", facilityId, input],
},
```

---

## File Checklist

### Server Actions
- [ ] `lib/actions/admin/facilities.ts`
- [ ] `lib/actions/admin/vendors.ts`
- [ ] `lib/actions/admin/users.ts`
- [ ] `lib/actions/admin/dashboard.ts`
- [ ] `lib/actions/admin/billing.ts`
- [ ] `lib/actions/admin/payor-contracts.ts`
- [ ] `lib/actions/change-proposals.ts`
- [ ] `lib/actions/vendor-analytics.ts`
- [ ] `lib/actions/report-scheduling.ts`
- [ ] `lib/actions/forecasting.ts`

### API Routes
- [ ] `app/api/webhooks/stripe/route.ts`

### Integrations
- [ ] `lib/stripe.ts`
- [ ] `lib/email.ts`

### Admin Components
- [ ] `components/admin/admin-stats.tsx`
- [ ] `components/admin/activity-feed.tsx`
- [ ] `components/admin/pending-actions.tsx`
- [ ] `components/admin/facility-table.tsx`
- [ ] `components/admin/facility-columns.tsx`
- [ ] `components/admin/facility-form-dialog.tsx`
- [ ] `components/admin/vendor-table.tsx`
- [ ] `components/admin/vendor-columns.tsx`
- [ ] `components/admin/user-table.tsx`
- [ ] `components/admin/user-columns.tsx`
- [ ] `components/admin/billing-overview.tsx`
- [ ] `components/admin/mrr-chart.tsx`
- [ ] `components/admin/invoice-table.tsx`
- [ ] `components/admin/payor-contract-table.tsx`
- [ ] `components/admin/payor-rate-editor.tsx`
- [ ] `components/admin/payor-grouper-editor.tsx`

### Change Proposal Components
- [ ] `components/vendor/contracts/change-proposal-form.tsx`
- [ ] `components/facility/contracts/proposal-review-list.tsx`

### Vendor Analytics Components
- [ ] `components/vendor/market-share/market-share-charts.tsx`
- [ ] `components/vendor/performance/performance-dashboard.tsx`
- [ ] `components/vendor/performance/performance-radar.tsx`

### Report Scheduling Components
- [ ] `components/facility/reports/schedule-table.tsx`
- [ ] `components/facility/reports/schedule-form-dialog.tsx`

### Forecasting Components
- [ ] `components/facility/dashboard/forecast-chart.tsx`

### Admin Pages
- [ ] `app/(admin)/dashboard/page.tsx`
- [ ] `app/(admin)/facilities/page.tsx`
- [ ] `app/(admin)/vendors/page.tsx`
- [ ] `app/(admin)/users/page.tsx`
- [ ] `app/(admin)/billing/page.tsx`
- [ ] `app/(admin)/payor-contracts/page.tsx`

### Vendor Pages
- [ ] `app/(vendor)/market-share/page.tsx`
- [ ] `app/(vendor)/performance/page.tsx`
- [ ] `app/(vendor)/purchase-orders/page.tsx`
- [ ] `app/(vendor)/reports/page.tsx`

### Loading States
- [ ] All pages get loading.tsx files

### Validators
- [ ] `lib/validators/admin.ts` -- AdminCreateFacilityInput, AdminCreateVendorInput, AdminCreateUserInput
- [ ] `lib/validators/payor-contracts.ts` -- CreatePayorContractInput, PayorContractRate, PayorContractGrouper
- [ ] `lib/validators/change-proposals.ts` -- CreateChangeProposalInput
- [ ] `lib/validators/report-scheduling.ts` -- CreateReportScheduleInput
- [ ] `lib/validators/billing.ts` -- CheckoutSessionInput

---

## Acceptance Criteria

1. Admin dashboard shows platform-wide stats (facilities, vendors, users, contracts, MRR)
2. Admin activity feed shows recent actions
3. Admin pending actions card shows counts for new setups, trial expirations, failed payments
4. Admin facilities page has full CRUD with health system assignment
5. Admin vendors page has full CRUD with status management
6. Admin users page has full CRUD with role filtering, bulk operations
7. Admin billing page shows Stripe invoice history with status badges
8. MRR chart tracks monthly recurring revenue over time
9. Stripe webhook handler processes checkout.session.completed and subscription events
10. Payor contract management supports CPT rate schedules and grouper rates
11. Payor rate editor allows adding/editing/removing CPT rates inline
12. Payor contracts can be assigned to specific facilities
13. Contract change proposal form shows before/after term comparison
14. Facility can approve/reject/request revision on proposals
15. Vendor market share page shows pie, bar, and trend charts by category/facility
16. Vendor performance page shows KPIs with radar chart
17. Report scheduling allows daily/weekly/monthly delivery to email recipients
18. Schedule toggle activates/deactivates without delete
19. Forecast chart shows actual data with dashed projected line
20. All pages are THIN (25-45 lines)
