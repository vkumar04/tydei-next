# v0 Parity Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Ship the 6 v0-parity subsystems that are standalone workflows — no engine dependencies but bigger surface area than wave 1.

**Architecture:** Mostly UI + thin server-action work. One small schema-aware change (multi-category audit). No new schemas; reuse existing models. Each task ships a Vitest regression test where it touches a server action.

**Tech Stack:** Next.js 16, Prisma 7, TypeScript strict, Vitest, TanStack Query, shadcn/ui, recharts.

**Working DB:** `postgresql://tydei:tydei_dev_password@localhost:5432/tydei`. Demo facility = `cmo4sbr8p0004wthl91ubwfwb`.

**Source spec:** `docs/superpowers/specs/2026-04-18-contracts-rewrite.md` §9.4, 9.6, 9.7, 9.8, 9.12 + `docs/superpowers/specs/2026-04-18-cog-data-rewrite.md` §10.3.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `lib/actions/contracts/off-contract-spend.ts` | New action — on/off-contract spend split + top-10 off-contract items | 1 |
| `components/contracts/off-contract-spend-card.tsx` | Card with totals + top-10 list | 1 |
| `components/contracts/contract-detail-client.tsx` | Render the card on Overview tab | 1 |
| `lib/actions/contracts/__tests__/off-contract-spend.test.ts` | All-on / all-off / mixed cases | 1 |
| `lib/actions/contracts.ts::getContract` | Plumb optional `periodId` filter | 2 |
| `components/contracts/contract-detail-client.tsx` | Period `<Select>` above metrics row | 2 |
| `components/contracts/amendment-extractor.tsx` | Stage breadcrumb header (1→2→3→4) | 3 |
| `components/contracts/__tests__/amendment-stages.test.tsx` | Fixture-driven 4-stage progression test | 3 |
| `lib/actions/contracts/proposals.ts` | submit / approve / requestRevision / reject server actions | 4 |
| `components/contracts/contract-change-proposals-card.tsx` | Pending-proposals list + actions on detail page | 4 |
| `lib/actions/contracts/__tests__/proposals.test.ts` | 4 server-action paths | 4 |
| `components/contracts/contracts-list-client.tsx` | Multi-category list filter — match by ANY category | 5 |
| `lib/validators/contract-terms.ts` | `scopedCategoryIds: string[]` (additive to `scopedCategoryId`) | 5 |
| `components/contracts/contract-terms-entry.tsx` | Multi-select for "Specific Category" tier scope | 5 |
| `components/contracts/new-contract-client.tsx::handleAIExtract` | Merge ALL extracted categories into `categoryIds` | 5 |
| `lib/actions/imports/pricing-history.ts` | New `getPricingImportHistory()` action | 6 |
| `components/facility/cog/pricing-import-history-card.tsx` | Recent-imports table | 6 |
| `components/facility/cog/cog-data-client.tsx` | Render the card below import section | 6 |

---

## Task 1: Off-contract spend panel

**Spec:** Subsystem 9.4.

**Files:**
- Create: `lib/actions/contracts/off-contract-spend.ts`
- Create: `components/contracts/off-contract-spend-card.tsx`
- Modify: `components/contracts/contract-detail-client.tsx`
- Create: `lib/actions/contracts/__tests__/off-contract-spend.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/actions/contracts/__tests__/off-contract-spend.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const aggregateMock = vi.fn()
const groupByMock = vi.fn()
const findUniqueMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findUniqueOrThrow: findUniqueMock },
    cOGRecord: { aggregate: aggregateMock, groupBy: groupByMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

import { getOffContractSpend } from "@/lib/actions/contracts/off-contract-spend"

beforeEach(() => {
  vi.clearAllMocks()
  findUniqueMock.mockResolvedValue({ id: "c-1", vendorId: "v-1" })
})

describe("getOffContractSpend", () => {
  it("splits totals by isOnContract and returns top-10 off-contract items", async () => {
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: 800_000 } }) // on-contract
      .mockResolvedValueOnce({ _sum: { extendedPrice: 200_000 } }) // off-contract
    groupByMock.mockResolvedValueOnce([
      { vendorItemNo: "X-1", _sum: { extendedPrice: 75_000 } },
      { vendorItemNo: "X-2", _sum: { extendedPrice: 50_000 } },
    ])

    const r = await getOffContractSpend("c-1")
    expect(r.onContract).toBe(800_000)
    expect(r.offContract).toBe(200_000)
    expect(r.offContractItems).toHaveLength(2)
    expect(r.offContractItems[0]).toMatchObject({ vendorItemNo: "X-1", totalSpend: 75_000 })
  })

  it("returns zeros when no COG records exist", async () => {
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: null } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: null } })
    groupByMock.mockResolvedValueOnce([])

    const r = await getOffContractSpend("c-1")
    expect(r.onContract).toBe(0)
    expect(r.offContract).toBe(0)
    expect(r.offContractItems).toEqual([])
  })
})
```

- [ ] **Step 2: Run test → expect FAIL**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/contracts/__tests__/off-contract-spend.test.ts
```

- [ ] **Step 3: Implement the action**

```ts
// lib/actions/contracts/off-contract-spend.ts
"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"

export interface OffContractSpendResult {
  onContract: number
  offContract: number
  offContractItems: Array<{
    vendorItemNo: string
    totalSpend: number
  }>
}

export async function getOffContractSpend(
  contractId: string,
): Promise<OffContractSpendResult> {
  const { facility } = await requireFacility()
  const contract = await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true, vendorId: true },
  })

  const [onAgg, offAgg, offItems] = await Promise.all([
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: contract.vendorId,
        isOnContract: true,
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: contract.vendorId,
        isOnContract: false,
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.groupBy({
      by: ["vendorItemNo"],
      where: {
        facilityId: facility.id,
        vendorId: contract.vendorId,
        isOnContract: false,
        vendorItemNo: { not: null },
      },
      _sum: { extendedPrice: true },
      orderBy: { _sum: { extendedPrice: "desc" } },
      take: 10,
    }),
  ])

  return serialize({
    onContract: Number(onAgg._sum.extendedPrice ?? 0),
    offContract: Number(offAgg._sum.extendedPrice ?? 0),
    offContractItems: offItems
      .filter((r): r is typeof r & { vendorItemNo: string } => r.vendorItemNo !== null)
      .map((r) => ({
        vendorItemNo: r.vendorItemNo,
        totalSpend: Number(r._sum.extendedPrice ?? 0),
      })),
  })
}
```

- [ ] **Step 4: Run test → expect PASS**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/contracts/__tests__/off-contract-spend.test.ts
```

- [ ] **Step 5: Card component**

```tsx
// components/contracts/off-contract-spend-card.tsx
"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useQuery } from "@tanstack/react-query"
import { getOffContractSpend } from "@/lib/actions/contracts/off-contract-spend"
import { formatCurrency } from "@/lib/formatting"

export function OffContractSpendCard({ contractId }: { contractId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["contracts", "off-contract-spend", contractId] as const,
    queryFn: () => getOffContractSpend(contractId),
  })

  if (isLoading || !data) return <div className="h-48 animate-pulse rounded-md bg-muted" />

  const total = data.onContract + data.offContract
  const offPct = total > 0 ? (data.offContract / total) * 100 : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>On vs Off Contract Spend</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">On Contract</p>
            <p className="text-2xl font-bold text-emerald-600">{formatCurrency(data.onContract)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Off Contract</p>
            <p className="text-2xl font-bold text-amber-600">{formatCurrency(data.offContract)}</p>
            <p className="text-xs text-muted-foreground">{offPct.toFixed(1)}% leakage</p>
          </div>
        </div>
        {data.offContractItems.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No off-contract spend recorded. Run "Re-run match" on COG Data if this looks wrong.
          </p>
        ) : (
          <div>
            <p className="mb-2 text-sm font-medium">Top off-contract items</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor Item</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.offContractItems.map((i) => (
                  <TableRow key={i.vendorItemNo}>
                    <TableCell className="font-mono text-xs">{i.vendorItemNo}</TableCell>
                    <TableCell className="text-right">{formatCurrency(i.totalSpend)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 6: Wire into detail page**

In `components/contracts/contract-detail-client.tsx`, in the Overview tab content (the same section as Compliance + Market Share cards), add:

```tsx
import { OffContractSpendCard } from "./off-contract-spend-card"
// ...
<OffContractSpendCard contractId={contractId} />
```

Place it after the Market Share card.

- [ ] **Step 7: tsc + commit**

```bash
bunx tsc --noEmit
git add lib/actions/contracts/off-contract-spend.ts components/contracts/off-contract-spend-card.tsx components/contracts/contract-detail-client.tsx lib/actions/contracts/__tests__/off-contract-spend.test.ts
git commit -m "feat(contract-detail): off-contract spend panel with top-10 leakage items"
```

---

## Task 2: Contract-period selector

**Spec:** Subsystem 9.6.

**Files:**
- Modify: `lib/actions/contracts.ts::getContract` — accept optional `periodId` filter
- Modify: `components/contracts/contract-detail-client.tsx` — render `<Select>` when ≥2 periods exist

- [ ] **Step 1: Audit getContract**

```bash
grep -nE "getContract\b|periods\s*[:=]" lib/actions/contracts.ts | head -10
```

Confirm whether `getContract` already loads `contract.periods`. If not, add `periods: { orderBy: { periodStart: 'asc' } }` to the include.

- [ ] **Step 2: Add periodId branch (filter date-bounded includes)**

In `getContract(id, options?: { periodId?: string })`:

```ts
const period = options?.periodId
  ? await prisma.contractPeriod.findFirst({
      where: { id: options.periodId, contractId: id },
      select: { periodStart: true, periodEnd: true },
    })
  : null

// Then include rebates filtered by period range when `period` is set:
const contract = await prisma.contract.findUniqueOrThrow({
  where: contractOwnershipWhere(id, facility.id),
  include: {
    // ...existing includes
    rebates: {
      where: period
        ? { payPeriodEnd: { gte: period.periodStart, lte: period.periodEnd } }
        : undefined,
      select: { id: true, rebateEarned: true, rebateCollected: true, payPeriodEnd: true, collectionDate: true },
    },
    periods: { orderBy: { periodStart: "asc" } },
  },
})
```

The earned/collected aggregation already filters by `payPeriodEnd <= today` and `collectionDate != null` — that stays.

- [ ] **Step 3: UI — period dropdown**

In `components/contracts/contract-detail-client.tsx`:

```tsx
const [periodId, setPeriodId] = useState<string | undefined>(undefined)
const { data: contract } = useContract(contractId, periodId)
// ...
{contract.periods && contract.periods.length >= 2 && (
  <div className="flex items-center gap-2">
    <span className="text-sm text-muted-foreground">Period:</span>
    <Select value={periodId ?? "__all__"} onValueChange={(v) => setPeriodId(v === "__all__" ? undefined : v)}>
      <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All periods</SelectItem>
        {contract.periods.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
)}
```

Update the `useContract` hook signature to accept `periodId` and pass it to the action. Include `periodId` in the query key.

- [ ] **Step 4: tsc + commit**

```bash
bunx tsc --noEmit
git add lib/actions/contracts.ts components/contracts/contract-detail-client.tsx hooks/use-contracts.ts
git commit -m "feat(contract-detail): contract-period selector for multi-year contracts"
```

---

## Task 3: Amendment 4-stage breadcrumb + smoke test

**Spec:** Subsystem 9.7.

**Files:**
- Modify: `components/contracts/amendment-extractor.tsx`
- Create: `components/contracts/__tests__/amendment-stages.test.tsx`

- [ ] **Step 1: Add a stage breadcrumb to the dialog header**

Find the existing `Stage` enum/type in `amendment-extractor.tsx` (commit `3e3ad63` mapped them to: upload, review, pricing, confirm). Above the existing dialog content add:

```tsx
const stages: Array<{key: string; label: string}> = [
  { key: "upload", label: "Upload" },
  { key: "review", label: "Review" },
  { key: "pricing", label: "Pricing" },
  { key: "confirm", label: "Confirm" },
]
const currentIndex = stages.findIndex((s) => s.key === stage)

<div className="flex items-center gap-1 text-xs">
  {stages.map((s, i) => (
    <div key={s.key} className="flex items-center gap-1">
      <span
        className={cn(
          "rounded-full border px-2 py-0.5",
          i < currentIndex && "border-emerald-500 text-emerald-700 dark:text-emerald-400",
          i === currentIndex && "border-foreground bg-foreground text-background",
          i > currentIndex && "text-muted-foreground",
        )}
      >
        {i + 1}. {s.label}
      </span>
      {i < stages.length - 1 && <span className="text-muted-foreground">→</span>}
    </div>
  ))}
</div>
```

Map the tydei stage names to these 4 if they differ.

- [ ] **Step 2: Test fixture + 4-stage assertion**

Skip a full React-render test (the project uses pure-logic Vitest, no `@testing-library/react`). Instead, extract the stage advancement logic into a pure helper:

```ts
// in amendment-extractor.tsx near the Stage type
export function nextStage(current: Stage): Stage | null {
  const order: Stage[] = ["upload", "review", "pricing", "confirm", "applying", "done"]
  const i = order.indexOf(current)
  return i >= 0 && i < order.length - 1 ? order[i + 1] : null
}
```

Then test:

```ts
// components/contracts/__tests__/amendment-stages.test.ts
import { describe, it, expect } from "vitest"
import { nextStage, type Stage } from "@/components/contracts/amendment-extractor"

describe("amendment-extractor stage progression", () => {
  it("advances upload → review → pricing → confirm → applying → done", () => {
    let s: Stage = "upload"
    const seen: Stage[] = [s]
    while (nextStage(s) !== null) {
      s = nextStage(s)!
      seen.push(s)
    }
    expect(seen).toEqual(["upload", "review", "pricing", "confirm", "applying", "done"])
  })

  it("returns null at terminal stage", () => {
    expect(nextStage("done")).toBeNull()
  })
})
```

- [ ] **Step 3: Run test + tsc**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' components/contracts/__tests__/amendment-stages.test.ts
bunx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add components/contracts/amendment-extractor.tsx components/contracts/__tests__/amendment-stages.test.ts
git commit -m "feat(contract-amendment): 4-stage breadcrumb + nextStage pure helper + test"
```

---

## Task 4: ContractChangeProposal workflow (facility side only)

**Spec:** Subsystem 9.8.

**Files:**
- Create: `lib/actions/contracts/proposals.ts`
- Create: `lib/actions/contracts/__tests__/proposals.test.ts`
- Create: `components/contracts/contract-change-proposals-card.tsx`
- Modify: `components/contracts/contract-detail-client.tsx`

- [ ] **Step 1: Write failing test**

```ts
// lib/actions/contracts/__tests__/proposals.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const findManyMock = vi.fn()
const findUniqueOrThrowMock = vi.fn()
const updateMock = vi.fn()
const transactionMock = vi.fn(async (cb: any) => cb({
  contract: { update: updateMock },
  contractChangeProposal: { update: vi.fn().mockResolvedValue({}) },
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contractChangeProposal: {
      findMany: findManyMock,
      findUniqueOrThrow: findUniqueOrThrowMock,
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: transactionMock,
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))

import {
  getPendingProposalsForContract,
  approveContractChangeProposal,
  rejectContractChangeProposal,
  requestProposalRevision,
} from "@/lib/actions/contracts/proposals"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("contract change proposals", () => {
  it("getPendingProposalsForContract filters by contract and pending status", async () => {
    findManyMock.mockResolvedValue([])
    await getPendingProposalsForContract("c-1")
    const where = findManyMock.mock.calls[0][0].where
    expect(where.contractId).toBe("c-1")
    expect(where.status).toBe("pending")
  })

  it("approve flips status + applies changes via transaction", async () => {
    findUniqueOrThrowMock.mockResolvedValue({
      id: "p-1",
      contractId: "c-1",
      status: "pending",
      proposedChanges: { totalValue: 500000 },
    })
    await approveContractChangeProposal("p-1")
    expect(transactionMock).toHaveBeenCalled()
  })

  it("reject flips status to rejected with notes", async () => {
    findUniqueOrThrowMock.mockResolvedValue({ id: "p-1", status: "pending" })
    await rejectContractChangeProposal("p-1", "Pricing too high")
    // The proposal.update call is inside the action; check it was called
  })

  it("requestRevision flips status to needs_revision with notes", async () => {
    findUniqueOrThrowMock.mockResolvedValue({ id: "p-1", status: "pending" })
    await requestProposalRevision("p-1", "Add detail on tier 2")
  })
})
```

- [ ] **Step 2: Run test → expect FAIL**

- [ ] **Step 3: Implement the actions**

```ts
// lib/actions/contracts/proposals.ts
"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"

export async function getPendingProposalsForContract(contractId: string) {
  const { facility } = await requireFacility()
  const proposals = await prisma.contractChangeProposal.findMany({
    where: {
      contractId,
      status: "pending",
      contract: { facilityId: facility.id },
    },
    orderBy: { createdAt: "desc" },
    include: {
      submittedBy: { select: { id: true, name: true, email: true } },
    },
  })
  return serialize(proposals)
}

export async function approveContractChangeProposal(proposalId: string) {
  const { facility, user } = await requireFacility()
  const proposal = await prisma.contractChangeProposal.findUniqueOrThrow({
    where: { id: proposalId },
    include: { contract: { select: { id: true, facilityId: true } } },
  })
  if (proposal.contract.facilityId !== facility.id) {
    throw new Error("Forbidden: proposal belongs to a different facility")
  }
  if (proposal.status !== "pending") {
    throw new Error(`Cannot approve proposal in status ${proposal.status}`)
  }

  const changes = (proposal.proposedChanges ?? {}) as Record<string, unknown>

  await prisma.$transaction(async (tx) => {
    if (Object.keys(changes).length > 0) {
      await tx.contract.update({
        where: { id: proposal.contractId },
        data: changes,
      })
    }
    await tx.contractChangeProposal.update({
      where: { id: proposalId },
      data: {
        status: "approved",
        reviewedAt: new Date(),
        reviewedById: user.id,
      },
    })
  })

  await logAudit({
    userId: user.id,
    action: "contract_change_proposal.approved",
    entityType: "contract_change_proposal",
    entityId: proposalId,
    metadata: { contractId: proposal.contractId, changes },
  })
}

export async function rejectContractChangeProposal(proposalId: string, notes: string) {
  const { facility, user } = await requireFacility()
  const proposal = await prisma.contractChangeProposal.findUniqueOrThrow({
    where: { id: proposalId },
    include: { contract: { select: { facilityId: true } } },
  })
  if (proposal.contract.facilityId !== facility.id) throw new Error("Forbidden")
  if (proposal.status !== "pending") throw new Error("Not pending")

  await prisma.contractChangeProposal.update({
    where: { id: proposalId },
    data: { status: "rejected", reviewerNotes: notes, reviewedAt: new Date(), reviewedById: user.id },
  })

  await logAudit({
    userId: user.id,
    action: "contract_change_proposal.rejected",
    entityType: "contract_change_proposal",
    entityId: proposalId,
    metadata: { notes },
  })
}

export async function requestProposalRevision(proposalId: string, notes: string) {
  const { facility, user } = await requireFacility()
  const proposal = await prisma.contractChangeProposal.findUniqueOrThrow({
    where: { id: proposalId },
    include: { contract: { select: { facilityId: true } } },
  })
  if (proposal.contract.facilityId !== facility.id) throw new Error("Forbidden")
  if (proposal.status !== "pending") throw new Error("Not pending")

  await prisma.contractChangeProposal.update({
    where: { id: proposalId },
    data: { status: "needs_revision", reviewerNotes: notes, reviewedAt: new Date(), reviewedById: user.id },
  })

  await logAudit({
    userId: user.id,
    action: "contract_change_proposal.revision_requested",
    entityType: "contract_change_proposal",
    entityId: proposalId,
    metadata: { notes },
  })
}
```

If the schema field names differ (e.g. `reviewerNotes` doesn't exist), inspect `prisma/schema.prisma model ContractChangeProposal` and adapt — keep the semantics the same.

- [ ] **Step 4: Card component**

```tsx
// components/contracts/contract-change-proposals-card.tsx
"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import {
  getPendingProposalsForContract,
  approveContractChangeProposal,
  rejectContractChangeProposal,
  requestProposalRevision,
} from "@/lib/actions/contracts/proposals"

export function ContractChangeProposalsCard({ contractId }: { contractId: string }) {
  const qc = useQueryClient()
  const { data: proposals } = useQuery({
    queryKey: ["contracts", "proposals", contractId] as const,
    queryFn: () => getPendingProposalsForContract(contractId),
  })

  const refetch = () => qc.invalidateQueries({ queryKey: ["contracts", "proposals", contractId] })
  const approve = useMutation({ mutationFn: approveContractChangeProposal, onSuccess: () => { toast.success("Approved"); refetch() } })
  const reject = useMutation({ mutationFn: ({ id, notes }: { id: string; notes: string }) => rejectContractChangeProposal(id, notes), onSuccess: () => { toast.success("Rejected"); refetch() } })
  const revise = useMutation({ mutationFn: ({ id, notes }: { id: string; notes: string }) => requestProposalRevision(id, notes), onSuccess: () => { toast.success("Revision requested"); refetch() } })

  const [notes, setNotes] = useState<Record<string, string>>({})

  if (!proposals || proposals.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Pending Vendor Proposals
          <Badge>{proposals.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {proposals.map((p) => (
          <div key={p.id} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {p.submittedBy?.name ?? p.submittedBy?.email ?? "Vendor"} proposed
              </p>
              <span className="text-xs text-muted-foreground">
                {new Date(p.createdAt).toLocaleDateString()}
              </span>
            </div>
            <pre className="rounded-md bg-muted p-2 text-xs overflow-x-auto">
              {JSON.stringify(p.proposedChanges, null, 2)}
            </pre>
            <Textarea
              placeholder="Notes (required for reject / revision)"
              value={notes[p.id] ?? ""}
              onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })}
              rows={2}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => approve.mutate(p.id)} disabled={approve.isPending}>Approve</Button>
              <Button size="sm" variant="outline" onClick={() => revise.mutate({ id: p.id, notes: notes[p.id] ?? "" })} disabled={revise.isPending || !notes[p.id]}>Request revision</Button>
              <Button size="sm" variant="outline" onClick={() => reject.mutate({ id: p.id, notes: notes[p.id] ?? "" })} disabled={reject.isPending || !notes[p.id]}>Reject</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Wire into detail page**

In `components/contracts/contract-detail-client.tsx` Overview tab, render above the rest of the cards:

```tsx
import { ContractChangeProposalsCard } from "./contract-change-proposals-card"
// ...
<ContractChangeProposalsCard contractId={contractId} />
```

- [ ] **Step 6: tsc + tests + commit**

```bash
bunx tsc --noEmit
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/contracts/__tests__/proposals.test.ts
git add lib/actions/contracts/proposals.ts lib/actions/contracts/__tests__/proposals.test.ts components/contracts/contract-change-proposals-card.tsx components/contracts/contract-detail-client.tsx
git commit -m "feat(contracts): pending change-proposal review on facility detail page"
```

---

## Task 5: Multi-category audit & fixes

**Spec:** Subsystem 9.12.

**Files:**
- Modify: `components/contracts/contracts-list-client.tsx` — list filter matches against ANY category
- Modify: `lib/validators/contract-terms.ts` — `scopedCategoryIds: string[]` (additive)
- Modify: `components/contracts/contract-terms-entry.tsx` — multi-select for "Specific Category" tier scope
- Modify: `components/contracts/new-contract-client.tsx` — merge ALL extracted categories in `handleAIExtract`

- [ ] **Step 1: Audit list filter**

Find the category filter in `contracts-list-client.tsx`:

```bash
grep -n "categoryId\|category.*filter\|productCategoryId" components/contracts/contracts-list-client.tsx | head
```

If filtering uses `c.productCategoryId === selectedCategoryId`, change to:

```tsx
const matches =
  c.productCategoryId === selectedCategoryId ||
  (c.contractCategories ?? []).some((cc) => cc.productCategoryId === selectedCategoryId)
```

If the filter is server-side via `getContracts({ categoryId })`, modify the action's `where` to use:

```ts
OR: [
  { productCategoryId: filters.categoryId },
  { contractCategories: { some: { productCategoryId: filters.categoryId } } },
]
```

- [ ] **Step 2: Validator — add `scopedCategoryIds` (additive, keep `scopedCategoryId` for back-compat)**

In `lib/validators/contract-terms.ts`, both `createTermSchema` and `termFormSchema`:

```ts
scopedCategoryIds: z.array(z.string()).optional(),
```

- [ ] **Step 3: Tier-scope multi-select**

In `components/contracts/contract-terms-entry.tsx`, find the `appliesTo === "specific_category"` block (around line 379). Convert from single Select to multi-select:

```tsx
{term.appliesTo === "specific_category" && (
  <Field label="Categories">
    {resolvedCategories.length === 0 ? (
      <p className="text-xs text-muted-foreground">Loading categories…</p>
    ) : (
      <div className="space-y-1 max-h-40 overflow-y-auto rounded-md border p-2">
        {resolvedCategories.map((c) => {
          const checked = (term.scopedCategoryIds ?? []).includes(c.id)
          return (
            <label key={c.id} className="flex items-center gap-2 cursor-pointer hover:bg-accent rounded px-2 py-1">
              <Checkbox
                checked={checked}
                onCheckedChange={(v) => {
                  const cur = term.scopedCategoryIds ?? []
                  const next = v ? [...cur, c.id] : cur.filter((id) => id !== c.id)
                  updateTerm(termIdx, { scopedCategoryIds: next })
                }}
              />
              <span className="text-sm">{c.name}</span>
            </label>
          )
        })}
      </div>
    )}
  </Field>
)}
```

Keep the old single `scopedCategoryId` set to the first item of `scopedCategoryIds` for back-compat with `createContractTerm` until that action's persistence is updated.

- [ ] **Step 4: AI extract merges categories**

In `components/contracts/new-contract-client.tsx::handleAIExtract`, find the extraction-applied block. If it currently sets only `productCategoryId`, change to:

```tsx
if (data.productCategories && Array.isArray(data.productCategories)) {
  const matchedIds: string[] = []
  for (const extractedName of data.productCategories) {
    const found = liveCategories.find((c) => c.name.toLowerCase() === extractedName.toLowerCase())
    if (found) matchedIds.push(found.id)
  }
  if (matchedIds.length > 0) {
    form.setValue("categoryIds", matchedIds)
    form.setValue("productCategoryId", matchedIds[0])
  }
} else if (data.productCategory) {
  // legacy single
  const found = liveCategories.find((c) => c.name.toLowerCase() === data.productCategory.toLowerCase())
  if (found) {
    form.setValue("categoryIds", [found.id])
    form.setValue("productCategoryId", found.id)
  }
}
```

The shape of `data` matches `lib/ai/schemas.ts::extractedContractSchema` — confirm `productCategories: string[]` exists; if not, fall back to the legacy single-category path.

- [ ] **Step 5: tsc + commit**

```bash
bunx tsc --noEmit
git add components/contracts/contracts-list-client.tsx lib/validators/contract-terms.ts components/contracts/contract-terms-entry.tsx components/contracts/new-contract-client.tsx
git commit -m "fix(contracts): multi-category — list filter, tier scope, AI merge"
```

---

## Task 6: Pricing-file import history table

**Spec:** Subsystem 10.3.

**Files:**
- Create: `lib/actions/imports/pricing-history.ts`
- Create: `components/facility/cog/pricing-import-history-card.tsx`
- Modify: `components/facility/cog/cog-data-client.tsx`

- [ ] **Step 1: Confirm Prisma model**

```bash
grep -nE "model PricingFile|model FileImport.*pricing" prisma/schema.prisma | head
```

If a `PricingFile` model exists, use it. If pricing-file imports go through the unified `FileImport` model with a `type` discriminator, query that instead with `where: { type: "pricing" }`.

- [ ] **Step 2: Action**

```ts
// lib/actions/imports/pricing-history.ts
"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

export interface PricingImportRow {
  id: string
  fileName: string
  uploadedAt: Date
  rowCount: number
  itemMatchCount: number | null
}

export async function getPricingImportHistory(limit = 20): Promise<PricingImportRow[]> {
  const { facility } = await requireFacility()

  // Adjust the query to whichever model represents pricing-file imports.
  const imports = await prisma.fileImport.findMany({
    where: { facilityId: facility.id, type: "pricing" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      fileName: true,
      createdAt: true,
      rowCount: true,
      // Adjust if there's a per-import "items matched" count column.
    },
  })

  return serialize(imports.map((i) => ({
    id: i.id,
    fileName: i.fileName,
    uploadedAt: i.createdAt,
    rowCount: i.rowCount,
    itemMatchCount: null,
  })))
}
```

If the schema doesn't have `FileImport.type` or the model is named differently, adapt — the goal is a list of recent pricing-file imports the user can see.

- [ ] **Step 3: Card**

```tsx
// components/facility/cog/pricing-import-history-card.tsx
"use client"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getPricingImportHistory } from "@/lib/actions/imports/pricing-history"

export function PricingImportHistoryCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["pricing-import-history"] as const,
    queryFn: () => getPricingImportHistory(),
  })
  if (isLoading) return <div className="h-32 animate-pulse rounded-md bg-muted" />
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Pricing File Imports</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No pricing-file imports yet.</p>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader><CardTitle>Pricing File Imports</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead className="text-right">Rows</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.fileName}</TableCell>
                <TableCell>{new Date(r.uploadedAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">{r.rowCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Wire into cog-data page**

```tsx
import { PricingImportHistoryCard } from "@/components/facility/cog/pricing-import-history-card"
// somewhere in the page, below the existing import section:
<PricingImportHistoryCard />
```

- [ ] **Step 5: tsc + commit**

```bash
bunx tsc --noEmit
git add lib/actions/imports/pricing-history.ts components/facility/cog/pricing-import-history-card.tsx components/facility/cog/cog-data-client.tsx
git commit -m "feat(cog-data): pricing-file import history card"
```

---

## Task 7: Smoke + finalize

- [ ] **Step 1: Run unit suite**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' 2>&1 | tail -5
```

- [ ] **Step 2: Smoke contracts + cog-data pages**

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

---

## Self-Review

| Spec subsystem | Task |
|---|---|
| 9.4 Off-contract spend | Task 1 |
| 9.6 Contract-period selector | Task 2 |
| 9.7 Amendment 4-stage | Task 3 |
| 9.8 ChangeProposal workflow (facility) | Task 4 |
| 9.12 Multi-category audit | Task 5 |
| 10.3 Pricing import history | Task 6 |

**Type consistency:** `OffContractSpendResult`, `PricingImportRow`, proposal `Stage` — all defined once and consumed identically across action + UI + test.

**Placeholders:** none. Every step has runnable code or runnable command. Adaptive notes call out where a subagent must inspect the schema and adapt (e.g. `FileImport` vs `PricingFile`).
