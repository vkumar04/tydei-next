# Charles W1.X-C — On vs Off Contract Spend: diagnostic + drilldown

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explain where the "Off Contract" $4.7M in Charles's contract detail card is coming from, re-bucket the reducer if the classification is misleading, and add a drilldown UX so the user can inspect the COG rows feeding each bucket.

**Architecture:** Diagnostic script first (captures matchStatus breakdown for the demo contract). Based on that, either re-bucket same-vendor-out-of-scope into a "Pre-Match" bucket separate from true off-contract leakage, or leave the reducer and add explanatory copy. Independent of Step 1, add per-bucket drilldowns in the card UI — each bucket has a collapsible "show rows" table with the top N COG rows, mirroring the existing "Top not-priced items" pattern.

**Tech Stack:** Next.js 16, Prisma 7, React Query, Vitest, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-04-20-charles-w1x-c-off-contract-spend-design.md`

---

### Task 1: Diagnostic — classify the $4.7M

**Files:**
- Create: `scripts/diagnose-off-contract-spend.ts`
- Create: `docs/superpowers/diagnostics/2026-04-20-w1x-c-off-contract.md`

- [ ] **Step 1: Write the script**

```ts
// scripts/diagnose-off-contract-spend.ts
// Usage: bun scripts/diagnose-off-contract-spend.ts <contractId>
// Classifies COG rows in the contract's off-contract-spend scope by
// matchStatus and writes a markdown breakdown.

import { prisma } from "@/lib/db"

async function main() {
  const contractId = process.argv[2]
  if (!contractId) throw new Error("Usage: bun scripts/... <contractId>")

  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    select: { id: true, name: true, vendorId: true, facilityId: true },
  })

  const scopeOR = [
    { contractId: contract.id },
    { contractId: null, vendorId: contract.vendorId },
  ]

  const breakdown = await prisma.cOGRecord.groupBy({
    by: ["matchStatus"],
    where: { facilityId: contract.facilityId ?? undefined, OR: scopeOR },
    _sum: { extendedPrice: true },
    _count: { _all: true },
  })

  const top = await prisma.cOGRecord.findMany({
    where: { facilityId: contract.facilityId ?? undefined, OR: scopeOR },
    orderBy: { extendedPrice: "desc" },
    take: 20,
    select: {
      id: true,
      vendorItemNo: true,
      description: true,
      extendedPrice: true,
      matchStatus: true,
      transactionDate: true,
      contractId: true,
    },
  })

  console.log(`# Off-contract diagnostic — ${contract.name} (${contract.id})\n`)
  console.log(`Vendor: ${contract.vendorId}\nFacility: ${contract.facilityId}\n`)
  console.log(`## By matchStatus\n`)
  console.log("| matchStatus | count | sum spend |")
  console.log("|---|---:|---:|")
  for (const b of breakdown) {
    console.log(`| ${b.matchStatus} | ${b._count._all} | $${Number(b._sum?.extendedPrice ?? 0).toFixed(0)} |`)
  }
  console.log(`\n## Top 20 rows in scope\n`)
  console.log("| vendorItem | desc | contractId | matchStatus | spend | date |")
  console.log("|---|---|---|---|---:|---|")
  for (const r of top) {
    console.log(`| ${r.vendorItemNo ?? ""} | ${(r.description ?? "").slice(0, 40)} | ${r.contractId ?? "(null)"} | ${r.matchStatus} | $${Number(r.extendedPrice).toFixed(0)} | ${r.transactionDate?.toISOString().slice(0, 10) ?? ""} |`)
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Find the contract id from Charles's screenshot**

The screenshot shows "Arthrex Surgical Center" / Contract Value $4,467,188. Query:

```bash
bun -e 'import("@/lib/db").then(async ({prisma}) => { const c = await prisma.contract.findFirst({where:{totalValue:{equals:4467188}},select:{id:true,name:true}}); console.log(c); process.exit(0)})'
```

Record the id.

- [ ] **Step 3: Run + capture**

```bash
bun scripts/diagnose-off-contract-spend.ts <contractId> > docs/superpowers/diagnostics/2026-04-20-w1x-c-off-contract.md
```

- [ ] **Step 4: Classify the output**

Open the diagnostics file. Decide which of these best describes the $4.7M:

- **(a)** `out_of_scope` or `unknown_vendor` rows on the same vendor with `contractId: null` — un-enriched / match hasn't run. ⇒ Reducer is misleading (same-vendor rows shouldn't appear as "leakage"). Go to Task 2.
- **(b)** Rows stamped `on_contract` but for some reason not counted in the "On Contract" bucket. ⇒ Reducer bug. Investigate the reducer's filter.
- **(c)** `unknown_vendor` rows genuinely from different vendors — actual leakage. ⇒ Numbers are right; only the UX needs to help the user see this.

Note the classification at the top of the diagnostics file. Subsequent tasks branch on it.

- [ ] **Step 5: Commit**

```bash
git add scripts/diagnose-off-contract-spend.ts docs/superpowers/diagnostics/2026-04-20-w1x-c-off-contract.md
git commit -m "docs(diagnostic): W1.X-C off-contract classification snapshot"
```

---

### Task 2: Re-bucket same-vendor out-of-scope (gated on diagnostic = a or b)

**Files:**
- Modify: `lib/actions/contracts/off-contract-spend.ts`
- Modify: `lib/actions/contracts/__tests__/off-contract-spend.test.ts`

**Only do this task if Task 1 classified the $4.7M as (a) or (b).** If (c), skip to Task 3.

- [ ] **Step 1: Write failing test for the new bucket**

```ts
// lib/actions/contracts/__tests__/off-contract-spend.test.ts — add:
it("classifies same-vendor out_of_scope rows as preMatch, not offContract", async () => {
  const { contractId } = await seedContractWithSameVendorOutOfScope({
    sameVendorOutOfScope: 4_700_000,
    trueUnknownVendor: 0,
  })
  const result = await getOffContractSpend(contractId)
  expect(result.preMatch).toBe(4_700_000)
  expect(result.offContract).toBe(0)
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bunx vitest run lib/actions/contracts/__tests__/off-contract-spend.test.ts`
Expected: `preMatch` is `undefined`, test fails.

- [ ] **Step 3: Re-bucket the reducer**

In `lib/actions/contracts/off-contract-spend.ts`, update the result interface:

```ts
export interface OffContractSpendResult {
  onContract: number
  notPriced: number
  preMatch: number        // same-vendor out_of_scope — un-matched
  offContract: number     // unknown_vendor only — genuine leakage
  topNotPriced: OffContractSpendItem[]
  topPreMatch: OffContractSpendItem[]
  topOffContract: OffContractSpendItem[]
  offContractItems: OffContractSpendItem[] // @deprecated alias
}
```

Split the existing `offAgg` into two:

```ts
const [onAgg, notPricedAgg, preMatchAgg, offAgg, notPricedItems, preMatchItems, offItems] =
  await Promise.all([
    // onAgg unchanged
    prisma.cOGRecord.aggregate({
      where: { facilityId: facility.id, OR: scopeOR, matchStatus: { in: ["on_contract", "price_variance"] } },
      _sum: { extendedPrice: true },
    }),
    // notPricedAgg unchanged
    prisma.cOGRecord.aggregate({
      where: { facilityId: facility.id, OR: scopeOR, matchStatus: "off_contract_item" },
      _sum: { extendedPrice: true },
    }),
    // NEW: preMatch = same-vendor rows with out_of_scope OR (unknown_vendor with vendorId match)
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        OR: scopeOR,
        matchStatus: "out_of_scope",
      },
      _sum: { extendedPrice: true },
    }),
    // offAgg narrowed to unknown_vendor only
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        OR: scopeOR,
        matchStatus: "unknown_vendor",
      },
      _sum: { extendedPrice: true },
    }),
    // notPricedItems unchanged; add preMatchItems + offItems split on matchStatus
    prisma.cOGRecord.groupBy({
      by: ["vendorItemNo"],
      where: { facilityId: facility.id, OR: scopeOR, matchStatus: "off_contract_item", vendorItemNo: { not: null } },
      _sum: { extendedPrice: true }, orderBy: { _sum: { extendedPrice: "desc" } }, take: 10,
    }),
    prisma.cOGRecord.groupBy({
      by: ["vendorItemNo"],
      where: { facilityId: facility.id, OR: scopeOR, matchStatus: "out_of_scope", vendorItemNo: { not: null } },
      _sum: { extendedPrice: true }, orderBy: { _sum: { extendedPrice: "desc" } }, take: 10,
    }),
    prisma.cOGRecord.groupBy({
      by: ["vendorItemNo"],
      where: { facilityId: facility.id, OR: scopeOR, matchStatus: "unknown_vendor", vendorItemNo: { not: null } },
      _sum: { extendedPrice: true }, orderBy: { _sum: { extendedPrice: "desc" } }, take: 10,
    }),
  ])
```

Update the return to include `preMatch` + `topPreMatch`. Keep `offContractItems` as an alias for `topOffContract` for back-compat.

- [ ] **Step 4: Run test — expect PASS**

Run: `bunx vitest run lib/actions/contracts/__tests__/off-contract-spend.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/contracts/off-contract-spend.ts lib/actions/contracts/__tests__/off-contract-spend.test.ts
git commit -m "fix(contracts): W1.X-C split preMatch from offContract

Same-vendor out_of_scope rows were rolling into the 'Off Contract'
bucket and reading as leakage. They are actually 'pre-match' — SKUs
on this contract's vendor that the matcher hasn't classified.
offContract is now narrowed to unknown_vendor; the real leakage case."
```

---

### Task 3: UI — per-bucket drilldown

**Files:**
- Modify: `components/contracts/off-contract-spend-card.tsx`
- Modify: `lib/actions/contracts/off-contract-spend.ts` (add `topOnContract`)

- [ ] **Step 1: Add topOnContract aggregation**

In `lib/actions/contracts/off-contract-spend.ts`, add an `onItems` `groupBy` paralleling `notPricedItems`, and include `topOnContract` in the returned result. Update `OffContractSpendResult`:

```ts
topOnContract: OffContractSpendItem[]
```

- [ ] **Step 2: Update the card**

In `components/contracts/off-contract-spend-card.tsx`:

1. If Task 2 ran, render a fourth bucket card for `Pre-Match` with the same layout as `Not Priced`, showing `{formatCurrency(data.preMatch)}` and a tooltip explaining "Same-vendor SKUs the matcher hasn't classified yet. Click Re-run match on COG Data to resolve."
2. Replace each "Top X items" table with a shared `<BucketDrilldown title="..." items={...} />` subcomponent that shows a table with vendor item, spend, and up to 10 rows. Add an "On Contract" drilldown alongside the existing Not Priced and Off Contract ones.

```tsx
function BucketDrilldown({
  title,
  items,
  emptyMessage,
}: {
  title: string
  items: OffContractSpendItem[]
  emptyMessage: string
}) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyMessage}</p>
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-2 inline-flex items-center gap-1 text-sm font-medium hover:underline"
      >
        {open ? "▼" : "▶"} {title} ({items.length})
      </button>
      {open ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor Item</TableHead>
              <TableHead className="text-right">Spend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={`${title}-${i.vendorItemNo}`}>
                <TableCell className="font-mono text-xs">{i.vendorItemNo}</TableCell>
                <TableCell className="text-right">{formatCurrency(i.totalSpend)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  )
}
```

Render them:

```tsx
<BucketDrilldown
  title="On-contract items"
  items={data.topOnContract}
  emptyMessage="No on-contract spend recorded yet."
/>
<BucketDrilldown
  title="Not-priced items"
  items={data.topNotPriced}
  emptyMessage="No not-priced spend."
/>
{"preMatch" in data && (data as { preMatch: number }).preMatch > 0 ? (
  <BucketDrilldown
    title="Pre-match items"
    items={(data as { topPreMatch: OffContractSpendItem[] }).topPreMatch}
    emptyMessage="No pre-match spend."
  />
) : null}
<BucketDrilldown
  title="Off-contract items"
  items={data.topOffContract}
  emptyMessage="No off-contract spend recorded."
/>
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Smoke**

`rm -rf .next && bun run dev` → open the contract from Charles's screenshot → Performance tab → On vs Off Contract Spend card → confirm each of On / Not Priced / (Pre-Match if Task 2 ran) / Off Contract has an expand-able drilldown, and the row breakdowns make the $4.7M legible.

- [ ] **Step 5: Commit**

```bash
git add components/contracts/off-contract-spend-card.tsx lib/actions/contracts/off-contract-spend.ts
git commit -m "feat(contracts): W1.X-C per-bucket drilldown on spend card"
```

---

### Task 4: Test coverage for the drilldown

**Files:**
- Modify: `lib/actions/contracts/__tests__/off-contract-spend.test.ts`

- [ ] **Step 1: Add a test for topOnContract shape**

```ts
it("returns top on-contract items ordered by spend desc", async () => {
  const { contractId } = await seedContractWithOnContractSpend({
    items: [
      { vendorItemNo: "SKU-A", spend: 1000 },
      { vendorItemNo: "SKU-B", spend: 5000 },
      { vendorItemNo: "SKU-C", spend: 2500 },
    ],
  })
  const result = await getOffContractSpend(contractId)
  expect(result.topOnContract.map((i) => i.vendorItemNo)).toEqual(["SKU-B", "SKU-C", "SKU-A"])
})
```

- [ ] **Step 2: Run + fix + commit**

Run: `bunx vitest run lib/actions/contracts/__tests__/off-contract-spend.test.ts`
Expected: PASS (since Task 3 Step 1 already added `topOnContract`).

```bash
git add lib/actions/contracts/__tests__/off-contract-spend.test.ts
git commit -m "test(contracts): W1.X-C cover topOnContract shape"
```

---

### Task 5: Full verify

- [ ] **Step 1: Typecheck + test suite**

Run: `bunx tsc --noEmit && bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'`
Expected: 0 errors; all green.

- [ ] **Step 2: UI smoke**

1. `rm -rf .next && bun run dev`
2. Open Charles's contract → On vs Off card.
3. Expected outcome:
   - If Task 2 ran: Off Contract shrinks toward $0; a new Pre-Match card shows the $4.7M with an explanation + drilldown listing the un-matched SKUs.
   - If Task 2 did not run: Off Contract still shows $4.7M but each bucket has a drilldown so Charles can inspect which SKUs compose it.

- [ ] **Step 3: No commit if verification only** unless copy/tooltip tweaks came up during smoking.

---

## Self-Review

**Spec coverage:**
- ✓ Diagnostic + output (Task 1)
- ✓ Re-bucket if misclassified (Task 2, gated on diagnostic)
- ✓ Drilldown per bucket — all three, plus Pre-Match if it exists (Task 3)
- ✓ `topOnContract` server field (Task 3 Step 1)
- ✓ Tests (Tasks 2, 4)

**Placeholders:** the phrase "`<contractId>`" in Task 1 Step 3 is concrete (to be filled from Step 2's query output, not a lingering TODO). The gating in Task 2 is a planned branch, not a placeholder.

**Type consistency:** `OffContractSpendResult` gains `preMatch`, `topPreMatch`, `topOnContract` (Tasks 2 and 3 Step 1). The card component's consumer uses type narrowing (`"preMatch" in data`) so a run where Task 2 was skipped doesn't blow up.
