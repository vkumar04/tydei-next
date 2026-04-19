# v0 Parity Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each task ships independently — dispatch in its own worktree, review, then cherry-pick to main.

**Goal:** Ship the 6 v0-parity subsystems that have no engine dependencies — the highest user-visible quick wins from the contracts + cog-data v0 audit.

**Architecture:** All UI-layer or already-built backend wiring. No schema migrations, no new server actions beyond one tiny scope-filter branch. Each task ships its own Vitest regression test where it touches a server action; UI-only tasks skip tests where the existing structure already covers the behavior.

**Tech Stack:** Next.js 16, Prisma 7, TypeScript strict, Vitest, TanStack Query, shadcn/ui.

**Working DB:** `postgresql://tydei:tydei_dev_password@localhost:5432/tydei`. Demo facility = "Lighthouse Community Hospital", `cmo4sbr8p0004wthl91ubwfwb`.

**Source spec:** `docs/superpowers/specs/2026-04-18-contracts-rewrite.md` §9 + `docs/superpowers/specs/2026-04-18-cog-data-rewrite.md` §10.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `components/contracts/contract-columns.tsx` | Add per-row checkbox column with `selectable` opt-in | 1 |
| `components/contracts/contracts-list-client.tsx` | Sticky "Compare (N)" toolbar above the table | 1 |
| `lib/validators/contracts.ts` | Add `facilityScope: enum` to `ContractFilters` | 2 |
| `lib/actions/contracts.ts::getContracts` | Branch the `where` clause on `facilityScope` | 2 |
| `lib/actions/__tests__/get-contracts-scope.test.ts` | 3 cases: this / all / shared | 2 |
| `components/contracts/contracts-list-client.tsx` | RadioGroup or Tabs above filter bar bound to URL param | 2 |
| `components/contracts/contract-detail-client.tsx` | Market-share progress card on Overview tab | 3 |
| `lib/contract-definitions.ts` | Centralised CONTRACT_TYPE / REBATE_TYPE / TIER_STRUCTURE / PERFORMANCE_PERIOD definitions | 4 |
| `components/contracts/definition-tooltip.tsx` | Tooltip wrapper component | 4 |
| `lib/contracts/__tests__/contract-definitions.test.ts` | Coverage test — every Prisma enum value has a definition | 4 |
| `lib/actions/cog-import/cog-csv-import.ts` (or wherever ingestCOGRecordsCSV lives) | Return new stats fields | 5 |
| `components/facility/cog/cog-import-dialog.tsx` | Render "Import complete" stats card | 5 |
| `lib/actions/__tests__/cog-csv-import.test.ts` | Extend with stats-shape assertion | 5 |
| `components/facility/cog/cog-data-client.tsx` | Audit "Re-run match" button visibility + wiring | 6 |

---

## Task 1: Compare modal wired to "Compare (N)" toolbar

**Spec:** Subsystem 9.1.

**Files:**
- Modify: `components/contracts/contract-columns.tsx`
- Modify: `components/contracts/contracts-list-client.tsx`

- [ ] **Step 1: Add `selectable` prop to columns helper**

In `components/contracts/contract-columns.tsx`, find the columns factory (likely `getContractColumns()` or similar). Add a `selectable: boolean` parameter (default `false`). When true, prepend a column:

```tsx
import { Checkbox } from "@/components/ui/checkbox"
// ...
const selectionColumn: ColumnDef<ContractWithVendor> = {
  id: "select",
  header: ({ table }) => (
    <Checkbox
      checked={
        table.getIsAllPageRowsSelected() ||
        (table.getIsSomePageRowsSelected() && "indeterminate")
      }
      onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
      aria-label="Select all"
    />
  ),
  cell: ({ row }) => (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={(v) => row.toggleSelected(!!v)}
      aria-label="Select row"
    />
  ),
  enableSorting: false,
  enableHiding: false,
}
```

Then in the factory, prepend `selectionColumn` to the returned array when `selectable === true`.

- [ ] **Step 2: Lift selection state to list client**

In `components/contracts/contracts-list-client.tsx`, the existing `selectedForCompare: string[]` state already lives there. Add a TanStack Table `rowSelection` state synced to it:

```tsx
const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})

useEffect(() => {
  setSelectedForCompare(Object.keys(rowSelection).filter((k) => rowSelection[k]))
}, [rowSelection])
```

Pass `rowSelection`, `onRowSelectionChange: setRowSelection`, and `getRowId: (row) => row.id` into the existing `useReactTable` call. Pass `selectable={true}` to `getContractColumns(...)`.

- [ ] **Step 3: Sticky compare toolbar**

Above the existing table (inside the All Contracts Tab content), add:

```tsx
{selectedForCompare.length >= 2 && (
  <div className="sticky top-0 z-10 flex items-center justify-between rounded-md border bg-card/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/80">
    <p className="text-sm">
      {selectedForCompare.length} contracts selected
    </p>
    <div className="flex gap-2">
      <Button size="sm" variant="ghost" onClick={() => setRowSelection({})}>
        Clear
      </Button>
      <Button size="sm" onClick={() => setCompareOpen(true)}>
        Compare ({selectedForCompare.length})
      </Button>
    </div>
  </div>
)}
```

`compareOpen` and `<CompareModal />` already exist in this file (commit `dc26a37`).

- [ ] **Step 4: Type check**

```bash
bunx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add components/contracts/contract-columns.tsx components/contracts/contracts-list-client.tsx
git commit -m "feat(contracts-list): row checkbox + sticky Compare toolbar"
```

---

## Task 2: 3-way facility scope filter

**Spec:** Subsystem 9.2.

**Files:**
- Modify: `lib/validators/contracts.ts`
- Modify: `lib/actions/contracts.ts`
- Create: `lib/actions/__tests__/get-contracts-scope.test.ts`
- Modify: `components/contracts/contracts-list-client.tsx`

- [ ] **Step 1: Validator — add facilityScope**

In `lib/validators/contracts.ts`, find `contractFiltersSchema` (or wherever `ContractFilters` is defined). Add:

```ts
facilityScope: z.enum(["this", "all", "shared"]).optional().default("this"),
```

- [ ] **Step 2: Write failing test for the action branches**

Create `lib/actions/__tests__/get-contracts-scope.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const findManyMock = vi.fn().mockResolvedValue([])
const countMock = vi.fn().mockResolvedValue(0)

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findMany: findManyMock, count: countMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

import { getContracts } from "@/lib/actions/contracts"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getContracts — facilityScope", () => {
  it("'this' (default) scopes by facilityId", async () => {
    await getContracts({})
    const call = findManyMock.mock.calls[0][0]
    const where = JSON.stringify(call.where)
    expect(where).toContain("fac-1")
    expect(where).not.toContain("isMultiFacility")
  })

  it("'all' drops the facility filter", async () => {
    await getContracts({ facilityScope: "all" })
    const call = findManyMock.mock.calls[0][0]
    const where = JSON.stringify(call.where)
    // No facilityId scoping in 'all' mode
    expect(where).not.toContain("\"facilityId\":")
  })

  it("'shared' filters to multi-facility rows the facility participates in", async () => {
    await getContracts({ facilityScope: "shared" })
    const call = findManyMock.mock.calls[0][0]
    const where = JSON.stringify(call.where)
    expect(where).toContain("isMultiFacility")
    expect(where).toContain("contractFacilities")
  })
})
```

- [ ] **Step 3: Run test → expect FAIL**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/__tests__/get-contracts-scope.test.ts
```

Expected: FAIL — current implementation always uses `contractsOwnedByFacility`.

- [ ] **Step 4: Branch `getContracts`**

In `lib/actions/contracts.ts::getContracts`, after parsing filters, branch the facility-scope clause:

```ts
const scope = filters.facilityScope ?? "this"
let facilityClause: Prisma.ContractWhereInput = {}
if (scope === "this") {
  facilityClause = contractsOwnedByFacility(facility.id)
} else if (scope === "shared") {
  facilityClause = {
    isMultiFacility: true,
    OR: [
      { facilityId: facility.id },
      { contractFacilities: { some: { facilityId: facility.id } } },
    ],
  }
}
// scope === "all" leaves facilityClause empty (auth gate already enforced)

const where: Prisma.ContractWhereInput = {
  AND: [facilityClause, ...otherClauses],
}
```

Make sure the rest of `where` (status / vendorId / search / etc.) is folded under `AND` alongside `facilityClause`.

- [ ] **Step 5: Run test → expect PASS**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/__tests__/get-contracts-scope.test.ts
```

Expected: 3 cases pass.

- [ ] **Step 6: UI — radio toggle**

In `components/contracts/contracts-list-client.tsx`, add above the existing filter bar:

```tsx
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
// ...
const searchParams = useSearchParams()
const router = useRouter()
const pathname = usePathname()
const facilityScope = (searchParams.get("scope") as "this" | "all" | "shared") ?? "this"

function setFacilityScope(next: "this" | "all" | "shared") {
  const params = new URLSearchParams(searchParams.toString())
  if (next === "this") params.delete("scope")
  else params.set("scope", next)
  router.replace(`${pathname}?${params.toString()}`)
}
// ...
<Tabs value={facilityScope} onValueChange={(v) => setFacilityScope(v as "this" | "all" | "shared")}>
  <TabsList>
    <TabsTrigger value="this">This Facility</TabsTrigger>
    <TabsTrigger value="all">All</TabsTrigger>
    <TabsTrigger value="shared">Shared</TabsTrigger>
  </TabsList>
</Tabs>
```

Pass `facilityScope` into the `useContracts` call's filters argument so TanStack Query re-fetches on scope change.

- [ ] **Step 7: Type check + commit**

```bash
bunx tsc --noEmit
git add lib/validators/contracts.ts lib/actions/contracts.ts lib/actions/__tests__/get-contracts-scope.test.ts components/contracts/contracts-list-client.tsx
git commit -m "feat(contracts-list): 3-way facility scope filter (this/all/shared)"
```

---

## Task 3: Market-share progress card

**Spec:** Subsystem 9.5.

**Files:**
- Modify: `components/contracts/contract-detail-client.tsx`

- [ ] **Step 1: Add the conditional Card on the Overview tab**

In `components/contracts/contract-detail-client.tsx`, find the existing Compliance Card (commit `122c7a3`, around line 473 — the `{contract.complianceRate != null && (...)}` block). Insert this Card immediately after it:

```tsx
{contract.currentMarketShare != null && contract.marketShareCommitment != null && Number(contract.marketShareCommitment) > 0 && (
  <Card>
    <CardHeader>
      <CardTitle>Market Share Commitment</CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="text-3xl font-bold">
          {Number(contract.currentMarketShare).toFixed(0)}%
        </div>
        <span className="text-sm text-muted-foreground">
          of {Number(contract.marketShareCommitment).toFixed(0)}% commitment
        </span>
        <Badge
          className={
            (Number(contract.currentMarketShare) / Number(contract.marketShareCommitment)) * 100 >= 80
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : (Number(contract.currentMarketShare) / Number(contract.marketShareCommitment)) * 100 >= 60
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : "bg-red-500/15 text-red-700 dark:text-red-400"
          }
        >
          {Math.round(
            (Number(contract.currentMarketShare) / Number(contract.marketShareCommitment)) * 100,
          )}% met
        </Badge>
      </div>
      <Progress
        value={Math.min(
          100,
          (Number(contract.currentMarketShare) / Number(contract.marketShareCommitment)) * 100,
        )}
      />
      <p className="text-xs text-muted-foreground">
        Current market share vs the commitment target on this contract.
      </p>
    </CardContent>
  </Card>
)}
```

`Card`, `Badge`, and `Progress` should already be imported in this file (per commit `122c7a3`).

- [ ] **Step 2: Type check + commit**

```bash
bunx tsc --noEmit
git add components/contracts/contract-detail-client.tsx
git commit -m "feat(contract-detail): market-share commitment progress card"
```

---

## Task 4: Centralized contract definitions + tooltip wrapper

**Spec:** Subsystem 9.11.

**Files:**
- Create: `lib/contract-definitions.ts`
- Create: `components/contracts/definition-tooltip.tsx`
- Create: `lib/contracts/__tests__/contract-definitions.test.ts`
- Modify: `components/contracts/contract-terms-entry.tsx` — replace inline `description:` strings on the `termTypes` array with lookups

- [ ] **Step 1: Create the definitions file**

```ts
// lib/contract-definitions.ts
import type { ContractType, RebateType, TermType } from "@prisma/client"

export interface Definition {
  label: string
  description: string
}

export const CONTRACT_TYPE_DEFINITIONS: Record<ContractType, Definition> = {
  usage: {
    label: "Usage",
    description: "Standard contract with spend or volume-based rebates.",
  },
  capital: {
    label: "Capital",
    description: "Equipment purchase contract with payment schedule.",
  },
  service: {
    label: "Service",
    description: "Maintenance, support, or consulting service agreement.",
  },
  tie_in: {
    label: "Tie-In",
    description: "Hybrid contract where capital/service payments are tied to consumable purchases.",
  },
  grouped: {
    label: "Grouped",
    description: "Contract spanning multiple vendor divisions with combined rebate structure.",
  },
  pricing_only: {
    label: "Pricing Only",
    description: "Price-only agreement that locks in specific pricing without rebate structure.",
  },
}

export const TERM_TYPE_DEFINITIONS: Record<TermType, Definition> = {
  spend_rebate: { label: "Spend Rebate", description: "Rebate based on spend thresholds." },
  volume_rebate: { label: "Volume Rebate", description: "Rebate based on usage count. Baseline is in $ amounts." },
  price_reduction: { label: "Price Reduction", description: "Once spend/volume threshold is met, future purchases receive discounted prices." },
  market_share: { label: "Market Share", description: "Rebate based on market share percentage." },
  market_share_price_reduction: { label: "Market Share Price Reduction", description: "Once market share target is met, future purchases receive discounted prices." },
  capitated_price_reduction: { label: "Capitated Price Reduction", description: "Once procedure spend threshold is met, future procedures receive discounted prices." },
  capitated_pricing_rebate: { label: "Capitated Pricing Rebate", description: "Procedure-based ceiling price with rebate." },
  po_rebate: { label: "PO Rebate", description: "Per-purchase-order rebate triggered by PO totals." },
  carve_out: { label: "Carve Out", description: "Specific items excluded from the broader contract terms." },
  payment_rebate: { label: "Payment Rebate", description: "Rebate triggered by payment timing or method." },
  growth_rebate: { label: "Growth Rebate", description: "Rebate based on spend growth over baseline." },
  compliance_rebate: { label: "Compliance Rebate", description: "Rebate for meeting compliance requirements." },
  fixed_fee: { label: "Fixed Fee", description: "Fixed dollar rebate amount." },
  locked_pricing: { label: "Locked Pricing", description: "Price locked for contract duration." },
  rebate_per_use: { label: "Rebate Per Use", description: "Per-unit rebate tracked by usage count." },
}

export const REBATE_TYPE_DEFINITIONS: Record<RebateType, Definition> = {
  percent_of_spend: { label: "% of Spend", description: "Tier rebate computed as percent of qualifying spend." },
  percent_of_units: { label: "% of Units", description: "Tier rebate computed as percent of unit count." },
  fixed_rebate_per_unit: { label: "Fixed $ per Unit", description: "Fixed dollar rebate per qualifying unit." },
  flat_rebate: { label: "Flat Rebate", description: "Flat dollar rebate when tier is reached." },
  reduced_price: { label: "Reduced Price", description: "Tier unlocks a reduced unit price." },
  price_reduction_percent: { label: "Price Reduction %", description: "Tier unlocks a percent price reduction." },
}
```

If your Prisma enum has different `RebateType` keys, the file's `Record<RebateType, ...>` constraint will surface the mismatch at compile time. Adjust the keys to whatever the schema declares.

- [ ] **Step 2: Tooltip component**

```tsx
// components/contracts/definition-tooltip.tsx
"use client"
import { HelpCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { Definition } from "@/lib/contract-definitions"

interface Props {
  definition: Definition
}

export function DefinitionTooltip({ definition }: Props) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`What is ${definition.label}?`}
            className="inline-flex items-center text-muted-foreground hover:text-foreground"
          >
            <HelpCircle className="ml-1 h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium">{definition.label}</p>
          <p className="text-xs text-muted-foreground">{definition.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
```

If `Tooltip` from shadcn isn't installed: `bunx shadcn@latest add tooltip`.

- [ ] **Step 3: Coverage test**

```ts
// lib/contracts/__tests__/contract-definitions.test.ts
import { describe, it, expect } from "vitest"
import { ContractType, RebateType, TermType } from "@prisma/client"
import {
  CONTRACT_TYPE_DEFINITIONS,
  REBATE_TYPE_DEFINITIONS,
  TERM_TYPE_DEFINITIONS,
} from "@/lib/contract-definitions"

describe("contract definitions coverage", () => {
  it("has a definition for every ContractType enum value", () => {
    for (const v of Object.values(ContractType)) {
      expect(CONTRACT_TYPE_DEFINITIONS[v]).toBeDefined()
      expect(CONTRACT_TYPE_DEFINITIONS[v].label.length).toBeGreaterThan(0)
    }
  })
  it("has a definition for every TermType enum value", () => {
    for (const v of Object.values(TermType)) {
      expect(TERM_TYPE_DEFINITIONS[v]).toBeDefined()
      expect(TERM_TYPE_DEFINITIONS[v].label.length).toBeGreaterThan(0)
    }
  })
  it("has a definition for every RebateType enum value", () => {
    for (const v of Object.values(RebateType)) {
      expect(REBATE_TYPE_DEFINITIONS[v]).toBeDefined()
      expect(REBATE_TYPE_DEFINITIONS[v].label.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 4: Run tests**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/contracts/__tests__/contract-definitions.test.ts
```

Expected: 3 passing. If a test fails because the definitions file doesn't cover an enum value, add it (don't relax the test).

- [ ] **Step 5: Wire one consumer (proof-of-life)**

In `components/contracts/contract-terms-entry.tsx`, find the `termTypes` array (~line 51) and the `<Field label="Term Type">` block. Add a tooltip next to the label:

```tsx
import { DefinitionTooltip } from "@/components/contracts/definition-tooltip"
import { TERM_TYPE_DEFINITIONS } from "@/lib/contract-definitions"
// ...
<Field
  label={
    <span className="inline-flex items-center">
      Term Type
      {term.termType && TERM_TYPE_DEFINITIONS[term.termType] && (
        <DefinitionTooltip definition={TERM_TYPE_DEFINITIONS[term.termType]} />
      )}
    </span>
  }
>
```

If `<Field>` doesn't accept a ReactNode label, add a small inline label-with-tooltip wrapper above the existing field. Don't refactor the entire form — just prove the wiring works on this one field.

- [ ] **Step 6: Type check + commit**

```bash
bunx tsc --noEmit
git add lib/contract-definitions.ts components/contracts/definition-tooltip.tsx lib/contracts/__tests__/contract-definitions.test.ts components/contracts/contract-terms-entry.tsx
git commit -m "feat(contracts): centralized definitions + tooltip wrapper, wired on Term Type"
```

---

## Task 5: COG import wizard enrichment feedback

**Spec:** Subsystem 10.1.

**Files:**
- Modify: `lib/actions/imports/cog-csv-import.ts` (or wherever `ingestCOGRecordsCSV` lives — search for it if uncertain)
- Modify: `components/facility/cog/cog-import-dialog.tsx`
- Modify: `lib/actions/__tests__/cog-csv-import.test.ts`

- [ ] **Step 1: Locate the ingest action**

```bash
grep -rn "ingestCOGRecordsCSV\|export async function ingestCOG" lib/actions/ | head -5
```

Note the exact file path. The current return shape is likely `{ created: number }` or `{ created, skipped }`.

- [ ] **Step 2: Extend the return shape**

After the existing ingest + enrichment passes in the action, add a final aggregation:

```ts
// at the end of the action, after enrichment:
const matchedCount = await prisma.cOGRecord.count({
  where: {
    facilityId: facility.id,
    fileImportId: fileImport.id, // assumes FileImport tracking is on
    matchStatus: { not: "pending" },
  },
})
const totalForFile = await prisma.cOGRecord.count({
  where: { facilityId: facility.id, fileImportId: fileImport.id },
})
const onContractCount = await prisma.cOGRecord.count({
  where: {
    facilityId: facility.id,
    fileImportId: fileImport.id,
    isOnContract: true,
  },
})

return serialize({
  // ...existing return fields
  matched: matchedCount,
  unmatched: Math.max(0, totalForFile - matchedCount),
  onContractRate: totalForFile > 0 ? onContractCount / totalForFile : 0,
})
```

If `fileImportId` isn't tracked on `COGRecord` yet (Subsystem 1 still pending), fall back to a window over rows created in the last 60 seconds — it's an interim approximation:

```ts
const since = new Date(Date.now() - 60_000)
const totalForFile = await prisma.cOGRecord.count({
  where: { facilityId: facility.id, createdAt: { gte: since } },
})
// matched/onContract aggregates use the same `since` window
```

- [ ] **Step 3: Extend the test**

In `lib/actions/__tests__/cog-csv-import.test.ts` (or whatever it's named), add a case asserting the return shape includes `matched`, `unmatched`, `onContractRate`. Use the same prisma mock pattern as adjacent tests.

- [ ] **Step 4: Stats card on completion screen**

In `components/facility/cog/cog-import-dialog.tsx`, find the stage that renders after the ingest succeeds. Add:

```tsx
{stage === "summary" && result && (
  <div className="grid gap-3 sm:grid-cols-3">
    <Card>
      <CardHeader><CardTitle className="text-sm">Records imported</CardTitle></CardHeader>
      <CardContent><p className="text-2xl font-bold">{result.created}</p></CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle className="text-sm">Matched to contracts</CardTitle></CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{result.matched}</p>
        <p className="text-xs text-muted-foreground">{result.unmatched} unmatched</p>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle className="text-sm">On-contract rate</CardTitle></CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">
          {((result.onContractRate ?? 0) * 100).toFixed(1)}%
        </p>
      </CardContent>
    </Card>
  </div>
)}
```

If the dialog doesn't have a `summary` stage today, add one between the existing confirm + close steps.

- [ ] **Step 5: Type check + run extended test**

```bash
bunx tsc --noEmit
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/__tests__/cog-csv-import.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/actions/imports/cog-csv-import.ts components/facility/cog/cog-import-dialog.tsx lib/actions/__tests__/cog-csv-import.test.ts
git commit -m "feat(cog-import): matched/unmatched/on-contract stats on import completion"
```

---

## Task 6: Audit "Re-run match" button

**Spec:** Subsystem 10.2.

**Files:**
- Verify: `components/facility/cog/cog-data-client.tsx`

- [ ] **Step 1: Confirm button presence**

```bash
grep -nE "Re-run match|backfillCOGEnrichment|useBackfillCOGEnrichment" components/facility/cog/cog-data-client.tsx hooks/use-cog.ts
```

Expected: a button rendered + a mutation hook wired (per commit `153ae97`).

- [ ] **Step 2: Smoke against demo facility**

```bash
PORT=3002 bun run start &
sleep 6
curl -sL -c /tmp/c.txt -X POST http://localhost:3002/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"demo-facility@tydei.com","password":"demo-facility-2024"}' > /dev/null
curl -sL -b /tmp/c.txt http://localhost:3002/dashboard/cog-data -o /tmp/cog.html
grep -c "Re-run match" /tmp/cog.html
kill %1 2>/dev/null
```

Expected: `1` (the button label appears in the rendered HTML).

- [ ] **Step 3: If grep returns 0, port the button from worktree `agent-a5c61de1`**

```bash
git fetch /Users/vickkumar/code/tydei-next/.claude/worktrees/agent-a5c61de1 worktree-agent-a5c61de1
git show worktree-agent-a5c61de1:components/facility/cog/cog-data-client.tsx > /tmp/source.tsx
diff components/facility/cog/cog-data-client.tsx /tmp/source.tsx
```

Apply the missing diff manually.

- [ ] **Step 4: Doc-only audit commit (or fix commit)**

If audit found everything works, commit a single comment marker so the audit is recorded:

```tsx
// Re-run match button audit (Subsystem 10.2): confirmed wired 2026-04-19
```

```bash
git add components/facility/cog/cog-data-client.tsx
git commit -m "audit(cog): Re-run match button verified per Subsystem 10.2"
```

If a fix was needed, commit message: `fix(cog): wire Re-run match button per Subsystem 10.2`.

---

## Task 7: Smoke + finalize

After every task is cherry-picked to main:

- [ ] **Step 1: Full unit suite**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' 2>&1 | tail -5
```

Expected: every unit test passes; only file-level failures should be the pre-existing playwright suites that need a browser.

- [ ] **Step 2: Build**

```bash
bun run build 2>&1 | tail -5
```

- [ ] **Step 3: Smoke pages as demo facility**

```bash
PORT=3002 bun run start &
sleep 6
curl -sL -c /tmp/c.txt -X POST http://localhost:3002/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"demo-facility@tydei.com","password":"demo-facility-2024"}' > /dev/null
for p in /dashboard/contracts /dashboard/cog-data; do
  code=$(curl -sL -b /tmp/c.txt -o /tmp/p.html -w "%{http_code}" "http://localhost:3002$p")
  err=$(grep -c '"digest"' /tmp/p.html 2>/dev/null)
  echo "$p HTTP=$code digest_errors=$err"
done
kill %1 2>/dev/null
```

Expected: all 200, all `digest_errors=0`.

---

## Self-Review

| Spec subsystem | Task | Acceptance covered |
|---|---|---|
| 9.1 Compare modal wired | Task 1 | Sticky toolbar + per-row checkbox |
| 9.2 3-way scope filter | Task 2 | Validator + action branches + UI radio + 3 tests |
| 9.5 Market-share progress | Task 3 | Conditional Card with thresholded badge |
| 9.11 Centralized definitions | Task 4 | Constants + tooltip wrapper + coverage test + 1 wired consumer |
| 10.1 Import enrichment feedback | Task 5 | Action stats fields + summary card |
| 10.2 Re-run match audit | Task 6 | Audit + commit marker (or fix if absent) |

**Type consistency:** `Definition` interface (Task 4) — `{label, description}`, used identically in tooltip + lookups + tests. `facilityScope` (Task 2) — `"this" | "all" | "shared"` literal union, identical in validator / action / UI.

**Placeholder scan:** every step has runnable code or runnable command. No "TODO" or "implement later." Task 6 has an explicit fallback path if audit reveals the button is missing.
