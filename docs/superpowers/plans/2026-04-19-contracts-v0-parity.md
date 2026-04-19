# Contracts Page v0-Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each task ships independently — dispatch in its own worktree, review, then cherry-pick to main.

**Goal:** Close the 8 highest-impact gaps between the v0 prototype contracts surface (`/Users/vickkumar/Downloads/b_T2SEkJJdo8w/`) and the tydei-next contracts surface so the user-visible behavior matches.

**Architecture:** Mostly UI work. Schema is already there for every gap. Where a feature uses many-to-many (multi-facility, multi-vendor for grouped contracts), wire the existing `ContractFacility` join table or extend the create action to write multiple `vendorId`s. Performance charts reuse existing `ContractPeriod` / `Rebate` rollups via new server-action selectors.

**Tech Stack:** Next.js 16, Prisma 7, TypeScript strict, Vitest, TanStack Query, shadcn/ui, recharts.

**Working DB:** `postgresql://tydei:tydei_dev_password@localhost:5432/tydei`. Demo facility = "Lighthouse Community Hospital", id = `cmo4sbr8p0004wthl91ubwfwb`, 3 active contracts seeded.

**v0 reference paths (read-only):**
- `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/app/dashboard/contracts/page.tsx` (list, 991 L)
- `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/app/dashboard/contracts/[id]/page.tsx` (detail, 1326 L)
- `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/app/dashboard/contracts/new/page.tsx` (create, 1666 L)
- `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/components/contracts/tie-in-contract-details.tsx`

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `components/contracts/compare-modal.tsx` | New: side-by-side comparison of 2-5 selected contracts | 1 |
| `components/contracts/contracts-list-client.tsx` | Wire compare-modal trigger when ≥2 selected | 1 |
| `components/contracts/__tests__/compare-rows.test.ts` | Pure logic tests for compare row builder | 1 |
| `components/contracts/contract-detail-client.tsx` | Add Compliance Status Card on Overview tab | 2 |
| `components/contracts/contract-form.tsx` (or new-contract-client.tsx) | Add multi-facility checkbox group + persist to ContractFacility | 3 |
| `lib/actions/contracts.ts::createContract` | Accept `additionalFacilityIds: string[]`, write ContractFacility rows | 3 |
| `lib/validators/contracts.ts` | Add `additionalFacilityIds` optional array | 3 |
| `components/contracts/grouped-vendor-picker.tsx` | New: shows when contractType === "grouped" — multi-select vendors | 4 |
| `components/contracts/contract-form.tsx` | Render grouped-vendor-picker conditionally; persist to a new VendorContract join table OR derive from existing schema | 4 |
| `components/contracts/contract-performance-charts.tsx` | New: monthly spend area chart + quarterly rebate bar | 5 |
| `lib/actions/contracts/performance-history.ts` | New server action returning `{monthly: {month, spend}[], quarterly: {quarter, rebateEarned, rebateCollected}[]}` for a contract | 5 |
| `components/contracts/tie-in-capital-picker.tsx` | New: capital-contract picker + tie-in mode + bonus multiplier (only when contractType === "tie_in") | 6 |
| `components/contracts/contract-form.tsx` | Render tie-in-capital-picker conditionally; persist to TieInBundle row | 6 |
| `components/contracts/contract-form.tsx` | New "Auto-derive from COG" button next to vendor select that fills totalValue + annualValue from vendor-wide COG aggregate | 7 |
| `lib/actions/contracts/derive-from-cog.ts` | New server action: returns `{totalValue, annualValue, periodMonths}` from `prisma.cOGRecord` aggregate by vendorId | 7 |
| `components/contracts/amendment-extractor.tsx` (existing) + `contract-detail-client.tsx` | Verify the 4-stage amendment dialog renders all stages and is reachable from a button on detail page | 8 |

---

## Task 1: Contract Comparison UI

**Why:** v0 list page has a Compare tab with selected contracts in a side-by-side table. Tydei has `selectedForCompare` state in `contracts-list-client.tsx` line 80 but no rendering — the user can multi-select but can't view a comparison.

**Files:**
- Create: `components/contracts/compare-modal.tsx`
- Create: `components/contracts/__tests__/compare-rows.test.ts`
- Modify: `components/contracts/contracts-list-client.tsx`

- [ ] **Step 1: Pure compare-row builder + test**

```ts
// components/contracts/compare-row-builder.ts
export interface CompareContract {
  id: string
  name: string
  vendorName: string
  contractType: string
  status: string
  effectiveDate: Date
  expirationDate: Date
  totalValue: number
  rebateEarned: number
  spend: number
  score: number | null
  scoreBand: string | null
}

export interface CompareRow {
  label: string
  values: string[] // one per contract
}

export function buildCompareRows(contracts: CompareContract[]): CompareRow[] {
  const fmtMoney = (n: number) => `$${n.toLocaleString()}`
  return [
    { label: "Vendor", values: contracts.map((c) => c.vendorName) },
    { label: "Type", values: contracts.map((c) => c.contractType.replace(/_/g, " ")) },
    { label: "Status", values: contracts.map((c) => c.status) },
    { label: "Effective", values: contracts.map((c) => c.effectiveDate.toISOString().slice(0, 10)) },
    { label: "Expires", values: contracts.map((c) => c.expirationDate.toISOString().slice(0, 10)) },
    { label: "Total Value", values: contracts.map((c) => fmtMoney(c.totalValue)) },
    { label: "Spend", values: contracts.map((c) => fmtMoney(c.spend)) },
    { label: "Rebate Earned", values: contracts.map((c) => fmtMoney(c.rebateEarned)) },
    { label: "Score", values: contracts.map((c) => c.score == null ? "—" : String(c.score)) },
    { label: "Score Band", values: contracts.map((c) => c.scoreBand ?? "—") },
  ]
}
```

```ts
// components/contracts/__tests__/compare-rows.test.ts
import { describe, it, expect } from "vitest"
import { buildCompareRows } from "@/components/contracts/compare-row-builder"

describe("buildCompareRows", () => {
  it("produces one row per metric and one column per contract", () => {
    const c = [
      {
        id: "1", name: "A", vendorName: "Stryker", contractType: "usage",
        status: "active", effectiveDate: new Date("2025-01-01"),
        expirationDate: new Date("2027-01-01"), totalValue: 1_000_000,
        rebateEarned: 50_000, spend: 800_000, score: 82, scoreBand: "B",
      },
      {
        id: "2", name: "B", vendorName: "Medtronic", contractType: "usage",
        status: "active", effectiveDate: new Date("2025-02-01"),
        expirationDate: new Date("2028-02-01"), totalValue: 2_000_000,
        rebateEarned: 80_000, spend: 1_200_000, score: 91, scoreBand: "A",
      },
    ]
    const rows = buildCompareRows(c)
    expect(rows).toHaveLength(10)
    const vendorRow = rows.find((r) => r.label === "Vendor")
    expect(vendorRow?.values).toEqual(["Stryker", "Medtronic"])
    const totalRow = rows.find((r) => r.label === "Total Value")
    expect(totalRow?.values).toEqual(["$1,000,000", "$2,000,000"])
  })
})
```

- [ ] **Step 2: Run failing test, then create the helper file. Re-run, expect pass.**

```bash
bunx vitest run components/contracts/__tests__/compare-rows.test.ts
```

- [ ] **Step 3: Build the modal**

```tsx
// components/contracts/compare-modal.tsx
"use client"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { buildCompareRows, type CompareContract } from "./compare-row-builder"

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  contracts: CompareContract[]
}

export function CompareModal({ open, onOpenChange, contracts }: Props) {
  const rows = buildCompareRows(contracts)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Compare {contracts.length} contracts</DialogTitle>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Metric</TableHead>
              {contracts.map((c) => (
                <TableHead key={c.id}>{c.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.label}>
                <TableCell className="font-medium text-muted-foreground">{r.label}</TableCell>
                {r.values.map((v, i) => (
                  <TableCell key={i}>{v}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Wire modal trigger into list client**

In `components/contracts/contracts-list-client.tsx`, add at the top of the action bar (where compare-mode toggle lives):

```tsx
import { CompareModal } from "./compare-modal"
const [compareOpen, setCompareOpen] = useState(false)
const compareContracts = useMemo(
  () => contracts.filter((c) => selectedForCompare.includes(c.id)).map((c) => ({
    id: c.id,
    name: c.name,
    vendorName: c.vendor.name,
    contractType: c.contractType,
    status: c.status,
    effectiveDate: new Date(c.effectiveDate),
    expirationDate: new Date(c.expirationDate),
    totalValue: Number(c.totalValue),
    rebateEarned: Number(metricsBatch[c.id]?.rebate ?? 0),
    spend: Number(metricsBatch[c.id]?.spend ?? 0),
    score: c.score,
    scoreBand: c.scoreBand,
  })),
  [contracts, selectedForCompare, metricsBatch],
)
// ...
<Button
  size="sm"
  disabled={selectedForCompare.length < 2}
  onClick={() => setCompareOpen(true)}
>
  Compare ({selectedForCompare.length})
</Button>
<CompareModal open={compareOpen} onOpenChange={setCompareOpen} contracts={compareContracts} />
```

- [ ] **Step 5: tsc + commit**

```bash
bunx tsc --noEmit
git add components/contracts/compare-row-builder.ts components/contracts/compare-modal.tsx components/contracts/contracts-list-client.tsx components/contracts/__tests__/compare-rows.test.ts
git commit -m "feat(contracts-list): side-by-side compare modal for selected contracts"
```

---

## Task 2: Compliance Status Card on detail Overview

**Why:** v0 detail page shows a "Compliance & Alerts" section with a colored badge (On Track / Needs Attention / At Risk) based on `compliance_rate`. Tydei `Contract.complianceRate` exists in the schema but the detail Overview tab is silent.

**Files:** `components/contracts/contract-detail-client.tsx`

- [ ] **Step 1: Insert Card after Tie-In Card (or after Commitment Progress when not tie-in)**

```tsx
{contract.complianceRate != null && (
  <Card>
    <CardHeader>
      <CardTitle>Compliance</CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="text-3xl font-bold">
          {Number(contract.complianceRate).toFixed(0)}%
        </div>
        <Badge
          className={
            Number(contract.complianceRate) >= 90
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : Number(contract.complianceRate) >= 75
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
              : "bg-red-500/15 text-red-700 dark:text-red-400"
          }
        >
          {Number(contract.complianceRate) >= 90
            ? "On Track"
            : Number(contract.complianceRate) >= 75
            ? "Needs Attention"
            : "At Risk"}
        </Badge>
      </div>
      <Progress value={Number(contract.complianceRate)} />
      <p className="text-xs text-muted-foreground">
        % of vendor purchases routed through this contract.
      </p>
    </CardContent>
  </Card>
)}
```

`Progress` import: `import { Progress } from "@/components/ui/progress"`. `Badge` should already be imported.

- [ ] **Step 2: tsc + commit**

```bash
bunx tsc --noEmit
git add components/contracts/contract-detail-client.tsx
git commit -m "feat(contract-detail): Compliance status card on Overview tab"
```

---

## Task 3: Multi-Facility selector on contract create

**Why:** v0 has `isMultiFacility` toggle and `selectedFacilities[]` array. Tydei schema has `Contract.isMultiFacility` AND a `ContractFacility` join table, but the create form has no facility multi-select.

**Files:**
- Modify: `components/contracts/new-contract-client.tsx` (or wherever the contract-create form is)
- Modify: `lib/actions/contracts.ts::createContract`
- Modify: `lib/validators/contracts.ts::createContractSchema`

- [ ] **Step 1: Validator**

In `lib/validators/contracts.ts::createContractSchema`, add:

```ts
additionalFacilityIds: z.array(z.string()).optional(),
```

- [ ] **Step 2: Action persistence**

In `lib/actions/contracts.ts::createContract`, after `prisma.contract.create`, write the join rows:

```ts
if (data.additionalFacilityIds?.length) {
  await prisma.contractFacility.createMany({
    data: data.additionalFacilityIds.map((fid) => ({
      contractId: contract.id,
      facilityId: fid,
    })),
    skipDuplicates: true,
  })
}
```

- [ ] **Step 3: UI multi-select**

Below the existing facility-select on the form, add a `<Switch>` "Apply to multiple facilities" controlled by `form.watch("isMultiFacility")`. When on, render a `<MultiSelect>` of facility names from `getFacilities()`. Persist the selection into `additionalFacilityIds`.

```tsx
const { data: allFacilities } = useQuery({
  queryKey: queryKeys.facilities.all,
  queryFn: getFacilities,
})

{form.watch("isMultiFacility") && (
  <Field label="Additional facilities">
    <FacilityMultiSelect
      facilities={(allFacilities ?? []).filter((f) => f.id !== form.watch("facilityId"))}
      selected={form.watch("additionalFacilityIds") ?? []}
      onChange={(ids) => form.setValue("additionalFacilityIds", ids)}
    />
  </Field>
)}
```

If `FacilityMultiSelect` doesn't exist, build it with the same shape as `SpecificItemsPicker` (search + checkbox list).

- [ ] **Step 4: tsc + smoke + commit**

```bash
bunx tsc --noEmit
```

Then create a test contract with 2 facilities via the form, verify `prisma.contractFacility.count({where: {contractId: <new>}})` returns the additional count.

```bash
git add lib/validators/contracts.ts lib/actions/contracts.ts components/contracts/new-contract-client.tsx
git commit -m "feat(contracts-create): multi-facility selector + ContractFacility persistence"
```

---

## Task 4: Grouped contract — multi-vendor support

**Why:** v0 lets the user create "grouped" contracts (GPO-style) covering multiple vendors. Tydei schema has `Contract.isGrouped` flag but `vendorId` is a single column. The create form locks to one vendor.

**Decision:** Don't add a multi-vendor join table in this task — that's a schema change with downstream impact. Instead: when `isGrouped=true`, the `vendorId` is the *primary* vendor and an additional `groupedVendorIds: string[]` is stored as a JSON column or via a future join. For this task, ship the UI + a TODO note for the schema change.

**Files:**
- Modify: `components/contracts/contract-form.tsx` (or the create client) — render a `<GroupedVendorPicker>` when `isGrouped` toggle is on
- Note: persistence beyond storing the primary vendor is deferred — flag clearly in the commit message

- [ ] **Step 1: Add `<GroupedVendorPicker>`**

```tsx
{form.watch("isGrouped") && (
  <Field label="Additional vendors in this group">
    <p className="text-xs text-muted-foreground">
      Persistence for additional vendors is coming — for now this contract will be created against the primary vendor only.
    </p>
    <VendorMultiSelect
      vendors={(vendors ?? []).filter((v) => v.id !== form.watch("vendorId"))}
      selected={additionalVendorIds}
      onChange={setAdditionalVendorIds}
    />
  </Field>
)}
```

- [ ] **Step 2: Commit (UI-only, schema deferred)**

```bash
bunx tsc --noEmit
git add components/contracts/contract-form.tsx components/contracts/grouped-vendor-picker.tsx
git commit -m "feat(contracts-create): grouped vendor multi-select UI (persistence deferred)"
```

---

## Task 5: Performance charts on detail page

**Why:** v0 detail page shows monthly spend (area chart) + quarterly rebate (bar chart). Tydei has `ContractAccrualTimeline` but no spend trend or quarterly rebate visualization.

**Files:**
- Create: `lib/actions/contracts/performance-history.ts`
- Create: `components/contracts/contract-performance-charts.tsx`
- Modify: `components/contracts/contract-detail-client.tsx` — render the charts on the Performance tab

- [ ] **Step 1: Server action**

```ts
"use server"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"

export interface MonthlyPoint { month: string; spend: number }
export interface QuarterlyPoint { quarter: string; rebateEarned: number; rebateCollected: number }

export async function getContractPerformanceHistory(contractId: string): Promise<{
  monthly: MonthlyPoint[]
  quarterly: QuarterlyPoint[]
}> {
  const { facility } = await requireFacility()
  const contract = await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true, vendorId: true, effectiveDate: true },
  })

  const since = new Date(contract.effectiveDate)
  const cog = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
      transactionDate: { gte: since },
    },
    select: { transactionDate: true, extendedPrice: true },
  })
  const monthMap = new Map<string, number>()
  for (const r of cog) {
    if (!r.transactionDate) continue
    const key = r.transactionDate.toISOString().slice(0, 7)
    monthMap.set(key, (monthMap.get(key) ?? 0) + Number(r.extendedPrice ?? 0))
  }
  const monthly = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, spend]) => ({ month, spend }))

  const periods = await prisma.contractPeriod.findMany({
    where: { contractId: contract.id },
    select: { periodEnd: true, rebateEarned: true, rebateCollected: true },
    orderBy: { periodEnd: "asc" },
  })
  const quarterly: QuarterlyPoint[] = periods.map((p) => {
    const y = p.periodEnd.getUTCFullYear()
    const q = Math.floor(p.periodEnd.getUTCMonth() / 3) + 1
    return {
      quarter: `${y} Q${q}`,
      rebateEarned: Number(p.rebateEarned ?? 0),
      rebateCollected: Number(p.rebateCollected ?? 0),
    }
  })

  return serialize({ monthly, quarterly })
}
```

- [ ] **Step 2: Charts component**

```tsx
"use client"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts"
import { useQuery } from "@tanstack/react-query"
import { getContractPerformanceHistory } from "@/lib/actions/contracts/performance-history"

export function ContractPerformanceCharts({ contractId }: { contractId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["contracts", "perf-history", contractId] as const,
    queryFn: () => getContractPerformanceHistory(contractId),
  })
  if (isLoading || !data) return <div className="h-72 animate-pulse rounded-md bg-muted" />
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Monthly Spend</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.monthly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="spend" stroke="#10b981" fill="#10b98133" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Rebate by Quarter</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.quarterly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="quarter" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="rebateEarned" fill="#3b82f6" name="Earned" />
              <Bar dataKey="rebateCollected" fill="#10b981" name="Collected" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Wire into detail page Performance tab**

```tsx
import { ContractPerformanceCharts } from "@/components/contracts/contract-performance-charts"
// inside <TabsContent value="performance">
<ContractPerformanceCharts contractId={contractId} />
```

- [ ] **Step 4: tsc + commit**

```bash
bunx tsc --noEmit
git add lib/actions/contracts/performance-history.ts components/contracts/contract-performance-charts.tsx components/contracts/contract-detail-client.tsx
git commit -m "feat(contract-detail): monthly spend + quarterly rebate charts on Performance tab"
```

---

## Task 6: Tie-in capital picker on contract create

**Why:** v0 contract create form has a `TieInContractDetails` component for setting up capital tie-ins. Tydei has the term-level capital fields (shipped today as Bug 10) but no contract-level "this contract is tied to capital contract X" flow.

**Files:**
- Create: `components/contracts/tie-in-capital-picker.tsx`
- Modify: `components/contracts/new-contract-client.tsx` — render the picker conditionally
- Schema: `Contract.tieInCapitalContractId` already exists (line 575 of prisma/schema.prisma)
- Modify: `lib/validators/contracts.ts` — add `tieInCapitalContractId: z.string().optional()` to create schema if not present
- Modify: `lib/actions/contracts.ts::createContract` — pass `tieInCapitalContractId` through

- [ ] **Step 1: Picker component**

```tsx
"use client"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { useQuery } from "@tanstack/react-query"
import { getContracts } from "@/lib/actions/contracts"

interface Props {
  value: string | null
  onChange: (v: string | null) => void
}

export function TieInCapitalPicker({ value, onChange }: Props) {
  const { data } = useQuery({
    queryKey: ["contracts", "capital-list"] as const,
    queryFn: () => getContracts({ status: "active", contractType: "capital" } as any),
  })
  const options = data?.contracts ?? []
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v === "__none__" ? null : v)}>
      <SelectTrigger><SelectValue placeholder="Pick a capital contract..." /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">None</SelectItem>
        {options.map((c) => (
          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

- [ ] **Step 2: Render in form when contractType === "tie_in"**

```tsx
{form.watch("contractType") === "tie_in" && (
  <Field label="Tied to capital contract">
    <TieInCapitalPicker
      value={form.watch("tieInCapitalContractId") ?? null}
      onChange={(v) => form.setValue("tieInCapitalContractId", v ?? undefined)}
    />
  </Field>
)}
```

- [ ] **Step 3: tsc + commit**

```bash
bunx tsc --noEmit
git add components/contracts/tie-in-capital-picker.tsx components/contracts/new-contract-client.tsx lib/validators/contracts.ts lib/actions/contracts.ts
git commit -m "feat(contracts-create): tie-in capital contract picker"
```

---

## Task 7: Auto-derive contract total + annual value from COG

**Why:** v0 form pre-fills `contractTotal` and `contractMargin` from existing COG data when a vendor is selected. Tydei requires manual entry, which is a friction point Charles will hit on every new contract.

**Files:**
- Create: `lib/actions/contracts/derive-from-cog.ts`
- Modify: `components/contracts/new-contract-client.tsx` — add a "Suggest from COG" button next to totalValue input

- [ ] **Step 1: Server action**

```ts
"use server"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"

export async function deriveContractTotalFromCOG(vendorId: string, months = 12): Promise<{
  totalValue: number
  annualValue: number
  monthsObserved: number
}> {
  const { facility } = await requireFacility()
  const since = new Date()
  since.setMonth(since.getMonth() - months)

  const agg = await prisma.cOGRecord.aggregate({
    where: { facilityId: facility.id, vendorId, transactionDate: { gte: since } },
    _sum: { extendedPrice: true },
    _count: true,
  })
  const totalValue = Number(agg._sum.extendedPrice ?? 0)
  const annualValue = totalValue // last 12 months IS annual

  return { totalValue, annualValue, monthsObserved: months }
}
```

- [ ] **Step 2: Button + handler in form**

```tsx
<div className="flex items-end gap-2">
  <Field label="Total Value ($)" required>
    <Input type="number" {...form.register("totalValue", { valueAsNumber: true })} />
  </Field>
  <Button
    type="button"
    variant="outline"
    size="sm"
    disabled={!form.watch("vendorId")}
    onClick={async () => {
      const r = await deriveContractTotalFromCOG(form.watch("vendorId")!)
      form.setValue("totalValue", r.totalValue)
      form.setValue("annualValue", r.annualValue)
      toast.success(`Filled from ${r.monthsObserved}-month COG aggregate`)
    }}
  >
    Suggest from COG
  </Button>
</div>
```

- [ ] **Step 3: tsc + commit**

```bash
bunx tsc --noEmit
git add lib/actions/contracts/derive-from-cog.ts components/contracts/new-contract-client.tsx
git commit -m "feat(contracts-create): suggest totalValue from vendor COG aggregate"
```

---

## Task 8: Amendment workflow verification

**Why:** v0 has a 4-stage amendment dialog (upload → review → pricing → confirm). Tydei has `AmendmentExtractor` imported but the wiring is partial — verify it's reachable from the detail page and complete the missing stages if any.

**Files:**
- Modify: `components/contracts/contract-detail-client.tsx`

- [ ] **Step 1: Survey**

Read `components/contracts/amendment-extractor.tsx` and `contract-detail-client.tsx`. Check:
- Is there a button on the detail page that opens the AmendmentExtractor?
- Does the AmendmentExtractor walk through all 4 v0 stages (upload, review, pricing, confirm)?
- After confirm, does it call a server action to create an amendment record (or update the contract)?

- [ ] **Step 2: Add the button if missing**

Near the contract title actions on the detail page:

```tsx
<Button variant="outline" size="sm" onClick={() => setShowAmendment(true)}>
  <FileText className="mr-2 h-4 w-4" /> Add Amendment
</Button>
```

- [ ] **Step 3: Verify the AmendmentExtractor renders all 4 stages**

If any stage is stubbed, complete it per the v0 reference at `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/components/contracts/amendment-extractor.tsx`.

- [ ] **Step 4: tsc + commit**

```bash
bunx tsc --noEmit
git add components/contracts/amendment-extractor.tsx components/contracts/contract-detail-client.tsx
git commit -m "fix(contract-detail): wire 4-stage amendment dialog from detail page"
```

---

## Task 9: Smoke + finalize

- [ ] **Step 1: Run full unit suite**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' 2>&1 | tail -5
```

Expected: all unit tests pass (browser/playwright suites can fail — they're pre-existing).

- [ ] **Step 2: Build**

```bash
bun run build 2>&1 | tail -10
```

- [ ] **Step 3: Smoke contracts pages as demo facility**

```bash
PORT=3002 bun run start &
sleep 6
curl -sL -c /tmp/c.txt -X POST http://localhost:3002/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"demo-facility@tydei.com","password":"demo-facility-2024"}' > /dev/null
for p in /dashboard/contracts /dashboard/contracts/new; do
  code=$(curl -sL -b /tmp/c.txt -o /tmp/p.html -w "%{http_code}" "http://localhost:3002$p")
  err=$(grep -c '"digest"' /tmp/p.html 2>/dev/null)
  echo "$p HTTP=$code digest_errors=$err"
done
```

Expected: all 200, all `digest_errors=0`.

- [ ] **Step 4: Push (already shipped per task)**

If anything still un-pushed: `git push origin main`.

---

## Self-Review

| Gap | Task |
|---|---|
| 1 — Compare modal | Task 1 |
| 2 — Compliance card | Task 2 |
| 3 — Multi-facility selector | Task 3 |
| 4 — Grouped vendor picker | Task 4 |
| 5 — Performance charts | Task 5 |
| 6 — Tie-in capital picker | Task 6 |
| 7 — Auto-derive from COG | Task 7 |
| 8 — Amendment workflow | Task 8 |

**Type consistency:** `CompareContract` (Task 1) — id/name/vendorName/contractType/status/effectiveDate/expirationDate/totalValue/rebateEarned/spend/score/scoreBand. Used identically in modal + helper + test. `MonthlyPoint`/`QuarterlyPoint` (Task 5) match the recharts dataKey strings.

**Placeholder scan:** every step has runnable code or a runnable command. Task 4 explicitly defers persistence with a UI-only commit and a clear note in the message.
