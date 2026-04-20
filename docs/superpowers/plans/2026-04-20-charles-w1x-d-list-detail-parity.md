# Charles W1.X-D — Contracts list vs detail parity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the drift between contracts-list row numbers and contract-detail numbers by collapsing `getContractMetricsBatch`'s rebate/spend aggregates (dual-source with canonical helpers) to a single source, and add a CI drift guard.

**Architecture:** `getContracts` already computes `rebateEarned` / `rebateCollected` / `currentSpend` via the canonical in-memory helpers (`sumEarnedRebatesYTD`, `sumCollectedRebates`, trailing-12-month cascade). `getContractMetricsBatch` duplicates this with a Prisma-side aggregation and "keep in sync" comment. The list column accessor prefers the batch result, so the canonical value is overridden. Fix: drop rebate + spend from the batch, update the column accessors, add a Vitest that compares `getContracts` output to `getContract(id)` output for invariance.

**Tech Stack:** Next.js 16, Prisma 7, React Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-20-charles-w1x-d-list-detail-parity-design.md`

---

### Task 1: Diagnostic — document the actual drift

**Files:**
- Create: `scripts/diagnose-contracts-list-parity.ts`
- Create: `docs/superpowers/diagnostics/2026-04-20-w1x-d-parity.md`

- [ ] **Step 1: Write the script**

```ts
// scripts/diagnose-contracts-list-parity.ts
// Usage: bun scripts/diagnose-contracts-list-parity.ts <facilityId>
// Writes a markdown table of drift between getContracts and getContract.

import { prisma } from "@/lib/db"
import { getContracts, getContract, getContractMetricsBatch } from "@/lib/actions/contracts"

async function main() {
  const facilityId = process.argv[2] ?? "cmo4sbr8p0004wthl91ubwfwb" // demo facility
  console.log(`# List vs detail parity — facility ${facilityId}`)
  console.log(`_Generated ${new Date().toISOString()}_\n`)

  const contracts = await getContracts({ facilityId })
  const ids = contracts.map((c) => c.id)
  const batch = await getContractMetricsBatch(ids)

  const rows: Array<{
    id: string
    field: string
    list: number
    detail: number
    batch: number
    delta: number
  }> = []

  for (const c of contracts) {
    const detail = await getContract(c.id)
    const b = batch[c.id]

    const fields = [
      { name: "rebateEarned", list: Number(c.rebateEarned ?? 0), detail: Number(detail?.rebateEarnedYTD ?? 0), batch: Number(b?.rebate ?? 0) },
      { name: "rebateCollected", list: Number(c.rebateCollected ?? 0), detail: Number(detail?.rebateCollected ?? 0), batch: 0 },
      { name: "currentSpend", list: Number(c.currentSpend ?? 0), detail: Number(detail?.currentSpend ?? 0), batch: Number(b?.spend ?? 0) },
    ]

    for (const f of fields) {
      if (f.list !== f.detail) {
        rows.push({ id: c.id, field: f.name, list: f.list, detail: f.detail, batch: f.batch, delta: f.list - f.detail })
      }
    }
  }

  console.log(`## Drift rows\n`)
  console.log("| Contract | Field | List | Detail | Batch | Delta |")
  console.log("|---|---|---:|---:|---:|---:|")
  for (const r of rows) {
    console.log(`| ${r.id} | ${r.field} | ${r.list} | ${r.detail} | ${r.batch} | ${r.delta} |`)
  }
  if (rows.length === 0) console.log("_No drift detected._")

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run + capture output**

```bash
bun scripts/diagnose-contracts-list-parity.ts > docs/superpowers/diagnostics/2026-04-20-w1x-d-parity.md
```

- [ ] **Step 3: Eyeball the output**

Open the diagnostics file. Identify which field drifts for which contract. Expected: at least one contract (the one in Charles's screenshots) shows a non-zero `delta` on `rebateEarned` with `batch` equal to `list` — confirming the accessor's `?? metricsRebate` is shadowing the canonical `rebateEarned`.

- [ ] **Step 4: Commit**

```bash
git add scripts/diagnose-contracts-list-parity.ts docs/superpowers/diagnostics/2026-04-20-w1x-d-parity.md
git commit -m "docs(diagnostic): W1.X-D list vs detail parity snapshot"
```

---

### Task 2: Write the CI parity test (initially failing)

**Files:**
- Create: `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest"
import { getContracts, getContract } from "@/lib/actions/contracts"
import { seedContractWithRebatesAndSpend } from "@/tests/helpers/contract-fixtures"

describe("contracts list vs detail parity", () => {
  it("list row rebateEarned equals detail rebateEarnedYTD", async () => {
    const { facilityId, contractId } = await seedContractWithRebatesAndSpend({
      earnedYTD: 58660,
      collectedLifetime: 58660,
      trailing12MoSpend: 1536659,
    })

    const list = await getContracts({ facilityId })
    const row = list.find((c) => c.id === contractId)!
    const detail = await getContract(contractId)

    expect(Number(row.rebateEarned ?? 0)).toBe(Number(detail?.rebateEarnedYTD ?? 0))
    expect(Number(row.rebateCollected ?? 0)).toBe(Number(detail?.rebateCollected ?? 0))
    expect(Number(row.currentSpend ?? 0)).toBe(Number(detail?.currentSpend ?? 0))
  })

  it("stays in parity across year boundary", async () => {
    // December 31 → January 1 flip exercises the YTD cutoff.
    // Assert that both surfaces reset YTD earned on Jan 1 by the same amount.
    // Implementation: seed rebates with payPeriodEnd in prior year + current year,
    // run the parity assertion with Date.now faked to Dec 31 23:59 and then Jan 1 00:01.
    const clock = vi.useFakeTimers()
    try {
      clock.setSystemTime(new Date("2025-12-31T23:59:00Z"))
      const { facilityId, contractId } = await seedContractWithRebatesAndSpend({
        earnedYTD: 10_000,
        collectedLifetime: 10_000,
        trailing12MoSpend: 200_000,
      })

      const decList = await getContracts({ facilityId })
      const decDetail = await getContract(contractId)
      const decRow = decList.find((c) => c.id === contractId)!
      expect(Number(decRow.rebateEarned ?? 0)).toBe(Number(decDetail?.rebateEarnedYTD ?? 0))

      clock.setSystemTime(new Date("2026-01-01T00:01:00Z"))
      const janList = await getContracts({ facilityId })
      const janDetail = await getContract(contractId)
      const janRow = janList.find((c) => c.id === contractId)!
      expect(Number(janRow.rebateEarned ?? 0)).toBe(Number(janDetail?.rebateEarnedYTD ?? 0))
    } finally {
      clock.useRealTimers()
    }
  })
})
```

If `seedContractWithRebatesAndSpend` does not exist, add it to `tests/helpers/contract-fixtures.ts` — it seeds a Facility, Vendor, Contract with one term + one tier, one Rebate row with the specified earned + collected amounts and `payPeriodEnd: <today - 1 day>`, and COG records totaling `trailing12MoSpend`. Also import `vi` from `vitest` if not already present.

- [ ] **Step 2: Run — expect FAILURE on the first test for the contract with drift**

Run: `bunx vitest run lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`
Expected: the first assertion fails if the column accessor's `?? metricsRebate` shadows `rebateEarned` for the seed data. If the seed data happens to produce identical values from both paths, the drift only shows with the real-world contract — adjust the seed to include a Rebate row whose `payPeriodEnd` lies inside the current year so that the DB aggregate in `getContractMetricsBatch` might double-count or miss vs the in-memory helper.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts tests/helpers/contract-fixtures.ts
git commit -m "test(contracts): W1.X-D add list-vs-detail parity guard"
```

---

### Task 3: Collapse sources — drop rebate + spend from getContractMetricsBatch

**Files:**
- Modify: `lib/actions/contracts.ts`
- Modify: `lib/actions/__tests__/contract-metrics-batch.test.ts`

- [ ] **Step 1: Locate `getContractMetricsBatch`**

Open `lib/actions/contracts.ts` and find `export async function getContractMetricsBatch` (around L627). Identify the rebate and spend aggregation blocks (the `prisma.rebate.aggregate` / `prisma.cOGRecord.aggregate` / ContractPeriod queries).

- [ ] **Step 2: Delete the rebate and spend aggregation and result fields**

Remove from the returned record shape:

```ts
// Before
return { /* ... */ rebate: ..., spend: ..., /* ... */ }
// After
return { /* whatever else it returned — e.g., score — or just delete the function if nothing remains */ }
```

Delete the Prisma queries that computed them. If `getContractMetricsBatch` now has no remaining fields to compute, delete the entire function export AND its test file.

- [ ] **Step 3: Update test file**

If `getContractMetricsBatch` remains: narrow `contract-metrics-batch.test.ts` to assert only the fields that remain.
If deleted: `git rm lib/actions/__tests__/contract-metrics-batch.test.ts`.

- [ ] **Step 4: Typecheck — identify callers broken by the signature change**

Run: `bunx tsc --noEmit`
Expected: errors in every file that reads `metricsRebate` or `metricsSpend` from the batch result. Make note of them; they'll be fixed in Task 4.

- [ ] **Step 5: Commit (expect it to leave typecheck red — next task cleans up)**

```bash
git add lib/actions/contracts.ts lib/actions/__tests__/contract-metrics-batch.test.ts
git commit -m "refactor(contracts): W1.X-D drop metricsRebate/metricsSpend from batch

These duplicated the canonical sumEarnedRebatesYTD + trailing-12mo
cascade already computed in-memory by getContracts. Dual sources with
a 'keep in sync' comment produced drift between the list column and
the detail header (Charles iMessage 2026-04-20). Typecheck is
expected red until the next commit migrates callers off the removed
fields."
```

---

### Task 4: Update contract-columns accessors and client to the single source

**Files:**
- Modify: `components/contracts/contract-columns.tsx`
- Modify: `components/contracts/contracts-list-client.tsx`

- [ ] **Step 1: Update the Spend column**

In `contract-columns.tsx` L304-327, change:

```tsx
accessorFn: (row) => row.currentSpend ?? row.metricsSpend ?? 0,
// ...
const value = row.original.currentSpend ?? row.original.metricsSpend
```

to:

```tsx
accessorFn: (row) => row.currentSpend ?? 0,
// ...
const value = row.original.currentSpend
```

Remove `metricsSpend` from the `ContractWithVendor` type at the top of the file.

- [ ] **Step 2: Update the Earned column**

In `contract-columns.tsx` L328-353, change:

```tsx
accessorFn: (row) => row.metricsRebate ?? Number(row.rebateEarned ?? 0),
// ...
const value = row.original.metricsRebate ?? Number(row.original.rebateEarned ?? 0)
```

to:

```tsx
accessorFn: (row) => Number(row.rebateEarned ?? 0),
// ...
const value = Number(row.original.rebateEarned ?? 0)
```

Remove `metricsRebate` from the `ContractWithVendor` type.

- [ ] **Step 3: Remove the batch call from contracts-list-client.tsx**

Open `components/contracts/contracts-list-client.tsx`. Find any call to `getContractMetricsBatch` (likely a `useQuery` or merge in a `useMemo`). Delete the call and any merging code that attached `metricsRebate` / `metricsSpend` onto the rows.

- [ ] **Step 4: Run the parity test — expect PASS**

Run: `bunx vitest run lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`
Expected: both cases pass.

- [ ] **Step 5: Full typecheck and tests**

Run: `bunx tsc --noEmit && bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'`
Expected: 0 tsc errors; all tests green.

- [ ] **Step 6: Smoke**

1. `rm -rf .next && bun run dev`
2. Open contracts list → note Spend (Last 12 Months) and Rebate Earned (YTD) for a row.
3. Click into the contract → confirm header card Current Spend (Last 12 Months) and Rebates Earned (YTD) match the list row to the dollar.
4. Log a new collected rebate → go back to list → value updates and still matches detail.

- [ ] **Step 7: Commit**

```bash
git add components/contracts/contract-columns.tsx components/contracts/contracts-list-client.tsx
git commit -m "fix(contracts): W1.X-D list columns route through canonical helper

The accessor's ?? metricsRebate fallback shadowed the canonical
sumEarnedRebatesYTD value that getContracts already populates on
rebateEarned. Same shape for currentSpend vs metricsSpend. Collapses
to the single canonical source; list and detail now cannot drift."
```

---

### Task 5: Update CLAUDE.md invariants table

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Remove any reference to `getContractMetricsBatch` if its rebate role is gone**

If the function was deleted entirely, skim `CLAUDE.md` for mentions of it. The invariants table already names the canonical helpers; no entry directly referenced `getContractMetricsBatch`. Add a line under "Release hygiene" or similar:

```md
- **No dual-source metrics.** `getContractMetricsBatch` no longer computes
  rebate or spend. The single source for list-row metrics is `getContracts`
  via the canonical helpers (`sumEarnedRebatesYTD`, `sumCollectedRebates`,
  trailing-12mo cascade). Enforced by
  `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): W1.X-D note single-source rule for list metrics"
```

---

## Self-Review

**Spec coverage:**
- ✓ Diagnostic script + committed output (Task 1)
- ✓ Collapse `getContractMetricsBatch` rebate/spend (Task 3)
- ✓ Column accessors use canonical source only (Task 4)
- ✓ Parity CI test (Task 2)
- ✓ CLAUDE.md updated (Task 5)

**Placeholders:** none. Every step shows exact code to add/remove.

**Type consistency:**
- `ContractWithVendor` type in `contract-columns.tsx` — remove `metricsRebate`, `metricsSpend` (Task 4). Task 3 removes the Prisma source; Task 4 removes the TS type; keeps it consistent.
- `getContractMetricsBatch` return type shrinks; caller `contracts-list-client.tsx` loses its consumer in Task 4.
