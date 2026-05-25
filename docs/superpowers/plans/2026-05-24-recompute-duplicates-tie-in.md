# Recompute duplicates on tie-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix bug #16. Recompute Earned Rebates on tie-in contracts must be idempotent — every click produces the same final ledger state, not duplicates.

**Architecture:** Add an `isTieIn: boolean` parameter to every dispatcher in `lib/contracts/recompute/`. Each dispatcher's `deleteMany` filter drops the `collectionDate: null` clause when `isTieIn === true`. The main spend-writer flow in `recompute-accrual.ts` does the same for its own pre-delete and the future-row purge. The auto-stamped collection on tie-in rows still happens at insert; it just no longer protects them from deletion on next Recompute.

**Spec:** `docs/superpowers/specs/2026-05-24-recompute-duplicates-tie-in-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/actions/contracts/recompute-accrual.ts` | Modify | Add `isTieIn` local; drop `collectionDate: null` from the 2 own delete filters when tie-in; thread `isTieIn` into each dispatcher call |
| `lib/contracts/recompute/threshold.ts` | Modify | Accept `isTieIn?: boolean`; conditional delete filter |
| `lib/contracts/recompute/volume.ts` | Modify | Same, both entry points |
| `lib/contracts/recompute/po.ts` | Modify | Same |
| `lib/contracts/recompute/invoice.ts` | Modify | Same |
| `lib/contracts/recompute/carve-out.ts` | Modify | Same, both entry points |
| `lib/actions/contracts/__tests__/recompute-accrual-idempotent-tie-in.test.ts` | Create | Regression guard |

---

## Task 1: Failing idempotency test

**Files:**
- Create: `lib/actions/contracts/__tests__/recompute-accrual-idempotent-tie-in.test.ts`

- [ ] **Step 1: Write the failing test**

This test uses an end-to-end-style Prisma mock that stores rows in an in-memory array so two consecutive `recomputeAccrualForContract` calls operate on persisted state.

```ts
/**
 * Bug #16 (2026-05-24): Recompute Earned Rebates on tie-in contracts
 * must be idempotent. Pre-fix, every Recompute click on a tie-in
 * contract appended new rows because the auto-stamped collectionDate
 * (set by autoStampCollectionForTieIn) made every auto-accrual row
 * look "user-collected" to the delete filter (collectionDate: null),
 * so nothing was wiped before re-inserting.
 *
 * Strategy: stub prisma.rebate as an in-memory store so two calls to
 * recompute build state. Assert the row count from call #2 matches
 * call #1, and that no (payPeriodStart, payPeriodEnd) pair repeats.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

type RebateRow = {
  id: string
  contractId: string
  facilityId: string
  rebateEarned: number
  rebateCollected: number
  payPeriodStart: Date
  payPeriodEnd: Date
  collectionDate: Date | null
  notes: string
  engineVersion: string
  engineWarnings: string | null
}

let rebateStore: RebateRow[] = []
let nextId = 1
const contractRow = {
  id: "contract-tie-in-1",
  facilityId: "fac-1",
  name: "Test Tie-In",
  contractType: "tie_in",
  vendorId: "vendor-1",
  effectiveDate: new Date("2023-01-01T00:00:00Z"),
  expirationDate: new Date("2030-12-31T00:00:00Z"),
  currentMarketShare: null,
  complianceRate: null,
  capitalLineItems: [{ paymentCadence: "monthly" }],
  productCategory: null,
  terms: [
    {
      id: "term-1",
      termName: "Spend Rebate",
      termType: "spend_rebate",
      rebateMethod: "cumulative",
      evaluationPeriod: "annual",
      effectiveStart: new Date("2023-01-01T00:00:00Z"),
      effectiveEnd: null,
      appliesTo: "all_products",
      categories: [],
      spendBaseline: null,
      baselineType: null,
      cptCodes: [],
      volumeType: null,
      tiers: [
        {
          tierNumber: 1,
          tierName: null,
          spendMin: 0,
          spendMax: null,
          rebateValue: 0.03,
          rebateType: "percent_of_spend",
        },
      ],
    },
  ],
}

const cogRecords = [
  // ~$500k in 2023, $500k in 2024 — two completed annual windows.
  { transactionDate: new Date("2023-06-15T00:00:00Z"), extendedPrice: 500_000, category: null },
  { transactionDate: new Date("2024-06-15T00:00:00Z"), extendedPrice: 500_000, category: null },
]

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUnique: vi.fn(async () => contractRow),
      findMany: vi.fn(async () => []),
    },
    rebate: {
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const before = rebateStore.length
        rebateStore = rebateStore.filter((r) => {
          if (where.contractId && r.contractId !== where.contractId) return true
          const notes = where.notes as { startsWith?: string } | undefined
          if (notes?.startsWith && !r.notes.startsWith(notes.startsWith)) return true
          if ("collectionDate" in where && where.collectionDate === null) {
            if (r.collectionDate !== null) return true
          }
          if (where.payPeriodEnd && typeof where.payPeriodEnd === "object") {
            const filter = where.payPeriodEnd as { gt?: Date }
            if (filter.gt && r.payPeriodEnd <= filter.gt) return true
          }
          return false
        })
        return { count: before - rebateStore.length }
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return rebateStore.filter((r) => {
          if (where.contractId && r.contractId !== where.contractId) return false
          const notes = where.notes as { startsWith?: string } | undefined
          if (notes?.startsWith && !r.notes.startsWith(notes.startsWith)) return false
          if (where.collectionDate && typeof where.collectionDate === "object") {
            const filter = where.collectionDate as { not?: null }
            if ("not" in filter && filter.not === null && r.collectionDate === null) return false
          }
          return true
        })
      }),
      createMany: vi.fn(async ({ data }: { data: Omit<RebateRow, "id">[] }) => {
        for (const row of data) {
          rebateStore.push({ id: String(nextId++), ...row })
        }
        return { count: data.length }
      }),
      aggregate: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const matched = rebateStore.filter((r) => {
          if (where.contractId && r.contractId !== where.contractId) return false
          const notes = where.notes as { startsWith?: string } | undefined
          if (notes?.startsWith && !r.notes.startsWith(notes.startsWith)) return false
          return true
        })
        return { _sum: { rebateEarned: matched.reduce((s, r) => s + r.rebateEarned, 0) } }
      }),
    },
    cOGRecord: {
      findMany: vi.fn(async () => cogRecords),
      groupBy: vi.fn(async () => []),
    },
    contractPricing: {
      count: vi.fn(async () => 0),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1", name: "Test" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string) => ({ id, facilityId: "fac-1" }),
}))

describe("recomputeAccrualForContract — tie-in idempotency", () => {
  beforeEach(() => {
    rebateStore = []
    nextId = 1
  })

  it("emits the same row count on two consecutive calls (no duplicates)", async () => {
    const { recomputeAccrualForContract } = await import(
      "@/lib/actions/contracts/recompute-accrual"
    )

    const first = await recomputeAccrualForContract("contract-tie-in-1")
    const firstStoreSize = rebateStore.length

    const second = await recomputeAccrualForContract("contract-tie-in-1")
    const secondStoreSize = rebateStore.length

    // Idempotent: store size after run #2 must equal run #1.
    expect(secondStoreSize).toBe(firstStoreSize)

    // And no (start, end) pair repeats.
    const keys = rebateStore.map(
      (r) => `${r.payPeriodStart.toISOString()}|${r.payPeriodEnd.toISOString()}`,
    )
    const uniqueKeys = new Set(keys)
    expect(uniqueKeys.size).toBe(keys.length)

    // Sanity: both runs reported the same sumEarned.
    expect(second.sumEarned).toBe(first.sumEarned)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/vickkumar/code/tydei-next/.claude/worktrees/agent-cluster-f
bunx vitest run lib/actions/contracts/__tests__/recompute-accrual-idempotent-tie-in.test.ts
```
Expected: FAIL — `secondStoreSize` is twice (or more than) `firstStoreSize` because the delete filter preserves the auto-stamped rows.

---

## Task 2: Fix the main spend-writer + future-purge in `recompute-accrual.ts`

**Files:**
- Modify: `lib/actions/contracts/recompute-accrual.ts`

- [ ] **Step 1: Add the `isTieIn` local right after the contract load**

After the existing `const autoStampCollectionForTieIn = contract.contractType === "tie_in"` declaration around line 560, no new declaration is needed — that boolean already exists. But it's declared too late in the file (after the deletes). MOVE the declaration to immediately after the `if (!contract) { ... }` early-return block (around line 137), so all three delete sites can reference it.

Concretely, after the `if (!contract)` block, add:

```ts
// Charles 2026-05-24 (Bug #16): tie-in contracts auto-stamp
// collectionDate on every auto-accrual row (see line 586). The
// delete filters below normally preserve rows with a non-null
// collectionDate (user-logged collections), but tie-in has no
// user-collection workflow — every "collected" row is system-
// stamped. So drop the collectionDate gate when tie-in; otherwise
// every Recompute click adds duplicate rows that survive forever.
const isTieIn = contract.contractType === "tie_in"
const preserveUserCollections = !isTieIn
```

Then DELETE the redeclaration of `autoStampCollectionForTieIn` later in the file (around line 560) and rename it to `isTieIn` in the two `autoStampCollectionForTieIn ? ... : ...` ternaries around lines 583 and 586.

- [ ] **Step 2: Update the future-purge delete (line 187-196)**

Replace:

```ts
await prisma.rebate.deleteMany({
  where: {
    contractId,
    notes: { startsWith: AUTO_ACCRUAL_PREFIX },
    payPeriodEnd: { gt: now },
    collectionDate: null,
  },
})
```

with:

```ts
await prisma.rebate.deleteMany({
  where: {
    contractId,
    notes: { startsWith: AUTO_ACCRUAL_PREFIX },
    payPeriodEnd: { gt: now },
    // Bug #16: drop the collectionDate gate on tie-in so auto-
    // stamped future rows actually get purged.
    ...(preserveUserCollections ? { collectionDate: null } : {}),
  },
})
```

- [ ] **Step 3: Update the main pre-delete (line 207-213)**

Replace:

```ts
const deleteResult = await prisma.rebate.deleteMany({
  where: {
    contractId,
    notes: { startsWith: AUTO_ACCRUAL_PREFIX },
    collectionDate: null,
  },
})
```

with:

```ts
const deleteResult = await prisma.rebate.deleteMany({
  where: {
    contractId,
    notes: { startsWith: AUTO_ACCRUAL_PREFIX },
    ...(preserveUserCollections ? { collectionDate: null } : {}),
  },
})
```

- [ ] **Step 4: Pass `isTieIn` into every dispatcher invocation**

For each `recompute*ForTerm` call inside `recomputeAccrualForContract` (volume at line 699, po at line 747, carveOut at line 789, invoice at line 829, threshold at line 957), add `isTieIn` to the params object. Example for threshold (around line 957):

```ts
const r = await recomputeThresholdAccrualForTerm({
  contractId,
  facilityId: facilityId,
  contractEffectiveDate: contract.effectiveDate,
  contractExpirationDate: contract.expirationDate,
  metric,
  metricValue,
  isTieIn,           // ← new
  term: { ... },
})
```

Repeat for the other four dispatcher calls.

- [ ] **Step 5: Run typecheck**

Run: `bunx tsc --noEmit 2>&1 | head -30`
Expected: at this point typecheck will FAIL because the dispatcher signatures don't yet accept `isTieIn`. That's expected — Task 3 adds the param to each dispatcher. Don't commit until Task 3 is done.

---

## Task 3: Add `isTieIn` to each dispatcher

**Files:**
- Modify: `lib/contracts/recompute/threshold.ts`
- Modify: `lib/contracts/recompute/volume.ts`
- Modify: `lib/contracts/recompute/po.ts`
- Modify: `lib/contracts/recompute/invoice.ts`
- Modify: `lib/contracts/recompute/carve-out.ts`

For each file, do exactly these two edits:

- [ ] **Step 1: Add `isTieIn?: boolean` to the input type**

Find the function signature (look for `export async function recompute*ForTerm`). Add `isTieIn?: boolean` to the input type. Document:

```ts
/**
 * Bug #16 (2026-05-24): when the parent contract is tie-in, every
 * auto-accrual row is system-stamped with collectionDate = periodEnd
 * (no user-collect workflow exists for tie-in). Set this true so the
 * delete filter wipes ALL auto-accrual rows for this term — not just
 * uncollected ones. Without this, Recompute is non-idempotent.
 */
isTieIn?: boolean
```

- [ ] **Step 2: Update the `deleteMany` filter**

Find the `prisma.rebate.deleteMany` call (one per file except `volume.ts` and `carve-out.ts` which have two each). Change:

```ts
await prisma.rebate.deleteMany({
  where: {
    contractId,
    collectionDate: null,
    notes: { startsWith: termPrefix },
  },
})
```

to:

```ts
await prisma.rebate.deleteMany({
  where: {
    contractId,
    notes: { startsWith: termPrefix },
    // Bug #16: tie-in contracts auto-stamp collectionDate, so the
    // collectionDate=null gate would never match. Drop the gate when
    // the parent contract is tie-in.
    ...(isTieIn ? {} : { collectionDate: null }),
  },
})
```

- [ ] **Step 3: After all five dispatchers + both volume/carve-out entry points are updated, run typecheck**

```bash
bunx tsc --noEmit 2>&1 | head -10
```
Expected: 0 errors.

- [ ] **Step 4: Run the failing test from Task 1**

```bash
bunx vitest run lib/actions/contracts/__tests__/recompute-accrual-idempotent-tie-in.test.ts
```
Expected: PASS.

- [ ] **Step 5: Run the full recompute-accrual test suite to confirm no regressions**

```bash
bunx vitest run lib/actions/contracts/__tests__/ lib/contracts/__tests__/recompute lib/contracts/__tests__/recompute-volume lib/contracts/__tests__/recompute-po lib/contracts/__tests__/recompute-threshold lib/contracts/__tests__/recompute-carve-out 2>&1 | tail -20
```
Expected: PASS — existing tests should keep working because the change is gated on `isTieIn` (defaulted undefined → preserve-collections behaviour unchanged for non-tie-in callers).

- [ ] **Step 6: Run the full project test suite**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' 2>&1 | tail -8
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/contracts/recompute-accrual.ts \
  lib/contracts/recompute/threshold.ts \
  lib/contracts/recompute/volume.ts \
  lib/contracts/recompute/po.ts \
  lib/contracts/recompute/invoice.ts \
  lib/contracts/recompute/carve-out.ts \
  lib/actions/contracts/__tests__/recompute-accrual-idempotent-tie-in.test.ts
git commit -m "fix(recompute): tie-in idempotency — drop collectionDate gate when auto-stamped

Bug #16: every Recompute Earned Rebates click on a tie-in contract
appended new rows because autoStampCollectionForTieIn sets
collectionDate = periodEnd on every insert (Charles 2026-04-23: tie-in
retires capital on earn, vendor applies credit directly). The
delete-then-insert idempotency relied on a 'collectionDate=null'
filter to wipe stale auto-rows, which never matched on tie-in.

Thread isTieIn through every dispatcher (threshold/volume/po/invoice/
carve-out) plus the main spend-writer's own pre-delete + future-purge.
When true, the delete filter wipes ALL auto-accrual rows for the
contract/term regardless of collectionDate. Non-tie-in behaviour is
unchanged.

Spec: docs/superpowers/specs/2026-05-24-recompute-duplicates-tie-in-design.md"
```

---

## Self-review checklist

1. **Spec coverage** — each row of the spec's 6-location table is touched.
2. **Backwards compat** — `isTieIn?: boolean` is optional with default-undefined; existing dispatcher callers (tests, source-oracle harness) continue to receive `collectionDate: null` behaviour without change.
3. **Test isolation** — the new test uses an in-memory rebateStore that resets per `beforeEach`.
4. **No placeholders** — every code block contains the actual code, not "...similar".
