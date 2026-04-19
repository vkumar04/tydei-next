# v0 Parity Wave 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Ship the 5 final v0-parity subsystems — engine-dependent or nice-to-have. After this wave the contracts + cog-data v0 audit gaps are closed.

**Architecture:** Mix of UI promotion, scoring-engine extension, deterministic fuzzy matcher, and a canonical resolver. No schema migrations beyond what's already pending.

**Tech Stack:** Next.js 16, Prisma 7, TypeScript strict, Vitest, TanStack Query, shadcn/ui, recharts.

**Working DB:** `postgresql://tydei:tydei_dev_password@localhost:5432/tydei`. Demo facility = `cmo4sbr8p0004wthl91ubwfwb`.

**Source spec:** `docs/superpowers/specs/2026-04-18-contracts-rewrite.md` §9.3, 9.9, 9.10 + `docs/superpowers/specs/2026-04-18-cog-data-rewrite.md` §10.4, 10.5.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `components/contracts/new-contract-client.tsx` | Default `entryMode = "pdf"`; show inline review panel after extract | 1 |
| `components/contracts/__tests__/new-contract-tab-routing.test.ts` | Pure helper test asserting initial mode | 1 |
| `lib/contracts/score-benchmarks.ts` | Static seed: median per dimension by contract type | 2 |
| `lib/contracts/__tests__/score-benchmarks.test.ts` | Lookup returns the right shape per type | 2 |
| `components/contracts/contract-score-radar.tsx` | Accept optional `benchmark` prop; second translucent series | 2 |
| `app/dashboard/contracts/[id]/score/page.tsx` | Pass benchmark by `contract.contractType` | 2 |
| `lib/contracts/scoring.ts` | Add `priceCompetitivenessScore` to `ContractScoreResult.components` | 3 |
| `lib/actions/contracts/scoring.ts` | Query `prisma.invoicePriceVariance`, feed to `calculateContractScore` | 3 |
| `lib/contracts/__tests__/scoring.test.ts` | Add cases for the new component | 3 |
| `lib/cog/ai-dedup.ts` | Pure fuzzy matcher (Levenshtein + price/date tolerance) | 4 |
| `lib/cog/__tests__/ai-dedup.test.ts` | Fixture + assertions | 4 |
| `components/facility/cog/dedup-advisor-card.tsx` | Pairs UI + ignore/merge buttons | 4 |
| `lib/cog/match.ts` | Cascade resolver: vendorItemNo exact → vendor+date window → fuzzy fallback | 5 |
| `lib/cog/__tests__/match.test.ts` | Precedence tests | 5 |

---

## Task 1: PDF entry-mode default + inline preview

**Spec:** Subsystem 9.3.

**Files:**
- Modify: `components/contracts/new-contract-client.tsx`
- Create: `components/contracts/__tests__/new-contract-tab-routing.test.ts`

- [ ] **Step 1: Extract initial-mode helper**

In `components/contracts/new-contract-client.tsx`, near the top, add:

```ts
export function initialEntryMode(searchParam: string | null): "pdf" | "manual" | "ai" {
  if (searchParam === "manual" || searchParam === "ai" || searchParam === "pdf") {
    return searchParam
  }
  return "pdf"
}
```

Use it as the `useState` initializer reading from `useSearchParams().get("mode")`.

- [ ] **Step 2: Test the helper**

```ts
// components/contracts/__tests__/new-contract-tab-routing.test.ts
import { describe, it, expect } from "vitest"
import { initialEntryMode } from "@/components/contracts/new-contract-client"

describe("initialEntryMode", () => {
  it("defaults to pdf when param is missing", () => {
    expect(initialEntryMode(null)).toBe("pdf")
  })
  it("respects ?mode=manual / ?mode=ai", () => {
    expect(initialEntryMode("manual")).toBe("manual")
    expect(initialEntryMode("ai")).toBe("ai")
  })
  it("falls back to pdf for unknown values", () => {
    expect(initialEntryMode("garbage")).toBe("pdf")
  })
})
```

- [ ] **Step 3: Inline review panel**

After the existing `<ExtractedReviewCard>` (commit `6c87174`), confirm it renders inside `<TabsContent value="pdf">`. If it currently lives inside `<TabsContent value="manual">`, move it. The `ExtractedReviewCard` already exists; this task just makes sure it renders in the PDF tab so the user doesn't bounce away.

- [ ] **Step 4: Run test + tsc**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' components/contracts/__tests__/new-contract-tab-routing.test.ts
bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add components/contracts/new-contract-client.tsx components/contracts/__tests__/new-contract-tab-routing.test.ts
git commit -m "feat(contracts-create): default to PDF entry mode + inline review panel"
```

---

## Task 2: Industry benchmark radar overlay

**Spec:** Subsystem 9.9.

**Files:**
- Create: `lib/contracts/score-benchmarks.ts`
- Create: `lib/contracts/__tests__/score-benchmarks.test.ts`
- Modify: `components/contracts/contract-score-radar.tsx`
- Modify: `app/dashboard/contracts/[id]/score/page.tsx`

- [ ] **Step 1: Static seed file**

```ts
// lib/contracts/score-benchmarks.ts
import type { ContractType } from "@prisma/client"
import type { ContractScoreResult } from "@/lib/contracts/scoring"

/**
 * Peer-median benchmarks per contract type. Placeholder values until real
 * industry data is ingested (separate spec). Surface every dimension the
 * scoring engine emits so the radar can overlay both series in the same
 * shape — match the keys returned by `lib/contracts/scoring.ts`.
 */
export type ScoreBenchmark = ContractScoreResult["components"]

const PLACEHOLDER_BENCHMARK: ScoreBenchmark = {
  commitmentScore: 70,
  complianceScore: 80,
  rebateEfficiencyScore: 65,
  timelinessScore: 85,
  varianceScore: 75,
}

const BENCHMARKS: Partial<Record<ContractType, ScoreBenchmark>> = {
  usage: PLACEHOLDER_BENCHMARK,
  capital: { ...PLACEHOLDER_BENCHMARK, commitmentScore: 50, rebateEfficiencyScore: 55 },
  service: { ...PLACEHOLDER_BENCHMARK, commitmentScore: 60, rebateEfficiencyScore: 60 },
  tie_in: { ...PLACEHOLDER_BENCHMARK, complianceScore: 75 },
  grouped: { ...PLACEHOLDER_BENCHMARK, commitmentScore: 75, rebateEfficiencyScore: 70 },
  pricing_only: { ...PLACEHOLDER_BENCHMARK, rebateEfficiencyScore: 30, commitmentScore: 40 },
}

export function getScoreBenchmark(contractType: ContractType): ScoreBenchmark {
  return BENCHMARKS[contractType] ?? PLACEHOLDER_BENCHMARK
}
```

If the actual `ContractScoreResult["components"]` shape differs (e.g. Wave 3 Task 3 lands first and adds a 6th key), adapt — the type constraint will surface the mismatch.

- [ ] **Step 2: Test**

```ts
// lib/contracts/__tests__/score-benchmarks.test.ts
import { describe, it, expect } from "vitest"
import { ContractType } from "@prisma/client"
import { getScoreBenchmark } from "@/lib/contracts/score-benchmarks"

describe("getScoreBenchmark", () => {
  it("returns a benchmark for every ContractType enum value", () => {
    for (const t of Object.values(ContractType)) {
      const b = getScoreBenchmark(t)
      expect(b).toBeDefined()
      expect(b.complianceScore).toBeGreaterThanOrEqual(0)
      expect(b.complianceScore).toBeLessThanOrEqual(100)
    }
  })
})
```

- [ ] **Step 3: Radar — add second series**

In `components/contracts/contract-score-radar.tsx`, accept `benchmark?: ScoreBenchmark`. When present, render a second `<Radar>` with `stroke="#94a3b8"` (slate-400) and `fillOpacity={0.15}` so the user contract's emerald series stays prominent. Add a `<Legend />`.

- [ ] **Step 4: Wire in the page**

In `app/dashboard/contracts/[id]/score/page.tsx`:

```ts
import { getScoreBenchmark } from "@/lib/contracts/score-benchmarks"
// ...
const benchmark = contract?.contractType ? getScoreBenchmark(contract.contractType) : undefined
// pass into the client:
<ContractScoreClient
  contractId={id}
  contract={contract}
  ruleBasedComponents={ruleBasedComponents}
  benchmark={benchmark}
/>
```

Then plumb `benchmark` to `<ContractScoreRadar benchmark={benchmark} />`.

- [ ] **Step 5: Run test + tsc + commit**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/contracts/__tests__/score-benchmarks.test.ts
bunx tsc --noEmit
git add lib/contracts/score-benchmarks.ts lib/contracts/__tests__/score-benchmarks.test.ts components/contracts/contract-score-radar.tsx app/dashboard/contracts/[id]/score/page.tsx components/facility/contracts/contract-score-client.tsx
git commit -m "feat(contract-score): industry-benchmark radar overlay"
```

---

## Task 3: Price competitiveness score (6th dimension)

**Spec:** Subsystem 9.10.

**Files:**
- Modify: `lib/contracts/scoring.ts`
- Modify: `lib/actions/contracts/scoring.ts`
- Modify: `lib/contracts/__tests__/scoring.test.ts`

- [ ] **Step 1: Extend `calculateContractScore` signature + result shape**

In `lib/contracts/scoring.ts`, add `priceCompetitivenessScore: number` to `ContractScoreResult.components` and accept a new input parameter `averageVariancePercent?: number | null` on `calculateContractScore`. Default behavior when missing: `priceCompetitivenessScore = 100` (no variance data → no penalty).

When provided, score = `Math.max(0, Math.min(100, 100 - Math.abs(averageVariancePercent)))`. Heavy overcharge → low score; flat or undercharge → high score.

Re-weight `overallScore` to include the new component:

```ts
const overallScore =
  commitmentScore * 0.20 +
  complianceScore * 0.20 +
  rebateEfficiencyScore * 0.20 +
  timelinessScore * 0.15 +
  varianceScore * 0.15 +
  priceCompetitivenessScore * 0.10
```

(Adjust weights to taste — keep them summing to 1.0.)

- [ ] **Step 2: Add test cases**

In `lib/contracts/__tests__/scoring.test.ts`:

```ts
it("returns 100 priceCompetitivenessScore when no variance data", () => {
  const r = calculateContractScore({
    commitmentMet: 80, complianceRate: 80, rebatesEarned: 1000,
    totalContractValue: 10000, daysUntilExpiration: 365,
    majorVarianceCount: 0, totalVarianceCount: 0,
  })
  expect(r.components.priceCompetitivenessScore).toBe(100)
})

it("clamps priceCompetitivenessScore to 0-100 even on heavy overcharge", () => {
  const r = calculateContractScore({
    commitmentMet: 80, complianceRate: 80, rebatesEarned: 1000,
    totalContractValue: 10000, daysUntilExpiration: 365,
    majorVarianceCount: 5, totalVarianceCount: 5,
    averageVariancePercent: 200,
  })
  expect(r.components.priceCompetitivenessScore).toBe(0)
})

it("penalizes proportionally for variance", () => {
  const r = calculateContractScore({
    commitmentMet: 80, complianceRate: 80, rebatesEarned: 1000,
    totalContractValue: 10000, daysUntilExpiration: 365,
    majorVarianceCount: 1, totalVarianceCount: 3,
    averageVariancePercent: 25,
  })
  expect(r.components.priceCompetitivenessScore).toBe(75)
})
```

- [ ] **Step 3: Wire `loadAndScoreContract` to fetch the average**

In `lib/actions/contracts/scoring.ts::loadAndScoreContract`, in the existing variance query (the one that selects `severity`), also select `variancePercent: true` (or whatever the schema column is named). Compute the average:

```ts
const averageVariancePercent = variances.length > 0
  ? variances.reduce((sum, v) => sum + Math.abs(Number(v.variancePercent ?? 0)), 0) / variances.length
  : null
```

Pass `averageVariancePercent` into `calculateContractScore({...})`.

- [ ] **Step 4: Run tests + tsc + commit**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/contracts/__tests__/scoring.test.ts
bunx tsc --noEmit
git add lib/contracts/scoring.ts lib/actions/contracts/scoring.ts lib/contracts/__tests__/scoring.test.ts
git commit -m "feat(scoring): 6th dimension — price competitiveness from variance"
```

---

## Task 4: AI dedup advisor (deterministic fuzzy first)

**Spec:** Subsystem 10.4.

**Files:**
- Create: `lib/cog/ai-dedup.ts`
- Create: `lib/cog/__tests__/ai-dedup.test.ts`
- Create: `components/facility/cog/dedup-advisor-card.tsx`
- Modify: `components/facility/cog/cog-import-dialog.tsx`

- [ ] **Step 1: Pure fuzzy matcher**

```ts
// lib/cog/ai-dedup.ts
export interface CogRowFingerprint {
  id: string
  vendorItemNo: string | null
  description: string
  transactionDate: Date
  extendedPrice: number
}

export interface FuzzyDuplicatePair {
  a: CogRowFingerprint
  b: CogRowFingerprint
  reasons: string[]
}

const PRICE_TOLERANCE = 0.05 // ±5%
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_TOLERANCE_DAYS = 7

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    }
  }
  return d[m][n]
}

function descriptionSimilar(a: string, b: string): boolean {
  if (!a || !b) return false
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()
  const an = norm(a), bn = norm(b)
  const maxLen = Math.max(an.length, bn.length)
  if (maxLen === 0) return false
  const dist = levenshtein(an, bn)
  return dist / maxLen <= 0.2 // ≤20% character difference
}

function priceSimilar(a: number, b: number): boolean {
  if (a === 0 || b === 0) return false
  const diff = Math.abs(a - b) / Math.max(a, b)
  return diff <= PRICE_TOLERANCE
}

function dateSimilar(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= DATE_TOLERANCE_DAYS * DAY_MS
}

export function findFuzzyDuplicates(rows: CogRowFingerprint[]): FuzzyDuplicatePair[] {
  const out: FuzzyDuplicatePair[] = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j]
      // Skip exact dupes (the deterministic detector already catches those).
      if (a.vendorItemNo && b.vendorItemNo && a.vendorItemNo === b.vendorItemNo &&
          a.transactionDate.getTime() === b.transactionDate.getTime() &&
          a.extendedPrice === b.extendedPrice) continue

      const reasons: string[] = []
      if (descriptionSimilar(a.description, b.description)) reasons.push("description match")
      if (priceSimilar(a.extendedPrice, b.extendedPrice)) reasons.push("price within 5%")
      if (dateSimilar(a.transactionDate, b.transactionDate)) reasons.push("date within 7d")

      // Require at least 2 of the 3 signals AND vendor item match (or both null).
      if (reasons.length >= 2 && (a.vendorItemNo === b.vendorItemNo)) {
        out.push({ a, b, reasons })
      }
    }
  }
  return out
}
```

- [ ] **Step 2: Test**

```ts
// lib/cog/__tests__/ai-dedup.test.ts
import { describe, it, expect } from "vitest"
import { findFuzzyDuplicates, type CogRowFingerprint } from "@/lib/cog/ai-dedup"

const base = (over: Partial<CogRowFingerprint>): CogRowFingerprint => ({
  id: "x",
  vendorItemNo: "STK-1",
  description: "Stryker plate, 6-hole",
  transactionDate: new Date("2026-04-01"),
  extendedPrice: 100,
  ...over,
})

describe("findFuzzyDuplicates", () => {
  it("flags borderline pair (same item, close date, close price)", () => {
    const rows = [
      base({ id: "a" }),
      base({ id: "b", transactionDate: new Date("2026-04-04"), extendedPrice: 102 }),
    ]
    const pairs = findFuzzyDuplicates(rows)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].reasons.length).toBeGreaterThanOrEqual(2)
  })

  it("ignores far-apart rows", () => {
    const rows = [
      base({ id: "a" }),
      base({ id: "b", transactionDate: new Date("2026-09-01"), extendedPrice: 500 }),
    ]
    const pairs = findFuzzyDuplicates(rows)
    expect(pairs).toHaveLength(0)
  })

  it("skips exact-duplicate pairs (deterministic detector handles those)", () => {
    const rows = [base({ id: "a" }), base({ id: "b" })]
    const pairs = findFuzzyDuplicates(rows)
    expect(pairs).toHaveLength(0)
  })
})
```

- [ ] **Step 3: UI card (optional integration in this commit — surface only)**

Create the card stub:

```tsx
// components/facility/cog/dedup-advisor-card.tsx
"use client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { FuzzyDuplicatePair } from "@/lib/cog/ai-dedup"

interface Props {
  pairs: FuzzyDuplicatePair[]
}

export function DedupAdvisorCard({ pairs }: Props) {
  if (pairs.length === 0) return null
  return (
    <Card>
      <CardHeader><CardTitle>Possible duplicates</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {pairs.length} pairs flagged by fuzzy matcher. Review before committing import.
        </p>
        {pairs.slice(0, 10).map((p, i) => (
          <div key={i} className="rounded-md border p-2 text-xs">
            <p className="font-mono">{p.a.id} vs {p.b.id}</p>
            <p>{p.reasons.join(", ")}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
```

Wiring the card into the actual import wizard is deferred — the pure helper + tests + card-shell ship now; full integration when the import dialog is rebuilt to surface a dedup-advisor stage.

- [ ] **Step 4: Run test + tsc + commit**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/cog/__tests__/ai-dedup.test.ts
bunx tsc --noEmit
git add lib/cog/ai-dedup.ts lib/cog/__tests__/ai-dedup.test.ts components/facility/cog/dedup-advisor-card.tsx
git commit -m "feat(cog): fuzzy duplicate advisor — pure helper + UI card stub"
```

---

## Task 5: Canonical `matchCOGRecordToContract` cascade

**Spec:** Subsystem 10.5.

**Files:**
- Modify: `lib/cog/match.ts`
- Modify: `lib/cog/__tests__/match.test.ts`

- [ ] **Step 1: Audit current match logic**

```bash
grep -nE "findContractForCOGRecord|matchCOGRecord|matchStatus" lib/cog/match.ts | head -10
```

Note the current resolver name + signature.

- [ ] **Step 2: Implement the cascade**

Replace (or extend) the current resolver with:

```ts
import type { CogRecord, Contract, ContractPricing, Vendor } from "@prisma/client"

export type MatchMode = "vendorItemNo" | "vendorAndDate" | "fuzzyVendorName" | "none"

export interface MatchResult {
  contractId: string | null
  mode: MatchMode
}

/**
 * Cascade resolver. Tries in order:
 *   1. Exact vendorItemNo match against active contract pricing.
 *   2. Exact vendorId + transactionDate within active contract window.
 *   3. Fuzzy vendor-name match (legacy fallback).
 */
export function resolveContractForCOG(
  row: Pick<CogRecord, "vendorItemNo" | "vendorId" | "transactionDate" | "vendorName">,
  ctx: {
    pricingByVendorItem: Map<string, { contractId: string; effectiveStart: Date; effectiveEnd: Date }[]>
    activeContractsByVendor: Map<string, { id: string; effectiveDate: Date; expirationDate: Date }[]>
    fuzzyVendorMatch: (name: string) => string | null
  },
): MatchResult {
  if (!row.transactionDate) return { contractId: null, mode: "none" }

  // 1. vendorItemNo
  if (row.vendorItemNo) {
    const candidates = ctx.pricingByVendorItem.get(row.vendorItemNo) ?? []
    const hit = candidates.find(
      (c) =>
        row.transactionDate! >= c.effectiveStart && row.transactionDate! <= c.effectiveEnd,
    )
    if (hit) return { contractId: hit.contractId, mode: "vendorItemNo" }
  }

  // 2. vendorId + date window
  if (row.vendorId) {
    const candidates = ctx.activeContractsByVendor.get(row.vendorId) ?? []
    const hit = candidates.find(
      (c) =>
        row.transactionDate! >= c.effectiveDate && row.transactionDate! <= c.expirationDate,
    )
    if (hit) return { contractId: hit.id, mode: "vendorAndDate" }
  }

  // 3. fuzzy
  if (row.vendorName) {
    const fuzzyVendorId = ctx.fuzzyVendorMatch(row.vendorName)
    if (fuzzyVendorId) {
      const candidates = ctx.activeContractsByVendor.get(fuzzyVendorId) ?? []
      const hit = candidates.find(
        (c) =>
          row.transactionDate! >= c.effectiveDate && row.transactionDate! <= c.expirationDate,
      )
      if (hit) return { contractId: hit.id, mode: "fuzzyVendorName" }
    }
  }

  return { contractId: null, mode: "none" }
}
```

The caller (e.g. `recomputeMatchStatusesForVendor`) builds the maps once per recompute and passes them in. Don't re-query inside the resolver.

- [ ] **Step 3: Tests**

```ts
// lib/cog/__tests__/match.test.ts (add to existing or create)
import { describe, it, expect } from "vitest"
import { resolveContractForCOG } from "@/lib/cog/match"

const ctx = {
  pricingByVendorItem: new Map([
    ["STK-1", [{ contractId: "c-1", effectiveStart: new Date("2026-01-01"), effectiveEnd: new Date("2027-01-01") }]],
  ]),
  activeContractsByVendor: new Map([
    ["v-stryker", [{ id: "c-1", effectiveDate: new Date("2026-01-01"), expirationDate: new Date("2027-01-01") }]],
  ]),
  fuzzyVendorMatch: (name: string) => (name.toLowerCase().includes("stryker") ? "v-stryker" : null),
}

describe("resolveContractForCOG cascade", () => {
  it("hits vendorItemNo match first", () => {
    const r = resolveContractForCOG(
      { vendorItemNo: "STK-1", vendorId: null, transactionDate: new Date("2026-04-01"), vendorName: "stryker" },
      ctx,
    )
    expect(r).toEqual({ contractId: "c-1", mode: "vendorItemNo" })
  })

  it("falls back to vendorId+date when vendorItemNo misses", () => {
    const r = resolveContractForCOG(
      { vendorItemNo: "UNKNOWN", vendorId: "v-stryker", transactionDate: new Date("2026-04-01"), vendorName: "x" },
      ctx,
    )
    expect(r.mode).toBe("vendorAndDate")
    expect(r.contractId).toBe("c-1")
  })

  it("falls back to fuzzy vendor name when vendorId is missing", () => {
    const r = resolveContractForCOG(
      { vendorItemNo: null, vendorId: null, transactionDate: new Date("2026-04-01"), vendorName: "Stryker Corp" },
      ctx,
    )
    expect(r.mode).toBe("fuzzyVendorName")
    expect(r.contractId).toBe("c-1")
  })

  it("returns none when nothing matches", () => {
    const r = resolveContractForCOG(
      { vendorItemNo: null, vendorId: null, transactionDate: new Date("2026-04-01"), vendorName: "Acme" },
      ctx,
    )
    expect(r).toEqual({ contractId: null, mode: "none" })
  })
})
```

- [ ] **Step 4: Wire into `recomputeMatchStatusesForVendor`**

In `lib/cog/recompute.ts`, build the two maps before the COG-record loop and call `resolveContractForCOG(row, ctx)` per record. Set `matchStatus` based on the returned `mode` (e.g. `vendorItemNo` / `vendorAndDate` → matched; `fuzzyVendorName` → fuzzy_match; `none` → unmatched).

- [ ] **Step 5: Smoke against demo**

```bash
PORT=3002 bun run start &
sleep 6
# Backfill via the action and confirm match rate improves vs the 489/571 baseline.
cat > /tmp/smoke.ts <<'EOF'
import { prisma } from '/Users/vickkumar/code/tydei-next/lib/db'
import { recomputeMatchStatusesForVendor } from '/Users/vickkumar/code/tydei-next/lib/cog/recompute'
const fac = await prisma.facility.findFirst()
const contracts = await prisma.contract.findMany({
  where: { facilityId: fac!.id, status: { in: ['active','expiring'] } },
  select: { vendorId: true },
})
const vendors = [...new Set(contracts.map(c => c.vendorId))]
for (const v of vendors) await recomputeMatchStatusesForVendor(v, fac!.id)
const dist = await prisma.cOGRecord.groupBy({ by: ['matchStatus'], where: { facilityId: fac!.id }, _count: true })
console.log(dist)
process.exit(0)
EOF
DATABASE_URL=postgresql://tydei:tydei_dev_password@localhost:5432/tydei bun /tmp/smoke.ts
kill %1 2>/dev/null
```

Expected: match rate ≥ 86% (today's baseline).

- [ ] **Step 6: Commit**

```bash
bunx tsc --noEmit
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/cog/__tests__/match.test.ts
git add lib/cog/match.ts lib/cog/__tests__/match.test.ts lib/cog/recompute.ts
git commit -m "feat(cog): canonical matchCOGRecordToContract cascade (vendorItemNo > vendor+date > fuzzy)"
```

---

## Task 6: Smoke + finalize

- [ ] **Step 1: Full unit suite**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' 2>&1 | tail -5
```

- [ ] **Step 2: Smoke contracts + cog-data**

```bash
PORT=3002 bun run start &
sleep 6
curl -sL -c /tmp/c.txt -X POST http://localhost:3002/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"demo-facility@tydei.com","password":"demo-facility-2024"}' > /dev/null
for p in /dashboard/contracts /dashboard/contracts/new /dashboard/cog-data; do
  code=$(curl -sL -b /tmp/c.txt -o /tmp/p.html -w "%{http_code}" "http://localhost:3002$p")
  err=$(grep -c '"digest"' /tmp/p.html 2>/dev/null)
  echo "$p HTTP=$code digest_errors=$err"
done
kill %1 2>/dev/null
```

---

## Self-Review

| Spec subsystem | Task |
|---|---|
| 9.3 PDF entry-mode default | Task 1 |
| 9.9 Industry benchmark radar | Task 2 |
| 9.10 Price competitiveness 6th dim | Task 3 |
| 10.4 AI dedup advisor | Task 4 |
| 10.5 Canonical match cascade | Task 5 |

**Type consistency:** `ScoreBenchmark` (Task 2) is `ContractScoreResult["components"]` — automatically tracks the engine shape (Task 3 adds a key, Task 2's static seed must be updated to match — sequence Task 3 first if waves are run sequentially, or accept a one-line patch in Task 2 after Task 3 lands).

**Placeholders:** none. Each step has runnable code or a runnable command.
