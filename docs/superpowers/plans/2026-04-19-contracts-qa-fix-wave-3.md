# Contracts QA Fix Wave 3 — remaining P1 + high-value P2

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Fix the 3 remaining P1 bugs from the QA sweep (`terms-3`, `terms-4`, `terms-5`) plus amendment workflow correctness (detail-4, detail-5) and score radar 6-dim completeness (score-4).

**Source:** QA report `docs/superpowers/qa/2026-04-19-contracts-sweep.md`.

**Waves 1+2 already shipped:** 5 P0 + 8 P1. Wave 3 ships the 3 remaining P1 + 3 surgical P2 fixes.

**Tech Stack:** Next.js 16, Prisma 7, TypeScript strict, Vitest, TanStack Query, shadcn/ui.

---

## File Structure

| File | Bug(s) | Task |
|---|---|---|
| `components/facility/contracts/contract-terms-page-client.tsx` | terms-3 — pass `availableItems` derived from pricing | 1 |
| `components/facility/contracts/contract-terms-page-client.tsx` + `lib/actions/contract-terms.ts::getContractTerms` | terms-4 — pre-fill tie-in + scope fields on Edit | 2 |
| `lib/rebates/calculate.ts::computeRebateFromPrismaTiers` | terms-5 — short-circuit non-percent rebate types | 3 |
| `components/contracts/amendment-extractor.tsx` | detail-4 — drop dead "pricing" breadcrumb step OR render it | 4 |
| `components/contracts/amendment-extractor.tsx` | detail-5 — sanitize `parseFloat` of AI-extracted currency values | 5 |
| `components/contracts/contract-score-radar.tsx` | score-4 — render 6th `priceCompetitivenessScore` axis | 6 |

---

## Task 1: Terms page passes `availableItems` to picker (terms-3 P1)

**Files:**
- Modify: `components/facility/contracts/contract-terms-page-client.tsx` (~line 194-199)
- Likely need: `lib/actions/pricing-files.ts` or query for `ContractPricing` rows

- [ ] **Step 1: Find the pricing-items source**

```bash
grep -nE "ContractPricing|contractPricing" lib/actions/ | head -10
grep -nE "vendorItemNo|description" prisma/schema.prisma | grep -i "contractPricing\|ContractPricing" | head -5
```

Confirm `ContractPricing` has `vendorItemNo` + `description` columns. If an action like `getContractPricing(contractId)` exists, use it. Otherwise query directly.

- [ ] **Step 2: Add a query + pass to `<ContractTermsEntry>`**

In `components/facility/contracts/contract-terms-page-client.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query"
// ...
const { data: pricingItems } = useQuery({
  queryKey: ["contracts", contractId, "pricing-items"] as const,
  queryFn: async () => {
    // Reuse an existing action if one exists. If not, create a tiny one.
    const res = await getContractPricing(contractId)
    return res
  },
  enabled: !!contractId,
})

const availableItems = useMemo(
  () =>
    (pricingItems ?? []).map((p) => ({
      vendorItemNo: p.vendorItemNo,
      description: p.description ?? null,
    })),
  [pricingItems],
)

// Then in the JSX:
<ContractTermsEntry
  terms={editTerms}
  onChange={setEditTerms}
  availableCategories={availableCategories}
  contractType={contract?.contractType}
  availableItems={availableItems}
/>
```

If no `getContractPricing` action exists, create a minimal one in `lib/actions/pricing-files.ts`:

```ts
export async function getContractPricing(contractId: string) {
  const { facility } = await requireFacility()
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true },
  })
  const rows = await prisma.contractPricing.findMany({
    where: { contractId },
    select: { vendorItemNo: true, description: true },
    orderBy: { vendorItemNo: "asc" },
  })
  return serialize(rows)
}
```

- [ ] **Step 3: tsc + commit**

```bash
bunx tsc --noEmit
git add components/facility/contracts/contract-terms-page-client.tsx lib/actions/pricing-files.ts
git commit -m "fix(contract-terms-page): pass pricing items into SpecificItemsPicker"
```

---

## Task 2: Pre-fill tie-in + scope fields on Edit (terms-4 P1)

**Files:**
- Modify: `lib/actions/contract-terms.ts::getContractTerms` — include `products: true` and select tie-in fields
- Modify: `components/facility/contracts/contract-terms-page-client.tsx:81-105` (`startEditing` mapper)

- [ ] **Step 1: Extend `getContractTerms` include**

Find the action (in `lib/actions/contract-terms.ts`). Current shape likely:

```ts
await prisma.contractTerm.findMany({
  where: { contractId },
  include: { tiers: { orderBy: { tierNumber: "asc" } } },
  orderBy: { createdAt: "asc" },
})
```

Add `products: true`:

```ts
include: {
  tiers: { orderBy: { tierNumber: "asc" } },
  products: { select: { vendorItemNo: true } },
},
```

- [ ] **Step 2: Extend `startEditing` mapper**

In `components/facility/contracts/contract-terms-page-client.tsx`, find the `startEditing` / `toEditTerms` mapper. Current code cherry-picks ~10 fields. Add:

```tsx
const mapped: TermFormValues[] = terms.map((t) => ({
  // ...existing fields...
  scopedCategoryIds: (t.categories as string[] | null) ?? [],
  scopedItemNumbers: (t.products ?? []).map((p) => p.vendorItemNo),
  capitalCost: t.capitalCost !== null ? Number(t.capitalCost) : null,
  interestRate: t.interestRate !== null ? Number(t.interestRate) : null,
  termMonths: t.termMonths !== null ? t.termMonths : null,
}))
```

Adjust field names to match the actual Prisma types (Decimal → Number coerce, nullable).

- [ ] **Step 3: tsc + commit**

```bash
bunx tsc --noEmit
git add components/facility/contracts/contract-terms-page-client.tsx lib/actions/contract-terms.ts
git commit -m "fix(contract-terms-page): pre-fill tie-in + scoped fields on Edit"
```

---

## Task 3: `computeRebateFromPrismaTiers` short-circuits non-percent types (terms-5 P1)

**Files:**
- Modify: `lib/rebates/calculate.ts::computeRebateFromPrismaTiers`
- Modify: `lib/rebates/__tests__/from-prisma-units.test.ts`

**Current:** scaling branch only handles `percent_of_spend`; `fixed_rebate`, `fixed_rebate_per_unit`, etc. fall through into the engine which unconditionally does `(spend * rebateValue) / 100`. Example: Medtronic tier 3 (rebateValue=100, type=fixed_rebate_per_unit) at spend=$750K returns $750,000 instead of a sensible unit-count-based number.

- [ ] **Step 1: Failing tests**

Add to `lib/rebates/__tests__/from-prisma-units.test.ts`:

```ts
it("returns 0 for fixed_rebate_per_unit tiers (unit count not available in this facade)", () => {
  const tiers = [
    {
      tierNumber: 1,
      rebateType: "fixed_rebate_per_unit" as const,
      rebateValue: new Decimal(100),
      spendMin: new Decimal(0),
      spendMax: null,
    },
  ]
  const r = computeRebateFromPrismaTiers(750_000, tiers, { method: "cumulative" })
  // Facade is spend-based. Unit-based tiers need computeRebateFromPrismaTerm.
  expect(r.rebateEarned).toBe(0)
})

it("returns the flat amount for fixed_rebate tiers", () => {
  const tiers = [
    {
      tierNumber: 1,
      rebateType: "fixed_rebate" as const,
      rebateValue: new Decimal(10_000),
      spendMin: new Decimal(0),
      spendMax: null,
    },
  ]
  const r = computeRebateFromPrismaTiers(500_000, tiers, { method: "cumulative" })
  // Flat amount — not scaled by spend.
  expect(r.rebateEarned).toBe(10_000)
})
```

- [ ] **Step 2: Run, expect FAIL**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/rebates/__tests__/from-prisma-units.test.ts
```

- [ ] **Step 3: Short-circuit in the facade**

In `lib/rebates/calculate.ts::computeRebateFromPrismaTiers`, before dispatching to the math engine, filter/transform tiers by `rebateType`:

```ts
export function computeRebateFromPrismaTiers(
  spend: number,
  tiers: Array<{
    tierNumber: number
    rebateType: RebateType
    rebateValue: Decimal
    spendMin: Decimal
    spendMax: Decimal | null
  }>,
  opts: { method?: "cumulative" | "marginal" } = {},
): { rebateEarned: number; rebatePercent: number; tierAchieved: number } {
  if (tiers.length === 0) {
    return { rebateEarned: 0, rebatePercent: 0, tierAchieved: 0 }
  }
  // Identify the applicable tier first (using spendMin like the engine does).
  const sortedTiers = [...tiers].sort((a, b) =>
    Number(a.spendMin) - Number(b.spendMin),
  )
  const applicable = sortedTiers.reduce<typeof sortedTiers[number] | null>(
    (best, t) => (spend >= Number(t.spendMin) ? t : best),
    null,
  )
  if (!applicable) {
    return { rebateEarned: 0, rebatePercent: 0, tierAchieved: 0 }
  }

  // Route by rebateType. This facade is a spend-based % estimator;
  // unit-based tiers need computeRebateFromPrismaTerm (which has the
  // full RebateConfig). Return 0 for unit-based to avoid silently
  // inflating values 100x.
  const rv = Number(applicable.rebateValue)
  switch (applicable.rebateType) {
    case "percent_of_spend": {
      // Existing percent-of-spend path — scale fractional .02 to 2% for
      // the math engine (mirrors lib/contracts/tier-rebate-label.ts).
      const scaled = sortedTiers.map((t) => ({
        tierNumber: t.tierNumber,
        spendMin: Number(t.spendMin),
        spendMax: t.spendMax === null ? null : Number(t.spendMax),
        rebateValue: Number(t.rebateValue) * 100,
      }))
      return calculateRebate(spend, scaled, opts.method ?? "cumulative")
    }
    case "fixed_rebate":
      return {
        rebateEarned: rv,
        rebatePercent: 0,
        tierAchieved: applicable.tierNumber,
      }
    case "fixed_rebate_per_unit":
    case "percent_per_unit":
    default:
      // Unit-based or unknown — can't compute from spend alone.
      return {
        rebateEarned: 0,
        rebatePercent: 0,
        tierAchieved: applicable.tierNumber,
      }
  }
}
```

Read the actual `RebateType` Prisma enum values in `prisma/schema.prisma` and add each case explicitly. The default branch returns 0 for unknown types.

- [ ] **Step 4: Run tests, tsc, commit**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/rebates
bunx tsc --noEmit
git add lib/rebates/calculate.ts lib/rebates/__tests__/from-prisma-units.test.ts
git commit -m "fix(rebates): short-circuit non-percent tier types in facade"
```

---

## Task 4: Fix amendment breadcrumb (detail-4 P1)

**File:** `components/contracts/amendment-extractor.tsx`

Current: breadcrumb shows 4 steps (Upload, Review, Pricing, Confirm) but `pricing` is never entered — `Stage` transitions upload → extracting → review → applying → done.

**Decision:** drop the dead "Pricing" step. The extractor doesn't split field changes from pricing changes; merging them in Review is fine.

- [ ] **Step 1: Remove `pricing` from the breadcrumb + `Stage` union**

Find:

```ts
const stages: Array<{key: string; label: string}> = [
  { key: "upload", label: "Upload" },
  { key: "review", label: "Review" },
  { key: "pricing", label: "Pricing" },
  { key: "confirm", label: "Confirm" },
]
```

Drop the `pricing` entry:

```ts
const stages: Array<{key: string; label: string}> = [
  { key: "upload", label: "Upload" },
  { key: "review", label: "Review" },
  { key: "confirm", label: "Confirm" },
]
```

Also remove `pricing` from the `Stage` union type and `nextStage` ordering.

- [ ] **Step 2: Update tests**

Tests for `nextStage` in `components/contracts/__tests__/amendment-stages.test.ts` currently assert `upload → review → pricing → confirm → applying → done`. Update to `upload → review → confirm → applying → done`.

- [ ] **Step 3: tsc + commit**

```bash
bunx tsc --noEmit
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' components/contracts/__tests__/amendment-stages.test.ts
git add components/contracts/amendment-extractor.tsx components/contracts/__tests__/amendment-stages.test.ts
git commit -m "fix(amendment): drop dead 'Pricing' breadcrumb step"
```

---

## Task 5: Sanitize AI numeric values (detail-5 P1)

**File:** `components/contracts/amendment-extractor.tsx:252-257`

Current: `parseFloat(change.newValue) || 0`. AI returns `"$350,000"` → parses to NaN → falls back to 0, silently clobbering contract totalValue.

- [ ] **Step 1: Extract + test a sanitize helper**

Add to the file (or a new `amendment-helpers.ts`):

```ts
export function sanitizeNumeric(raw: string): number {
  const cleaned = raw.replace(/[^\d.-]/g, "")
  const parsed = parseFloat(cleaned)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Could not parse "${raw}" as a number`)
  }
  return parsed
}

export function sanitizeInteger(raw: string): number {
  const n = sanitizeNumeric(raw)
  return Math.trunc(n)
}
```

Test in `components/contracts/__tests__/amendment-stages.test.ts` or a new test file:

```ts
describe("sanitizeNumeric", () => {
  it("strips $ and commas", () => {
    expect(sanitizeNumeric("$350,000")).toBe(350000)
    expect(sanitizeNumeric("1,234.56")).toBe(1234.56)
  })
  it("throws on unparseable input", () => {
    expect(() => sanitizeNumeric("three hundred")).toThrow()
  })
})
```

- [ ] **Step 2: Replace every `parseFloat(change.newValue) || 0` site**

Find each numeric coercion in the amendment extractor. Wrap with try/catch around the sanitize helper and surface the error to the user via toast (instead of silently writing 0).

- [ ] **Step 3: tsc + run tests + commit**

```bash
bunx tsc --noEmit
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' components/contracts/__tests__
git add components/contracts/amendment-extractor.tsx components/contracts/__tests__/amendment-stages.test.ts
git commit -m "fix(amendment): sanitize AI numeric values — throw on unparseable"
```

---

## Task 6: Render 6th radar dimension (score-4 P2)

**File:** `components/contracts/contract-score-radar.tsx:54-80`

Engine returns 6 components since commit `0ea0165`. Radar's internal data array still lists 5 — `priceCompetitivenessScore` missing.

- [ ] **Step 1: Add the missing axis**

Find the `data` array. Add:

```tsx
{
  dim: "Price Competitiveness",
  value: components.priceCompetitivenessScore ?? 100,
  benchmark: benchmark?.priceCompetitivenessScore ?? 100,
},
```

- [ ] **Step 2: tsc + commit**

```bash
bunx tsc --noEmit
git add components/contracts/contract-score-radar.tsx
git commit -m "fix(score-radar): render 6th priceCompetitivenessScore axis"
```

---

## Task 7: Smoke + finalize

- [ ] **Step 1: Full unit suite**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' 2>&1 | tail -5
```

- [ ] **Step 2: tsc**

```bash
bunx tsc --noEmit 2>&1 | tail -3
```

---

## Self-Review

| QA bug | Task |
|---|---|
| terms-3 (P1) | Task 1 |
| terms-4 (P1) | Task 2 |
| terms-5 (P1) | Task 3 |
| detail-4 (P1) | Task 4 |
| detail-5 (P1) | Task 5 |
| score-4 (P2) | Task 6 |

**Scope:** 6 independent tasks. Task 3 is the largest (rebate math) — dispatch to a more capable model if available. Tasks 1-2 both touch `contract-terms-page-client.tsx` — dispatch sequentially or to one subagent.

**Placeholders:** each step has runnable code or commands. No "handle edge cases" hand-waves.
