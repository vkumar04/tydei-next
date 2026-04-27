# Market-Share Canonicalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote per-category market-share computation into a single canonical helper used by both the facility-scoped action (`getCategoryMarketShareForVendor`) and the vendor-session action (`getVendorMarketShareByCategory`), with a parity test that fails when the two drift, and update CLAUDE.md so future surfaces register against the helper instead of hand-rolling.

**Architecture:** Extract the pure `effectiveCategory + bucket + share%` math into `lib/contracts/market-share-filter.ts:computeCategoryMarketShare(rows, opts)`. The two server actions become thin Prisma wrappers around it. A new parity test in `lib/actions/__tests__/market-share-parity.test.ts` feeds both actions the same fixture (where some COG rows have `category=null` but a `Contract.productCategory.name` fallback) and asserts identical numerator + denominator semantics — this catches a real drift bug that exists today (vendor-session denominator skips the contract-category fallback). CLAUDE.md "Canonical reducers" table gets a new row.

**Tech Stack:** TypeScript strict, Prisma 7, Vitest, Next.js 16 App Router. Pure helper in `lib/contracts/`; no React, no Prisma client inside the helper.

**Why this plan, this size:** Spec `2026-04-26-v0-parity-engines-design.md` Bucket A1/A3 is the highest-leverage open item after the other instance's batch. It's the only place where the original "drift across surfaces" pain has a known live bug (`getVendorMarketShareByCategory` denominator) that the upcoming PO follow-ups will surface again. Other open items (#7 multi-division, #11/#12/#13 PO clarifications) are blocked on PO input and get separate plans when unblocked.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/contracts/market-share-filter.ts` | Create | Pure helper: takes COG rows + contract→category map + vendorId, returns `{ rows, uncategorizedSpend, totalVendorSpend }`. No Prisma client. |
| `lib/contracts/__tests__/market-share-filter.test.ts` | Create | Unit tests for the pure helper covering: explicit category, contract fallback, mixed, all-uncategorized, vendor with no spend. |
| `lib/actions/cog/category-market-share.ts` | Modify | Replace the inline math with a call to `computeCategoryMarketShare`. Keep Prisma fetch + auth + commitment overlay; delete the duplicated `effectiveCategory`/bucket loops. |
| `lib/actions/vendor-dashboard.ts` | Modify (lines ~92–195) | Same refactor; this also fixes the denominator-fallback bug because the helper applies the fallback to BOTH numerator and denominator. |
| `lib/actions/__tests__/market-share-parity.test.ts` | Create | Mocks Prisma + auth, runs both actions on identical fixtures, asserts identical per-category `vendorSpend` + `categoryTotal` + `sharePct` for the same vendor. |
| `CLAUDE.md` | Modify (Canonical reducers table) | Add row: "Per-category market share \| `computeCategoryMarketShare` \| `lib/contracts/market-share-filter.ts` \| facility action `getCategoryMarketShareForVendor`, vendor action `getVendorMarketShareByCategory`, contract-detail card, vendor dashboard widget." |

---

## Task 1: Pure helper — write failing unit test

**Files:**
- Create: `lib/contracts/__tests__/market-share-filter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/contracts/__tests__/market-share-filter.test.ts
import { describe, it, expect } from "vitest"
import { computeCategoryMarketShare } from "@/lib/contracts/market-share-filter"

describe("computeCategoryMarketShare", () => {
  const VENDOR = "v_stryker"
  const OTHER = "v_other"

  it("uses explicit COG category when present", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: "Ortho-Extremity", extendedPrice: 100, contractId: null },
        { vendorId: OTHER, category: "Ortho-Extremity", extendedPrice: 100, contractId: null },
      ],
      contractCategoryMap: new Map(),
      vendorId: VENDOR,
    })
    expect(result.rows).toEqual([
      expect.objectContaining({
        category: "Ortho-Extremity",
        vendorSpend: 100,
        categoryTotal: 200,
        sharePct: 50,
        competingVendors: 2,
      }),
    ])
    expect(result.uncategorizedSpend).toBe(0)
    expect(result.totalVendorSpend).toBe(100)
  })

  it("falls back to contract.productCategory when COG.category is null", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: null, extendedPrice: 80, contractId: "c1" },
        { vendorId: OTHER, category: null, extendedPrice: 20, contractId: "c2" },
      ],
      contractCategoryMap: new Map([
        ["c1", "Ortho-Extremity"],
        ["c2", "Ortho-Extremity"],
      ]),
      vendorId: VENDOR,
    })
    expect(result.rows[0]).toMatchObject({
      category: "Ortho-Extremity",
      vendorSpend: 80,
      categoryTotal: 100,
      sharePct: 80,
    })
    expect(result.uncategorizedSpend).toBe(0)
  })

  it("counts truly-uncategorized rows separately", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: null, extendedPrice: 50, contractId: null },
        { vendorId: VENDOR, category: "Spine", extendedPrice: 50, contractId: null },
      ],
      contractCategoryMap: new Map(),
      vendorId: VENDOR,
    })
    expect(result.uncategorizedSpend).toBe(50)
    expect(result.totalVendorSpend).toBe(100)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].category).toBe("Spine")
  })

  it("skips categories where the target vendor has zero spend", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: "Spine", extendedPrice: 100, contractId: null },
        { vendorId: OTHER, category: "Joint Replacement", extendedPrice: 100, contractId: null },
      ],
      contractCategoryMap: new Map(),
      vendorId: VENDOR,
    })
    expect(result.rows.map((r) => r.category)).toEqual(["Spine"])
  })

  it("ignores zero / negative line amounts", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: "Spine", extendedPrice: 0, contractId: null },
        { vendorId: VENDOR, category: "Spine", extendedPrice: -5, contractId: null },
        { vendorId: VENDOR, category: "Spine", extendedPrice: 100, contractId: null },
      ],
      contractCategoryMap: new Map(),
      vendorId: VENDOR,
    })
    expect(result.rows[0].vendorSpend).toBe(100)
    expect(result.totalVendorSpend).toBe(100)
  })

  it("attaches commitmentPct from optional overlay", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: "Spine", extendedPrice: 100, contractId: null },
      ],
      contractCategoryMap: new Map(),
      vendorId: VENDOR,
      commitmentByCategory: new Map([["Spine", 60]]),
    })
    expect(result.rows[0].commitmentPct).toBe(60)
  })

  it("sorts result rows by category total descending", () => {
    const result = computeCategoryMarketShare({
      rows: [
        { vendorId: VENDOR, category: "Spine", extendedPrice: 50, contractId: null },
        { vendorId: VENDOR, category: "Joint Replacement", extendedPrice: 200, contractId: null },
      ],
      contractCategoryMap: new Map(),
      vendorId: VENDOR,
    })
    expect(result.rows.map((r) => r.category)).toEqual(["Joint Replacement", "Spine"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run lib/contracts/__tests__/market-share-filter.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/contracts/market-share-filter"`.

---

## Task 2: Pure helper — implementation

**Files:**
- Create: `lib/contracts/market-share-filter.ts`

- [ ] **Step 1: Implement the helper**

```ts
// lib/contracts/market-share-filter.ts
/**
 * Canonical per-category market-share helper.
 *
 * Used by every surface that renders "vendor share of category X at this
 * facility" — facility-scoped contract detail card, vendor-session
 * dashboard widget. Both code paths previously implemented the same
 * `effectiveCategory` fallback + bucket math inline; the vendor-session
 * version had a real drift bug where the fallback applied to the
 * numerator but not to the per-category denominator.
 *
 * Rule: the *only* way to compute per-category market share is to call
 * this helper. Server actions own Prisma fetching + auth + the
 * commitment overlay; this helper owns the math.
 *
 * See: `docs/superpowers/specs/2026-04-26-v0-parity-engines-design.md`
 * Bucket A1.
 */

export interface MarketShareCogRow {
  vendorId: string | null
  category: string | null
  extendedPrice: number | string | { toString(): string } | null
  contractId: string | null
}

export interface MarketShareRow {
  category: string
  vendorSpend: number
  categoryTotal: number
  /** vendorSpend / categoryTotal × 100. 0–100. */
  sharePct: number
  /** Number of distinct vendors with positive spend in this category. */
  competingVendors: number
  /** Optional commitment overlay; null when no overlay supplied. */
  commitmentPct: number | null
}

export interface MarketShareResult {
  rows: MarketShareRow[]
  /** Vendor spend (in window) where neither COG.category nor the
   *  matched-contract productCategory could resolve a category. */
  uncategorizedSpend: number
  /** Vendor's total spend in the input window — categorized + un-. */
  totalVendorSpend: number
}

export interface ComputeMarketShareInput {
  /** Already-windowed COG rows for the facility (or vendor session). */
  rows: MarketShareCogRow[]
  /** contractId → productCategory.name lookup. Pass an empty Map to
   *  disable the fallback. */
  contractCategoryMap: Map<string, string | null>
  /** Vendor whose share is being computed. */
  vendorId: string
  /** Optional category → commitment% overlay. */
  commitmentByCategory?: Map<string, number>
}

/**
 * Resolve a COG row's effective category: explicit COG.category first,
 * then the matched-contract productCategory.name. Exported for tests
 * and for any caller that needs the same resolution semantics outside
 * of share computation.
 */
export function effectiveCategoryOf(
  row: MarketShareCogRow,
  contractCategoryMap: Map<string, string | null>,
): string | null {
  if (row.category) return row.category
  if (row.contractId) return contractCategoryMap.get(row.contractId) ?? null
  return null
}

function toAmount(price: MarketShareCogRow["extendedPrice"]): number {
  if (price == null) return 0
  if (typeof price === "number") return price
  if (typeof price === "string") return Number(price)
  return Number(price.toString())
}

export function computeCategoryMarketShare(
  input: ComputeMarketShareInput,
): MarketShareResult {
  const { rows, contractCategoryMap, vendorId, commitmentByCategory } = input

  let totalVendorSpend = 0
  let uncategorizedSpend = 0

  type Bucket = { total: number; byVendor: Map<string, number> }
  const byCategory = new Map<string, Bucket>()

  for (const row of rows) {
    const amount = toAmount(row.extendedPrice)
    if (amount <= 0) continue

    const isVendor = row.vendorId === vendorId
    const cat = effectiveCategoryOf(row, contractCategoryMap)

    if (isVendor) {
      totalVendorSpend += amount
      if (!cat) uncategorizedSpend += amount
    }

    if (!cat) continue

    const bucket = byCategory.get(cat) ?? {
      total: 0,
      byVendor: new Map<string, number>(),
    }
    bucket.total += amount
    if (row.vendorId) {
      bucket.byVendor.set(
        row.vendorId,
        (bucket.byVendor.get(row.vendorId) ?? 0) + amount,
      )
    }
    byCategory.set(cat, bucket)
  }

  const result: MarketShareRow[] = []
  for (const [category, bucket] of byCategory.entries()) {
    const vendorSpend = bucket.byVendor.get(vendorId) ?? 0
    if (vendorSpend <= 0) continue
    result.push({
      category,
      vendorSpend,
      categoryTotal: bucket.total,
      sharePct: bucket.total > 0 ? (vendorSpend / bucket.total) * 100 : 0,
      competingVendors: bucket.byVendor.size,
      commitmentPct: commitmentByCategory?.get(category) ?? null,
    })
  }

  result.sort((a, b) => b.categoryTotal - a.categoryTotal)
  return { rows: result, uncategorizedSpend, totalVendorSpend }
}
```

- [ ] **Step 2: Run unit test to verify it passes**

Run: `bunx vitest run lib/contracts/__tests__/market-share-filter.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 3: Commit**

```bash
git add lib/contracts/market-share-filter.ts lib/contracts/__tests__/market-share-filter.test.ts
git commit -m "feat(market-share): canonical computeCategoryMarketShare helper

Pure-function helper that owns effectiveCategory + bucket math. Spec
2026-04-26-v0-parity-engines-design.md Bucket A1. Server actions
will be migrated next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Refactor facility action to use the helper

**Files:**
- Modify: `lib/actions/cog/category-market-share.ts:67-215`

- [ ] **Step 1: Replace the inline math**

Open `lib/actions/cog/category-market-share.ts`. Replace the entire body of `getCategoryMarketShareForVendor` (lines 67–222 today, from the `try {` through the matching `}`) with this implementation. Keep the imports at the top of the file, and add the import for the helper.

Add to imports block (line 24 area):

```ts
import {
  computeCategoryMarketShare,
  type MarketShareResult,
} from "@/lib/contracts/market-share-filter"
```

Replace the function body so the file reads:

```ts
export async function getCategoryMarketShareForVendor(input: {
  vendorId: string
  monthsBack?: number
  contractId?: string
}): Promise<CategoryMarketShareResult> {
  try {
    const { facility } = await requireFacility()
    const months = input.monthsBack ?? 12
    const since = new Date()
    since.setMonth(since.getMonth() - months)

    // Optional commitment overlay per category. Schema stores user-set
    // targets as `[{category, commitmentPct}, ...]` JSON on Contract.
    // Tolerate any non-array shape (old contracts / hand-edits) by
    // treating it as an empty map.
    const commitmentByCategory = new Map<string, number>()
    if (input.contractId) {
      const c = await prisma.contract.findFirst({
        where: contractOwnershipWhere(input.contractId, facility.id),
        select: { marketShareCommitmentByCategory: true },
      })
      const raw = c?.marketShareCommitmentByCategory
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (
            entry &&
            typeof entry === "object" &&
            "category" in entry &&
            "commitmentPct" in entry &&
            typeof (entry as Record<string, unknown>).category === "string" &&
            typeof (entry as Record<string, unknown>).commitmentPct === "number"
          ) {
            commitmentByCategory.set(
              (entry as { category: string }).category,
              (entry as { commitmentPct: number }).commitmentPct,
            )
          }
        }
      }
    }

    const cogRows = await prisma.cOGRecord.findMany({
      where: {
        facilityId: facility.id,
        transactionDate: { gte: since },
      },
      select: {
        vendorId: true,
        category: true,
        extendedPrice: true,
        contractId: true,
      },
    })

    const contractIds = Array.from(
      new Set(cogRows.map((r) => r.contractId).filter((v): v is string => !!v)),
    )
    const contractCategoryRows =
      contractIds.length > 0
        ? await prisma.contract.findMany({
            where: { id: { in: contractIds } },
            select: {
              id: true,
              productCategory: { select: { name: true } },
            },
          })
        : []
    const contractCategoryMap = new Map<string, string | null>(
      contractCategoryRows.map((c) => [c.id, c.productCategory?.name ?? null]),
    )

    const computed: MarketShareResult = computeCategoryMarketShare({
      rows: cogRows,
      contractCategoryMap,
      vendorId: input.vendorId,
      commitmentByCategory,
    })

    return serialize(computed)
  } catch (err) {
    console.error("[getCategoryMarketShareForVendor]", err, {
      vendorId: input.vendorId,
    })
    throw err
  }
}
```

- [ ] **Step 2: Verify the existing call sites still typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors. The exported `CategoryMarketShareResult` shape from this file matches `MarketShareResult` field-by-field, so consumers (`components/contracts/category-market-share-card.tsx`, `components/contracts/contract-performance-card.tsx`) compile unchanged.

- [ ] **Step 3: Run the existing facility-side tests**

Run: `bunx vitest run lib/actions/__tests__/vendor-spend-cog-source.test.ts`
Expected: PASS. (This file references both action names; if it tests output shape, it must still pass.)

- [ ] **Step 4: Commit**

```bash
git add lib/actions/cog/category-market-share.ts
git commit -m "refactor(market-share): facility action delegates to canonical helper

getCategoryMarketShareForVendor now fetches Prisma data, applies the
commitment overlay, and hands everything to computeCategoryMarketShare.
No behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Refactor vendor-session action to use the helper (also fixes denominator drift bug)

**Files:**
- Modify: `lib/actions/vendor-dashboard.ts:92-195` (the `getVendorMarketShareByCategory` function body)

- [ ] **Step 1: Read the surrounding file context**

Run: `bunx rg -n "getVendorMarketShareByCategory|requireVendor" lib/actions/vendor-dashboard.ts | head -20`

Note the exported `VendorMarketShareByCategoryResult` interface above the function — the helper's `MarketShareResult` shape is field-compatible. Also note the existing fallback already pulls `contractCategoryMap` correctly; the bug is downstream where the *denominator* (`totalByCategory.groupBy`) re-queries Prisma without the fallback.

- [ ] **Step 2: Replace the function body**

Add to imports at the top of `lib/actions/vendor-dashboard.ts`:

```ts
import { computeCategoryMarketShare } from "@/lib/contracts/market-share-filter"
```

Replace the entire body of `getVendorMarketShareByCategory` (the `_vendorId?: string` overload) with:

```ts
export async function getVendorMarketShareByCategory(
  _vendorId?: string,
): Promise<VendorMarketShareByCategoryResult> {
  const { vendor: sessionVendor } = await requireVendor()
  const vendorId = sessionVendor.id

  // Pull the vendor's facility set so we can compute correct category
  // totals (denominator) at every facility this vendor sells into.
  // Previously this action sliced facility-wide COG with `category IN
  // (...)` which (a) lost the contract-category fallback for the
  // denominator and (b) leaked spend across facilities the vendor
  // doesn't actually sell at.
  const vendorRows = await prisma.cOGRecord.findMany({
    where: { vendorId },
    select: { facilityId: true },
    distinct: ["facilityId"],
  })
  const facilityIds = vendorRows.map((r) => r.facilityId)

  if (facilityIds.length === 0) {
    return serialize({ rows: [], uncategorizedSpend: 0, totalVendorSpend: 0 })
  }

  const cogRows = await prisma.cOGRecord.findMany({
    where: { facilityId: { in: facilityIds } },
    select: {
      vendorId: true,
      category: true,
      extendedPrice: true,
      contractId: true,
    },
  })

  const contractIds = Array.from(
    new Set(cogRows.map((r) => r.contractId).filter((v): v is string => !!v)),
  )
  const contractCategoryRows =
    contractIds.length > 0
      ? await prisma.contract.findMany({
          where: { id: { in: contractIds } },
          select: {
            id: true,
            productCategory: { select: { name: true } },
          },
        })
      : []
  const contractCategoryMap = new Map<string, string | null>(
    contractCategoryRows.map((c) => [c.id, c.productCategory?.name ?? null]),
  )

  const computed = computeCategoryMarketShare({
    rows: cogRows,
    contractCategoryMap,
    vendorId,
  })

  return serialize(computed)
}
```

Then delete the now-unused `vendorByCategory` / `categories` / `totalByCategory.groupBy` block that follows.

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors. Note: if the deletion left `totalMap` or other locals dangling, remove them. The `VendorMarketShareByCategoryResult` interface is structurally identical to `MarketShareResult`.

- [ ] **Step 4: Run vendor-side tests**

Run: `bunx vitest run lib/actions/__tests__/vendor-spend-cog-source.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/vendor-dashboard.ts
git commit -m "fix(market-share): vendor action delegates to canonical helper

getVendorMarketShareByCategory now applies the contract-category
fallback to BOTH numerator and denominator via the canonical
helper. Pre-fix the groupBy denominator filtered on raw category
only, so vendors whose contracts carried productCategory but
whose COG rows were null saw inflated share% (correct numerator,
under-counted denominator).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Parity test — both actions agree on a shared fixture

**Files:**
- Create: `lib/actions/__tests__/market-share-parity.test.ts`

- [ ] **Step 1: Write the parity test**

```ts
// lib/actions/__tests__/market-share-parity.test.ts
/**
 * Parity guard — Spec 2026-04-26-v0-parity-engines-design.md Bucket A1.
 *
 * `getCategoryMarketShareForVendor` (facility-scoped, contract detail card)
 * and `getVendorMarketShareByCategory` (vendor-session, vendor dashboard)
 * must produce identical `{ category, vendorSpend, categoryTotal,
 * sharePct }` for the same vendor when fed the same COG fixture.
 *
 * This test fails if either action regresses to an inline reducer that
 * skips the contract-category fallback (the bug fixed in Task 4) or any
 * future drift between the two surfaces.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const FACILITY_ID = "f_lighthouse"
const VENDOR_ID = "v_stryker"
const OTHER_VENDOR_ID = "v_other"

type CogRow = {
  vendorId: string | null
  category: string | null
  extendedPrice: number
  contractId: string | null
  facilityId: string
  transactionDate: Date
}

const fixture: CogRow[] = [
  // Explicit category — both vendors compete in Spine
  { vendorId: VENDOR_ID, category: "Spine", extendedPrice: 100, contractId: null, facilityId: FACILITY_ID, transactionDate: new Date() },
  { vendorId: OTHER_VENDOR_ID, category: "Spine", extendedPrice: 100, contractId: null, facilityId: FACILITY_ID, transactionDate: new Date() },
  // Fallback path — COG.category null but contract carries Ortho-Extremity
  { vendorId: VENDOR_ID, category: null, extendedPrice: 80, contractId: "c1", facilityId: FACILITY_ID, transactionDate: new Date() },
  { vendorId: OTHER_VENDOR_ID, category: null, extendedPrice: 20, contractId: "c2", facilityId: FACILITY_ID, transactionDate: new Date() },
]

const contracts = [
  { id: "c1", productCategory: { name: "Ortho-Extremity" } },
  { id: "c2", productCategory: { name: "Ortho-Extremity" } },
]

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      findMany: vi.fn(async (args: { select?: Record<string, boolean>; distinct?: string[] }) => {
        if (args.distinct?.includes("facilityId")) {
          return [{ facilityId: FACILITY_ID }]
        }
        return fixture
      }),
    },
    contract: {
      findMany: vi.fn(async () => contracts),
      findFirst: vi.fn(async () => null),
    },
  },
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T>(v: T) => v,
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: FACILITY_ID },
    user: { id: "u1" },
  })),
  requireVendor: vi.fn(async () => ({
    vendor: { id: VENDOR_ID },
    user: { id: "u1" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string) => ({ id }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.resetModules()
})

describe("market-share parity: facility action vs vendor action", () => {
  it("produces identical rows for the same vendor on the same fixture", async () => {
    const { getCategoryMarketShareForVendor } = await import(
      "@/lib/actions/cog/category-market-share"
    )
    const { getVendorMarketShareByCategory } = await import(
      "@/lib/actions/vendor-dashboard"
    )

    const facilityResult = await getCategoryMarketShareForVendor({
      vendorId: VENDOR_ID,
    })
    const vendorResult = await getVendorMarketShareByCategory()

    const norm = (rows: Array<{ category: string; vendorSpend: number; categoryTotal: number; sharePct: number }>) =>
      [...rows]
        .sort((a, b) => a.category.localeCompare(b.category))
        .map((r) => ({
          category: r.category,
          vendorSpend: r.vendorSpend,
          categoryTotal: r.categoryTotal,
          sharePct: Number(r.sharePct.toFixed(6)),
        }))

    expect(norm(vendorResult.rows)).toEqual(norm(facilityResult.rows))
    expect(vendorResult.totalVendorSpend).toBe(facilityResult.totalVendorSpend)
    expect(vendorResult.uncategorizedSpend).toBe(facilityResult.uncategorizedSpend)
  })

  it("includes the contract-fallback category in BOTH numerator and denominator", async () => {
    const { getCategoryMarketShareForVendor } = await import(
      "@/lib/actions/cog/category-market-share"
    )
    const result = await getCategoryMarketShareForVendor({ vendorId: VENDOR_ID })
    const ortho = result.rows.find((r) => r.category === "Ortho-Extremity")
    expect(ortho).toBeDefined()
    expect(ortho!.vendorSpend).toBe(80)
    expect(ortho!.categoryTotal).toBe(100)
    expect(ortho!.sharePct).toBeCloseTo(80, 6)
  })
})
```

- [ ] **Step 2: Run the parity test**

Run: `bunx vitest run lib/actions/__tests__/market-share-parity.test.ts`
Expected: PASS — both assertions green. If the second assertion (`Ortho-Extremity` denominator = 100) fails, Task 4's refactor missed the fallback for one side.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/__tests__/market-share-parity.test.ts
git commit -m "test(market-share): parity guard between facility + vendor actions

Both actions must produce identical { vendorSpend, categoryTotal,
sharePct } for the same vendor on the same fixture. Test seeds a
fallback case (COG.category=null, Contract.productCategory='Ortho-
Extremity') to lock in the fix from the previous commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Update CLAUDE.md Canonical reducers table

**Files:**
- Modify: `CLAUDE.md` (Canonical reducers — invariants table section)

- [ ] **Step 1: Add the new row**

Open `CLAUDE.md`. Find the table under "## Canonical reducers — invariants table". After the `Rebate applied to capital (tie-in)` row and before the closing of the table, insert:

```markdown
| Per-category market share | `computeCategoryMarketShare` | `lib/contracts/market-share-filter.ts` | facility action `getCategoryMarketShareForVendor` (contract-detail Performance tab — `category-market-share-card.tsx`), vendor action `getVendorMarketShareByCategory` (vendor dashboard widget). Regression-guarded by `lib/actions/__tests__/market-share-parity.test.ts` |
```

- [ ] **Step 2: Verify the table still renders**

Run: `bunx rg -n "Per-category market share" CLAUDE.md`
Expected: one match in the invariants table block.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: register market-share canonical helper in invariants table

Future surfaces that render per-category market share must call
computeCategoryMarketShare. The parity test prevents new ad-hoc
reducers from silently disagreeing with the canonical math.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full-suite verification + push

**Files:** none

- [ ] **Step 1: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Run the full Vitest suite excluding worktrees**

Run: `bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'`
Expected: all tests pass. If any pre-existing test breaks, investigate before pushing — don't paper over.

- [ ] **Step 3: Smoke the surfaces touched**

Run: `rm -rf .next && bun run dev`

In the browser at the demo facility (Lighthouse Surgical Center):
- Open a contract whose vendor has spend in a category. Confirm Performance tab "Category Market Share" card renders rows with `vendorSpend / categoryTotal` percentages.
- Open the vendor dashboard at `/vendor` for the same demo vendor. Confirm the market-share-by-category widget renders the same percentages for the same categories.

If percentages disagree between the two surfaces, the Task 5 parity test should have caught it — re-run it and inspect the fixture.

- [ ] **Step 4: Push**

```bash
git pull --rebase origin main
git push origin main
```

Expected: clean fast-forward push.

---

## Self-review

**1. Spec coverage:**
- Bucket A1 (canonical helper) — Tasks 2, 3, 4. ✅
- Bucket A3 (extend parity tests to vendor surfaces) — Task 5. ✅
- Bucket A1 invariants-table update — Task 6. ✅
- Bucket A4 (seed Lighthouse rebate rows) — NOT in this plan; that's a data-prep task to run before the verification pass, not a code change. Tracked separately.

**2. Placeholder scan:** every step has concrete code, exact paths, exact commands, exact expected output. No "TBD" / "similar to" / "appropriate handling" patterns.

**3. Type consistency:** `MarketShareResult` (helper) and `CategoryMarketShareResult` (facility action) and `VendorMarketShareByCategoryResult` (vendor action) all share field names: `rows`, `uncategorizedSpend`, `totalVendorSpend`. `MarketShareRow` and `CategoryMarketShareRow` share: `category`, `vendorSpend`, `categoryTotal`, `sharePct`, `competingVendors`, `commitmentPct`. Helper input row uses `extendedPrice: number | string | { toString(): string } | null` to accept Prisma `Decimal` without a static dependency.

**4. Risk callouts:**
- Task 4 changes the **scope** of the vendor-session denominator from "all facilities" to "facilities where this vendor has any spend." This is intentional — the prior global denominator was a bug — but it does change numbers visibly for vendors selling at multiple facilities. Confirm with PO before merge if any production vendor's dashboard would shift materially.
- The parity test (Task 5) mocks `prisma` with a single `findMany` mock that returns the same fixture regardless of `where` clause. This is sufficient for the parity guarantee but does not exercise the windowing logic; the per-helper unit tests (Task 1) cover the math, the action-level integration tests (existing `vendor-spend-cog-source.test.ts`) cover the queries.

---

## Out of scope / follow-up plans

These were in the spec but blocked or deferred:

- **#7 Vendor divisions multi-value editor** — blocked on PO clarifying whether free-text (`Vendor.division: string`, already shipped in `2f37a39`) is sufficient or whether `Vendor.divisions[]` is required.
- **#11 Financial Analysis hypothetical input** — blocked on PO screenshot against current main.
- **#12 Optimizer empty-state UX** — blocked on confirming whether commit `9482840` resolved it for the demo data.
- **#13 Case Costing "anything new"** — needs PO clarification on what they were asking.
- **B1 E2E test for vendor amortization** — separate Playwright plan; not blocked, just not the highest leverage.
- **D4 Shared contract-detail component** — explicitly deferred per spec Section 4 (v0 has parallel trees too; output parity > maintenance refactor).

When PO unblocks any of the above, write a sibling plan in `docs/superpowers/plans/`.
