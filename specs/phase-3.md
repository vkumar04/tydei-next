# Phase 3 -- COG Data + Pricing Files + Vendor Management

## Objective

Build the COG data import pipeline (CSV/Excel upload, column mapping, duplicate detection, vendor name matching), pricing file management, and vendor CRUD for the facility portal. These data flows feed contract spend tracking and invoice validation in later phases.

## Dependencies

- Phase 2 (contracts exist for pricing file linking, shared table/form components built)

## Tech Stack

| Tool | Purpose |
|------|---------|
| xlsx | Server-side Excel/CSV parsing |
| TanStack Table | COG records table, pricing files table |
| TanStack Query | COG data caching with optimistic updates |
| Zod | Import validation, vendor form validation |

---

## Server Actions

### `lib/actions/cog-records.ts`

```typescript
"use server"

// List COG records with filters
export async function getCOGRecords(input: {
  facilityId: string
  search?: string
  vendorId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}): Promise<{ records: COGRecordWithVendor[]; total: number }>

// Create single manual record
export async function createCOGRecord(input: CreateCOGRecordInput): Promise<COGRecord>

// Bulk import parsed records
export async function bulkImportCOGRecords(input: {
  facilityId: string
  records: COGRecordInput[]
  duplicateStrategy: "skip" | "overwrite" | "keep_both"
}): Promise<{ imported: number; skipped: number; errors: number }>

// Delete single record
export async function deleteCOGRecord(id: string): Promise<void>

// Bulk delete
export async function bulkDeleteCOGRecords(ids: string[]): Promise<{ deleted: number }>

// Get import history
export async function getCOGImportHistory(facilityId: string): Promise<ImportHistoryEntry[]>
```

### `lib/actions/pricing-files.ts`

```typescript
"use server"

// List pricing file entries
export async function getPricingFiles(input: {
  facilityId: string
  vendorId?: string
  page?: number
  pageSize?: number
}): Promise<{ files: PricingFileWithVendor[]; total: number }>

// Bulk import pricing file entries
export async function bulkImportPricingFiles(input: {
  vendorId: string
  facilityId: string
  records: PricingFileInput[]
}): Promise<{ imported: number; errors: number }>

// Delete pricing file entries by vendor
export async function deletePricingFilesByVendor(vendorId: string, facilityId: string): Promise<void>
```

### `lib/actions/vendors.ts` (extend from Phase 2 stub)

```typescript
"use server"

// Full vendor list with search
export async function getVendors(input: {
  search?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ vendors: Vendor[]; total: number }>

// Single vendor detail
export async function getVendor(id: string): Promise<VendorWithDivisions>

// Create vendor
export async function createVendor(input: CreateVendorInput): Promise<Vendor>

// Update vendor
export async function updateVendor(id: string, input: UpdateVendorInput): Promise<Vendor>

// Deactivate vendor (soft delete)
export async function deactivateVendor(id: string): Promise<void>
```

### `lib/actions/vendor-mappings.ts`

```typescript
"use server"

// Get unconfirmed vendor name mappings
export async function getVendorNameMappings(input: {
  isConfirmed?: boolean
  page?: number
  pageSize?: number
}): Promise<{ mappings: VendorNameMapping[]; total: number }>

// Confirm a vendor name mapping
export async function confirmVendorNameMapping(id: string, mappedVendorId: string): Promise<void>

// Create vendor name mapping (from COG import)
export async function createVendorNameMapping(input: {
  cogVendorName: string
  mappedVendorId?: string
  mappedVendorName?: string
  confidenceScore?: number
}): Promise<VendorNameMapping>

// Delete mapping
export async function deleteVendorNameMapping(id: string): Promise<void>
```

### `lib/actions/categories.ts` (extend)

```typescript
"use server"

// Full category tree
export async function getCategoryTree(): Promise<CategoryNode[]>

// Create category
export async function createCategory(input: CreateCategoryInput): Promise<ProductCategory>

// Update category
export async function updateCategory(id: string, input: UpdateCategoryInput): Promise<ProductCategory>

// Delete category
export async function deleteCategory(id: string): Promise<void>

// Category mappings
export async function getCategoryMappings(): Promise<CategoryMapping[]>
export async function confirmCategoryMapping(id: string, contractCategory: string): Promise<void>
```

---

## Components

### COG Data Components

#### `components/facility/cog/cog-records-table.tsx`

- **Props:** `{ facilityId: string }`
- **shadcn deps:** uses DataTable, Select, Button, Calendar, Popover
- **States:** search, vendorFilter, dateRange
- **Description:** COG records table with vendor/date filters. Wraps shared DataTable. ~60 lines.

#### `components/facility/cog/cog-columns.tsx`

- **Export:** `getCOGColumns(onDelete): ColumnDef<COGRecordWithVendor>[]`
- **Description:** Column defs: inventory number, description, vendor, item no, unit cost, extended price, quantity, transaction date, category, actions. ~60 lines.

#### `components/facility/cog/cog-import-dialog.tsx`

- **Props:** `{ facilityId: string; open: boolean; onOpenChange: (open: boolean) => void; onComplete: () => void }`
- **shadcn deps:** Dialog, Button, Progress, Select, Badge
- **States:** step (upload -> map -> review -> import), file, parsedData, columnMapping, duplicateStrategy, importResult
- **Description:** Multi-step import wizard: (1) file drop zone, (2) column mapping UI, (3) duplicate resolution, (4) import progress + summary. ~130 lines (largest component -- consider splitting steps into sub-components if needed).

#### `components/facility/cog/cog-column-mapper.tsx`

- **Props:** `{ sourceColumns: string[]; targetFields: TargetField[]; mapping: Record<string, string>; onChange: (mapping: Record<string, string>) => void }`
- **shadcn deps:** Select, Label, Card
- **Description:** Map uploaded CSV columns to COG record fields. Shows source -> target dropdowns. ~50 lines.

#### `components/facility/cog/cog-import-preview.tsx`

- **Props:** `{ records: COGRecordInput[]; duplicates: number; errors: string[] }`
- **shadcn deps:** Table, Badge, Alert
- **Description:** Preview table of parsed records before import, showing duplicate count and validation errors. ~40 lines.

#### `components/facility/cog/cog-manual-entry.tsx`

- **Props:** `{ facilityId: string; open: boolean; onOpenChange: (open: boolean) => void; onComplete: () => void }`
- **shadcn deps:** uses FormDialog, Field, Input, Select, Calendar
- **Description:** Manual COG record entry dialog. ~50 lines.

#### `components/facility/cog/file-dropzone.tsx`

- **Props:** `{ accept: string[]; onFile: (file: File) => void; label?: string }`
- **shadcn deps:** Card
- **Description:** Drag-and-drop file upload zone accepting CSV/XLSX. ~40 lines.

### Pricing File Components

#### `components/facility/cog/pricing-files-table.tsx`

- **Props:** `{ facilityId: string }`
- **shadcn deps:** uses DataTable, Select, Button
- **Description:** Pricing file entries table with vendor filter. ~50 lines.

#### `components/facility/cog/pricing-columns.tsx`

- **Export:** `getPricingColumns(): ColumnDef<PricingFileWithVendor>[]`
- **Description:** Column defs: vendor item no, description, list price, contract price, effective date, expiration date, vendor, category. ~50 lines.

#### `components/facility/cog/pricing-import-dialog.tsx`

- **Props:** `{ facilityId: string; open: boolean; onOpenChange: (open: boolean) => void; onComplete: () => void }`
- **shadcn deps:** Dialog, Select (vendor selector), Button, Progress
- **Description:** Upload pricing file (select vendor first, then upload CSV/XLSX). ~70 lines.

### Vendor Management Components

#### `components/facility/vendors/vendor-list.tsx`

- **Props:** `{ facilityId: string }`
- **shadcn deps:** uses DataTable, Button
- **Description:** Vendor table with create, edit, deactivate actions. ~50 lines.

#### `components/facility/vendors/vendor-columns.tsx`

- **Export:** `getVendorColumns(onEdit, onDeactivate): ColumnDef<Vendor>[]`
- **Description:** Columns: name, code, contact email, contact phone, status, tier, actions. ~50 lines.

#### `components/facility/vendors/vendor-form-dialog.tsx`

- **Props:** `{ vendor?: Vendor; open: boolean; onOpenChange: (open: boolean) => void; onComplete: () => void }`
- **shadcn deps:** uses FormDialog, Field, Input, Select
- **Description:** Create/edit vendor dialog with name, code, display name, division, contact info, tier. ~60 lines.

#### `components/facility/vendors/vendor-mapping-table.tsx`

- **Props:** `{ mappings: VendorNameMapping[] }`
- **shadcn deps:** Table, Select, Button, Badge
- **Description:** Table of unconfirmed vendor name mappings with vendor selector to confirm. ~50 lines.

### Category Components

#### `components/facility/categories/category-tree.tsx`

- **Props:** `{ categories: CategoryNode[] }`
- **shadcn deps:** Collapsible, Button
- **Description:** Hierarchical category tree with expand/collapse, edit, delete. ~60 lines.

#### `components/facility/categories/category-form-dialog.tsx`

- **Props:** `{ category?: ProductCategory; parentId?: string; open: boolean; onOpenChange: (open: boolean) => void; onComplete: () => void }`
- **shadcn deps:** uses FormDialog, Field, Input, Select, Textarea
- **Description:** Create/edit category dialog. ~40 lines.

---

## Pages

### `app/(facility)/dashboard/cog-data/page.tsx`

- **Route:** `/dashboard/cog-data`
- **Layout:** Facility portal
- **Auth:** facility role
- **Data loading:** TanStack Query for COG records, pricing files
- **Content:** PageHeader + Tabs (COG Records, Pricing Files, Upload History). Each tab renders its respective table component + import button.
- **Lines:** ~50 lines

### `app/(facility)/dashboard/cog-data/loading.tsx`

- **Content:** Skeleton tabs + skeleton table
- **Lines:** ~15 lines

### `app/(facility)/dashboard/settings/page.tsx` (stub -- settings expanded in Phase 6)

- **Route:** `/dashboard/settings`
- **Content:** PageHeader + Tabs stub with Vendors tab rendered: VendorList + VendorMappingTable
- **Lines:** ~40 lines

---

## Hooks

### `hooks/use-file-parser.ts`

- **Description:** Parses CSV/XLSX files client-side using xlsx library. Returns headers and rows. ~40 lines.

### `hooks/use-cog-import.ts`

- **Description:** Manages the multi-step import state machine (upload -> parse -> map -> preview -> import). ~60 lines.

---

## Query Keys

```typescript
cogRecords: {
  all: ["cogRecords"],
  list: (facilityId: string, filters?: COGFilters) =>
    ["cogRecords", "list", facilityId, filters],
  importHistory: (facilityId: string) =>
    ["cogRecords", "importHistory", facilityId],
},
pricingFiles: {
  all: ["pricingFiles"],
  list: (facilityId: string, vendorId?: string) =>
    ["pricingFiles", "list", facilityId, vendorId],
},
vendors: {
  all: ["vendors"],
  list: (filters?: VendorFilters) => ["vendors", "list", filters],
  detail: (id: string) => ["vendors", "detail", id],
  mappings: () => ["vendors", "mappings"],
},
categories: {
  all: ["categories"],
  tree: () => ["categories", "tree"],
  mappings: () => ["categories", "mappings"],
},
```

---

## File Checklist

### Server Actions
- [ ] `lib/actions/cog-records.ts`
- [ ] `lib/actions/pricing-files.ts`
- [ ] `lib/actions/vendors.ts` (extend)
- [ ] `lib/actions/vendor-mappings.ts`
- [ ] `lib/actions/categories.ts` (extend)

### COG Components
- [ ] `components/facility/cog/cog-records-table.tsx`
- [ ] `components/facility/cog/cog-columns.tsx`
- [ ] `components/facility/cog/cog-import-dialog.tsx`
- [ ] `components/facility/cog/cog-column-mapper.tsx`
- [ ] `components/facility/cog/cog-import-preview.tsx`
- [ ] `components/facility/cog/cog-manual-entry.tsx`
- [ ] `components/facility/cog/file-dropzone.tsx`
- [ ] `components/facility/cog/pricing-files-table.tsx`
- [ ] `components/facility/cog/pricing-columns.tsx`
- [ ] `components/facility/cog/pricing-import-dialog.tsx`

### Vendor Components
- [ ] `components/facility/vendors/vendor-list.tsx`
- [ ] `components/facility/vendors/vendor-columns.tsx`
- [ ] `components/facility/vendors/vendor-form-dialog.tsx`
- [ ] `components/facility/vendors/vendor-mapping-table.tsx`

### Category Components
- [ ] `components/facility/categories/category-tree.tsx`
- [ ] `components/facility/categories/category-form-dialog.tsx`

### Pages
- [ ] `app/(facility)/dashboard/cog-data/page.tsx`
- [ ] `app/(facility)/dashboard/cog-data/loading.tsx`
- [ ] `app/(facility)/dashboard/settings/page.tsx` (stub with vendors tab)

### Hooks
- [ ] `hooks/use-file-parser.ts`
- [ ] `hooks/use-cog-import.ts`

### Validators
- [ ] `lib/validators/cog-records.ts` -- CreateCOGRecordInput, COGRecordInput, COGFilters
- [ ] `lib/validators/pricing-files.ts` -- PricingFileInput
- [ ] `lib/validators/vendors.ts` -- CreateVendorInput, UpdateVendorInput, VendorFilters

---

## Acceptance Criteria

1. `/dashboard/cog-data` shows three tabs: COG Records, Pricing Files, Upload History
2. COG Records tab shows a searchable, filterable table of seeded COG data
3. "Import" button opens the multi-step import dialog
4. Uploading a CSV file parses it and shows column mapping UI
5. Column mapper allows mapping source columns to target COG fields
6. Duplicate detection shows how many records already exist
7. User can choose duplicate strategy (skip, overwrite, keep both)
8. After import, summary shows records imported, skipped, and errors
9. Manual entry dialog creates a single COG record
10. Bulk delete removes selected records
11. Pricing Files tab shows pricing entries with vendor filter
12. Pricing file import requires vendor selection first, then file upload
13. Vendors tab in Settings shows vendor list with create/edit/deactivate
14. Vendor name mapping table shows unconfirmed mappings with ability to confirm
15. Category tree displays hierarchical categories with CRUD
16. All pages are THIN (30-80 lines)
17. Loading states render skeleton UI
