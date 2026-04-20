# Charles W1.Y-D — Minimum Annual Purchase math

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `minAnnualPurchase` an active floor on tie-in contracts with rolling-12 math + a "needed-rebate-to-retire-capital" display. On non-tie-in, clearly label it as reference-only.

**Architecture:** Two new pure reducers (`computeMinAnnualShortfall`, `computeCapitalRetirementNeeded`), surfaced on the Capital Amortization card alongside W1.Y-C's additions. Form help text updated per contract type.

**Spec:** `docs/superpowers/specs/2026-04-20-charles-w1y-d-minimum-annual-purchase-design.md`

---

### Task 1: `computeMinAnnualShortfall`

**Files:**
- Create: `lib/contracts/min-annual-shortfall.ts`
- Create: `lib/contracts/__tests__/min-annual-shortfall.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest"
import { computeMinAnnualShortfall } from "@/lib/contracts/min-annual-shortfall"

describe("computeMinAnnualShortfall", () => {
  it("null floor → met", () => {
    const r = computeMinAnnualShortfall(100_000, null)
    expect(r).toEqual({ floor: null, spend: 100_000, gap: 0, met: true })
  })
  it("floor met", () => {
    const r = computeMinAnnualShortfall(500_000, 250_000)
    expect(r.gap).toBe(0)
    expect(r.met).toBe(true)
  })
  it("floor unmet", () => {
    const r = computeMinAnnualShortfall(150_000, 250_000)
    expect(r.gap).toBe(100_000)
    expect(r.met).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL, implement, re-run — expect PASS**

```ts
// lib/contracts/min-annual-shortfall.ts
export interface MinAnnualShortfallResult {
  floor: number | null
  spend: number
  gap: number
  met: boolean
}

export function computeMinAnnualShortfall(
  rolling12Spend: number,
  minAnnualPurchase: number | null,
): MinAnnualShortfallResult {
  if (minAnnualPurchase == null || minAnnualPurchase <= 0) {
    return { floor: null, spend: rolling12Spend, gap: 0, met: true }
  }
  const gap = Math.max(minAnnualPurchase - rolling12Spend, 0)
  return { floor: minAnnualPurchase, spend: rolling12Spend, gap, met: gap === 0 }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/contracts/min-annual-shortfall.ts lib/contracts/__tests__/min-annual-shortfall.test.ts
git commit -m "feat(contracts): W1.Y-D computeMinAnnualShortfall helper"
```

---

### Task 2: `computeCapitalRetirementNeeded`

**Files:**
- Create: `lib/contracts/capital-retirement-needed.ts`
- Create: `lib/contracts/__tests__/capital-retirement-needed.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest"
import { computeCapitalRetirementNeeded } from "@/lib/contracts/capital-retirement-needed"

describe("computeCapitalRetirementNeeded", () => {
  it("computes monthly + annual spend needed at current tier rate", () => {
    // Remaining capital: $100_000. 20 months left. Current tier rate: 5%.
    // Monthly needed = 100_000 / 20 = 5_000 rebate per month.
    // To earn $5_000 rebate at 5% → need $100_000 monthly spend. Annual: $1_200_000.
    const r = computeCapitalRetirementNeeded({
      capitalAmount: 200_000,
      rebatesApplied: 100_000,
      monthsRemaining: 20,
      rebatePercent: 5,
    })
    expect(r.remainingCapital).toBe(100_000)
    expect(r.monthlySpendNeeded).toBe(100_000)
    expect(r.annualSpendNeeded).toBe(1_200_000)
  })
  it("returns zero spend needed when capital fully retired", () => {
    const r = computeCapitalRetirementNeeded({
      capitalAmount: 100_000,
      rebatesApplied: 100_000,
      monthsRemaining: 12,
      rebatePercent: 5,
    })
    expect(r.annualSpendNeeded).toBe(0)
  })
  it("returns null when tier rate is zero (avoid /0)", () => {
    const r = computeCapitalRetirementNeeded({
      capitalAmount: 100_000,
      rebatesApplied: 0,
      monthsRemaining: 12,
      rebatePercent: 0,
    })
    expect(r.annualSpendNeeded).toBeNull()
  })
})
```

- [ ] **Step 2: Implement**

```ts
// lib/contracts/capital-retirement-needed.ts
export interface CapitalRetirementNeededInput {
  capitalAmount: number
  rebatesApplied: number
  monthsRemaining: number
  rebatePercent: number
}

export interface CapitalRetirementNeededResult {
  remainingCapital: number
  monthlySpendNeeded: number | null
  annualSpendNeeded: number | null
}

export function computeCapitalRetirementNeeded(
  input: CapitalRetirementNeededInput,
): CapitalRetirementNeededResult {
  const remainingCapital = Math.max(input.capitalAmount - input.rebatesApplied, 0)
  if (remainingCapital === 0) {
    return { remainingCapital: 0, monthlySpendNeeded: 0, annualSpendNeeded: 0 }
  }
  if (input.rebatePercent <= 0 || input.monthsRemaining <= 0) {
    return { remainingCapital, monthlySpendNeeded: null, annualSpendNeeded: null }
  }
  const monthlyRebateNeeded = remainingCapital / input.monthsRemaining
  const monthlySpendNeeded = monthlyRebateNeeded / (input.rebatePercent / 100)
  return {
    remainingCapital,
    monthlySpendNeeded,
    annualSpendNeeded: monthlySpendNeeded * 12,
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/contracts/capital-retirement-needed.ts lib/contracts/__tests__/capital-retirement-needed.test.ts
git commit -m "feat(contracts): W1.Y-D capital retirement needed reducer"
```

---

### Task 3: Surface on Capital Amortization card

**Files:**
- Modify: `components/contracts/contract-amortization-card.tsx`

- [ ] **Step 1: Wire the helpers**

Add two rows below W1.Y-C's Rebates Applied + Balance Due:

```tsx
const shortfall = computeMinAnnualShortfall(rolling12Spend, contract.minAnnualPurchase ?? null)
const retirement = computeCapitalRetirementNeeded({
  capitalAmount: Number(contract.capitalAmount ?? 0),
  rebatesApplied,
  monthsRemaining: contract.capitalMonths ?? 0,
  rebatePercent: tierRatePercent,
})
```

Render:

```tsx
{contract.contractType === "tie_in" ? (
  <>
    <div className="grid grid-cols-2 gap-4 pt-4">
      <div>
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
          Minimum Annual Purchase
          <Badge variant={shortfall.met ? "outline" : "destructive"} className="text-[10px]">
            {shortfall.met ? "Met" : `short ${formatCurrency(shortfall.gap)}`}
          </Badge>
        </p>
        <p className="text-lg font-semibold">{shortfall.floor ? formatCurrency(shortfall.floor) : "—"}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
          Annual Spend Needed to Retire Capital
          <Tooltip>...</Tooltip>
        </p>
        <p className="text-lg font-semibold">
          {retirement.annualSpendNeeded == null ? "—" : formatCurrency(retirement.annualSpendNeeded)}
        </p>
      </div>
    </div>
  </>
) : null}
```

- [ ] **Step 2: Commit**

```bash
git add components/contracts/contract-amortization-card.tsx
git commit -m "feat(contracts): W1.Y-D tie-in min-purchase + retirement math on card"
```

---

### Task 4: Form help text

**Files:**
- Modify: `components/contracts/contract-form.tsx` (or wherever `minAnnualPurchase` input lives)

- [ ] **Step 1: Update help text conditionally by contract type**

```tsx
<p className="text-xs text-muted-foreground">
  {contractType === "tie_in"
    ? "Floor. If 12-month spend falls below this, the contract will not retire its capital on schedule. Drives the at-risk badge on the Capital Amortization card."
    : "Reference only — not enforced in rebate math today."}
</p>
```

- [ ] **Step 2: Commit**

```bash
git add components/contracts/contract-form.tsx
git commit -m "docs(form): W1.Y-D clarify minAnnualPurchase semantics per type"
```

---

### Task 5: Integration test

**Files:**
- Create: `lib/actions/__tests__/tiein-min-annual-integration.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect } from "vitest"
import { seedTieInContract } from "@/tests/helpers/contract-fixtures"
import { getContract } from "@/lib/actions/contracts"
import { computeMinAnnualShortfall } from "@/lib/contracts/min-annual-shortfall"
import { computeCapitalRetirementNeeded } from "@/lib/contracts/capital-retirement-needed"

describe("tie-in min-annual + retirement integration", () => {
  it("surfaces the rolling-12 shortfall + retirement math (Charles iMessage 2026-04-20)", async () => {
    const { contractId } = await seedTieInContract({
      capitalAmount: 300_000,
      rolling12Spend: 312_056,
      minAnnualPurchase: 400_000,
      capitalMonths: 60,
      currentMonth: 30,
      tierPercent: 5,
    })
    const contract = await getContract(contractId)
    const shortfall = computeMinAnnualShortfall(312_056, 400_000)
    expect(shortfall.met).toBe(false)
    expect(shortfall.gap).toBe(400_000 - 312_056)

    const retirement = computeCapitalRetirementNeeded({
      capitalAmount: 300_000,
      rebatesApplied: Number(contract!.rebatesApplied ?? 0),
      monthsRemaining: 30,
      rebatePercent: 5,
    })
    expect(retirement.annualSpendNeeded).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run + commit**

```bash
bunx vitest run lib/actions/__tests__/tiein-min-annual-integration.test.ts
git add lib/actions/__tests__/tiein-min-annual-integration.test.ts
git commit -m "test(contracts): W1.Y-D tie-in min-annual + retirement integration"
```

---

### Task 6: Full verify

Run: `bunx tsc --noEmit && bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'`
Expected: clean; all pass.

---

## Self-Review

- ✓ Shortfall reducer + test (Task 1)
- ✓ Retirement reducer + test (Task 2)
- ✓ Card UI (Task 3)
- ✓ Form help text (Task 4)
- ✓ Integration test named with Charles iMessage (Task 5)
