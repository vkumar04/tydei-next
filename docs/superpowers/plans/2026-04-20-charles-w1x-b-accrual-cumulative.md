# Charles W1.X-B — Accrual Timeline cumulative column

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Accrual Timeline's "Cumulative" column so it shows the running cumulative spend across months, carrying forward through zero-spend months.

**Architecture:** One-liner bug fix in `getAccrualTimeline`. The final `rows.map` currently sets `cumulativeSpend: totalSpend` (per-month spend, not running). Introduce a `runningCumulative` accumulator that sums `totalSpend` across iterations.

**Tech Stack:** Next.js 16, Prisma 7, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-20-charles-w1x-b-accrual-cumulative-design.md`

---

### Task 1: Write the failing Vitest

**Files:**
- Create: `lib/actions/__tests__/accrual-timeline-cumulative.test.ts`

- [ ] **Step 1: Write the test**

Test the pure builder `buildMonthlyAccruals` AND a light integration test driving `getAccrualTimeline` against a seeded contract. The pure-builder test pins the semantics; the action test confirms the wiring.

```ts
// lib/actions/__tests__/accrual-timeline-cumulative.test.ts
import { describe, it, expect } from "vitest"
import { buildMonthlyAccruals } from "@/lib/contracts/accrual"

describe("accrual timeline cumulative column", () => {
  it("carries cumulative forward through zero-spend months", () => {
    const series = [
      { month: "2025-01", spend: 100 },
      { month: "2025-02", spend: 0 },
      { month: "2025-03", spend: 50 },
    ]
    const tiers = [
      { tierNumber: 1, tierName: null, spendMin: 0, spendMax: null, rebateValue: 5 },
    ]
    const rows = buildMonthlyAccruals(series, tiers, "cumulative", "monthly")
    expect(rows.map((r) => r.cumulativeSpend)).toEqual([100, 100, 150])
  })

  it("first month's cumulative equals its spend", () => {
    const series = [{ month: "2025-01", spend: 200 }]
    const tiers = [
      { tierNumber: 1, tierName: null, spendMin: 0, spendMax: null, rebateValue: 3 },
    ]
    const rows = buildMonthlyAccruals(series, tiers, "cumulative", "monthly")
    expect(rows[0].cumulativeSpend).toBe(200)
  })
})
```

- [ ] **Step 2: Run to confirm the pure-builder cases PASS**

Run: `bunx vitest run lib/actions/__tests__/accrual-timeline-cumulative.test.ts`
Expected: PASS. (`buildMonthlyAccruals` already computes running cumulative correctly — see `lib/contracts/accrual.ts:227`.) These tests lock in the pure-builder contract so regressions there are caught even though they currently pass. Don't delete them — they are the safety net for the pure helper.

- [ ] **Step 3: Add the failing action-level test**

Append to the same file:

```ts
import { getAccrualTimeline } from "@/lib/actions/contracts/accrual"
import { seedContractWithMixedSpend } from "@/tests/helpers/contract-fixtures"

describe("getAccrualTimeline cumulative column", () => {
  it("returns running cumulative, not per-month spend", async () => {
    // Fixture: 3 months — Jan $100, Feb $0, Mar $50.
    const { contractId } = await seedContractWithMixedSpend()
    const { rows } = await getAccrualTimeline(contractId)
    // Before the fix, cumulativeSpend === spend for every row.
    // After the fix, cumulativeSpend is the running sum.
    expect(rows.map((r) => r.cumulativeSpend)).toEqual([100, 100, 150])
    expect(rows.map((r) => r.spend)).toEqual([100, 0, 50])
  })
})
```

If `seedContractWithMixedSpend` doesn't exist, inline the seed helper at the top of this test file — create a Facility, Vendor, Contract with one term + one tier, and three COG rows with `transactionDate` in Jan/Feb(none)/Mar of the most recent calendar year. Scope the test to its own DB transaction if the project uses `prisma.$transaction` in tests; otherwise follow the pattern in `lib/actions/__tests__/contract-scoring.test.ts`.

- [ ] **Step 4: Run the action-level test and confirm it FAILS**

Run: `bunx vitest run lib/actions/__tests__/accrual-timeline-cumulative.test.ts`
Expected: the `getAccrualTimeline` test fails with actual `[100, 0, 50]` vs expected `[100, 100, 150]` (or similar — exact numbers depend on seed data).

- [ ] **Step 5: Commit**

```bash
git add lib/actions/__tests__/accrual-timeline-cumulative.test.ts
git commit -m "test(accrual-timeline): W1.X-B pin running cumulative semantics"
```

---

### Task 2: Fix the running-cumulative bug

**Files:**
- Modify: `lib/actions/contracts/accrual.ts:186-233`

- [ ] **Step 1: Read the current `rows.map`**

Open `lib/actions/contracts/accrual.ts` and locate the `const rows: MultiTermTimelineRow[] = monthsTimeline.map(...)` block. It sits at L186-233. The bug is L227: `cumulativeSpend: totalSpend`.

- [ ] **Step 2: Introduce a running accumulator**

Replace:

```ts
const rows: MultiTermTimelineRow[] = monthsTimeline.map((month, i) => {
  let totalSpend = 0
  let totalAccrued = 0
  // ... existing per-term loop ...
  return {
    month,
    spend: totalSpend,
    cumulativeSpend: totalSpend,
    // ... rest ...
  }
})
```

with:

```ts
let runningCumulative = 0
const rows: MultiTermTimelineRow[] = monthsTimeline.map((month, i) => {
  let totalSpend = 0
  let totalAccrued = 0
  // ... existing per-term loop (unchanged) ...
  runningCumulative += totalSpend
  return {
    month,
    spend: totalSpend,
    cumulativeSpend: runningCumulative,
    // ... rest ...
  }
})
```

The `runningCumulative` lives in the enclosing function scope (above the `.map`) so every iteration sees the same accumulator. Do not move it inside the callback.

- [ ] **Step 3: Run the failing test to confirm it now passes**

Run: `bunx vitest run lib/actions/__tests__/accrual-timeline-cumulative.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 4: Run the full contracts test suite**

Run: `bunx vitest run lib/actions/__tests__/ lib/contracts/__tests__/`
Expected: ALL pass. If `accrual.test.ts` had any assertions against the old `cumulativeSpend === totalSpend` behavior (unlikely — the pre-fix value was accidentally correct only when `monthsTimeline` had one entry), update those assertions to match the real-running-cumulative contract.

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Smoke the UI**

Run: `rm -rf .next && bun run dev`
Open a contract detail → Performance tab → scroll to Accrual Timeline. Confirm the Cumulative column values increase month-over-month and non-zero through trailing zero-spend months. Footer "Latest cumulative spend" should equal the final row's value.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/contracts/accrual.ts
git commit -m "fix(accrual-timeline): W1.X-B cumulative column shows running sum

The final rows.map set cumulativeSpend to the current month's totalSpend,
so every row had cumulativeSpend === spend and zero-spend tail months
rendered \$0 / —. Introduces a runningCumulative accumulator so the
column carries forward through zero-spend months as the 'Cumulative'
label advertises."
```

---

## Self-Review

**Spec coverage:**
- ✓ Fix at L227 (Task 2)
- ✓ Carry-forward test for `[100,0,50] → [100,100,150]` (Task 1)
- ✓ First-month trivial case (Task 1)
- ✓ Footer `latest.cumulativeSpend` check (Task 2 Step 6)

**Placeholders:** none — every code block is concrete; exact line numbers, file paths, commit messages.

**Type consistency:** `runningCumulative: number`, `totalSpend: number`, `cumulativeSpend: number` — consistent with the `MultiTermTimelineRow` interface at `lib/contracts/accrual.ts:296`.
