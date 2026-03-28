# Phase 5 -- Vendor Portal + File Storage + Purchase Orders + Invoices

## Objective

Complete the vendor portal (dashboard, contracts, contract submission, alerts), add S3-compatible file storage for documents, build purchase order workflows, and implement invoice validation. This phase completes the dual-portal MVP.

## Dependencies

- Phase 4 (alert system, dashboard/report patterns established, shared chart/table components)

## Tech Stack

| Tool | Purpose |
|------|---------|
| AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) | S3-compatible file storage (Railway Object Storage) |
| TanStack Table | PO table, invoice table, vendor contract table |
| react-hook-form + Zod | PO creation, invoice upload, vendor contract submission |
| Recharts | Vendor dashboard charts |

---

## Server Actions

### `lib/actions/vendor-contracts.ts`

```typescript
"use server"

// Vendor's contracts (filtered to their vendor)
export async function getVendorContracts(input: {
  vendorId: string
  status?: ContractStatus | "all"
  search?: string
  page?: number
  pageSize?: number
}): Promise<{ contracts: ContractWithFacility[]; total: number }>

// Vendor contract detail with spend tracking
export async function getVendorContractDetail(id: string, vendorId: string): Promise<VendorContractDetail>
```

### `lib/actions/pending-contracts.ts`

```typescript
"use server"

// List pending contracts (vendor side)
export async function getVendorPendingContracts(vendorId: string): Promise<PendingContract[]>

// Create pending contract (vendor submission)
export async function createPendingContract(input: CreatePendingContractInput): Promise<PendingContract>

// Update pending contract (vendor edits before approval)
export async function updatePendingContract(id: string, input: UpdatePendingContractInput): Promise<PendingContract>

// Withdraw pending contract
export async function withdrawPendingContract(id: string): Promise<void>

// List pending contracts (facility side -- for approval)
export async function getFacilityPendingContracts(facilityId: string): Promise<PendingContract[]>

// Approve pending contract (creates real Contract from PendingContract)
export async function approvePendingContract(id: string, reviewedBy: string): Promise<Contract>

// Reject pending contract
export async function rejectPendingContract(id: string, reviewedBy: string, notes: string): Promise<void>

// Request revision on pending contract
export async function requestRevision(id: string, reviewedBy: string, notes: string): Promise<void>
```

### `lib/actions/vendor-dashboard.ts`

```typescript
"use server"

// Vendor dashboard stats
export async function getVendorDashboardStats(vendorId: string): Promise<{
  totalContracts: number
  totalSpend: number
  totalRebates: number
  activeFacilities: number
}>

// Vendor spend trend (bar + line)
export async function getVendorSpendTrend(input: {
  vendorId: string
  dateFrom: string
  dateTo: string
}): Promise<{ month: string; spend: number; rebate: number }[]>
```

### `lib/actions/purchase-orders.ts`

```typescript
"use server"

// List POs
export async function getPurchaseOrders(input: {
  facilityId: string
  vendorId?: string
  status?: POStatus
  page?: number
  pageSize?: number
}): Promise<{ orders: PurchaseOrderWithRelations[]; total: number }>

// Get single PO
export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail>

// Create PO with line items
export async function createPurchaseOrder(input: CreatePOInput): Promise<PurchaseOrder>

// Update PO status
export async function updatePOStatus(id: string, status: POStatus): Promise<void>

// Search products for line item builder (from COG data and pricing files)
export async function searchProducts(input: {
  facilityId: string
  query: string
  vendorId?: string
}): Promise<ProductSearchResult[]>
```

### `lib/actions/invoices.ts`

```typescript
"use server"

// List invoices
export async function getInvoices(input: {
  facilityId?: string
  vendorId?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ invoices: InvoiceWithRelations[]; total: number }>

// Get invoice detail
export async function getInvoice(id: string): Promise<InvoiceDetail>

// Bulk import invoice line items
export async function importInvoice(input: ImportInvoiceInput): Promise<Invoice>

// Validate invoice against contract pricing
export async function validateInvoice(id: string): Promise<InvoiceValidationResult>

// Flag discrepant line item
export async function flagInvoiceLineItem(lineItemId: string, notes?: string): Promise<void>

// Resolve flagged line item
export async function resolveInvoiceLineItem(lineItemId: string): Promise<void>
```

### `lib/actions/uploads.ts`

```typescript
"use server"

// Generate presigned upload URL
export async function getUploadUrl(input: {
  fileName: string
  contentType: string
  folder: "contracts" | "pricing" | "cog" | "invoices"
}): Promise<{ uploadUrl: string; key: string; publicUrl: string }>

// Generate presigned download URL
export async function getDownloadUrl(key: string): Promise<string>

// Delete file from S3
export async function deleteFile(key: string): Promise<void>
```

---

## Components

### Vendor Dashboard Components

#### `components/vendor/dashboard/vendor-stats.tsx`

- **Props:** `{ stats: VendorDashboardStats }`
- **shadcn deps:** uses MetricCard
- **Description:** 4 metric cards for vendor dashboard. ~25 lines.

#### `components/vendor/dashboard/vendor-spend-chart.tsx`

- **Props:** `{ data: VendorSpendTrend[] }`
- **shadcn deps:** uses ChartCard
- **Description:** Combined bar (spend) + line (rebate) chart. Recharts ComposedChart. ~40 lines.

### Vendor Contract Components

#### `components/vendor/contracts/vendor-contract-list.tsx`

- **Props:** `{ vendorId: string }`
- **shadcn deps:** uses DataTable, Tabs
- **States:** activeTab (active/pending/expired)
- **Description:** Vendor contracts table with tab filtering. ~50 lines.

#### `components/vendor/contracts/vendor-contract-columns.tsx`

- **Export:** `getVendorContractColumns(onView): ColumnDef<ContractWithFacility>[]`
- **Description:** Columns: name, facility, type, status, dates, value, tier progress. ~55 lines.

#### `components/vendor/contracts/vendor-contract-submission.tsx`

- **Props:** `{ vendorId: string; facilities: FacilityOption[] }`
- **shadcn deps:** Input, Select, Calendar, Popover, Tabs, Button
- **Description:** Vendor contract submission form with facility selection, contract type, dates, terms (reuses ContractTermsEntry), pricing file upload, document upload. ~100 lines.

#### `components/vendor/contracts/pending-contract-card.tsx`

- **Props:** `{ contract: PendingContract; onView: () => void; onEdit: () => void; onWithdraw: () => void }`
- **shadcn deps:** Card, Badge, Button
- **Description:** Card showing pending submission status, submitted date, notes. ~35 lines.

### Approval Workflow (Facility Side)

#### `components/facility/contracts/pending-review-dialog.tsx`

- **Props:** `{ contract: PendingContract; open: boolean; onOpenChange: (open: boolean) => void; onApprove: () => void; onReject: (notes: string) => void; onRequestRevision: (notes: string) => void }`
- **shadcn deps:** Dialog, Tabs, Textarea, Button, Badge
- **Description:** Review dialog for pending vendor submissions. Shows contract details, terms, allows approve/reject/revision. ~80 lines.

### File Upload Components

#### `components/shared/file-upload.tsx`

- **Props:** `{ onUpload: (file: File) => Promise<string>; accept?: string; label?: string; existingUrl?: string }`
- **shadcn deps:** Button, Progress
- **Description:** File upload component using presigned URLs. Shows progress bar during upload. ~50 lines.

#### `components/contracts/document-upload.tsx`

- **Props:** `{ contractId: string; onUploaded: (doc: ContractDocument) => void }`
- **shadcn deps:** Dialog, Select, Button
- **Description:** Contract document upload dialog. Select document type, upload file. ~45 lines.

### Purchase Order Components

#### `components/facility/purchase-orders/po-list.tsx`

- **Props:** `{ facilityId: string }`
- **shadcn deps:** uses DataTable, Select, Button
- **Description:** PO table with status filter and create button. ~50 lines.

#### `components/facility/purchase-orders/po-columns.tsx`

- **Export:** `getPOColumns(onView, onUpdateStatus): ColumnDef<PurchaseOrderWithRelations>[]`
- **Description:** Columns: PO number, vendor, order date, total cost, status (badge), line item count, actions. ~50 lines.

#### `components/facility/purchase-orders/po-create-form.tsx`

- **Props:** `{ facilityId: string; onComplete: () => void }`
- **shadcn deps:** Card, Input, Select, Button, Command
- **Description:** PO creation with vendor select, product search (Command for autocomplete), line item builder with quantity and price lookup. Auto-calculates totals. ~110 lines.

#### `components/facility/purchase-orders/po-line-item-builder.tsx`

- **Props:** `{ lineItems: POLineItemInput[]; onChange: (items: POLineItemInput[]) => void; onSearch: (query: string) => void; searchResults: ProductSearchResult[] }`
- **shadcn deps:** Table, Input, Button, Command
- **Description:** Dynamic line item rows with product search, quantity, auto-price. ~70 lines.

#### `components/facility/purchase-orders/po-detail.tsx`

- **Props:** `{ order: PurchaseOrderDetail }`
- **shadcn deps:** Card, Badge, Table, Button
- **Description:** PO detail view with header, status workflow buttons, line items table. ~60 lines.

### Invoice Components

#### `components/facility/invoices/invoice-validation-table.tsx`

- **Props:** `{ facilityId: string }`
- **shadcn deps:** uses DataTable, Tabs, Badge
- **States:** activeTab (pending/resolved/flagged)
- **Description:** Invoice validation table with tab filtering. ~55 lines.

#### `components/facility/invoices/invoice-columns.tsx`

- **Export:** `getInvoiceColumns(onView, onValidate): ColumnDef<InvoiceWithRelations>[]`
- **Description:** Columns: invoice number, vendor, date, total, status, discrepancy count, actions. ~50 lines.

#### `components/facility/invoices/invoice-import-dialog.tsx`

- **Props:** `{ facilityId: string; open: boolean; onOpenChange: (open: boolean) => void; onComplete: () => void }`
- **shadcn deps:** Dialog, Select, Button, Progress
- **Description:** Import invoice from CSV/XLSX. Select vendor, upload file, auto-match to contracts. ~70 lines.

#### `components/facility/invoices/invoice-validation-detail.tsx`

- **Props:** `{ invoice: InvoiceDetail; validation: InvoiceValidationResult }`
- **shadcn deps:** Table, Badge, Dialog, Button
- **Description:** Line-by-line validation showing invoice price vs contract price, variance %, flag/approve actions. ~80 lines.

#### `components/facility/invoices/dispute-dialog.tsx`

- **Props:** `{ lineItem: InvoiceLineItem; open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (notes: string) => void }`
- **shadcn deps:** Dialog, Textarea, Button
- **Description:** Simple dispute dialog for flagged invoice items. ~30 lines.

### Vendor Invoice Components

#### `components/vendor/invoices/vendor-invoice-list.tsx`

- **Props:** `{ vendorId: string }`
- **shadcn deps:** uses DataTable, Button
- **Description:** Vendor's invoice table with upload and status tracking. ~45 lines.

---

## Pages

### Vendor Pages

#### `app/(vendor)/dashboard/page.tsx`

- **Route:** `/vendor/dashboard`
- **Auth:** vendor role
- **Data loading:** TanStack Query `getVendorDashboardStats()`, `getVendorSpendTrend()`
- **Content:** PageHeader + VendorStats + VendorSpendChart
- **Lines:** ~40 lines

#### `app/(vendor)/contracts/page.tsx`

- **Route:** `/vendor/contracts`
- **Auth:** vendor role
- **Data loading:** TanStack Query `getVendorContracts()`, `getVendorPendingContracts()`
- **Content:** PageHeader + VendorContractList
- **Lines:** ~35 lines

#### `app/(vendor)/contracts/new/page.tsx`

- **Route:** `/vendor/contracts/new`
- **Auth:** vendor role
- **Data loading:** Facilities list
- **Content:** PageHeader + VendorContractSubmission
- **Lines:** ~35 lines

#### `app/(vendor)/contracts/[id]/page.tsx`

- **Route:** `/vendor/contracts/[id]`
- **Auth:** vendor role
- **Data loading:** TanStack Query `getVendorContractDetail()`
- **Content:** PageHeader + ContractDetailOverview (reuse) + ContractTermsDisplay (reuse)
- **Lines:** ~40 lines

#### `app/(vendor)/alerts/page.tsx`

- **Route:** `/vendor/alerts`
- **Auth:** vendor role
- **Data loading:** TanStack Query `getAlerts({ portalType: "vendor" })`
- **Content:** PageHeader + Tabs + AlertsList (reuse shared alerts components)
- **Lines:** ~50 lines

#### `app/(vendor)/invoices/page.tsx`

- **Route:** `/vendor/invoices`
- **Auth:** vendor role
- **Data loading:** TanStack Query `getInvoices({ vendorId })`
- **Content:** PageHeader + VendorInvoiceList
- **Lines:** ~30 lines

### Facility Pages

#### `app/(facility)/dashboard/purchase-orders/page.tsx`

- **Route:** `/dashboard/purchase-orders`
- **Auth:** facility role
- **Data loading:** TanStack Query `getPurchaseOrders()`
- **Content:** PageHeader + POList
- **Lines:** ~30 lines

#### `app/(facility)/dashboard/purchase-orders/new/page.tsx`

- **Route:** `/dashboard/purchase-orders/new`
- **Auth:** facility role
- **Data loading:** Vendors list
- **Content:** PageHeader + POCreateForm
- **Lines:** ~30 lines

#### `app/(facility)/dashboard/purchase-orders/[id]/page.tsx`

- **Route:** `/dashboard/purchase-orders/[id]`
- **Auth:** facility role
- **Data loading:** TanStack Query `getPurchaseOrder()`
- **Content:** PageHeader + PODetail
- **Lines:** ~30 lines

#### `app/(facility)/dashboard/invoice-validation/page.tsx`

- **Route:** `/dashboard/invoice-validation`
- **Auth:** facility role
- **Data loading:** TanStack Query `getInvoices()`
- **Content:** PageHeader + InvoiceValidationTable + InvoiceImportDialog
- **Lines:** ~40 lines

#### `app/(facility)/dashboard/invoice-validation/[id]/page.tsx`

- **Route:** `/dashboard/invoice-validation/[id]`
- **Auth:** facility role
- **Data loading:** TanStack Query `getInvoice()` + `validateInvoice()`
- **Content:** PageHeader + InvoiceValidationDetail
- **Lines:** ~35 lines

### Loading States

All pages above get corresponding `loading.tsx` files with skeleton UI.

---

## S3 Configuration (`lib/s3.ts`)

```typescript
// ~30 lines
// S3Client initialization with env vars (S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)
// generatePresignedUploadUrl(key, contentType): string
// generatePresignedDownloadUrl(key): string
// deleteObject(key): void
```

---

## Query Keys

```typescript
vendorContracts: {
  all: ["vendorContracts"],
  list: (vendorId: string, filters?) => ["vendorContracts", "list", vendorId, filters],
  detail: (id: string) => ["vendorContracts", "detail", id],
},
pendingContracts: {
  vendor: (vendorId: string) => ["pendingContracts", "vendor", vendorId],
  facility: (facilityId: string) => ["pendingContracts", "facility", facilityId],
},
vendorDashboard: {
  stats: (vendorId: string) => ["vendorDashboard", "stats", vendorId],
  spendTrend: (vendorId: string, dateRange) => ["vendorDashboard", "spendTrend", vendorId, dateRange],
},
purchaseOrders: {
  all: ["purchaseOrders"],
  list: (facilityId: string, filters?) => ["purchaseOrders", "list", facilityId, filters],
  detail: (id: string) => ["purchaseOrders", "detail", id],
  productSearch: (facilityId: string, query: string) => ["purchaseOrders", "productSearch", facilityId, query],
},
invoices: {
  all: ["invoices"],
  list: (entityId: string, filters?) => ["invoices", "list", entityId, filters],
  detail: (id: string) => ["invoices", "detail", id],
  validation: (id: string) => ["invoices", "validation", id],
},
```

---

## File Checklist

### Server Actions
- [ ] `lib/actions/vendor-contracts.ts`
- [ ] `lib/actions/pending-contracts.ts`
- [ ] `lib/actions/vendor-dashboard.ts`
- [ ] `lib/actions/purchase-orders.ts`
- [ ] `lib/actions/invoices.ts`
- [ ] `lib/actions/uploads.ts`

### S3
- [ ] `lib/s3.ts`

### Vendor Components
- [ ] `components/vendor/dashboard/vendor-stats.tsx`
- [ ] `components/vendor/dashboard/vendor-spend-chart.tsx`
- [ ] `components/vendor/contracts/vendor-contract-list.tsx`
- [ ] `components/vendor/contracts/vendor-contract-columns.tsx`
- [ ] `components/vendor/contracts/vendor-contract-submission.tsx`
- [ ] `components/vendor/contracts/pending-contract-card.tsx`
- [ ] `components/vendor/invoices/vendor-invoice-list.tsx`

### Approval Workflow
- [ ] `components/facility/contracts/pending-review-dialog.tsx`

### File Upload
- [ ] `components/shared/file-upload.tsx`
- [ ] `components/contracts/document-upload.tsx`

### Purchase Order Components
- [ ] `components/facility/purchase-orders/po-list.tsx`
- [ ] `components/facility/purchase-orders/po-columns.tsx`
- [ ] `components/facility/purchase-orders/po-create-form.tsx`
- [ ] `components/facility/purchase-orders/po-line-item-builder.tsx`
- [ ] `components/facility/purchase-orders/po-detail.tsx`

### Invoice Components
- [ ] `components/facility/invoices/invoice-validation-table.tsx`
- [ ] `components/facility/invoices/invoice-columns.tsx`
- [ ] `components/facility/invoices/invoice-import-dialog.tsx`
- [ ] `components/facility/invoices/invoice-validation-detail.tsx`
- [ ] `components/facility/invoices/dispute-dialog.tsx`

### Vendor Pages
- [ ] `app/(vendor)/dashboard/page.tsx`
- [ ] `app/(vendor)/contracts/page.tsx`
- [ ] `app/(vendor)/contracts/new/page.tsx`
- [ ] `app/(vendor)/contracts/[id]/page.tsx`
- [ ] `app/(vendor)/alerts/page.tsx`
- [ ] `app/(vendor)/invoices/page.tsx`
- [ ] All vendor loading.tsx files

### Facility Pages
- [ ] `app/(facility)/dashboard/purchase-orders/page.tsx`
- [ ] `app/(facility)/dashboard/purchase-orders/new/page.tsx`
- [ ] `app/(facility)/dashboard/purchase-orders/[id]/page.tsx`
- [ ] `app/(facility)/dashboard/invoice-validation/page.tsx`
- [ ] `app/(facility)/dashboard/invoice-validation/[id]/page.tsx`
- [ ] All facility loading.tsx files

### Validators
- [ ] `lib/validators/pending-contracts.ts`
- [ ] `lib/validators/purchase-orders.ts`
- [ ] `lib/validators/invoices.ts`
- [ ] `lib/validators/uploads.ts`

---

## Acceptance Criteria

1. Vendor dashboard shows 4 metric cards and spend trend chart
2. Vendor contracts page shows tabs for active/pending/expired with correct filtering
3. Vendor can submit a new contract with terms, tiers, and document upload
4. Submitted contract appears in vendor's "Pending" tab with correct status
5. Facility user sees pending submissions and can approve/reject/request revision
6. Approved submission creates a real Contract visible in both portals
7. Rejected submission shows rejection notes to vendor
8. File upload works via presigned URLs (contract documents, pricing files)
9. Uploaded documents appear in contract detail page with download links
10. Vendor alerts page reuses shared alert components filtered to vendor
11. PO creation form allows product search, line item building, and auto-pricing
12. PO status workflow (draft -> pending -> approved -> sent -> completed/cancelled) works
13. Invoice import parses CSV/XLSX and creates invoice with line items
14. Invoice validation compares line items to contract pricing and flags discrepancies
15. Flagged items show variance percentage and allow dispute
16. Vendor invoice page shows their submitted invoices with status
17. All pages are THIN (30-80 lines)
18. All loading states render skeleton UI
