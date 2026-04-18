# Subsystem 1 — Marginal Rebate Method (Contracts Rewrite)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (TDD discipline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the P0 silent-wrong-numbers bug. `lib/rebates/calculate.ts:49-65` currently implements cumulative tier math only. Spec section 2.1 requires both cumulative and marginal (bracket) methods. Add a pure `lib/contracts/rebate-method.ts` engine with both; rewire the existing facade to delegate via new `method` param; surface the choice on the terms UI.

**Architecture:** Pure functions in `lib/contracts/rebate-method.ts`. `lib/rebates/calculate.ts` becomes a thin facade (backward-compatible — default method `'cumulative'`). UI lets the user pick method at term-entry time; the stored `ContractTerm.rebateMethod` flows through every recompute path.

**Tech Stack:** Vitest, TypeScript strict mode, Prisma 7 Decimal.

**Parent spec:** `docs/superpowers/specs/2026-04-18-contracts-rewrite.md`
**Depends on:** Subsystem 0 (`ContractTerm.rebateMethod` column).

---

## Task 1: Write the failing test file

**Files:**
- Create: `tests/contracts/rebate-method.test.ts`

- [ ] **Step 1: Write full test file**

```typescript
import { describe, it, expect } from "vitest"
import {
  calculateCumulative,
  calculateMarginal,
  calculateRebate,
  type TierLike,
} from "@/lib/contracts/rebate-method"

// Spec example tier structure — sections 2.1.1 and 2.1.2
const TIERS: TierLike[] = [
  { tierNumber: 1, spendMin: 0,       spendMax: 50_000,  rebateValue: 2 },
  { tierNumber: 2, spendMin: 50_000,  spendMax: 100_000, rebateValue: 3 },
  { tierNumber: 3, spendMin: 100_000, spendMax: null,    rebateValue: 4 },
]

describe("calculateCumulative", () => {
  it("spec example — $75K spend returns $2,250 at tier 2 (3%)", () => {
    const result = calculateCumulative(75_000, TIERS)
    expect(result.rebateEarned).toBe(2_250)
    expect(result.tierAchieved).toBe(2)
    expect(result.rebatePercent).toBe(3)
  })

  it("$125K spend returns $5,000 at tier 3 (4%) — entire spend at top rate", () => {
    const result = calculateCumulative(125_000, TIERS)
    expect(result.rebateEarned).toBe(5_000)
    expect(result.tierAchieved).toBe(3)
  })

  it("$0 spend returns 0 rebate, tier 1", () => {
    const result = calculateCumulative(0, TIERS)
    expect(result.rebateEarned).toBe(0)
    expect(result.tierAchieved).toBe(1)
  })

  it("spend exactly at tier boundary promotes to that tier", () => {
    const result = calculateCumulative(50_000, TIERS)
    expect(result.tierAchieved).toBe(2)
    expect(result.rebatePercent).toBe(3)
  })

  it("handles single-tier contract", () => {
    const oneTier: TierLike[] = [{ tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 2.5 }]
    const result = calculateCumulative(10_000, oneTier)
    expect(result.rebateEarned).toBe(250)
    expect(result.tierAchieved).toBe(1)
  })

  it("tiers supplied out of order still resolve correctly", () => {
    const scrambled: TierLike[] = [TIERS[2], TIERS[0], TIERS[1]]
    const result = calculateCumulative(75_000, scrambled)
    expect(result.tierAchieved).toBe(2)
  })
})

describe("calculateMarginal", () => {
  it("spec example — $125K spend returns $3,500 across three brackets", () => {
    // $50K × 2% = $1,000
    // $50K × 3% = $1,500
    // $25K × 4% = $1,000
    // total = $3,500
    const result = calculateMarginal(125_000, TIERS)
    expect(result.rebateEarned).toBe(3_500)
    expect(result.tierAchieved).toBe(3)
  })

  it("$75K spend returns $1,750 across two brackets", () => {
    // $50K × 2% = $1,000
    // $25K × 3% = $750
    const result = calculateMarginal(75_000, TIERS)
    expect(result.rebateEarned).toBe(1_750)
    expect(result.tierAchieved).toBe(2)
  })

  it("$30K spend returns $600 within tier 1 only", () => {
    const result = calculateMarginal(30_000, TIERS)
    expect(result.rebateEarned).toBe(600)
    expect(result.tierAchieved).toBe(1)
  })

  it("$0 spend returns 0 rebate, tier 1", () => {
    const result = calculateMarginal(0, TIERS)
    expect(result.rebateEarned).toBe(0)
    expect(result.tierAchieved).toBe(1)
  })

  it("spend exactly at tier-2 boundary stays tier 1 (no overflow)", () => {
    // $50K × 2% = $1,000. Tier 2 starts AT 50K but no spend is above it.
    const result = calculateMarginal(50_000, TIERS)
    expect(result.rebateEarned).toBe(1_000)
    expect(result.tierAchieved).toBe(1)
  })

  it("single-tier contract behaves identically to cumulative", () => {
    const oneTier: TierLike[] = [{ tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 2.5 }]
    expect(calculateMarginal(10_000, oneTier).rebateEarned).toBe(250)
  })

  it("marginal with non-final tier missing spendMax throws", () => {
    const bad: TierLike[] = [
      { tierNumber: 1, spendMin: 0,      spendMax: null,   rebateValue: 2 },
      { tierNumber: 2, spendMin: 50_000, spendMax: null,   rebateValue: 3 },
    ]
    expect(() => calculateMarginal(60_000, bad)).toThrow(/spendMax/i)
  })
})

describe("calculateRebate (dispatcher)", () => {
  it("cumulative method matches calculateCumulative", () => {
    const r = calculateRebate(75_000, TIERS, "cumulative")
    expect(r.rebateEarned).toBe(2_250)
  })

  it("marginal method matches calculateMarginal", () => {
    const r = calculateRebate(125_000, TIERS, "marginal")
    expect(r.rebateEarned).toBe(3_500)
  })

  it("defaults to cumulative when method omitted (backward compat)", () => {
    const r = calculateRebate(75_000, TIERS)
    expect(r.rebateEarned).toBe(2_250)
  })
})
```

- [ ] **Step 2: Run tests — expect ALL red**

Run: `bunx vitest run tests/contracts/rebate-method.test.ts`
Expected: all tests fail with "Failed to resolve import" or "calculateCumulative is not a function" (module doesn't exist yet).

---

## Task 2: Implement the engine

**Files:**
- Create: `lib/contracts/rebate-method.ts`

- [ ] **Step 1: Write implementation**

```typescript
/**
 * Rebate calculation engines for cumulative and marginal tier methods.
 *
 * - Cumulative (most common): the entire spend receives the rate of the
 *   highest tier achieved. Spec section 2.1.1.
 * - Marginal (bracket): each spend bracket receives its own rate. Spec
 *   section 2.1.2.
 *
 * Tiers are sorted by spendMin ascending inside each function, so callers
 * don't have to pre-sort.
 */

export type RebateMethodName = "cumulative" | "marginal"

export interface TierLike {
  tierNumber: number
  spendMin: number | string | { toString(): string }
  spendMax: number | string | { toString(): string } | null
  rebateValue: number | string | { toString(): string }
}

export interface RebateEngineResult {
  tierAchieved: number
  rebatePercent: number
  rebateEarned: number
}

// ─── Helpers ────────────────────────────────────────────────────────

function numericValue(v: TierLike["spendMin"]): number {
  return typeof v === "number" ? v : Number(v)
}

function nullableNumeric(v: TierLike["spendMax"]): number | null {
  if (v === null || v === undefined) return null
  return typeof v === "number" ? v : Number(v)
}

function sortedByMin(tiers: TierLike[]): TierLike[] {
  return [...tiers].sort((a, b) => numericValue(a.spendMin) - numericValue(b.spendMin))
}

// ─── Cumulative ─────────────────────────────────────────────────────

export function calculateCumulative(spend: number, tiers: TierLike[]): RebateEngineResult {
  if (tiers.length === 0) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }

  const sorted = sortedByMin(tiers)
  // Default to the lowest tier (spend >= its min, which is usually 0).
  let applicable = sorted[0]

  for (const tier of sorted) {
    if (spend >= numericValue(tier.spendMin)) {
      applicable = tier
    }
  }

  const rebatePercent = numericValue(applicable.rebateValue)
  const rebateEarned = (spend * rebatePercent) / 100

  return {
    tierAchieved: applicable.tierNumber,
    rebatePercent,
    rebateEarned,
  }
}

// ─── Marginal ───────────────────────────────────────────────────────

export function calculateMarginal(spend: number, tiers: TierLike[]): RebateEngineResult {
  if (tiers.length === 0) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }

  const sorted = sortedByMin(tiers)
  let totalRebate = 0
  let tierAchieved = sorted[0].tierNumber
  let topRate = numericValue(sorted[0].rebateValue)

  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i]
    const tierMin = numericValue(tier.spendMin)
    const tierMax = nullableNumeric(tier.spendMax)
    const nextMin = i + 1 < sorted.length ? numericValue(sorted[i + 1].spendMin) : null

    // Non-final tier without spendMax is ambiguous — we can't compute the bracket width.
    if (i < sorted.length - 1 && tierMax === null && nextMin === null) {
      throw new Error(
        `Marginal method requires spendMax on non-final tier (tier ${tier.tierNumber})`,
      )
    }

    // Upper bound of this bracket: prefer explicit spendMax, fall back to next tier's spendMin.
    const upperBound = tierMax ?? nextMin ?? Infinity

    if (spend <= tierMin) break

    const spendInBracket = Math.min(spend, upperBound) - tierMin
    if (spendInBracket <= 0) continue

    const rate = numericValue(tier.rebateValue)
    totalRebate += (spendInBracket * rate) / 100

    tierAchieved = tier.tierNumber
    topRate = rate

    if (spend <= upperBound) break
  }

  return {
    tierAchieved,
    rebatePercent: topRate,
    rebateEarned: totalRebate,
  }
}

// ─── Dispatcher ─────────────────────────────────────────────────────

export function calculateRebate(
  spend: number,
  tiers: TierLike[],
  method: RebateMethodName = "cumulative",
): RebateEngineResult {
  return method === "marginal"
    ? calculateMarginal(spend, tiers)
    : calculateCumulative(spend, tiers)
}
```

- [ ] **Step 2: Run tests — expect all green**

Run: `bunx vitest run tests/contracts/rebate-method.test.ts`
Expected: all tests pass.

---

## Task 3: Rewire the existing facade

**Files:**
- Modify: `lib/rebates/calculate.ts` — delegate to new module, accept `method` param

- [ ] **Step 1: Add method parameter + delegate**

Update `applyTiers` signature and add `method` on `computeRebate` / `computeRebateFromPrismaTiers`. Backward-compatible: default `'cumulative'`.

Full new content of `lib/rebates/calculate.ts`:

```typescript
/**
 * Shared rebate calculation facade.
 *
 * All callers compute rebates through this module so tier logic stays
 * consistent (one previous bug: each caller re-implemented tier lookup
 * with subtle `>=` vs `>` differences).
 *
 * Actual engine lives in `lib/contracts/rebate-method.ts` — this facade
 * adds the DEFAULT_COLLECTION_RATE concept and Prisma-shaped convenience.
 */
import type { ContractTier } from "@prisma/client"
import {
  calculateRebate,
  type RebateMethodName,
  type TierLike,
} from "@/lib/contracts/rebate-method"

// ─── Types ──────────────────────────────────────────────────────

export interface TierInput {
  tierNumber: number
  spendMin: number | string | { toString(): string }
  spendMax?: number | string | { toString(): string } | null
  rebateValue: number | string | { toString(): string }
}

export interface RebateResult {
  tierAchieved: number
  rebatePercent: number
  rebateEarned: number
  rebateCollected: number
}

// Default collection rate applied when a contract doesn't specify its
// own payment terms. 80% is the industry rule-of-thumb for "paid on time".
export const DEFAULT_COLLECTION_RATE = 0.8

// ─── Tier lookup ────────────────────────────────────────────────

/**
 * Returns the highest tier whose spendMin the spend meets, plus the
 * rebate percentage at that tier. Kept for backward compat — this is the
 * cumulative-method view. New code should call `calculateRebate` directly.
 */
export function applyTiers(
  spend: number,
  tiers: TierInput[],
): { tierAchieved: number; rebatePercent: number } {
  const r = calculateRebate(spend, tiers as TierLike[], "cumulative")
  return { tierAchieved: r.tierAchieved, rebatePercent: r.rebatePercent }
}

// ─── Full rebate computation ────────────────────────────────────

export function computeRebate(
  spend: number,
  tiers: TierInput[],
  opts: { collectionRate?: number; method?: RebateMethodName } = {},
): RebateResult {
  const method = opts.method ?? "cumulative"
  const { tierAchieved, rebatePercent, rebateEarned } = calculateRebate(
    spend,
    tiers as TierLike[],
    method,
  )
  const rebateCollected = rebateEarned * (opts.collectionRate ?? DEFAULT_COLLECTION_RATE)

  return {
    tierAchieved,
    rebatePercent,
    rebateEarned,
    rebateCollected,
  }
}

// ─── Prisma-shaped helper ───────────────────────────────────────

export function computeRebateFromPrismaTiers(
  spend: number,
  tiers: Pick<ContractTier, "tierNumber" | "spendMin" | "spendMax" | "rebateValue">[],
  opts?: { collectionRate?: number; method?: RebateMethodName },
): RebateResult {
  return computeRebate(spend, tiers as TierInput[], opts)
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Run all tests**

Run: `bunx vitest run`
Expected: all pass (new engine tests + existing serialize/map-columns tests).

---

## Task 4: Wire `rebateMethod` through contract-term save

**Files:**
- Modify: `lib/actions/contract-terms.ts` — accept `rebateMethod` in input schema
- Modify: callers of that save action (form state), if they don't already thread the field through

- [ ] **Step 1: Read current action signature**

Run: (read `lib/actions/contract-terms.ts` — identify the Zod schema / input type used for save/create).

- [ ] **Step 2: Add `rebateMethod` to save schema**

Add to the Zod schema and the Prisma create/update payload:

```typescript
rebateMethod: z.enum(["cumulative", "marginal"]).default("cumulative"),
```

And include in the Prisma payload so it persists.

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

---

## Task 5: Surface method choice in term-entry UI

**Files:**
- Modify: `components/facility/contracts/contract-terms-entry.tsx` — add radio group

- [ ] **Step 1: Add radio group for cumulative vs marginal**

Within the term form, after the existing rebate-structure inputs, add:

```tsx
<div className="space-y-2">
  <Label>Rebate Calculation Method</Label>
  <RadioGroup
    value={rebateMethod}
    onValueChange={(v) => setRebateMethod(v as "cumulative" | "marginal")}
    className="grid grid-cols-2 gap-3"
  >
    <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3">
      <RadioGroupItem value="cumulative" className="mt-1" />
      <div>
        <div className="text-sm font-medium">Cumulative</div>
        <div className="text-xs text-muted-foreground">
          Entire spend at the highest achieved tier&rsquo;s rate.
        </div>
      </div>
    </label>
    <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3">
      <RadioGroupItem value="marginal" className="mt-1" />
      <div>
        <div className="text-sm font-medium">Marginal (bracket)</div>
        <div className="text-xs text-muted-foreground">
          Each spend bracket at its own rate.
        </div>
      </div>
    </label>
  </RadioGroup>
</div>
```

Plumb the state through save.

- [ ] **Step 2: Typecheck + build**

Run: `bunx tsc --noEmit && bun run build`
Expected: 0 errors, build succeeds.

---

## Task 6: Display the chosen method on the terms page

**Files:**
- Modify: `components/facility/contracts/contract-terms-page-client.tsx`

- [ ] **Step 1: Add method badge above tier table**

For each term, show:

```tsx
<Badge variant={term.rebateMethod === "marginal" ? "secondary" : "outline"}>
  {term.rebateMethod === "marginal" ? "Marginal (bracket)" : "Cumulative (whole-spend)"}
</Badge>
```

- [ ] **Step 2: Typecheck + build**

Run: `bunx tsc --noEmit && bun run build`
Expected: 0 errors, build succeeds.

---

## Task 7: Verify existing rebate numbers unchanged for cumulative contracts

- [ ] **Step 1: Re-seed + QA sanity**

Run: `bun run db:seed`
Expected: 10/10 QA checks pass (existing seeded contracts are all `cumulative` — numbers identical to pre-change).

- [ ] **Step 2: Manually flip one seed contract to marginal, reseed, verify numbers differ**

(Optional smoke check — skip if time-constrained; the engine tests are authoritative.)

---

## Task 8: Commit

- [ ] **Step 1: Commit**

```bash
git add lib/contracts/rebate-method.ts \
        tests/contracts/rebate-method.test.ts \
        lib/rebates/calculate.ts \
        lib/actions/contract-terms.ts \
        components/facility/contracts/contract-terms-entry.tsx \
        components/facility/contracts/contract-terms-page-client.tsx \
        docs/superpowers/plans/2026-04-18-contracts-rewrite-01-rebate-method-plan.md

git commit -m "feat(contracts): subsystem 1 — marginal rebate method ..."
```

---

## Acceptance

- All spec worked examples pass: cumulative $75K → $2,250, marginal $125K → $3,500.
- `bunx vitest run tests/contracts/rebate-method.test.ts` → all pass.
- `bunx vitest run` → all existing tests still pass.
- `bunx tsc --noEmit` → 0 errors.
- `bun run db:seed` → 10/10 QA checks pass (seeded contracts' rebate numbers unchanged — all cumulative by default).
- `bun run build` → compiled successfully.
- Term-entry form shows method radio; terms page shows method badge.
