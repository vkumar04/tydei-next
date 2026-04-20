# Charles W1.Y-C — Tie-in: earned rebates + capital reconciliation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** (C1) Tie-in contracts show earned rebates. (C2) Capital-paid-down reconciles across surfaces. (C3) Capital Amortization card surfaces rebates-applied + balance-due.

**Architecture:** Introduce canonical `sumRebateAppliedToCapital` helper (add to CLAUDE.md invariants table). Every surface rendering "applied to capital" / "paid to date" routes through it. Charles's rule: on tie-in, 100% of collected rebate retires capital.

**Spec:** `docs/superpowers/specs/2026-04-20-charles-w1y-c-tie-in-earned-reconciliation-design.md`

---

### Task 1: Diagnostic — classify the $0-earned + reconciliation

**Files:**
- Create: `scripts/diagnose-tiein-rebate-capital.ts`
- Create: `docs/superpowers/diagnostics/2026-04-20-w1y-c-tiein.md`

- [ ] **Step 1: Write the script**

```ts
// scripts/diagnose-tiein-rebate-capital.ts
import { prisma } from "@/lib/db"
import { contractTypeEarnsRebates } from "@/lib/contract-definitions"

async function main() {
  const contracts = await prisma.contract.findMany({
    where: { contractType: "tie_in" },
    include: { rebates: true, terms: { include: { tiers: true } } },
  })
  console.log("# Tie-in diagnostic\n")
  for (const c of contracts) {
    console.log(`## ${c.name} (${c.id})\n`)
    console.log(`- contractType: ${c.contractType}`)
    console.log(`- contractTypeEarnsRebates: ${contractTypeEarnsRebates(c.contractType)}`)
    console.log(`- capitalAmount: ${c.capitalAmount}`)
    console.log(`- capitalMonths: ${c.capitalMonths}`)
    console.log(`- rebates (count=${c.rebates.length}):`)
    let totalEarned = 0, totalCollected = 0
    for (const r of c.rebates) {
      const e = Number(r.rebateEarned)
      const co = Number(r.rebateCollected)
      totalEarned += e
      totalCollected += co
      console.log(`  - ${r.id}: earned=$${e}, collected=$${co}, collectionDate=${r.collectionDate?.toISOString().slice(0,10) ?? "-"}, notes="${r.notes ?? ""}"`)
    }
    console.log(`- totals: earned=$${totalEarned}, collected=$${totalCollected}\n`)
  }
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run + capture**

```bash
bun scripts/diagnose-tiein-rebate-capital.ts > docs/superpowers/diagnostics/2026-04-20-w1y-c-tiein.md
```

- [ ] **Step 3: Classify**

- If `contractTypeEarnsRebates` returns `false` for tie-in → that's the C1 bug.
- If rebates exist but UI shows $0 → the display path drops tie-in.
- If rebates exist and numbers are right → C1 is resolved, focus on C2 (reconciliation).

Note findings at the top of the diagnostic file.

- [ ] **Step 4: Commit**

```bash
git add scripts/diagnose-tiein-rebate-capital.ts docs/superpowers/diagnostics/2026-04-20-w1y-c-tiein.md
git commit -m "docs(diagnostic): W1.Y-C tie-in rebate+capital snapshot"
```

---

### Task 2: C1 — fix tie-in earned-rebate display

**Files:**
- Modify: `lib/contract-definitions.ts` (if the predicate is wrong)
- Modify: `lib/actions/contracts/recompute-accrual.ts` (if it skips tie-in)
- Modify: UI paths that render "$0" for tie-in earned
- Create: `lib/__tests__/contract-definitions-tiein.test.ts`

- [ ] **Step 1: Failing test**

```ts
// lib/__tests__/contract-definitions-tiein.test.ts
import { describe, it, expect } from "vitest"
import { contractTypeEarnsRebates } from "@/lib/contract-definitions"

describe("contract-types that earn rebates", () => {
  it("tie_in contracts earn rebates (Charles iMessage 2026-04-20)", () => {
    expect(contractTypeEarnsRebates("tie_in")).toBe(true)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bunx vitest run lib/__tests__/contract-definitions-tiein.test.ts`
Expected: FAIL if the predicate excludes tie-in today.

- [ ] **Step 3: Fix predicate**

Open `lib/contract-definitions.ts`. Find `contractTypeEarnsRebates`. If `tie_in` is not in the allow-list, add it. Tie-in contracts earn rebates — the whole mechanism is rebates retiring capital.

- [ ] **Step 4: Recompute existing tie-in contracts**

Add to the diagnostic or a one-shot script: call `recomputeAccrualForContract` on every tie-in contract in the demo facility so the $0 displays update. This is data migration; commit the script.

- [ ] **Step 5: Run test + typecheck + commit**

```bash
git add lib/contract-definitions.ts lib/__tests__/contract-definitions-tiein.test.ts
git commit -m "fix(contracts): W1.Y-C tie_in contracts earn rebates

contractTypeEarnsRebates was excluding tie_in so the engine
skipped accrual for these contracts — Rebates Earned (YTD)
rendered \$0 despite non-zero spend. Fixes C1."
```

---

### Task 3: C2 — canonical capital-applied reducer

**Files:**
- Create: `lib/contracts/rebate-capital-filter.ts`
- Create: `lib/contracts/__tests__/rebate-capital-filter.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest"
import { sumRebateAppliedToCapital } from "@/lib/contracts/rebate-capital-filter"

describe("sumRebateAppliedToCapital", () => {
  it("tie_in: sums all collected rebates", () => {
    const rebates = [
      { rebateEarned: 100, rebateCollected: 100, collectionDate: new Date("2025-01-01") },
      { rebateEarned: 50, rebateCollected: 50, collectionDate: new Date("2025-02-01") },
      { rebateEarned: 30, rebateCollected: 0, collectionDate: null },
    ]
    expect(sumRebateAppliedToCapital(rebates, "tie_in")).toBe(150)
  })
  it("non-tie_in: returns 0 (no capital to retire)", () => {
    const rebates = [{ rebateEarned: 100, rebateCollected: 100, collectionDate: new Date() }]
    expect(sumRebateAppliedToCapital(rebates, "usage")).toBe(0)
  })
  it("rejects earned-but-uncollected", () => {
    const rebates = [{ rebateEarned: 100, rebateCollected: 0, collectionDate: null }]
    expect(sumRebateAppliedToCapital(rebates, "tie_in")).toBe(0)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// lib/contracts/rebate-capital-filter.ts
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"

interface RebateLike {
  rebateEarned?: number | null
  rebateCollected?: number | null
  collectionDate?: Date | string | null
}

export function sumRebateAppliedToCapital(
  rebates: RebateLike[],
  contractType: string,
): number {
  if (contractType !== "tie_in") return 0
  return sumCollectedRebates(
    rebates.map((r) => ({
      collectionDate: r.collectionDate ?? null,
      rebateCollected: Number(r.rebateCollected ?? 0),
    })),
  )
}
```

- [ ] **Step 3: Run — expect PASS + commit**

```bash
git add lib/contracts/rebate-capital-filter.ts lib/contracts/__tests__/rebate-capital-filter.test.ts
git commit -m "feat(contracts): W1.Y-C canonical sumRebateAppliedToCapital

Tie-in contracts: 100% of collected rebate retires capital (Charles's
rule, iMessage 2026-04-20). Single helper ensures contract-header,
Capital Amortization card, and dashboard surfaces agree."
```

---

### Task 4: C2 — route every capital-applied surface through the helper

**Files:**
- Modify: `components/contracts/contract-amortization-card.tsx` — "Paid to Date" reads `sumRebateAppliedToCapital`
- Modify: `components/contracts/contract-detail-overview.tsx` (or wherever header card's "applied to capital" sublabel lives) — read the helper
- Create: `lib/actions/__tests__/tiein-capital-parity.test.ts`

- [ ] **Step 1: Parity test**

```ts
// lib/actions/__tests__/tiein-capital-parity.test.ts
import { describe, it, expect } from "vitest"
import { prisma } from "@/lib/db"
import { getContract } from "@/lib/actions/contracts"
import { sumRebateAppliedToCapital } from "@/lib/contracts/rebate-capital-filter"
import { seedTieInContract } from "@/tests/helpers/contract-fixtures"

describe("tie-in capital-applied parity", () => {
  it("tie-in capital-applied reconciles across surfaces (Charles iMessage 2026-04-20)", async () => {
    const { contractId } = await seedTieInContract({
      capitalAmount: 500_000,
      collected: [50_000, 75_000, 70_124], // total = 195_124
      earnedUncollected: [19_280],
    })
    const contract = await getContract(contractId)
    const applied = sumRebateAppliedToCapital(contract!.rebates, "tie_in")
    // Header sublabel, amortization paid-to-date, dashboards — all read `applied`.
    expect(applied).toBe(195_124)
  })
})
```

- [ ] **Step 2: Replace surface reducers with the helper**

Find the Capital Amortization card's "Paid to Date" computation. If it today computes from `(monthsElapsed × monthlyPayment)`, replace with `sumRebateAppliedToCapital`. Similarly for the header card sublabel.

- [ ] **Step 3: Run + commit**

```bash
git add components/contracts/ lib/actions/__tests__/tiein-capital-parity.test.ts
git commit -m "fix(contracts): W1.Y-C surfaces route through sumRebateAppliedToCapital"
```

---

### Task 5: C3 — Capital Amortization card shows rebate-applied + balance-due

**Files:**
- Modify: `components/contracts/contract-amortization-card.tsx`

- [ ] **Step 1: Add rows**

```tsx
<div className="grid grid-cols-3 gap-4">
  <div>
    <p className="text-xs text-muted-foreground">Rebates Applied (lifetime)</p>
    <p className="text-xl font-semibold text-blue-600">{formatCurrency(rebatesApplied)}</p>
  </div>
  <div>
    <p className="text-xs text-muted-foreground">Balance Due</p>
    <p className="text-xl font-semibold">{formatCurrency(Math.max(capitalAmount - rebatesApplied, 0))}</p>
  </div>
  <div>
    <p className="text-xs text-muted-foreground">Projected End-of-Term Balance</p>
    <p className="text-xl font-semibold">{formatCurrency(projectedEndBalance)}</p>
  </div>
</div>
```

Feed `rebatesApplied = sumRebateAppliedToCapital(contract.rebates, contract.contractType)`.

- [ ] **Step 2: Typecheck + commit**

```bash
bunx tsc --noEmit
git add components/contracts/contract-amortization-card.tsx
git commit -m "feat(contracts): W1.Y-C amortization card shows rebates + balance"
```

---

### Task 6: CLAUDE.md invariants table

- [ ] **Step 1: Add the row**

In the "Canonical reducers — invariants table" in CLAUDE.md, append:

```md
| Rebate applied to capital (tie-in) | `sumRebateAppliedToCapital` | `lib/contracts/rebate-capital-filter.ts` | contract-header applied-to-capital sublabel, Capital Amortization card Paid-to-Date + Balance-Due |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): W1.Y-C register sumRebateAppliedToCapital"
```

---

### Task 7: Full verify

Run: `bunx tsc --noEmit && bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'`
Expected: clean; all pass.

---

## Self-Review

- ✓ C1 fixed with predicate + test (Task 2)
- ✓ C2 single reducer + parity test (Tasks 3, 4)
- ✓ C3 card surfaces rebate + balance (Task 5)
- ✓ Invariants table updated (Task 6)
- ✓ Tests named to reference Charles iMessage (validation mandate)
