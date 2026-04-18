# COG Data Rewrite — Subsystem 1: Enrichment Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `lib/contracts/match.ts::matchCOGRecordToContract` (the canonical match algorithm from platform-data-model spec §4.9) plus `lib/cog/enrichment.ts::enrichCOGRecord` and `enrichBatch` (the persistence adapter). Both are pure; tests cover all 6 match statuses + the canonical sign convention.

**Architecture:** Two modules, no schema changes, no DB calls. The match function is platform-wide (used by both COG and invoice pipelines); the enrichment function is the COG-specific adapter that maps a `MatchResult` into column-level update data.

**Tech Stack:** TypeScript, Prisma 7 (type-only imports), Vitest, Decimal.js (via Prisma).

**Parent spec:** `docs/superpowers/specs/2026-04-18-cog-data-rewrite.md` §3 (subsystem 1).
**Cross-referenced spec:** `docs/superpowers/specs/2026-04-18-platform-data-model-reconciliation.md` §4.9 — canonical match algorithm; §4.11 — sign convention.

---

## Sign convention (locked in — §4.11)

- `savings > 0` → facility paid **less** than list (win). Computed as `(listPrice - unitPrice) × quantity`.
- `variancePercent > 0` → facility paid **more** than contract (bad). Computed as `((actual - contract) / contract) × 100`.
- `variancePercent === 0` → on contract exactly.
- `variancePercent < 0` → paid below contract (rare; typically credit-memo correction).

Every function in this subsystem must document this inline.

---

## Price variance threshold

- `PRICE_VARIANCE_THRESHOLD = 2%` — per §4.12. Exported from `lib/contracts/match.ts`.

---

## File structure

**Files touched:**

- Create: `lib/contracts/match.ts` — canonical match algorithm + threshold constant
- Create: `lib/contracts/__tests__/match.test.ts` — 6-status coverage + sign convention
- Create: `lib/cog/enrichment.ts` — column-level adapter (`enrichCOGRecord`, `enrichBatch`)
- Create: `lib/cog/__tests__/enrichment.test.ts` — batch coverage + idempotence

**Tests:** Vitest. Files follow the pattern of `tests/contracts/*.test.ts` (which are already green).

---

## Task 1: Build `lib/contracts/match.ts`

**Files:**
- Create: `lib/contracts/match.ts`

- [ ] **Step 1: Write the failing test (skeleton)**

Create `lib/contracts/__tests__/match.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import {
  matchCOGRecordToContract,
  PRICE_VARIANCE_THRESHOLD,
  type CogRecordForMatch,
  type ContractForMatch,
} from "../match"

const baseRecord: CogRecordForMatch = {
  facilityId: "fac-1",
  vendorId: "vendor-1",
  vendorName: "Acme Medical",
  vendorItemNo: "ITEM-100",
  unitCost: 100,
  quantity: 10,
  transactionDate: new Date("2026-03-15"),
}

const onContractItem = (overrides = {}) => ({
  vendorItemNo: "ITEM-100",
  unitPrice: 100,
  listPrice: 120,
  ...overrides,
})

const baseContract = (overrides: Partial<ContractForMatch> = {}): ContractForMatch => ({
  id: "c-1",
  vendorId: "vendor-1",
  status: "active",
  effectiveDate: new Date("2026-01-01"),
  expirationDate: new Date("2026-12-31"),
  facilityIds: ["fac-1"],
  pricingItems: [onContractItem()],
  ...overrides,
})

describe("matchCOGRecordToContract", () => {
  it("returns unknown_vendor when record has no vendorId", () => {
    const r = { ...baseRecord, vendorId: null }
    const result = matchCOGRecordToContract(r, [baseContract()])
    expect(result.status).toBe("unknown_vendor")
  })

  it("returns off_contract_item when vendor has no active contracts", () => {
    const result = matchCOGRecordToContract(baseRecord, [
      baseContract({ status: "expired" }),
    ])
    expect(result.status).toBe("off_contract_item")
  })

  it("returns out_of_scope when contract does not cover facility", () => {
    const result = matchCOGRecordToContract(baseRecord, [
      baseContract({ facilityIds: ["fac-other"] }),
    ])
    expect(result.status).toBe("out_of_scope")
  })

  it("returns out_of_scope when transactionDate is outside contract window", () => {
    const r = { ...baseRecord, transactionDate: new Date("2027-01-15") }
    const result = matchCOGRecordToContract(r, [baseContract()])
    expect(result.status).toBe("out_of_scope")
  })

  it("returns off_contract_item when vendor+facility+date match but item is not on contract", () => {
    const result = matchCOGRecordToContract(baseRecord, [
      baseContract({ pricingItems: [onContractItem({ vendorItemNo: "OTHER-ITEM" })] }),
    ])
    expect(result.status).toBe("off_contract_item")
  })

  it("returns on_contract when item matches at contract price (within 2%)", () => {
    const result = matchCOGRecordToContract(baseRecord, [
      baseContract({ pricingItems: [onContractItem({ unitPrice: 100, listPrice: 120 })] }),
    ])
    expect(result.status).toBe("on_contract")
    if (result.status === "on_contract") {
      expect(result.contractId).toBe("c-1")
      expect(result.contractPrice).toBe(100)
      // (listPrice - unitPrice) × quantity = (120 - 100) × 10 = 200
      expect(result.savings).toBe(200)
    }
  })

  it("returns price_variance when actual is >2% above contract price", () => {
    const r = { ...baseRecord, unitCost: 110 } // 10% overpay
    const result = matchCOGRecordToContract(r, [baseContract()])
    expect(result.status).toBe("price_variance")
    if (result.status === "price_variance") {
      expect(result.contractId).toBe("c-1")
      expect(result.contractPrice).toBe(100)
      // (110 - 100) / 100 * 100 = 10%
      expect(result.variancePercent).toBeCloseTo(10, 2)
    }
  })

  it("returns on_contract when actual is within 2% of contract (edge)", () => {
    const r = { ...baseRecord, unitCost: 101.5 } // 1.5% — within threshold
    const result = matchCOGRecordToContract(r, [baseContract()])
    expect(result.status).toBe("on_contract")
  })

  it("vendorItemNo match is case-insensitive", () => {
    const r = { ...baseRecord, vendorItemNo: "item-100" }
    const result = matchCOGRecordToContract(r, [
      baseContract({ pricingItems: [onContractItem({ vendorItemNo: "ITEM-100" })] }),
    ])
    expect(result.status).toBe("on_contract")
  })

  it("accepts 'expiring' status as active for match purposes", () => {
    const result = matchCOGRecordToContract(baseRecord, [
      baseContract({ status: "expiring" }),
    ])
    expect(result.status).toBe("on_contract")
  })

  it("exports PRICE_VARIANCE_THRESHOLD as 2", () => {
    expect(PRICE_VARIANCE_THRESHOLD).toBe(2)
  })
})
```

- [ ] **Step 2: Run the failing test**

```bash
bunx vitest run lib/contracts/__tests__/match.test.ts
```

Expected: FAIL — `match.ts` not found.

- [ ] **Step 3: Implement `lib/contracts/match.ts`**

```typescript
/**
 * Canonical COG → Contract match algorithm.
 *
 * Per docs/superpowers/specs/2026-04-18-platform-data-model-reconciliation.md §4.9.
 *
 * ─── Sign convention (§4.11, LOCKED IN) ─────────────────────────────
 *
 *   savings > 0            → facility paid LESS than list (WIN)
 *   variancePercent > 0    → facility paid MORE than contract (BAD, flag)
 *   variancePercent === 0  → on contract exactly
 *   variancePercent < 0    → paid BELOW contract (rare; credit-memo correction)
 *
 *   savings = (listPrice - unitPrice) × quantity
 *   variancePercent = ((actual - contract) / contract) × 100
 *
 * This module is pure. No DB calls. Callers load contracts + pass them in.
 */

/** Match threshold: any |variancePercent| strictly above this is `price_variance`. */
export const PRICE_VARIANCE_THRESHOLD = 2 // percent

export type CogRecordForMatch = {
  facilityId: string
  vendorId: string | null
  vendorName: string | null
  vendorItemNo: string | null
  unitCost: number
  quantity: number
  transactionDate: Date
}

export type ContractPricingItemForMatch = {
  vendorItemNo: string
  unitPrice: number
  listPrice: number | null
}

export type ContractForMatch = {
  id: string
  vendorId: string
  status: "active" | "expiring" | "expired" | "draft" | "pending"
  effectiveDate: Date
  expirationDate: Date | null
  facilityIds: string[]
  pricingItems: ContractPricingItemForMatch[]
}

export type MatchResult =
  | { status: "unknown_vendor" }
  | { status: "off_contract_item"; reason: string }
  | { status: "out_of_scope"; reason: string }
  | {
      status: "on_contract"
      contractId: string
      contractPrice: number
      savings: number
    }
  | {
      status: "price_variance"
      contractId: string
      contractPrice: number
      variancePercent: number
    }

/**
 * Returns a MatchResult describing how a COG record relates to a set of
 * candidate contracts. See file header for algorithm + sign convention.
 */
export function matchCOGRecordToContract(
  record: CogRecordForMatch,
  contracts: ContractForMatch[],
): MatchResult {
  // 1. Vendor resolution
  if (!record.vendorId) {
    return { status: "unknown_vendor" }
  }

  // 2. Active/expiring contracts for this vendor
  const activeContracts = contracts.filter(
    (c) =>
      c.vendorId === record.vendorId &&
      (c.status === "active" || c.status === "expiring"),
  )
  if (activeContracts.length === 0) {
    return { status: "off_contract_item", reason: "no active contract for vendor" }
  }

  // 3. Facility scope
  const inScope = activeContracts.filter((c) => c.facilityIds.includes(record.facilityId))
  if (inScope.length === 0) {
    return { status: "out_of_scope", reason: "no contract covers this facility" }
  }

  // 4. Date scope
  const byDate = inScope.filter((c) => {
    const recordMs = record.transactionDate.getTime()
    if (recordMs < c.effectiveDate.getTime()) return false
    if (c.expirationDate && recordMs > c.expirationDate.getTime()) return false
    return true
  })
  if (byDate.length === 0) {
    return { status: "out_of_scope", reason: "no contract covers this date" }
  }

  // 5. Item lookup across candidate contracts
  const itemNoLower = record.vendorItemNo?.toLowerCase() ?? null
  if (!itemNoLower) {
    return {
      status: "off_contract_item",
      reason: "record has no vendorItemNo to match against contract pricing",
    }
  }

  for (const contract of byDate) {
    const item = contract.pricingItems.find(
      (p) => p.vendorItemNo.toLowerCase() === itemNoLower,
    )
    if (!item) continue

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
      }
    }

    // Savings convention: positive = facility paid less than list.
    const savings =
      item.listPrice === null
        ? 0
        : (item.listPrice - item.unitPrice) * record.quantity

    return {
      status: "on_contract",
      contractId: contract.id,
      contractPrice: item.unitPrice,
      savings,
    }
  }

  return {
    status: "off_contract_item",
    reason: "vendor and facility and date match, but item not on any contract",
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bunx vitest run lib/contracts/__tests__/match.test.ts
```

Expected: all 11 tests passing.

---

## Task 2: Build `lib/cog/enrichment.ts`

**Files:**
- Create: `lib/cog/enrichment.ts`
- Create: `lib/cog/__tests__/enrichment.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest"
import { enrichCOGRecord, enrichBatch, type EnrichmentColumns } from "../enrichment"
import type { MatchResult } from "@/lib/contracts/match"

describe("enrichCOGRecord", () => {
  it("maps unknown_vendor to null/false columns", () => {
    const result: MatchResult = { status: "unknown_vendor" }
    const cols = enrichCOGRecord(result, { quantity: 10, unitCost: 100 })
    expect(cols.matchStatus).toBe("unknown_vendor")
    expect(cols.contractId).toBeNull()
    expect(cols.contractPrice).toBeNull()
    expect(cols.isOnContract).toBe(false)
    expect(cols.savingsAmount).toBeNull()
    expect(cols.variancePercent).toBeNull()
  })

  it("maps off_contract_item to null/false columns", () => {
    const result: MatchResult = {
      status: "off_contract_item",
      reason: "no active contract for vendor",
    }
    const cols = enrichCOGRecord(result, { quantity: 10, unitCost: 100 })
    expect(cols.matchStatus).toBe("off_contract_item")
    expect(cols.isOnContract).toBe(false)
    expect(cols.contractId).toBeNull()
    expect(cols.savingsAmount).toBeNull()
  })

  it("maps out_of_scope to null/false columns", () => {
    const result: MatchResult = {
      status: "out_of_scope",
      reason: "no contract covers this date",
    }
    const cols = enrichCOGRecord(result, { quantity: 10, unitCost: 100 })
    expect(cols.matchStatus).toBe("out_of_scope")
    expect(cols.isOnContract).toBe(false)
  })

  it("maps on_contract to populated columns with positive savings", () => {
    const result: MatchResult = {
      status: "on_contract",
      contractId: "c-1",
      contractPrice: 100,
      savings: 200,
    }
    const cols = enrichCOGRecord(result, { quantity: 10, unitCost: 100 })
    expect(cols.matchStatus).toBe("on_contract")
    expect(cols.contractId).toBe("c-1")
    expect(cols.contractPrice).toBe(100)
    expect(cols.isOnContract).toBe(true)
    expect(cols.savingsAmount).toBe(200)
    expect(cols.variancePercent).toBe(0)
  })

  it("maps price_variance to populated columns with positive variancePercent", () => {
    const result: MatchResult = {
      status: "price_variance",
      contractId: "c-1",
      contractPrice: 100,
      variancePercent: 10,
    }
    const cols = enrichCOGRecord(result, { quantity: 10, unitCost: 110 })
    expect(cols.matchStatus).toBe("price_variance")
    expect(cols.contractId).toBe("c-1")
    expect(cols.contractPrice).toBe(100)
    expect(cols.isOnContract).toBe(false) // variance means NOT on contract cleanly
    expect(cols.variancePercent).toBe(10)
    // savingsAmount = (contractPrice - unitCost) × quantity = (100 - 110) × 10 = -100
    // Sign: negative savings = facility overpaid
    expect(cols.savingsAmount).toBe(-100)
  })
})

describe("enrichBatch", () => {
  it("applies enrichment across an array of records preserving order", () => {
    const results: MatchResult[] = [
      { status: "unknown_vendor" },
      { status: "on_contract", contractId: "c-1", contractPrice: 50, savings: 100 },
    ]
    const records = [
      { quantity: 5, unitCost: 50 },
      { quantity: 5, unitCost: 50 },
    ]
    const enriched = enrichBatch(
      results.map((r, i) => ({ result: r, record: records[i]! })),
    )
    expect(enriched).toHaveLength(2)
    expect(enriched[0]!.matchStatus).toBe("unknown_vendor")
    expect(enriched[1]!.matchStatus).toBe("on_contract")
    expect(enriched[1]!.isOnContract).toBe(true)
  })
})
```

- [ ] **Step 2: Run the failing test**

```bash
bunx vitest run lib/cog/__tests__/enrichment.test.ts
```

Expected: FAIL — `enrichment.ts` not found.

- [ ] **Step 3: Implement `lib/cog/enrichment.ts`**

```typescript
/**
 * COG enrichment adapter.
 *
 * Pure function — maps a MatchResult (from lib/contracts/match.ts) plus
 * the COG record's quantity/unitCost into the 5 persisted columns:
 *
 *   matchStatus, contractId, contractPrice,
 *   isOnContract, savingsAmount, variancePercent
 *
 * ─── Sign convention (LOCKED IN, §4.11) ─────────────────────────────
 *
 *   savingsAmount > 0      → facility paid LESS than contract (win)
 *   variancePercent > 0    → facility paid MORE than contract (bad)
 *   isOnContract === true  → status is exactly "on_contract" (within 2%)
 *
 * This is the only module that writes enrichment columns. Subsystem 2's
 * recompute trigger, subsystem 3's import pipeline, and subsystem 4's
 * duplicate detection all go through this function — there must be
 * exactly one place where the sign lives.
 */

import type { COGMatchStatus, Prisma } from "@prisma/client"
import type { MatchResult } from "@/lib/contracts/match"

export type EnrichmentColumns = {
  matchStatus: COGMatchStatus
  contractId: string | null
  contractPrice: Prisma.Decimal | number | null
  isOnContract: boolean
  savingsAmount: Prisma.Decimal | number | null
  variancePercent: Prisma.Decimal | number | null
}

export type RecordForEnrichment = {
  quantity: number
  unitCost: number
}

/**
 * Map a single MatchResult + record into the 5 enrichment columns.
 */
export function enrichCOGRecord(
  result: MatchResult,
  record: RecordForEnrichment,
): EnrichmentColumns {
  switch (result.status) {
    case "unknown_vendor":
    case "off_contract_item":
    case "out_of_scope":
      return {
        matchStatus: result.status,
        contractId: null,
        contractPrice: null,
        isOnContract: false,
        savingsAmount: null,
        variancePercent: null,
      }

    case "on_contract":
      return {
        matchStatus: "on_contract",
        contractId: result.contractId,
        contractPrice: result.contractPrice,
        isOnContract: true,
        savingsAmount: result.savings,
        variancePercent: 0,
      }

    case "price_variance": {
      // savingsAmount for a variance record: (contract - actual) × quantity.
      // If facility overpaid (variancePercent > 0), savings will be negative.
      const savings =
        (result.contractPrice - record.unitCost) * record.quantity
      return {
        matchStatus: "price_variance",
        contractId: result.contractId,
        contractPrice: result.contractPrice,
        isOnContract: false, // variance means NOT on contract cleanly
        savingsAmount: savings,
        variancePercent: result.variancePercent,
      }
    }
  }
}

/**
 * Batched version: preserve input order, return enrichment per row.
 */
export function enrichBatch(
  pairs: Array<{ result: MatchResult; record: RecordForEnrichment }>,
): EnrichmentColumns[] {
  return pairs.map(({ result, record }) => enrichCOGRecord(result, record))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bunx vitest run lib/cog/__tests__/enrichment.test.ts
```

Expected: all 6 tests passing.

---

## Task 3: Full verification

- [ ] **Step 1: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Full suite**

```bash
bunx vitest run --exclude tests/workflows --exclude tests/visual
```

Expected: 94 + 11 + 6 = 111 tests passing.

- [ ] **Step 3: Build smoke**

```bash
bun run build
```

Expected: compiled successfully.

---

## Task 4: Commit + FF merge

- [ ] **Step 1: Stage + commit**

```bash
git add lib/contracts/match.ts \
        lib/contracts/__tests__/match.test.ts \
        lib/cog/enrichment.ts \
        lib/cog/__tests__/enrichment.test.ts \
        docs/superpowers/plans/2026-04-18-cog-data-01-enrichment-plan.md

git commit -m "feat(cog): subsystem 1 — enrichment engine + canonical match algorithm

Lands the two pure modules that every downstream COG enrichment
pathway consumes:

lib/contracts/match.ts:
- PRICE_VARIANCE_THRESHOLD (2%)
- matchCOGRecordToContract(record, contracts) → MatchResult
- Implements the §4.9 algorithm from platform-data-model spec
- 6 match statuses: unknown_vendor, off_contract_item, out_of_scope,
  on_contract, price_variance (+ 6th reserved for COG-specific
  'pending' default state)
- Case-insensitive vendorItemNo matching
- 'expiring' contracts treated as active

lib/cog/enrichment.ts:
- enrichCOGRecord(result, record) → 5 column values
- enrichBatch(pairs[]) — preserves order
- Sign convention locked in (§4.11):
    savings > 0      → facility paid LESS (win)
    variancePercent > 0 → facility paid MORE (flag)
    isOnContract true ONLY on exact on_contract match

Tests (17 total, all green):
- match.test.ts (11) — every status + sign + edge cases
- enrichment.test.ts (6) — status→column mapping + batch order

Pure functions; no schema changes; no DB calls. Consumable by:
- Subsystem 2 (contract-save recompute)
- Subsystem 3 (import pipeline)
- Invoice match-status pipeline (data-pipeline spec)

Part of: docs/superpowers/specs/2026-04-18-cog-data-rewrite.md
Cross-ref: 2026-04-18-platform-data-model-reconciliation.md §4.9 + §4.11

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 2: FF merge to main**

```bash
cd /Users/vickkumar/code/tydei-next
git merge --ff-only contracts-rewrite-00-schema
```

---

## Acceptance

- [ ] `lib/contracts/match.ts` exists with canonical algorithm
- [ ] `lib/cog/enrichment.ts` exists with pure adapter
- [ ] 17 new tests passing (11 match + 6 enrichment)
- [ ] `bunx tsc --noEmit` → 0 errors
- [ ] Full suite: 111+ tests passing
- [ ] `bun run build` compiled
- [ ] Commit on main via FF merge
