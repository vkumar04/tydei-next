# Phase 2 -- Contract Management (Core CRUD)

## Objective

Deliver the complete contract management experience for facility users: list, create (multi-step), view detail, edit, and delete. Contracts are the central entity of the platform. After this phase a facility user can perform full CRUD on contracts including complex term/tier structures.

## Dependencies

- Phase 1 (schema, auth, seed data, portal layouts)

## Tech Stack

| Tool | Purpose |
|------|---------|
| TanStack Table | Contract list with search, filter, sort, pagination |
| react-hook-form + Zod | Multi-step contract creation/edit form |
| TanStack Query | Server-state caching for contracts |
| Zod | Form validation |
| shadcn | Card, Dialog, Tabs, Table, Select, Calendar, Badge, Progress |

---

## Server Actions

### `lib/actions/contracts.ts`

```typescript
"use server"

// List with filters and pagination
export async function getContracts(input: {
  facilityId: string
  search?: string
  status?: ContractStatus
  type?: ContractType
  page?: number
  pageSize?: number
}): Promise<{ contracts: ContractWithVendor[]; total: number }>

// Single contract with all relations
export async function getContract(id: string): Promise<ContractDetail>

// Contract summary stats for the list page
export async function getContractStats(facilityId: string): Promise<{
  totalContracts: number
  totalValue: number
  totalRebates: number
}>

// Create with nested terms and tiers
export async function createContract(input: CreateContractInput): Promise<Contract>

// Update contract (basic info only, terms managed separately)
export async function updateContract(id: string, input: UpdateContractInput): Promise<Contract>

// Delete contract
export async function deleteContract(id: string): Promise<void>
```

### `lib/actions/contract-terms.ts`

```typescript
"use server"

// Get terms for a contract
export async function getContractTerms(contractId: string): Promise<ContractTermWithTiers[]>

// Create term with nested tiers
export async function createContractTerm(input: CreateTermInput): Promise<ContractTerm>

// Update term
export async function updateContractTerm(id: string, input: UpdateTermInput): Promise<ContractTerm>

// Delete term (cascades to tiers)
export async function deleteContractTerm(id: string): Promise<void>

// Add/update/delete tiers within a term
export async function upsertContractTiers(termId: string, tiers: TierInput[]): Promise<ContractTier[]>
```

---

## Components

### Shared Table Components (used across all phases)

#### `components/shared/tables/data-table.tsx`

- **Props:** `{ columns: ColumnDef<T>[]; data: T[]; searchKey?: string; searchPlaceholder?: string; filterComponent?: ReactNode; pagination?: boolean; pageSize?: number; onRowClick?: (row: T) => void; isLoading?: boolean }`
- **shadcn deps:** Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Input, Select, Button, Skeleton
- **States:** search, columnFilters, sorting, pagination
- **Description:** Generic TanStack Table wrapper with built-in search, filter slot, sorting, and pagination. Used by every list page. ~120 lines.

#### `components/shared/tables/table-action-menu.tsx`

- **Props:** `{ actions: { label: string; icon: LucideIcon; onClick: () => void; variant?: "default" | "destructive" }[] }`
- **shadcn deps:** DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Button
- **Description:** Row-level action dropdown (view, edit, delete). ~30 lines.

#### `components/shared/tables/table-filters.tsx`

- **Props:** `{ children: ReactNode }` (slot-based)
- **shadcn deps:** none (flex container)
- **Description:** Horizontal filter bar wrapper for search + filter selects. ~15 lines.

### Shared Form Components

#### `components/shared/forms/form-dialog.tsx`

- **Props:** `{ open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; onSubmit: () => Promise<void>; isSubmitting: boolean; submitLabel?: string }`
- **shadcn deps:** Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Button
- **Description:** Reusable dialog wrapper with form submit handling and loading state. ~40 lines.

#### `components/shared/forms/confirm-dialog.tsx`

- **Props:** `{ open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; onConfirm: () => Promise<void>; isLoading: boolean; variant?: "default" | "destructive" }`
- **shadcn deps:** Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Button
- **Description:** Simple yes/no confirmation (delete, archive). ~35 lines.

#### `components/shared/forms/field.tsx`

- **Props:** `{ label: string; error?: string; required?: boolean; children: ReactNode }`
- **shadcn deps:** Label
- **Description:** Label + input + error message wrapper for react-hook-form + Zod fields. ~20 lines.

#### `components/shared/cards/metric-card.tsx`

- **Props:** `{ title: string; value: string | number; description?: string; icon: LucideIcon; trend?: { value: number; isPositive: boolean } }`
- **shadcn deps:** Card, CardContent, CardHeader, CardTitle
- **Description:** Dashboard metric card with icon, value, optional trend indicator. ~35 lines.

### Contract-Specific Components

#### `components/contracts/contract-columns.tsx`

- **Export:** `getContractColumns(onView, onEdit, onDelete): ColumnDef<ContractWithVendor>[]`
- **shadcn deps:** Badge
- **Description:** TanStack Table column definitions for contract list. Columns: name, vendor, type, status (badge), effective date, expiration date, value (formatted currency), rebate, actions. ~80 lines.

#### `components/contracts/contract-filters.tsx`

- **Props:** `{ status: ContractStatus | "all"; onStatusChange: (status) => void; type: ContractType | "all"; onTypeChange: (type) => void }`
- **shadcn deps:** Select, SelectTrigger, SelectValue, SelectContent, SelectItem
- **Description:** Filter selects for contract status and type. ~40 lines.

#### `components/contracts/contract-form.tsx`

- **Props:** `{ defaultValues?: Partial<ContractFormValues>; vendors: VendorOption[]; categories: CategoryOption[]; onSubmit: (values: ContractFormValues) => Promise<void>; isSubmitting: boolean }`
- **shadcn deps:** Input, Select, Calendar, Popover, Switch, Textarea, Button
- **Description:** Shared contract form fields (basic info step). Used by both create and edit. ~100 lines.

#### `components/contracts/contract-terms-entry.tsx`

- **Props:** `{ terms: TermFormValues[]; onChange: (terms: TermFormValues[]) => void }`
- **shadcn deps:** Card, Input, Select, Button, Accordion, AccordionItem, AccordionTrigger, AccordionContent
- **Description:** Dynamic term builder with expandable sections. Each term has type, baseline, date range, and a nested tier table. Add/remove terms. ~120 lines.

#### `components/contracts/contract-tier-row.tsx`

- **Props:** `{ tier: TierFormValues; index: number; onChange: (tier: TierFormValues) => void; onRemove: () => void }`
- **shadcn deps:** Input, Select, Button
- **Description:** Single tier row with spend/volume/market-share ranges and rebate type/value. ~50 lines.

#### `components/contracts/contract-detail-overview.tsx`

- **Props:** `{ contract: ContractDetail }`
- **shadcn deps:** Card, Badge, Separator
- **Description:** Contract metadata overview card (name, number, vendor, type, status, dates, value, description). ~60 lines.

#### `components/contracts/contract-terms-display.tsx`

- **Props:** `{ terms: ContractTermWithTiers[] }`
- **shadcn deps:** Card, Accordion, AccordionItem, Progress, Badge
- **Description:** Read-only display of terms with tier progress bars. ~70 lines.

#### `components/contracts/contract-documents-list.tsx`

- **Props:** `{ documents: ContractDocument[]; onUpload?: () => void }`
- **shadcn deps:** Card, Badge, Button
- **Description:** List of contract documents with type badge, upload date, download link. Upload button placeholder (actual upload in Phase 5). ~40 lines.

### Shared Badges

#### `components/shared/badges/status-badge.tsx`

- **Props:** `{ status: string; config: Record<string, { label: string; variant: BadgeVariant }> }`
- **shadcn deps:** Badge
- **Description:** Config-driven status badge. Pass a status key and a config map. ~15 lines.

---

## Pages

### `app/(facility)/dashboard/contracts/page.tsx`

- **Route:** `/dashboard/contracts`
- **Layout:** Facility portal
- **Auth:** facility role
- **Data loading:** `getContracts()` + `getContractStats()` via TanStack Query
- **Content:** PageHeader + 3 MetricCards (total, value, rebates) + DataTable with ContractColumns + ContractFilters + ConfirmDialog for delete
- **Lines:** ~60 lines

### `app/(facility)/dashboard/contracts/new/page.tsx`

- **Route:** `/dashboard/contracts/new`
- **Layout:** Facility portal
- **Auth:** facility role
- **Data loading:** `getVendors()` + `getCategories()` server-side
- **Content:** PageHeader + multi-step form using Tabs (Step 1: ContractForm, Step 2: ContractTermsEntry, Step 3: facility selection, Step 4: review)
- **Lines:** ~70 lines

### `app/(facility)/dashboard/contracts/[id]/page.tsx`

- **Route:** `/dashboard/contracts/[id]`
- **Layout:** Facility portal
- **Auth:** facility role
- **Data loading:** `getContract(id)` via TanStack Query
- **Content:** PageHeader with edit/delete actions + ContractDetailOverview + ContractTermsDisplay + ContractDocumentsList
- **Lines:** ~50 lines

### `app/(facility)/dashboard/contracts/[id]/edit/page.tsx`

- **Route:** `/dashboard/contracts/[id]/edit`
- **Layout:** Facility portal
- **Auth:** facility role
- **Data loading:** `getContract(id)` + `getVendors()` + `getCategories()`
- **Content:** PageHeader + Tabs (Basic Info: ContractForm, Terms: ContractTermsEntry, Documents: ContractDocumentsList)
- **Lines:** ~65 lines

### Loading States

- `app/(facility)/dashboard/contracts/loading.tsx` -- Skeleton table
- `app/(facility)/dashboard/contracts/[id]/loading.tsx` -- Skeleton cards
- `app/(facility)/dashboard/contracts/new/loading.tsx` -- Skeleton form

---

## Query Keys

```typescript
contracts: {
  all: ["contracts"],
  list: (facilityId: string, filters?: ContractFilters) =>
    ["contracts", "list", facilityId, filters],
  detail: (id: string) => ["contracts", "detail", id],
  stats: (facilityId: string) => ["contracts", "stats", facilityId],
}
```

---

## Hooks

### `hooks/use-contract-form.ts`

- **Description:** react-hook-form + Zod setup for contract creation/edit. Handles multi-step validation, term/tier state management, and submit handler. ~60 lines.

---

## File Checklist

### Server Actions
- [ ] `lib/actions/contracts.ts` -- getContracts, getContract, getContractStats, createContract, updateContract, deleteContract
- [ ] `lib/actions/contract-terms.ts` -- getContractTerms, createContractTerm, updateContractTerm, deleteContractTerm, upsertContractTiers
- [ ] `lib/actions/vendors.ts` -- getVendors (select options), getVendor (stub for future)
- [ ] `lib/actions/categories.ts` -- getCategories (select options)

### Shared Components
- [ ] `components/shared/tables/data-table.tsx`
- [ ] `components/shared/tables/table-action-menu.tsx`
- [ ] `components/shared/tables/table-filters.tsx`
- [ ] `components/shared/forms/form-dialog.tsx`
- [ ] `components/shared/forms/confirm-dialog.tsx`
- [ ] `components/shared/forms/field.tsx`
- [ ] `components/shared/cards/metric-card.tsx`
- [ ] `components/shared/badges/status-badge.tsx`

### Contract Components
- [ ] `components/contracts/contract-columns.tsx`
- [ ] `components/contracts/contract-filters.tsx`
- [ ] `components/contracts/contract-form.tsx`
- [ ] `components/contracts/contract-terms-entry.tsx`
- [ ] `components/contracts/contract-tier-row.tsx`
- [ ] `components/contracts/contract-detail-overview.tsx`
- [ ] `components/contracts/contract-terms-display.tsx`
- [ ] `components/contracts/contract-documents-list.tsx`

### Pages
- [ ] `app/(facility)/dashboard/contracts/page.tsx`
- [ ] `app/(facility)/dashboard/contracts/new/page.tsx`
- [ ] `app/(facility)/dashboard/contracts/[id]/page.tsx`
- [ ] `app/(facility)/dashboard/contracts/[id]/edit/page.tsx`
- [ ] `app/(facility)/dashboard/contracts/loading.tsx`
- [ ] `app/(facility)/dashboard/contracts/[id]/loading.tsx`
- [ ] `app/(facility)/dashboard/contracts/new/loading.tsx`

### Hooks
- [ ] `hooks/use-contract-form.ts`

### Validators
- [ ] `lib/validators/contracts.ts` -- CreateContractInput, UpdateContractInput, ContractFilters Zod schemas
- [ ] `lib/validators/contract-terms.ts` -- CreateTermInput, UpdateTermInput, TierInput Zod schemas

---

## Acceptance Criteria

1. `/dashboard/contracts` renders a table of seeded contracts with correct columns
2. Search filters contracts by name or vendor name
3. Status filter (all/active/pending/expired/draft) correctly filters the table
4. Type filter (all/usage/capital/service/tie_in/grouped/pricing_only) correctly filters
5. Three metric cards display total contracts, total value, and total rebates
6. Clicking "New Contract" navigates to `/dashboard/contracts/new`
7. Multi-step form validates each step before allowing navigation to next
8. Step 2 (terms) allows adding multiple terms, each with multiple tiers
9. Created contract appears in the contracts list
10. Contract detail page (`/dashboard/contracts/[id]`) shows all metadata, terms with tier progress, and documents section
11. Edit page pre-populates all form fields from existing contract
12. Editing terms/tiers persists changes correctly
13. Delete shows confirmation dialog, then removes the contract
14. All pages are THIN (30-80 lines) with logic in components/hooks
15. Loading states show skeleton UI (not blank or null)
16. All forms validate with Zod and display field-level errors
