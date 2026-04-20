# Charles W1.X-A — Edit / delete collected ledger entries

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users a way to edit, uncollect, or delete rows on the contract-detail Transactions tab. Today there is no edit affordance at all.

**Architecture:** Two new server actions (`updateContractTransaction`, `deleteContractTransaction`) sibling to the existing `createContractTransaction` in `lib/actions/contract-periods.ts`. Each row in the existing `TransactionTable` gets an `EllipsisVertical` `DropdownMenu` with Edit / Uncollect / Delete items. Edit opens a new `EditTransactionDialog`. Engine-generated accrual rows (`notes` contains `[auto-accrual]`) are not deletable; they may be uncollected.

**Tech Stack:** Next.js 16 server actions, React Query 5, shadcn/ui Dialog + DropdownMenu, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-20-charles-w1x-a-edit-transaction-design.md`

---

### Task 1: Add `updateContractTransaction` server action (TDD)

**Files:**
- Modify: `lib/actions/contract-periods.ts`
- Create: `lib/actions/__tests__/contract-periods-update.test.ts`

- [ ] **Step 1: Read the current createContractTransaction for shape cues**

Open `lib/actions/contract-periods.ts`. Read `createContractTransaction` end-to-end. Note: it guards via `requireFacility()` + `contractOwnershipWhere(contractId, facility.id)`. Your update/delete must use the same pattern.

- [ ] **Step 2: Write failing test for updateContractTransaction**

```ts
// lib/actions/__tests__/contract-periods-update.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "@/lib/db"
import {
  createContractTransaction,
  updateContractTransaction,
} from "@/lib/actions/contract-periods"
import { seedCollectedRebate } from "@/tests/helpers/contract-fixtures"

describe("updateContractTransaction", () => {
  it("updates amount and collection date without touching rebateEarned", async () => {
    const { contractId, rebateId, originalEarned } = await seedCollectedRebate({
      earned: 1000,
      collected: 500,
      collectionDate: "2025-01-15",
    })

    await updateContractTransaction({
      id: rebateId,
      contractId,
      rebateCollected: 750,
      collectionDate: "2025-02-01",
    })

    const row = await prisma.rebate.findUniqueOrThrow({ where: { id: rebateId } })
    expect(Number(row.rebateCollected)).toBe(750)
    expect(row.collectionDate?.toISOString().slice(0, 10)).toBe("2025-02-01")
    expect(Number(row.rebateEarned)).toBe(originalEarned)
  })

  it("uncollect clears collectionDate and zeros collected but preserves earned", async () => {
    const { contractId, rebateId, originalEarned } = await seedCollectedRebate({
      earned: 1200,
      collected: 1200,
      collectionDate: "2025-01-15",
    })

    await updateContractTransaction({
      id: rebateId,
      contractId,
      rebateCollected: 0,
      collectionDate: null,
    })

    const row = await prisma.rebate.findUniqueOrThrow({ where: { id: rebateId } })
    expect(row.collectionDate).toBeNull()
    expect(Number(row.rebateCollected)).toBe(0)
    expect(Number(row.rebateEarned)).toBe(originalEarned)
  })

  it("rejects updates from other facilities", async () => {
    const { rebateId, contractId } = await seedCollectedRebate({
      facility: "other",
      earned: 500,
      collected: 0,
    })
    await expect(
      updateContractTransaction({ id: rebateId, contractId, rebateCollected: 100 })
    ).rejects.toThrow()
  })
})
```

If `seedCollectedRebate` helper doesn't exist in `tests/helpers/contract-fixtures.ts`, inline it in the test file. It should create a Facility, Vendor, Contract, and one Rebate row with the specified earned/collected/collectionDate values. The `facility: "other"` variant creates a second facility and returns IDs from the wrong facility for the cross-facility test.

- [ ] **Step 3: Run to confirm it FAILS with "updateContractTransaction is not a function"**

Run: `bunx vitest run lib/actions/__tests__/contract-periods-update.test.ts`
Expected: FAIL — `updateContractTransaction` import resolves to undefined.

- [ ] **Step 4: Implement updateContractTransaction**

Append to `lib/actions/contract-periods.ts`:

```ts
export interface UpdateContractTransactionInput {
  id: string
  contractId: string
  rebateCollected?: number
  collectionDate?: string | null // explicit null = uncollect
  quantity?: number | null
  notes?: string
}

export async function updateContractTransaction(
  input: UpdateContractTransactionInput,
): Promise<void> {
  const { facility } = await requireFacility()
  // Ownership guard: the contract must belong to this facility.
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(input.contractId, facility.id),
    select: { id: true },
  })
  // The Rebate row must also belong to that contract.
  const rebate = await prisma.rebate.findUniqueOrThrow({
    where: { id: input.id },
    select: { contractId: true },
  })
  if (rebate.contractId !== input.contractId) {
    throw new Error("Rebate does not belong to the requested contract")
  }

  const data: Prisma.RebateUpdateInput = {}
  if (input.rebateCollected !== undefined) {
    data.rebateCollected = input.rebateCollected
  }
  if (input.collectionDate !== undefined) {
    data.collectionDate = input.collectionDate === null ? null : new Date(input.collectionDate)
  }
  if (input.quantity !== undefined) {
    data.quantity = input.quantity
  }
  if (input.notes !== undefined) {
    data.notes = input.notes
  }

  await prisma.rebate.update({ where: { id: input.id }, data })
}
```

If `Prisma` is not yet imported, add `import { Prisma } from "@prisma/client"` at the top. The existing imports already include `prisma`, `requireFacility`, `contractOwnershipWhere` — check before adding duplicates.

- [ ] **Step 5: Run tests and verify they pass**

Run: `bunx vitest run lib/actions/__tests__/contract-periods-update.test.ts`
Expected: all 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/contract-periods.ts lib/actions/__tests__/contract-periods-update.test.ts
git commit -m "feat(contracts): W1.X-A add updateContractTransaction

Users had no way to correct a logged collection — amount typos, wrong
date — short of a DB edit. Adds updateContractTransaction scoped via
the same requireFacility + contractOwnershipWhere guard as
createContractTransaction. Explicit null collectionDate = uncollect.
Does not touch rebateEarned (engine domain, per CLAUDE.md)."
```

---

### Task 2: Add `deleteContractTransaction` server action (TDD)

**Files:**
- Modify: `lib/actions/contract-periods.ts`
- Modify: `lib/actions/__tests__/contract-periods-update.test.ts`

- [ ] **Step 1: Append failing test**

```ts
import { deleteContractTransaction } from "@/lib/actions/contract-periods"

describe("deleteContractTransaction", () => {
  it("removes a user-logged Rebate row", async () => {
    const { contractId, rebateId } = await seedCollectedRebate({
      earned: 300,
      collected: 300,
      collectionDate: "2025-02-10",
      notes: "Manually logged by Charles",
    })
    await deleteContractTransaction({ id: rebateId, contractId })
    const row = await prisma.rebate.findUnique({ where: { id: rebateId } })
    expect(row).toBeNull()
  })

  it("refuses to delete engine-generated [auto-accrual] rows", async () => {
    const { contractId, rebateId } = await seedCollectedRebate({
      earned: 500,
      collected: 0,
      notes: "[auto-accrual] Q1 2025",
    })
    await expect(
      deleteContractTransaction({ id: rebateId, contractId })
    ).rejects.toThrow(/auto-accrual/i)
    const stillThere = await prisma.rebate.findUnique({ where: { id: rebateId } })
    expect(stillThere).not.toBeNull()
  })

  it("rejects deletes from other facilities", async () => {
    const { rebateId, contractId } = await seedCollectedRebate({
      facility: "other",
      earned: 500,
      collected: 0,
    })
    await expect(
      deleteContractTransaction({ id: rebateId, contractId })
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `bunx vitest run lib/actions/__tests__/contract-periods-update.test.ts`
Expected: 3 FAILs (function missing).

- [ ] **Step 3: Implement**

Append to `lib/actions/contract-periods.ts`:

```ts
export async function deleteContractTransaction(input: {
  id: string
  contractId: string
}): Promise<void> {
  const { facility } = await requireFacility()
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(input.contractId, facility.id),
    select: { id: true },
  })
  const rebate = await prisma.rebate.findUniqueOrThrow({
    where: { id: input.id },
    select: { contractId: true, notes: true },
  })
  if (rebate.contractId !== input.contractId) {
    throw new Error("Rebate does not belong to the requested contract")
  }
  if (rebate.notes && rebate.notes.includes("[auto-accrual]")) {
    throw new Error(
      "Cannot delete an auto-accrual row. Uncollect instead, or run Recompute Earned Rebates."
    )
  }
  await prisma.rebate.delete({ where: { id: input.id } })
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run lib/actions/__tests__/contract-periods-update.test.ts`
Expected: all PASS (6 total now).

- [ ] **Step 5: Commit**

```bash
git add lib/actions/contract-periods.ts lib/actions/__tests__/contract-periods-update.test.ts
git commit -m "feat(contracts): W1.X-A add deleteContractTransaction

Destructive delete for user-logged rebate rows. Engine-generated rows
(notes contains [auto-accrual]) are blocked — users should use
Uncollect (via updateContractTransaction) or Recompute instead."
```

---

### Task 3: UI — Row actions menu

**Files:**
- Modify: `components/contracts/contract-transactions.tsx`

- [ ] **Step 1: Add the actions column to TransactionTable**

In `components/contracts/contract-transactions.tsx`, extend `TransactionTable` (L504-586). Add a new `<TableHead />` at the end of the header row, and inside the row `.map` add a new `<TableCell>` rendering a `DropdownMenu` with Edit, Uncollect (conditional), and Delete.

```tsx
import { MoreHorizontal } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
```

Modify the header:

```tsx
<TableRow>
  <TableHead>Period</TableHead>
  <TableHead>Type</TableHead>
  <TableHead className="text-right">Earned</TableHead>
  <TableHead className="text-right">Collected</TableHead>
  <TableHead className="text-right">Outstanding</TableHead>
  <TableHead className="text-center">Status</TableHead>
  <TableHead className="w-10" />
</TableRow>
```

Pass a new `onAction` prop into `TransactionTable`:

```tsx
function TransactionTable({
  rows,
  filter,
  onAction,
}: {
  rows: PeriodRow[]
  filter: "all" | TransactionType
  onAction: (action: "edit" | "uncollect" | "delete", row: PeriodRow) => void
}) {
```

Inside the row loop append the action cell. An engine-generated row is detected via `row.notes?.includes("[auto-accrual]")`; delete is hidden and Uncollect only shows when `row.collectionDate` is set.

```tsx
<TableCell className="text-right">
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" className="h-8 w-8">
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onClick={() => onAction("edit", row)}>
        Edit
      </DropdownMenuItem>
      {row.collectionDate ? (
        <DropdownMenuItem onClick={() => onAction("uncollect", row)}>
          Uncollect
        </DropdownMenuItem>
      ) : null}
      {!(row.notes?.includes("[auto-accrual]")) ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-red-600 dark:text-red-400"
            onClick={() => onAction("delete", row)}
          >
            Delete
          </DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenuContent>
  </DropdownMenu>
</TableCell>
```

Note: the `PeriodRow` interface currently has `notes?: string | null` (L83). Good — no type change needed.

- [ ] **Step 2: Confirm typecheck passes**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit (UI scaffolding only — handlers come next)**

```bash
git add components/contracts/contract-transactions.tsx
git commit -m "feat(contracts): W1.X-A row-level actions column on ledger"
```

---

### Task 4: UI — Wire Uncollect + Delete mutations

**Files:**
- Modify: `components/contracts/contract-transactions.tsx`

- [ ] **Step 1: Add mutations to the ContractTransactions root component**

Inside `ContractTransactions` (the exported component, L588+), add two mutations:

```tsx
import { updateContractTransaction, deleteContractTransaction } from "@/lib/actions/contract-periods"

const uncollect = useMutation({
  mutationFn: async (row: PeriodRow) => {
    await updateContractTransaction({
      id: row.id,
      contractId,
      rebateCollected: 0,
      collectionDate: null,
    })
  },
  onSuccess: () => {
    toast.success("Collection removed")
    invalidateLedger()
  },
  onError: () => toast.error("Failed to remove collection"),
})

const del = useMutation({
  mutationFn: async (row: PeriodRow) => {
    await deleteContractTransaction({ id: row.id, contractId })
  },
  onSuccess: () => {
    toast.success("Row deleted")
    invalidateLedger()
  },
  onError: (err: Error) => toast.error(err.message ?? "Failed to delete"),
})

function invalidateLedger() {
  queryClient.invalidateQueries({ queryKey: ["contract-periods", contractId] })
  queryClient.invalidateQueries({ queryKey: ["contractPeriods", contractId] })
  queryClient.invalidateQueries({ queryKey: ["contractRebates", contractId] })
  queryClient.invalidateQueries({ queryKey: queryKeys.contracts.detail(contractId) })
}
```

Add a simple `window.confirm` for delete to guard against misclicks:

```tsx
function handleAction(action: "edit" | "uncollect" | "delete", row: PeriodRow) {
  if (action === "uncollect") return uncollect.mutate(row)
  if (action === "delete") {
    if (!window.confirm(`Delete ledger row for ${row.periodStart}–${row.periodEnd}?`)) return
    return del.mutate(row)
  }
  // "edit" wired in Task 5.
}
```

Pass `onAction={handleAction}` into the `<TransactionTable />` JSX call.

- [ ] **Step 2: Smoke test**

Run: `rm -rf .next && bun run dev`
Open contract → Transactions → pick a collected row → ..., Uncollect → toast "Collection removed". Collected column should show $0 and status becomes Pending/Overdue. Pick a user-logged row → ..., Delete → confirm → row disappears.

- [ ] **Step 3: Commit**

```bash
git add components/contracts/contract-transactions.tsx
git commit -m "feat(contracts): W1.X-A wire Uncollect + Delete mutations"
```

---

### Task 5: UI — Edit dialog

**Files:**
- Modify: `components/contracts/contract-transactions.tsx`

- [ ] **Step 1: Add EditTransactionDialog component**

Place above `AddTransactionButtons`. It mirrors `TransactionDialog` but seeds state from an existing row and calls `updateContractTransaction` on submit. The dialog only supports rebate-collected editing in this iteration (the current ledger is all Rebate rows post-W1.P; credit/payment separation is a future expansion).

```tsx
function EditTransactionDialog({
  contractId,
  queryClient,
  row,
  open,
  onOpenChange,
}: {
  contractId: string
  queryClient: ReturnType<typeof useQueryClient>
  row: PeriodRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState("")
  const [quantity, setQuantity] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (!row) return
    setAmount(String(row.rebateCollected ?? 0))
    setDate(row.collectionDate ? row.collectionDate.slice(0, 10) : "")
    setQuantity("") // Quantity is not currently on PeriodRow; extend if needed.
    setNotes(row.notes ?? "")
  }, [row])

  async function handleSubmit() {
    if (!row) return
    const parsedAmount = parseFloat(amount.replace(/[^0-9.]/g, ""))
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      toast.error("Enter a valid amount")
      return
    }
    try {
      await updateContractTransaction({
        id: row.id,
        contractId,
        rebateCollected: parsedAmount,
        collectionDate: date || null,
        quantity: quantity ? parseFloat(quantity) : undefined,
        notes,
      })
      toast.success("Row updated")
      queryClient.invalidateQueries({ queryKey: ["contractRebates", contractId] })
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.detail(contractId) })
      onOpenChange(false)
    } catch {
      toast.error("Failed to update row")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Ledger Row</DialogTitle>
          <DialogDescription>
            Update amount, collection date, or notes. Earned amount is engine-owned and cannot be edited here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-amount">Collected Amount</Label>
            <Input id="edit-amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-date">Collection Date</Label>
            <Input id="edit-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-qty">Quantity</Label>
            <Input id="edit-qty" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notes</Label>
            <Input id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Wire it into ContractTransactions**

Add state:

```tsx
const [editRow, setEditRow] = useState<PeriodRow | null>(null)
```

Update `handleAction`:

```tsx
if (action === "edit") return setEditRow(row)
```

Render the dialog:

```tsx
<EditTransactionDialog
  contractId={contractId}
  queryClient={queryClient}
  row={editRow}
  open={editRow !== null}
  onOpenChange={(next) => { if (!next) setEditRow(null) }}
/>
```

- [ ] **Step 3: Smoke**

`bun run dev`. Pick a row → Edit → change amount + date → Save Changes. Toast appears; summary cards refresh; row reflects new values.

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add components/contracts/contract-transactions.tsx
git commit -m "feat(contracts): W1.X-A EditTransactionDialog wired to update action"
```

---

### Task 6: Full verify

- [ ] **Step 1: Typecheck + tests**

Run: `bunx tsc --noEmit && bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'`
Expected: zero tsc errors; all Vitest green.

- [ ] **Step 2: End-to-end smoke**

1. `rm -rf .next && bun run dev`
2. Open a contract → Transactions tab.
3. Edit a row: change amount → Save → confirm row + Collected card update.
4. Uncollect a row: pick a collected row → Uncollect → confirm Collection Date clears, Collected column $0, Status flips.
5. Delete a user-logged row: confirm it disappears.
6. Try to delete an `[auto-accrual]` row — menu should not show Delete; if you call the server action directly it errors.

- [ ] **Step 3: Final commit if there's housekeeping** (only if any non-task-3/4/5 edits were made during verification).

---

## Self-Review

**Spec coverage:**
- ✓ Edit dialog with amount/date/quantity/notes (Task 5)
- ✓ Uncollect path (Task 4)
- ✓ Delete blocked on auto-accrual (Task 2 + Task 3 UI guard)
- ✓ Server actions with requireFacility + contractOwnershipWhere (Tasks 1, 2)
- ✓ React Query invalidations matching createContractTransaction (Task 4)
- ✓ Tests for each action (Tasks 1, 2)
- ✓ Never edit rebateEarned (Task 1 — only whitelisted fields in `data`)

**Placeholders:** none.

**Type consistency:**
- `UpdateContractTransactionInput.collectionDate: string | null | undefined` — undefined means "don't touch", null means "uncollect". The explicit-undefined-vs-null distinction is preserved by the `if (input.collectionDate !== undefined)` guard in Task 1.
- `PeriodRow.notes?: string | null` — consistent use across Tasks 3 and 5.
- Action strings `"edit" | "uncollect" | "delete"` consistent between `onAction` prop (Task 3) and `handleAction` switch (Task 4).
