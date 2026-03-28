# Phase 4 -- Alerts + Dashboard Analytics + Reports

## Objective

Build the alert system (generation logic, alert pages for facility portal), populate the facility dashboard with real analytics (metric cards, charts), and deliver the reports page with period data tables and export capabilities. After this phase the platform transitions from data entry to data intelligence.

## Dependencies

- Phase 3 (COG data for spend calculations, off-contract detection, vendor/category data for charts)

## Tech Stack

| Tool | Purpose |
|------|---------|
| Recharts | Dashboard charts (BarChart, LineChart, PieChart, RadarChart) |
| TanStack Table | Report period data tables |
| TanStack Query | Analytics data caching |
| shadcn | Tabs, Card, Badge, Progress, Accordion, Calendar, Popover |

---

## Server Actions

### `lib/actions/alerts.ts`

```typescript
"use server"

// List alerts with filters
export async function getAlerts(input: {
  facilityId?: string
  vendorId?: string
  portalType: "facility" | "vendor"
  alertType?: AlertType
  status?: AlertStatus
  page?: number
  pageSize?: number
}): Promise<{ alerts: AlertWithRelations[]; total: number }>

// Single alert detail
export async function getAlert(id: string): Promise<AlertWithRelations>

// Get unread alert count (for sidebar badge)
export async function getUnreadAlertCount(input: {
  facilityId?: string
  vendorId?: string
  portalType: "facility" | "vendor"
}): Promise<number>

// Mark alert as read
export async function markAlertRead(id: string): Promise<void>

// Resolve alert
export async function resolveAlert(id: string): Promise<void>

// Dismiss alert
export async function dismissAlert(id: string): Promise<void>

// Bulk resolve
export async function bulkResolveAlerts(ids: string[]): Promise<{ resolved: number }>

// Bulk dismiss
export async function bulkDismissAlerts(ids: string[]): Promise<{ dismissed: number }>

// Generate alerts (called after COG import, contract create/update)
export async function generateAlerts(facilityId: string): Promise<{ created: number }>
```

### `lib/actions/dashboard.ts`

```typescript
"use server"

// Dashboard metric cards
export async function getDashboardStats(input: {
  facilityId: string
  dateFrom: string
  dateTo: string
}): Promise<{
  totalContractValue: number
  totalRebatesEarned: number
  activeAlertCount: number
  complianceRate: number
}>

// Earned rebate by month (stacked bar)
export async function getEarnedRebateByMonth(input: {
  facilityId: string
  dateFrom: string
  dateTo: string
}): Promise<{ month: string; [vendorName: string]: number | string }[]>

// Total spend by vendor (horizontal bar)
export async function getSpendByVendor(input: {
  facilityId: string
  dateFrom: string
  dateTo: string
}): Promise<{ vendor: string; total: number; categories: Record<string, number> }[]>

// Contract lifecycle (donut)
export async function getContractLifecycle(facilityId: string): Promise<{
  active: number
  expired: number
  expiring: number
}>

// Spend needed for next tier (grouped bar)
export async function getSpendNeededForTier(facilityId: string): Promise<{
  vendor: string
  contractName: string
  currentSpend: number
  tiers: { tier: number; threshold: number }[]
}[]>

// Recent contracts
export async function getRecentContracts(facilityId: string, limit?: number): Promise<ContractWithVendor[]>

// Recent alerts
export async function getRecentAlerts(facilityId: string, limit?: number): Promise<Alert[]>
```

### `lib/actions/reports.ts`

```typescript
"use server"

// Get report data by type
export async function getReportData(input: {
  facilityId: string
  reportType: "usage" | "service" | "tie_in" | "capital" | "grouped"
  dateFrom: string
  dateTo: string
}): Promise<ReportData>

// Get period data (spend/volume/rebate per period)
export async function getContractPeriodData(input: {
  contractId: string
  dateFrom?: string
  dateTo?: string
}): Promise<ContractPeriod[]>

// Export report to CSV
export async function exportReportCSV(input: {
  facilityId: string
  reportType: string
  dateFrom: string
  dateTo: string
}): Promise<string> // returns CSV string

// Price discrepancy report
export async function getPriceDiscrepancies(facilityId: string): Promise<PriceDiscrepancy[]>
```

---

## Components

### Alert Components

#### `components/shared/alerts/alert-card.tsx`

- **Props:** `{ alert: AlertWithRelations; onResolve: () => void; onDismiss: () => void; onNavigate: () => void }`
- **shadcn deps:** Card, Badge, Button, Checkbox
- **Description:** Single alert card with type icon, severity badge, title, description, timestamp, action buttons. ~45 lines.

#### `components/shared/alerts/alerts-list.tsx`

- **Props:** `{ alerts: AlertWithRelations[]; onResolve: (id: string) => void; onDismiss: (id: string) => void; selectedIds: Set<string>; onSelect: (id: string, checked: boolean) => void; isLoading: boolean }`
- **shadcn deps:** ScrollArea, Checkbox, Button
- **Description:** Scrollable list of AlertCard components with bulk select header. ~50 lines.

#### `components/shared/alerts/alert-config.ts`

- **Export:** `alertTypeConfig: Record<AlertType, { icon: LucideIcon; color: string; label: string }>` and `alertSeverityConfig`
- **Description:** Type-to-icon and type-to-color configuration maps. ~40 lines.

#### `components/shared/alerts/alert-detail-card.tsx`

- **Props:** `{ alert: AlertWithRelations }`
- **shadcn deps:** Card, Badge, Table, Button
- **Description:** Full alert detail with metadata table (related contract, vendor, PO, amounts). ~50 lines.

### Dashboard Components

#### `components/facility/dashboard/dashboard-stats.tsx`

- **Props:** `{ stats: DashboardStats }`
- **shadcn deps:** uses MetricCard (4 instances)
- **Description:** Row of 4 metric cards. ~25 lines.

#### `components/facility/dashboard/dashboard-filters.tsx`

- **Props:** `{ dateRange: DateRange; onDateRangeChange: (range: DateRange) => void }`
- **shadcn deps:** Button, Calendar, Popover
- **Description:** Date range picker for dashboard filtering. ~35 lines.

#### `components/shared/forms/date-range-picker.tsx`

- **Props:** `{ dateRange: DateRange; onDateRangeChange: (range: DateRange) => void; presets?: { label: string; range: DateRange }[] }`
- **shadcn deps:** Calendar, Popover, PopoverTrigger, PopoverContent, Button
- **Description:** Reusable date range picker with preset options (This Quarter, Last Quarter, This Year, etc.). ~50 lines.

#### `components/shared/charts/chart-card.tsx`

- **Props:** `{ title: string; description?: string; children: ReactNode; className?: string }`
- **shadcn deps:** Card, CardHeader, CardTitle, CardDescription, CardContent
- **Description:** Card wrapper for any Recharts chart. ~20 lines.

#### `components/facility/dashboard/earned-rebate-chart.tsx`

- **Props:** `{ data: EarnedRebateMonthly[] }`
- **shadcn deps:** uses ChartCard
- **Description:** Stacked bar chart of earned rebate by month by vendor. Recharts BarChart. ~40 lines.

#### `components/facility/dashboard/spend-by-vendor-chart.tsx`

- **Props:** `{ data: SpendByVendor[] }`
- **shadcn deps:** uses ChartCard
- **Description:** Horizontal bar chart of total spend by vendor. Recharts BarChart (layout="vertical"). ~35 lines.

#### `components/facility/dashboard/contract-lifecycle-chart.tsx`

- **Props:** `{ data: ContractLifecycle }`
- **shadcn deps:** uses ChartCard
- **Description:** Donut chart of active/expired/expiring contracts. Recharts PieChart. ~35 lines.

#### `components/facility/dashboard/spend-tier-chart.tsx`

- **Props:** `{ data: SpendNeededForTier[] }`
- **shadcn deps:** uses ChartCard
- **Description:** Grouped bar chart showing current spend vs tier thresholds per contract. ~40 lines.

#### `components/facility/dashboard/recent-contracts.tsx`

- **Props:** `{ contracts: ContractWithVendor[] }`
- **shadcn deps:** Card, Table, Badge
- **Description:** Simple table of 5 most recent contracts with status badge. ~35 lines.

#### `components/facility/dashboard/recent-alerts.tsx`

- **Props:** `{ alerts: Alert[] }`
- **shadcn deps:** Card, Badge
- **Description:** List of 5 most recent alerts with type icon and title. ~30 lines.

### Report Components

#### `components/facility/reports/report-period-table.tsx`

- **Props:** `{ periods: ContractPeriod[]; reportType: string }`
- **shadcn deps:** uses DataTable
- **Description:** Period data table (spend, volume, rebate earned/collected, payment expected/actual). ~50 lines.

#### `components/facility/reports/report-columns.tsx`

- **Export:** `getReportColumns(reportType): ColumnDef<ContractPeriod>[]`
- **Description:** Column definitions per report type. ~60 lines.

#### `components/facility/reports/report-trend-chart.tsx`

- **Props:** `{ data: ContractPeriod[]; metric: "spend" | "rebate" | "volume" }`
- **shadcn deps:** uses ChartCard
- **Description:** Line chart showing trend of selected metric over periods. ~35 lines.

#### `components/facility/reports/report-export-button.tsx`

- **Props:** `{ facilityId: string; reportType: string; dateFrom: string; dateTo: string }`
- **shadcn deps:** Button, DropdownMenu
- **Description:** Export button with CSV/PDF options. ~30 lines.

#### `components/facility/reports/price-discrepancy-table.tsx`

- **Props:** `{ discrepancies: PriceDiscrepancy[] }`
- **shadcn deps:** uses DataTable, Badge, Dialog
- **Description:** Table of price discrepancies with variance %, flag capability, dispute dialog. ~60 lines.

---

## Pages

### `app/(facility)/dashboard/page.tsx` (replace Phase 1 placeholder)

- **Route:** `/dashboard`
- **Auth:** facility role
- **Data loading:** TanStack Query for all dashboard endpoints
- **Content:** PageHeader + DashboardFilters + DashboardStats + grid of 4 charts + RecentContracts + RecentAlerts
- **Lines:** ~70 lines

### `app/(facility)/dashboard/alerts/page.tsx`

- **Route:** `/dashboard/alerts`
- **Auth:** facility role
- **Data loading:** TanStack Query `getAlerts()`
- **Content:** PageHeader + Tabs (All, Off-Contract, Expiring, Tier Threshold, Rebate Due) + AlertsList + bulk action bar
- **Lines:** ~60 lines

### `app/(facility)/dashboard/alerts/[id]/page.tsx`

- **Route:** `/dashboard/alerts/[id]`
- **Auth:** facility role
- **Data loading:** TanStack Query `getAlert(id)`
- **Content:** PageHeader + AlertDetailCard + action buttons (resolve, dismiss, navigate to related entity)
- **Lines:** ~35 lines

### `app/(facility)/dashboard/reports/page.tsx`

- **Route:** `/dashboard/reports`
- **Auth:** facility role
- **Data loading:** TanStack Query `getReportData()`
- **Content:** PageHeader + Tabs (Usage, Service, Tie-In, Capital, Grouped) + ReportPeriodTable + ReportTrendChart + ReportExportButton
- **Lines:** ~55 lines

### `app/(facility)/dashboard/reports/price-discrepancy/page.tsx`

- **Route:** `/dashboard/reports/price-discrepancy`
- **Auth:** facility role
- **Data loading:** TanStack Query `getPriceDiscrepancies()`
- **Content:** PageHeader + PriceDiscrepancyTable
- **Lines:** ~30 lines

### Loading States

- [ ] `app/(facility)/dashboard/loading.tsx`
- [ ] `app/(facility)/dashboard/alerts/loading.tsx`
- [ ] `app/(facility)/dashboard/alerts/[id]/loading.tsx`
- [ ] `app/(facility)/dashboard/reports/loading.tsx`

---

## Alert Generation Logic

Located in `lib/alerts/generate-alerts.ts` (pure functions, called by server action):

```typescript
// generateExpiringContractAlerts(facilityId): creates alerts for contracts
//   expiring within 30, 60, 90 days. Checks existing alerts to avoid duplicates.
//
// generateTierThresholdAlerts(facilityId): compares COG spend against tier
//   thresholds. If within 10% of next tier, creates alert.
//
// generateOffContractAlerts(facilityId): scans recent COG records for items
//   not matching any contract pricing. Groups by vendor for single alert.
//
// generateRebateDueAlerts(facilityId): checks rebate pay period deadlines.
```

---

## Query Keys

```typescript
alerts: {
  all: ["alerts"],
  list: (portalType: string, entityId: string, filters?: AlertFilters) =>
    ["alerts", "list", portalType, entityId, filters],
  detail: (id: string) => ["alerts", "detail", id],
  unreadCount: (portalType: string, entityId: string) =>
    ["alerts", "unreadCount", portalType, entityId],
},
dashboard: {
  stats: (facilityId: string, dateRange: DateRange) =>
    ["dashboard", "stats", facilityId, dateRange],
  earnedRebate: (facilityId: string, dateRange: DateRange) =>
    ["dashboard", "earnedRebate", facilityId, dateRange],
  spendByVendor: (facilityId: string, dateRange: DateRange) =>
    ["dashboard", "spendByVendor", facilityId, dateRange],
  contractLifecycle: (facilityId: string) =>
    ["dashboard", "contractLifecycle", facilityId],
  spendNeededForTier: (facilityId: string) =>
    ["dashboard", "spendNeededForTier", facilityId],
  recentContracts: (facilityId: string) =>
    ["dashboard", "recentContracts", facilityId],
  recentAlerts: (facilityId: string) =>
    ["dashboard", "recentAlerts", facilityId],
},
reports: {
  data: (facilityId: string, reportType: string, dateRange: DateRange) =>
    ["reports", "data", facilityId, reportType, dateRange],
  periodData: (contractId: string, dateRange?: DateRange) =>
    ["reports", "periodData", contractId, dateRange],
  priceDiscrepancies: (facilityId: string) =>
    ["reports", "priceDiscrepancies", facilityId],
},
```

---

## File Checklist

### Server Actions
- [ ] `lib/actions/alerts.ts`
- [ ] `lib/actions/dashboard.ts`
- [ ] `lib/actions/reports.ts`

### Alert Generation
- [ ] `lib/alerts/generate-alerts.ts`

### Alert Components
- [ ] `components/shared/alerts/alert-card.tsx`
- [ ] `components/shared/alerts/alerts-list.tsx`
- [ ] `components/shared/alerts/alert-config.ts`
- [ ] `components/shared/alerts/alert-detail-card.tsx`

### Dashboard Components
- [ ] `components/facility/dashboard/dashboard-stats.tsx`
- [ ] `components/facility/dashboard/dashboard-filters.tsx`
- [ ] `components/facility/dashboard/earned-rebate-chart.tsx`
- [ ] `components/facility/dashboard/spend-by-vendor-chart.tsx`
- [ ] `components/facility/dashboard/contract-lifecycle-chart.tsx`
- [ ] `components/facility/dashboard/spend-tier-chart.tsx`
- [ ] `components/facility/dashboard/recent-contracts.tsx`
- [ ] `components/facility/dashboard/recent-alerts.tsx`

### Shared Chart/Form Components
- [ ] `components/shared/charts/chart-card.tsx`
- [ ] `components/shared/forms/date-range-picker.tsx`

### Report Components
- [ ] `components/facility/reports/report-period-table.tsx`
- [ ] `components/facility/reports/report-columns.tsx`
- [ ] `components/facility/reports/report-trend-chart.tsx`
- [ ] `components/facility/reports/report-export-button.tsx`
- [ ] `components/facility/reports/price-discrepancy-table.tsx`

### Pages
- [ ] `app/(facility)/dashboard/page.tsx` (replace placeholder)
- [ ] `app/(facility)/dashboard/alerts/page.tsx`
- [ ] `app/(facility)/dashboard/alerts/[id]/page.tsx`
- [ ] `app/(facility)/dashboard/reports/page.tsx`
- [ ] `app/(facility)/dashboard/reports/price-discrepancy/page.tsx`
- [ ] `app/(facility)/dashboard/loading.tsx`
- [ ] `app/(facility)/dashboard/alerts/loading.tsx`
- [ ] `app/(facility)/dashboard/alerts/[id]/loading.tsx`
- [ ] `app/(facility)/dashboard/reports/loading.tsx`

---

## Acceptance Criteria

1. Facility dashboard shows 4 metric cards with real data from seed
2. Date range picker defaults to current quarter and updates all charts on change
3. Earned rebate by month chart renders stacked bars by vendor
4. Spend by vendor chart renders horizontal bars
5. Contract lifecycle donut shows active/expired/expiring counts
6. Spend needed for next tier chart shows current spend vs thresholds
7. Recent contracts and recent alerts sections show 5 most recent items
8. Alerts page has 5 tabs filtering by alert type
9. Alert cards show type icon, severity badge, title, and description
10. Bulk select + resolve/dismiss works for multiple alerts
11. Alert detail page shows full metadata and related entity links
12. Unread alert count badge appears in sidebar nav
13. Reports page shows tabs for each report type with period data tables
14. Report trend chart updates when switching report types
15. CSV export downloads a valid CSV file
16. Price discrepancy report shows variances with flagging capability
17. Alert generation creates alerts for expiring contracts, tier thresholds, off-contract purchases
18. All pages are THIN (30-80 lines)
