# Math Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make rebate forecasts populate for carve-out contracts, surface the carve-out % in the pricing tab, add reference-number (manufacturer-number) matching across grouped vendors, and verify per-category market share.

**Architecture:** Keep the pure forecast/match engines pure; push all Prisma + rate-derivation into the server actions/loaders that call them. The carve-out forecast adds a single `carveOutEffectiveRate` flat-rate branch to the engine (derived from `ContractPricing.carveOutPercent`, the same source the carve-out rebate engine uses). Reference-number matching adds a manufacturer-number fallback to the existing SKU lookup in `matchCOGRecordToContract`, carrying a real contract price.

**Tech Stack:** Next.js 16 App Router, Prisma 7, TypeScript strict (no `any`), Vitest. Tests: `bun run test:unit`. Oracles: `bun scripts/oracles/index.ts --filter <name>`.

**Scope:** Units A (carve-out forecast), B (pricing column), C (reference matching), D (market-share verify). Unit E (baseline vs. min-annual clarification) is **deferred pending Charles's answers** and is NOT in this plan.

**Resolved design choices (from spec Q5/Q6):**
- Q5: carve-out rate source is `ContractPricing.carveOutPercent` (all `PERCENT_OF_SPEND`). Forecast effective rate = trailing carve-out rebate ÷ trailing total spend, over the same 24-month window the forecast already pulls.
- Q6: reference-number match keys COG `manufacturerNo` against `ContractPricing.manufacturerNo`, so it carries a `unitPrice`/`listPrice` and produces normal `on_contract`/`price_variance` results — no new `MatchResult` shape.

---

## File Structure

**Unit A — carve-out forecast**
- Modify: `lib/contracts/rebate-forecast-engine.ts` — add `carveOutEffectiveRate` input + flat-rate branch; drop `carve_out` from `SPEND_BASED_TERM_TYPES`.
- Modify: `lib/actions/analytics/rebate-forecast.ts` — derive the rate, widen COG scope to the vendor group, pass the rate.
- Create: `lib/contracts/__tests__/rebate-forecast-engine.test.ts` — engine unit tests.

**Unit B — pricing tab column**
- Modify: `components/contracts/contract-pricing-tab.tsx` — add "Carve-Out %" header + cell.

**Unit C — reference-number matching**
- Modify: `lib/contracts/match.ts` — add `manufacturerNo` to record + pricing-item types; add the fallback match leg; extract a shared price-result helper.
- Modify: `lib/cog/recompute.ts` — select + thread `manufacturerNo` (COG rows and contract pricing items).
- Modify: `lib/contracts/__tests__/match.test.ts` — reference-number match tests.

**Unit D — market-share verification**
- No source change unless a defect reproduces. Runs oracles + a manual repro; outcome documented in the plan checklist.

---

## Task 1: Carve-out forecast engine — flat-rate branch

**Files:**
- Modify: `lib/contracts/rebate-forecast-engine.ts`
- Test: `lib/contracts/__tests__/rebate-forecast-engine.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `lib/contracts/__tests__/rebate-forecast-engine.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { computeRebateForecast } from "@/lib/contracts/rebate-forecast-engine"

const months = (n: number): Map<string, number> => {
  const m = new Map<string, number>()
  // 6 months of $10,000 spend, Jan–Jun 2026.
  for (let i = 1; i <= n; i++) {
    m.set(`2026-${String(i).padStart(2, "0")}`, 10_000)
  }
  return m
}

describe("computeRebateForecast — carve-out flat rate", () => {
  it("projects rebate at the flat effective rate for a carve-out contract", () => {
    const result = computeRebateForecast({
      monthlySpend: months(6),
      // Carve-out contracts have no tiers; the engine must NOT zero out.
      terms: [{ termType: "carve_out", tiers: [] }],
      carveOutEffectiveRate: 0.03,
      forecastMonths: 3,
    })

    expect(result.history.length).toBe(6)
    expect(result.forecast.length).toBe(3)
    // Flat 3% on $10,000 = $300 every history month.
    for (const p of result.history) {
      expect(p.achievedTier).toBe(0)
      expect(p.achievedRatePct).toBe(3)
      expect(p.rebateForPeriod).toBeCloseTo(p.spend * 0.03, 2)
    }
    // Forecast months also carry the flat rate (non-zero).
    for (const p of result.forecast) {
      expect(p.rebateForPeriod).toBeGreaterThan(0)
      expect(p.achievedRatePct).toBe(3)
    }
  })

  it("ignores the flat rate and uses tiers when carveOutEffectiveRate is absent", () => {
    const result = computeRebateForecast({
      monthlySpend: months(6),
      terms: [
        {
          termType: "spend_rebate",
          tiers: [{ tierNumber: 1, spendMin: 0, rebateValue: 0.02 }],
        },
      ],
      forecastMonths: 3,
    })
    // Tier path: 2% applied via tier ladder, achievedTier=1.
    expect(result.history[0].achievedTier).toBe(1)
    expect(result.history[0].achievedRatePct).toBe(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run lib/contracts/__tests__/rebate-forecast-engine.test.ts`
Expected: FAIL — the first test's `rebateForPeriod` is `0` (carve-out has no tiers, so the current engine returns rate 0).

- [ ] **Step 3: Drop `carve_out` from the spend-based set**

In `lib/contracts/rebate-forecast-engine.ts`, change the constant (currently lines 44–48):

```ts
const SPEND_BASED_TERM_TYPES = new Set(["spend_rebate", "tie_in"])
```

- [ ] **Step 4: Add the `carveOutEffectiveRate` input**

In the `ComputeRebateForecastInput` interface, add after `forecastMonths?: number`:

```ts
  /**
   * Flat carve-out rate (decimal, e.g. 0.03 = 3%). When > 0, the engine
   * bypasses the tier ladder and applies this rate to every history +
   * forecast point's spend. Carve-out terms have no tiers, so the tier
   * projection would otherwise return $0. Derived by the caller from
   * ContractPricing.carveOutPercent (see rebate-forecast.ts).
   */
  carveOutEffectiveRate?: number
```

- [ ] **Step 5: Replace `projectTier` with a rate selector that honors the flat rate**

In `computeRebateForecast`, replace the `projectTier` definition (currently lines 102–112) with:

```ts
  const carveOutRate = input.carveOutEffectiveRate ?? 0
  const isCarveOut = carveOutRate > 0

  const projectRate = (
    cumulativeYtd: number,
  ): { achievedTier: number; rate: number } => {
    if (isCarveOut) {
      // Flat per-reference rate — no tier ladder for carve-outs.
      return { achievedTier: 0, rate: carveOutRate }
    }
    let achievedTier = 0
    let rate = 0
    for (const t of tiers) {
      if (cumulativeYtd >= Number(t.spendMin)) {
        achievedTier = t.tierNumber
        rate = Number(t.rebateValue)
      }
    }
    return { achievedTier, rate }
  }
```

Then update `buildPoint` (currently line 120) to call the renamed selector:

```ts
    const { achievedTier, rate } = projectRate(cumulative)
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bunx vitest run lib/contracts/__tests__/rebate-forecast-engine.test.ts`
Expected: PASS (both tests).

- [ ] **Step 7: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add lib/contracts/rebate-forecast-engine.ts lib/contracts/__tests__/rebate-forecast-engine.test.ts
git commit -m "feat(forecast): flat-rate carve-out branch in rebate-forecast engine

Carve-out terms have no tiers; the tier projection returned \$0 for every
point. Add an optional carveOutEffectiveRate that bypasses the ladder, and
drop carve_out from SPEND_BASED_TERM_TYPES.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Carve-out forecast action — derive + pass the effective rate

**Files:**
- Modify: `lib/actions/analytics/rebate-forecast.ts`

- [ ] **Step 1: Import the group-vendor helper**

At the top of `lib/actions/analytics/rebate-forecast.ts`, add to the imports:

```ts
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
```

- [ ] **Step 2: Load the vendor group + carve-out pricing rows**

In `_getRebateForecastImpl`, extend the `contract` select (currently lines 50–73) so it returns `additionalVendorIds`, the per-term `termType` (already loaded) plus tier presence, and the contract's carve-out pricing rows. Replace the `prisma.contract.findFirstOrThrow` select with:

```ts
    select: {
      vendorId: true,
      additionalVendorIds: true,
      effectiveDate: true,
      terms: {
        select: {
          termType: true,
          tiers: {
            select: { tierNumber: true, spendMin: true, rebateValue: true },
            orderBy: { spendMin: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      // Carve-out rate source (Charles 2026-06-06): every carved-out
      // pricing row, keyed by vendorItemNo. Used to derive the flat
      // effective rate the forecast engine applies.
      pricingItems: {
        where: { carveOutPercent: { not: null } },
        select: { vendorItemNo: true, carveOutPercent: true },
      },
    },
```

- [ ] **Step 3: Widen the COG window query to the full vendor group + pull vendorItemNo**

Replace the `prisma.cOGRecord.findMany` block (currently lines 79–86) with:

```ts
  // Group-drift guard: a grouped/tie-in contract spans several vendors.
  // Scoping to the primary vendorId alone drops the group's spend.
  const vendorIds = contractVendorIds(contract)
  const cog = await prisma.cOGRecord.findMany({
    where: {
      facilityId: { in: scope.cogScopeFacilityIds },
      vendorId: { in: vendorIds },
      transactionDate: { gte: since, lte: today },
    },
    select: {
      transactionDate: true,
      extendedPrice: true,
      vendorItemNo: true,
    },
  })
```

- [ ] **Step 4: Derive the carve-out effective rate while bucketing spend**

Replace the monthly-bucket loop (currently lines 89–94) with a version that also accumulates carve-out rebate:

```ts
  // rate lookup keyed by lowercased vendorItemNo (carve-out lines use
  // vendorItemNo as the reference number — see lib/actions/contracts/carve-out.ts).
  const rateByItem = new Map<string, number>()
  for (const p of contract.pricingItems) {
    if (p.carveOutPercent != null) {
      rateByItem.set(p.vendorItemNo.toLowerCase(), Number(p.carveOutPercent))
    }
  }

  // Bucket by YYYY-MM and, in the same pass, sum trailing total spend and
  // trailing carve-out rebate so we can derive a single flat effective rate.
  const monthly = new Map<string, number>()
  let trailingTotalSpend = 0
  let trailingCarveRebate = 0
  for (const r of cog) {
    const spend = Number(r.extendedPrice)
    const d = new Date(r.transactionDate)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    monthly.set(key, (monthly.get(key) ?? 0) + spend)
    trailingTotalSpend += spend
    const rate = r.vendorItemNo
      ? rateByItem.get(r.vendorItemNo.toLowerCase())
      : undefined
    if (rate !== undefined) trailingCarveRebate += spend * rate
  }

  // Carve-out style = has carve-out pricing rows AND no spend-based tier
  // ladder that would take precedence (matches the engine's term priority).
  const hasTieredSpendTerm = contract.terms.some(
    (t) =>
      (t.termType === "spend_rebate" || t.termType === "tie_in") &&
      t.tiers.length > 0,
  )
  const carveOutEffectiveRate =
    !hasTieredSpendTerm && rateByItem.size > 0 && trailingTotalSpend > 0
      ? trailingCarveRebate / trailingTotalSpend
      : 0
```

- [ ] **Step 5: Pass the rate to the engine**

Update the `computeRebateForecast` call (currently lines 99–106) to include the rate:

```ts
  const result = computeRebateForecast({
    monthlySpend: monthly,
    terms: contract.terms.map((t) => ({
      termType: t.termType,
      tiers: t.tiers,
    })),
    forecastMonths,
    carveOutEffectiveRate,
  })
```

- [ ] **Step 6: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Run the full unit suite (no regressions)**

Run: `bun run test:unit`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add lib/actions/analytics/rebate-forecast.ts
git commit -m "feat(forecast): derive carve-out effective rate + widen to vendor group

The action now reads ContractPricing.carveOutPercent rows, computes a flat
effective rate (trailing carve rebate / trailing spend) for carve-out-style
contracts, and scopes COG to the full contractVendorIds() group.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Carve-out % column in the pricing tab

**Files:**
- Modify: `components/contracts/contract-pricing-tab.tsx`

`ContractPricingItem` already exposes `carveOutPercent?: number`
(`lib/actions/pricing-files-types.ts:20`) and `getContractPricing` serializes it,
so this is display-only.

- [ ] **Step 1: Add the column header**

In `components/contracts/contract-pricing-tab.tsx`, add a header after the
Category `<TableHead>` (currently line 218):

```tsx
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Carve-Out %</TableHead>
```

- [ ] **Step 2: Add the matching cell**

Add a cell after the Category `<TableCell>` (currently line 239). `carveOutPercent`
is a decimal fraction (`0.03` = 3%):

```tsx
                  <TableCell>{r.category ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {r.carveOutPercent != null
                      ? `${(Number(r.carveOutPercent) * 100).toFixed(2)}%`
                      : "—"}
                  </TableCell>
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors. (If TS reports `carveOutPercent` is not on the row type,
confirm the `rows` prop is typed as `ContractPricingItem[]`; it already carries
the field.)

- [ ] **Step 4: Commit**

```bash
git add components/contracts/contract-pricing-tab.tsx
git commit -m "feat(pricing): show Carve-Out % column in the contract pricing tab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Reference-number (manufacturer-number) matching in the matcher

**Files:**
- Modify: `lib/contracts/match.ts`
- Test: `lib/contracts/__tests__/match.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/contracts/__tests__/match.test.ts` (inside the existing top-level
`describe`, or in a new `describe` at the end of the file):

```ts
import { describe, it, expect } from "vitest"
import {
  matchCOGRecordToContract,
  type ContractForMatch,
  type CogRecordForMatch,
} from "@/lib/contracts/match"

describe("matchCOGRecordToContract — reference-number fallback", () => {
  const base = {
    id: "c1",
    vendorId: "v-primary",
    additionalVendorIds: ["v-secondary"],
    status: "active" as const,
    effectiveDate: new Date("2026-01-01"),
    expirationDate: null,
    facilityIds: ["f1"],
  }

  it("matches by manufacturerNo when the SKU is absent from the pricing file", () => {
    const contract: ContractForMatch = {
      ...base,
      pricingItems: [
        {
          vendorItemNo: "SKU-A",
          manufacturerNo: "MFR-123",
          unitPrice: 100,
          listPrice: 120,
        },
      ],
    }
    const record: CogRecordForMatch = {
      facilityId: "f1",
      vendorId: "v-secondary", // grouped vendor, different name/SKU
      vendorName: "Smith & Nephew, Inc.",
      vendorItemNo: "DIFFERENT-SKU", // not on the pricing file
      manufacturerNo: "MFR-123", // cross-vendor reference number
      unitCost: 100,
      quantity: 2,
      transactionDate: new Date("2026-03-01"),
    }
    const result = matchCOGRecordToContract(record, [contract])
    expect(result.status).toBe("on_contract")
    if (result.status === "on_contract") {
      expect(result.contractId).toBe("c1")
      expect(result.contractPrice).toBe(100)
      expect(result.savings).toBe((120 - 100) * 2)
    }
  })

  it("still resolves when the COG row has no vendorItemNo but has a manufacturerNo", () => {
    const contract: ContractForMatch = {
      ...base,
      pricingItems: [
        {
          vendorItemNo: "SKU-A",
          manufacturerNo: "MFR-999",
          unitPrice: 50,
          listPrice: null,
        },
      ],
    }
    const record: CogRecordForMatch = {
      facilityId: "f1",
      vendorId: "v-primary",
      vendorName: "ACME",
      vendorItemNo: null,
      manufacturerNo: "MFR-999",
      unitCost: 50,
      quantity: 1,
      transactionDate: new Date("2026-02-01"),
    }
    const result = matchCOGRecordToContract(record, [contract])
    expect(result.status).toBe("on_contract")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run lib/contracts/__tests__/match.test.ts`
Expected: FAIL — first test returns `off_contract_item` (SKU miss; manufacturerNo
not consulted); second returns `off_contract_item` (no `vendorItemNo` early-return).
Also a TS error: `manufacturerNo` is not on the types yet.

- [ ] **Step 3: Add `manufacturerNo` to the two types**

In `lib/contracts/match.ts`, add to `CogRecordForMatch` (after `vendorItemNo`,
currently line 28):

```ts
  /**
   * Manufacturer / cross-vendor reference number. Stable across vendor
   * name + SKU variations within a group — the robust cross-vendor key.
   * Optional for back-compat. (Charles 2026-06-06.)
   */
  manufacturerNo?: string | null
```

Add to `ContractPricingItemForMatch` (after `vendorItemNo`, currently line 35):

```ts
  /** Manufacturer / cross-vendor reference number on the pricing row. */
  manufacturerNo?: string | null
```

- [ ] **Step 4: Extract a shared price-result helper**

In `lib/contracts/match.ts`, add this module-level helper just above
`matchCOGRecordToContract` (it captures the variance/savings logic currently
inlined at lines 211–239 so both match legs share it):

```ts
/** Build the on_contract / price_variance result for a matched pricing item. */
function priceResultFor(
  contract: ContractForMatch,
  item: ContractPricingItemForMatch,
  record: CogRecordForMatch,
): MatchResult {
  // Sign convention: variancePercent > 0 means facility OVERPAID vs contract.
  const variancePercent =
    item.unitPrice === 0
      ? 0
      : ((record.unitCost - item.unitPrice) / item.unitPrice) * 100

  if (Math.abs(variancePercent) > PRICE_VARIANCE_THRESHOLD) {
    return {
      status: "price_variance",
      contractId: contract.id,
      contractPrice: item.unitPrice,
      variancePercent,
      matchedCategory: item.category ?? null,
    }
  }

  const savings =
    item.listPrice === null
      ? 0
      : (item.listPrice - item.unitPrice) * record.quantity

  return {
    status: "on_contract",
    contractId: contract.id,
    contractPrice: item.unitPrice,
    savings,
    matchedCategory: item.category ?? null,
  }
}
```

- [ ] **Step 5: Rewrite step 5 of the matcher to add the manufacturerNo fallback**

In `matchCOGRecordToContract`, replace the entire step-5 block (currently lines
196–245, from `// 5. Item lookup across candidate contracts` through the final
`off_contract_item` return) with:

```ts
  // 5. Item lookup across candidate contracts.
  //    Primary key: vendorItemNo (per-vendor SKU, most precise).
  //    Fallback key: manufacturerNo (cross-vendor reference number) — stable
  //    across the group's vendor-name/SKU inconsistencies (Charles 2026-06-06).
  const itemNoLower = record.vendorItemNo?.toLowerCase() ?? null
  const mfrLower = record.manufacturerNo?.toLowerCase() ?? null

  if (!itemNoLower && !mfrLower) {
    return {
      status: "off_contract_item",
      reason:
        "record has no vendorItemNo or manufacturerNo to match against contract pricing",
    }
  }

  // Primary: SKU match.
  if (itemNoLower) {
    for (const contract of byCategory) {
      const item = contract.pricingItems.find(
        (p) => p.vendorItemNo.toLowerCase() === itemNoLower,
      )
      if (item) return priceResultFor(contract, item, record)
    }
  }

  // Fallback: cross-vendor reference number.
  if (mfrLower) {
    for (const contract of byCategory) {
      const item = contract.pricingItems.find(
        (p) => (p.manufacturerNo?.toLowerCase() ?? null) === mfrLower,
      )
      if (item) return priceResultFor(contract, item, record)
    }
  }

  return {
    status: "off_contract_item",
    reason: "vendor and facility and date match, but item not on any contract",
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bunx vitest run lib/contracts/__tests__/match.test.ts`
Expected: PASS (new tests + all existing match tests still green).

- [ ] **Step 7: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add lib/contracts/match.ts lib/contracts/__tests__/match.test.ts
git commit -m "feat(match): reference-number (manufacturerNo) fallback across grouped vendors

SKU stays the primary key; when it misses, match COG manufacturerNo against
ContractPricing.manufacturerNo so any vendor in a group resolves regardless of
name/SKU inconsistency. Carries the contract price, so produces normal
on_contract / price_variance results.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Thread `manufacturerNo` through the recompute loaders

**Files:**
- Modify: `lib/cog/recompute.ts`

- [ ] **Step 1: Select `manufacturerNo` on contract pricing items**

In `loadContractsForVendor`, add `manufacturerNo: true` to the `pricingItems`
select (currently lines 69–81), after `category: true`:

```ts
      pricingItems: {
        select: {
          vendorItemNo: true,
          unitPrice: true,
          listPrice: true,
          category: true,
          manufacturerNo: true,
        },
      },
```

- [ ] **Step 2: Map `manufacturerNo` into the matcher pricing-item shape**

In the same function, extend the `pricingItems` map (currently lines 98–103):

```ts
    const pricingItems: ContractPricingItemForMatch[] = c.pricingItems.map((p) => ({
      vendorItemNo: p.vendorItemNo,
      unitPrice: Number(p.unitPrice),
      listPrice: p.listPrice === null ? null : Number(p.listPrice),
      category: (p as { category?: string | null }).category ?? null,
      manufacturerNo: (p as { manufacturerNo?: string | null }).manufacturerNo ?? null,
    }))
```

- [ ] **Step 3: Select `manufacturerNo` on COG records**

In the recompute body, add `manufacturerNo: true` to the `db.cOGRecord.findMany`
select (currently lines 266–278), after `category: true`:

```ts
    select: {
      id: true,
      facilityId: true,
      vendorId: true,
      vendorName: true,
      vendorItemNo: true,
      unitCost: true,
      quantity: true,
      transactionDate: true,
      category: true,
      manufacturerNo: true,
    },
```

- [ ] **Step 4: Pass `manufacturerNo` into the matcher call**

In the per-record loop, add `manufacturerNo` to the record object passed to
`matchCOGRecordToContract` (currently lines 332–345), after `category`:

```ts
    const result = matchCOGRecordToContract(
      {
        facilityId: r.facilityId,
        vendorId: r.vendorId,
        vendorName: r.vendorName,
        vendorItemNo: r.vendorItemNo,
        unitCost: Number(r.unitCost),
        quantity: r.quantity,
        transactionDate: r.transactionDate,
        category: r.category,
        manufacturerNo: r.manufacturerNo,
      },
      contracts,
    )
```

- [ ] **Step 5: Typecheck + full unit suite**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

Run: `bun run test:unit`
Expected: all green.

- [ ] **Step 6: Run the grouped-vendor oracle**

Run: `bun scripts/oracles/index.ts --filter grouped-vendor-scope`
Expected: PASS (group spend still attributed; no regression). If it requires the
dev DB, start it first: `docker compose up -d` then `bun run db:seed`.

- [ ] **Step 7: Commit**

```bash
git add lib/cog/recompute.ts
git commit -m "feat(recompute): thread manufacturerNo into the COG→contract matcher

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Verify per-category market share (investigation; fix only if defect reproduces)

This unit has **no source change unless a defect surfaces**. Run it after Tasks
1–2 land, since the "market share fails to display" symptom may have been the
carve-out Performance-tab $0 bug (the market-share card lives on that tab).

**Files:**
- Modify (only if a defect reproduces): the specific offending file, plus a
  regression test. Otherwise: record the outcome in this checklist.

- [ ] **Step 1: Confirm the parity invariant holds**

Run: `bunx vitest run lib/actions/__tests__/market-share-parity.test.ts`
Expected: PASS (facility and vendor actions agree per-category).

- [ ] **Step 2: Run the market-share oracle on seed data**

Ensure the DB is up: `docker compose up -d` then (if needed) `bun run db:seed`.
Run: `bun scripts/oracles/index.ts --filter market-share`
Expected: PASS. If it FAILS, capture the oracle's reported drift — that is the
defect to fix; jump to Step 4.

- [ ] **Step 3: Reproduce the Performance tab for a carve-out / grouped contract**

```bash
rm -rf .next && bun run dev
```

In the browser, open a carve-out or grouped contract under **Lighthouse Surgical
Center** → contract detail → **Performance** tab. Confirm:
- The Rebate Forecast card now shows non-zero projected rebate (Tasks 1–2).
- The per-category Market Share card renders with data (not blank).

- [ ] **Step 4: Decision — fix only if a real defect remains**

- If everything renders correctly: **no code change.** Tick the box and write
  the outcome below (e.g. "Resolved by Tasks 1–2; market share renders for
  carve-out + grouped contracts on Lighthouse Surgical Center; oracle + parity
  green."). Note for Charles to re-test on the current build.
- If a genuine remaining defect appears (blank card when rows exist,
  category-canonicalization mismatch, stale `Contract.currentMarketShare`):
  write a failing test that reproduces it, fix the single offending file, rerun
  the oracle + parity test, and commit with a message naming the defect.

**Outcome (fill in during execution):** _______________________________________

---

## Final verification (before "ship it")

Per CLAUDE.md release hygiene:

- [ ] `bunx tsc --noEmit` → 0 errors.
- [ ] `bun run test:unit` → all green.
- [ ] `rm -rf .next && bun run dev` + smoke the contract-detail **Performance**
      tab and **Pricing** tab for a carve-out / grouped contract on **Lighthouse
      Surgical Center**.
- [ ] Touched oracles green:
      `bun scripts/oracles/index.ts --filter rebate-forecast` and
      `--filter grouped-vendor-scope` and `--filter market-share`.
- [ ] Confirm no displayed earned/collected rebate aggregate changed — the
      forecast is a projection surface only; `sumCollectedRebates`,
      `sumEarnedRebatesLifetime`, etc. are untouched (grep that the new code does
      not import them).
```
