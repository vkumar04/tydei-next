# Charles Bug-Bash Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each task is independent — dispatch each in its own worktree, review, then cherry-pick to main.

**Goal:** Fix the 5 open issues remaining from Charles's 2026-04-18 bug bash:
- Bug 9 — "Specific Items" Product Scope has no actual item-picker UI
- Bug 10 — Tie-in contracts UI doesn't expose the schema's tie-in fields
- Bug 11 — `from-prisma.ts` passes fractional rebate values into the engine, causing 100× under-computation
- Bug 12 — Case Costing page renders shell + help text but no data
- Bug 13 — "Cumulative (whole-spend at top tier)" / "Marginal (per-bracket rate)" lingo is confusing for ops users

**Architecture:** All fixes are surgical. Bug 11 is the only correctness-critical change (engine math); ship its regression test before touching the converter. Bug 12 is investigative — root-cause first, then patch. Bugs 9/10/13 are UI-layer additions or label tweaks. Each task ships its own Vitest regression where the bug was server-side.

**Tech Stack:** Next.js 16, Prisma 7, TypeScript strict, Vitest, TanStack Query, shadcn/ui.

**Working DB for verification:** `postgresql://tydei:tydei_dev_password@localhost:5432/tydei`. Demo facility = "Lighthouse Community Hospital", id = `cmo4sbr8p0004wthl91ubwfwb`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `lib/rebates/__tests__/from-prisma-units.test.ts` | Regression: percent_of_spend tier with `rebateValue=0.02` (fractional) → 2% rebate, NOT 0.02% | 11 |
| `lib/rebates/from-prisma.ts` | Multiply `rebateValue` by 100 when `rebateType === "percent_of_spend"` before passing to engine, mirroring the display convention in `lib/contracts/tier-rebate-label.ts` | 11 |
| `components/contracts/contract-terms-entry.tsx` | Add `<SpecificItemsPicker/>` rendered when `term.appliesTo === "specific_items"`. Allow multi-select of `{vendorItemNo, description}` pairs from the contract's pricing items + COG records. Persist via existing `term.scopedItems` field (or add a new `term.scopedItemNumbers: string[]`) | 9 |
| `lib/validators/contract-terms.ts` | Add `scopedItemNumbers: z.array(z.string()).optional()` to TermFormValues schema | 9 |
| `components/contracts/__tests__/specific-items-picker.test.tsx` | Renders multi-select with provided items; selection is persisted to onChange payload | 9 |
| `components/contracts/contract-terms-entry.tsx` | Replace `Cumulative (whole-spend at top tier)` / `Marginal (per-bracket rate)` with clearer copy + tooltip explaining the math | 13 |
| `components/contracts/contract-terms-entry.tsx` (separate diff) | When `termType === "tie_in"` (or contract.contractType === "tie_in"), surface the tie-in fields: capital cost, payoff months, bundle compliance mode | 10 |
| `app/dashboard/case-costing/page.tsx` + `components/facility/case-costing/case-costing-client.tsx` | Diagnose why no data renders. Likely cause: `getCases`/`getFacilityCases` returning empty due to filter mismatch after the case-costing rewrite. Fix the action OR the client filter | 12 |
| `lib/actions/case-costing/__tests__/cases-list.test.ts` | Regression: `getCases({})` returns the demo facility's case rows | 12 |

---

## Task 11: Rebate engine math 100× off

**Why first:** This is a correctness bug — every contract's projected/computed rebate is currently 100× under-computed because `from-prisma.ts` passes fractional `rebateValue` (0.02) straight to the engine, which then divides by 100 again. Display side was patched in `e0d5226` but the engine path still feeds wrong values to the dashboard charts, the rebate optimizer projections, and contract-score recompute.

**Files:**
- Create: `lib/rebates/__tests__/from-prisma-units.test.ts`
- Modify: `lib/rebates/from-prisma.ts`

- [ ] **Step 1: Write failing test**

```ts
// lib/rebates/__tests__/from-prisma-units.test.ts
import { describe, it, expect } from "vitest"
import { Decimal } from "decimal.js"
import { computeRebateFromPrismaTiers } from "@/lib/rebates/calculate"

describe("computeRebateFromPrismaTiers — fractional percent_of_spend storage", () => {
  it("treats Prisma-stored 0.02 as 2% (not 0.02%)", () => {
    const tiers = [
      {
        tierNumber: 1,
        rebateType: "percent_of_spend" as const,
        rebateValue: new Decimal(0.02), // stored fractionally
        spendMin: new Decimal(0),
        spendMax: new Decimal(500_000),
      },
    ]
    // 100k @ 2% should be $2,000, not $20.
    const result = computeRebateFromPrismaTiers(100_000, tiers, { method: "cumulative" })
    expect(result.rebateEarned).toBe(2_000)
  })

  it("preserves fixed_rebate_per_unit (no scaling)", () => {
    const tiers = [
      {
        tierNumber: 1,
        rebateType: "fixed_rebate_per_unit" as const,
        rebateValue: new Decimal(50),
        spendMin: new Decimal(0),
        spendMax: null,
        volumeMin: 0,
        volumeMax: null,
      },
    ]
    const r = computeRebateFromPrismaTiers(100, tiers, { method: "cumulative" })
    // engine treats this as 100 units × $50 = $5,000 — must not be 5,000 / 100
    expect(r.rebateEarned).toBe(5_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx vitest run lib/rebates/__tests__/from-prisma-units.test.ts
```

Expected: FAIL — `Expected 2000, received 20`.

- [ ] **Step 3: Investigate + patch**

Open `lib/rebates/from-prisma.ts` and find every place that reads a tier's `rebateValue` to feed the engine. The engine does its own `× rebateValue / 100` for percent_of_spend, so the converter must multiply by 100 first when the storage convention is fractional. Reference `lib/contracts/tier-rebate-label.ts` (created by Bug 8 subagent) for the centralized convention.

Suggested patch (if `from-prisma.ts` has a tier mapper):

```ts
function tierEngineValue(rebateType: string, raw: Decimal | number | null): number {
  const n = raw == null ? 0 : Number(raw)
  // Storage convention (mirrors lib/contracts/tier-rebate-label.ts):
  // percent_of_spend stored as fraction (0.02 = 2%). Engine expects %.
  return rebateType === "percent_of_spend" ? n * 100 : n
}
```

Then replace each `Number(t.rebateValue)` site with `tierEngineValue(t.rebateType, t.rebateValue)`.

- [ ] **Step 4: Run test + full rebate suite**

```bash
bunx vitest run lib/rebates --reporter=verbose
bunx tsc --noEmit
```

Expected: PASS, 0 type errors. Pre-existing tests in `lib/rebates/__tests__/` may have been written expecting the broken behavior — read each failing test before changing it, and only update the test if the new value is the spec-correct one (use the demo seed: 0.02 stored → 2% rebate).

- [ ] **Step 5: Commit**

```bash
git add lib/rebates/from-prisma.ts lib/rebates/__tests__/from-prisma-units.test.ts
git commit -m "fix(rebates): scale fractional rebateValue when feeding the engine"
```

---

## Task 12: Case Costing page renders no data

**Why:** Charles screenshot — page shows "How Case Costing Works" + tabs (Cases, Surgeons, Financial, Compliance) + filters but the data area below is empty. Either the page-level fetch is returning `[]` or the client component isn't reading the result.

**Files:**
- Investigate `app/dashboard/case-costing/page.tsx` and `components/facility/case-costing/case-costing-client.tsx`
- Likely fix in `lib/actions/case-costing/cases-list.ts` (or wherever the cases query lives)
- Create a regression test

- [ ] **Step 1: Reproduce locally**

```bash
cat > /tmp/check_cases.ts <<'EOF'
import { prisma } from '/Users/vickkumar/code/tydei-next/lib/db'
const facility = await prisma.facility.findFirst()
const cases = await prisma.caseRecord.count({ where: { facilityId: facility!.id } })
console.log('facility cases:', cases)
const procs = await prisma.caseProcedure.count()
const supplies = await prisma.caseSupply.count()
console.log('procs:', procs, 'supplies:', supplies)
process.exit(0)
EOF
DATABASE_URL=postgresql://tydei:tydei_dev_password@localhost:5432/tydei bun /tmp/check_cases.ts
```

If `cases > 0`, the bug is in the action filter or the client. If `cases === 0`, the demo seed is missing — note this and stop (separate task).

- [ ] **Step 2: Trace the read path**

Open `app/dashboard/case-costing/page.tsx`. Find the action it calls. Open the action and the client. Look for:
- A `.where` clause on `prisma.caseRecord.findMany` that adds an extra filter (e.g. requires a join row or a status the seed doesn't have).
- A serializer call returning `[]` because `serialize(...)` mishandles the shape.
- A query-key mismatch between page's prefetched data and client's `useQuery`.

- [ ] **Step 3: Write failing test, then fix**

Once you've identified the action that returns `[]`, write a Vitest mocking prisma to return one case row and assert the action returns that row. Then patch the filter/serializer that's swallowing it. Run:

```bash
bunx vitest run lib/actions/case-costing
bunx tsc --noEmit
```

- [ ] **Step 4: Smoke against dev**

Restart the prod-like server, log in as `demo-facility@tydei.com`, hit `/dashboard/case-costing`, confirm at least one case row renders in the Cases tab.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/case-costing/ components/facility/case-costing/
git commit -m "fix(case-costing): cases tab renders rows again"
```

---

## Task 9: Specific Items picker

**Why:** Term form's "Product Scope" dropdown offers "Specific Items" but selecting it does nothing — there's no follow-up UI to actually pick items. Charles needs to scope a tier to a specific list of vendor item numbers (e.g. "this rebate only applies to these 5 catalog numbers").

**Files:**
- Create: `components/contracts/specific-items-picker.tsx`
- Modify: `components/contracts/contract-terms-entry.tsx` — render the picker when `appliesTo === "specific_items"`
- Modify: `lib/validators/contract-terms.ts` — add `scopedItemNumbers: z.array(z.string()).optional()` to the TermFormValues schema (if not already present)
- Modify: `lib/actions/contract-terms.ts` — persist `scopedItemNumbers` via the existing `ContractTermProduct` join table (one row per vendorItemNo)
- Create: `components/contracts/__tests__/specific-items-picker.test.tsx`

- [ ] **Step 1: Survey existing data**

```bash
grep -n "model ContractTermProduct\|vendorItemNo" prisma/schema.prisma | head -10
```

`ContractTermProduct` model exists. Use its `vendorItemNo` column.

- [ ] **Step 2: Write failing test**

```tsx
// components/contracts/__tests__/specific-items-picker.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SpecificItemsPicker } from "@/components/contracts/specific-items-picker"

describe("SpecificItemsPicker", () => {
  it("renders provided items and emits selection on click", () => {
    const onChange = vi.fn()
    render(
      <SpecificItemsPicker
        availableItems={[
          { vendorItemNo: "STK-001", description: "Stryker plate, 6-hole" },
          { vendorItemNo: "STK-002", description: "Stryker plate, 8-hole" },
        ]}
        selected={[]}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText(/STK-001/))
    expect(onChange).toHaveBeenCalledWith(["STK-001"])
  })

  it("renders empty state when no items provided", () => {
    render(
      <SpecificItemsPicker availableItems={[]} selected={[]} onChange={() => {}} />,
    )
    expect(
      screen.getByText(/Add a pricing file to enable item-level scoping/i),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test → expect FAIL**

```bash
bunx vitest run components/contracts/__tests__/specific-items-picker.test.tsx
```

- [ ] **Step 4: Implement the picker**

```tsx
// components/contracts/specific-items-picker.tsx
"use client"

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"

export interface VendorItem {
  vendorItemNo: string
  description?: string | null
}

interface Props {
  availableItems: VendorItem[]
  selected: string[]
  onChange: (next: string[]) => void
}

export function SpecificItemsPicker({ availableItems, selected, onChange }: Props) {
  const [filter, setFilter] = useState("")
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return availableItems
    return availableItems.filter(
      (i) =>
        i.vendorItemNo.toLowerCase().includes(f) ||
        (i.description ?? "").toLowerCase().includes(f),
    )
  }, [filter, availableItems])

  if (availableItems.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Add a pricing file to enable item-level scoping.
      </p>
    )
  }

  function toggle(vendorItemNo: string) {
    if (selected.includes(vendorItemNo)) onChange(selected.filter((s) => s !== vendorItemNo))
    else onChange([...selected, vendorItemNo])
  }

  return (
    <div className="space-y-2">
      <Input
        type="search"
        placeholder="Search items..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ScrollArea className="h-48 rounded-md border p-2">
        <ul className="space-y-1">
          {filtered.map((item) => (
            <li
              key={item.vendorItemNo}
              className="flex items-center gap-2 rounded px-2 py-1 hover:bg-accent cursor-pointer"
              onClick={() => toggle(item.vendorItemNo)}
            >
              <Checkbox checked={selected.includes(item.vendorItemNo)} />
              <span className="font-mono text-xs">{item.vendorItemNo}</span>
              {item.description && (
                <span className="truncate text-xs text-muted-foreground">{item.description}</span>
              )}
            </li>
          ))}
        </ul>
      </ScrollArea>
      <p className="text-xs text-muted-foreground">{selected.length} selected</p>
    </div>
  )
}
```

- [ ] **Step 5: Wire into contract-terms-entry**

In `components/contracts/contract-terms-entry.tsx`, right after the `specific_category` Field block (~line 405), add:

```tsx
{term.appliesTo === "specific_items" && (
  <Field label="Items">
    <SpecificItemsPicker
      availableItems={availableItems /* prop on ContractTermsEntry */}
      selected={term.scopedItemNumbers ?? []}
      onChange={(next) => updateTerm(termIdx, { scopedItemNumbers: next })}
    />
  </Field>
)}
```

Add `availableItems?: VendorItem[]` to `ContractTermsEntryProps`. Default to `[]`. Callers (new-contract-client, edit-contract-client, contract-terms-page-client) should pass the contract's pricing items.

- [ ] **Step 6: Persist via the action**

In `lib/actions/contract-terms.ts`, after creating the `ContractTerm`, also create `ContractTermProduct` rows for each `scopedItemNumbers` entry. Use upsert if the row may already exist.

```ts
if (data.scopedItemNumbers?.length) {
  await prisma.contractTermProduct.createMany({
    data: data.scopedItemNumbers.map((vendorItemNo) => ({
      termId: term.id,
      vendorItemNo,
    })),
    skipDuplicates: true,
  })
}
```

- [ ] **Step 7: Run tests + tsc + commit**

```bash
bunx vitest run components/contracts/__tests__/specific-items-picker.test.tsx
bunx tsc --noEmit
git add components/contracts/specific-items-picker.tsx components/contracts/contract-terms-entry.tsx components/contracts/__tests__/specific-items-picker.test.tsx lib/validators/contract-terms.ts lib/actions/contract-terms.ts
git commit -m "feat(contract-terms): SpecificItemsPicker for tier-scoped vendor items"
```

---

## Task 10: Tie-in contract UI

**Why:** Charles: "No changes to the Tie in contracts that we discussed". The `TieInBundle` model (prisma/schema.prisma ~line 877) has `complianceMode` (`all_or_nothing` | `proportional`) and `bonusMultiplier`, plus the `ContractTerm` has `capitalCost`, `interestRate`, `termMonths` for tie-in capital schedules. None of these are exposed on the term form or contract detail.

**Files:**
- Modify: `components/contracts/contract-terms-entry.tsx` — when `termType === "fixed_fee"` OR contract.contractType === "tie_in", render `capitalCost / interestRate / termMonths` inputs
- Modify: `components/contracts/contract-detail-client.tsx` — add a "Tie-in" badge + summary section when contract.contractType === "tie_in"
- Investigate whether a `TieInBundle` create/update action exists; if not, defer the bundle-level fields with a TODO note in the spec

- [ ] **Step 1: Survey schema fields**

```bash
grep -nE "tie_in|TieIn|capitalCost|complianceMode|bonusMultiplier" prisma/schema.prisma | head -20
```

- [ ] **Step 2: Write failing test for the term form section**

```tsx
// components/contracts/__tests__/tie-in-fields.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ContractTermsEntry } from "@/components/contracts/contract-terms-entry"

describe("ContractTermsEntry — tie-in fields", () => {
  it("shows capital cost / interest rate / term months when contractType is tie_in", () => {
    const onChange = vi.fn()
    render(
      <ContractTermsEntry
        terms={[{
          termName: "Capital schedule",
          termType: "fixed_fee",
          baselineType: "spend_based",
          evaluationPeriod: "annual",
          paymentTiming: "quarterly",
          appliesTo: "all_products",
          rebateMethod: "cumulative",
          effectiveStart: "2026-01-01",
          effectiveEnd: "2029-01-01",
          tiers: [],
        }]}
        contractType="tie_in"
        onChange={onChange}
      />
    )
    expect(screen.getByLabelText(/Capital Cost/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Interest Rate/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Term \(months\)/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Implement**

Add `contractType?: string` prop to `ContractTermsEntry`. When `contractType === "tie_in"`, render an extra `<details>` section per term:

```tsx
{contractType === "tie_in" && (
  <div className="grid gap-4 sm:grid-cols-3 rounded-md border p-3">
    <Field label="Capital Cost ($)">
      <Input type="number" value={term.capitalCost ?? ""} onChange={(e) => updateTerm(termIdx, { capitalCost: e.target.value === "" ? null : Number(e.target.value) })} />
    </Field>
    <Field label="Interest Rate (%)">
      <Input type="number" step="0.0001" value={term.interestRate ?? ""} onChange={(e) => updateTerm(termIdx, { interestRate: e.target.value === "" ? null : Number(e.target.value) })} />
    </Field>
    <Field label="Term (months)">
      <Input type="number" value={term.termMonths ?? ""} onChange={(e) => updateTerm(termIdx, { termMonths: e.target.value === "" ? null : Number(e.target.value) })} />
    </Field>
  </div>
)}
```

Update `TermFormValues` validator to include the three fields as optional nullable numbers.

In `contract-detail-client.tsx`, when `contract.contractType === "tie_in"`, add a small Card "Tie-In Capital" showing the first term's capitalCost / payoffMonths formatted.

- [ ] **Step 4: Verify + commit**

```bash
bunx vitest run components/contracts/__tests__/tie-in-fields.test.tsx
bunx tsc --noEmit
git add components/contracts/contract-terms-entry.tsx components/contracts/contract-detail-client.tsx lib/validators/contract-terms.ts components/contracts/__tests__/tie-in-fields.test.tsx
git commit -m "feat(contracts): tie-in capital schedule fields on term form + detail summary"
```

---

## Task 13: Rebate calculation lingo

**Why:** Charles: "Not sure about this rebate calculation lingo changes". The "Cumulative (whole-spend at top tier)" / "Marginal (per-bracket rate)" labels are technically correct but ops users find them confusing.

**Files:**
- Modify: `components/contracts/contract-terms-entry.tsx` (~lines 335-340)

- [ ] **Step 1: Replace labels with plain-English equivalents + worked example**

Replace the two SelectItems with:

```tsx
<SelectItem value="cumulative">
  <div className="flex flex-col">
    <span className="font-medium">Whole-spend at the highest tier</span>
    <span className="text-xs text-muted-foreground">All spend earns the rate of the top tier reached. Example: $750K at tier 3 (3%) → $22,500.</span>
  </div>
</SelectItem>
<SelectItem value="marginal">
  <div className="flex flex-col">
    <span className="font-medium">Each bracket at its own rate</span>
    <span className="text-xs text-muted-foreground">Spend in each bracket earns that bracket&apos;s rate, summed. Example: $500K @ 2% + $250K @ 3% → $17,500.</span>
  </div>
</SelectItem>
```

Also add an info `<Tooltip>` icon next to the "Rebate Calculation Method" label linking to `/help/rebate-methods` (or just inline the example again).

- [ ] **Step 2: Type check + commit**

```bash
bunx tsc --noEmit
git add components/contracts/contract-terms-entry.tsx
git commit -m "fix(contract-terms): plain-English rebate-method labels with worked examples"
```

---

## Task 14: Smoke + finalize

After every task is cherry-picked to main:

- [ ] **Step 1: Run full Vitest**

```bash
bunx vitest run --reporter=verbose 2>&1 | tail -30
```

- [ ] **Step 2: Build**

```bash
bun run build 2>&1 | tail -10
```

- [ ] **Step 3: Smoke pages as demo facility**

```bash
PORT=3002 bun run start &
sleep 6
curl -sL -c /tmp/c.txt -X POST http://localhost:3002/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"demo-facility@tydei.com","password":"demo-facility-2024"}' | tail -1
for p in /dashboard /dashboard/contracts /dashboard/case-costing /dashboard/contracts/new; do
  code=$(curl -sL -b /tmp/c.txt -o /tmp/p.html -w "%{http_code}" "http://localhost:3002$p")
  err=$(grep -c '"digest"' /tmp/p.html 2>/dev/null)
  echo "$p HTTP=$code digest_errors=$err"
done
```

Expected: all 200, all `digest_errors=0`.

- [ ] **Step 4: Push (already shipped per-task)**

If anything still un-pushed: `git push origin main`.

---

## Self-Review

| Bug | Task |
|---|---|
| 9 — Specific Items picker | Task 9 |
| 10 — Tie-in not surfaced | Task 10 |
| 11 — Engine math 100× off | Task 11 |
| 12 — Case Costing empty | Task 12 |
| 13 — Cumulative/Marginal lingo | Task 13 |

**Type consistency:** `VendorItem` in Task 9 (`{vendorItemNo: string, description?: string | null}`). `tierEngineValue` in Task 11 returns number. `ContractTermsEntry`'s new `contractType` prop is `string` matching the Prisma enum casing.

**Placeholder scan:** every step has runnable code or a runnable command. Investigation steps in Task 12 are bounded by "if X then Y else stop" decision rules, not open-ended.
