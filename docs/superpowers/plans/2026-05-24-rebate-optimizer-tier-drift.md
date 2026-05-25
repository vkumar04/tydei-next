# Rebate Optimizer Tier Drift — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix bug cluster B (#4, #5, #6, #8, #10, #11). Make every read path display the correct "current tier" for market-share term types — Tier 2 (15%) at 92% market share, not Tier 3 (20%) or Tier 1 (10%).

**Architecture:** The engine already supports market-share via the "column-reuse" pattern (`tier.spendMin` holds the threshold percent because writers mirror `marketShareMin` → `spendMin`). The fix is at the **call sites**: callers must pass `Contract.currentMarketShare` (not dollar spend) when the term type is `market_share` or `compliance_rebate`. Introduce one canonical helper, `pickThresholdMetric`, and route the two broken read paths through it.

**Tech Stack:** Next.js 16 App Router, Prisma 7, TypeScript strict, Vitest, React 19.

**Spec:** `docs/superpowers/specs/2026-05-24-rebate-optimizer-tier-drift-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/contracts/tier-metric.ts` | **Create** | `pickThresholdMetric(termType, metrics)` — single source of truth for "which contract metric qualifies tiers for this term type" |
| `lib/contracts/__tests__/tier-metric.test.ts` | **Create** | Unit coverage of every term type branch + default fall-through |
| `lib/actions/rebate-optimizer.ts` | **Modify** | `getRebateOpportunities()` (lines 40-178) — drop `period.tierAchieved` source, route per-term metric through the helper |
| `lib/actions/__tests__/rebate-optimizer-market-share.test.ts` | **Create** | Fixture mirroring the Smith & Nephew screenshot: 3-tier market-share ladder + `currentMarketShare=92` → Tier 2 / 15% |
| `components/contracts/contract-terms-display.tsx` | **Modify** | The in-line tier qualifier at lines 547-565 + the `TierProgressCard` (line 42-90) — pass term-appropriate metric to `calculateTierProgress` |
| `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts` | **Modify** | Add a market-share parity case ensuring contract-detail and optimizer report the same `currentTier` |

`calculateTierProgress` in `lib/contracts/tier-progress.ts` stays metric-agnostic — its docstring gets a one-line clarification that callers feed the appropriate metric. **No data migration needed** (storage convention is already correct; see spec).

---

## Task 1: Canonical metric-picker helper

**Files:**
- Create: `lib/contracts/tier-metric.ts`
- Test: `lib/contracts/__tests__/tier-metric.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/contracts/__tests__/tier-metric.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { pickThresholdMetric } from "@/lib/contracts/tier-metric"

describe("pickThresholdMetric", () => {
  const metrics = {
    currentSpend: 1_234_567,
    currentMarketShare: 92.6,
    complianceRate: 78.2,
    currentVolume: 412,
  }

  it("market_share → currentMarketShare", () => {
    expect(pickThresholdMetric("market_share", metrics)).toBe(92.6)
  })

  it("compliance_rebate → complianceRate", () => {
    expect(pickThresholdMetric("compliance_rebate", metrics)).toBe(78.2)
  })

  it.each([
    "volume_rebate",
    "rebate_per_use",
    "capitated_pricing_rebate",
    "po_rebate",
    "payment_rebate",
  ])("%s → currentVolume", (termType) => {
    expect(pickThresholdMetric(termType, metrics)).toBe(412)
  })

  it.each(["spend_rebate", "growth_rebate", "carve_out", "tie_in", "unknown_termtype"])(
    "%s → currentSpend (default)",
    (termType) => {
      expect(pickThresholdMetric(termType, metrics)).toBe(1_234_567)
    },
  )

  it("returns 0 when the relevant metric is null", () => {
    expect(
      pickThresholdMetric("market_share", { ...metrics, currentMarketShare: null }),
    ).toBe(0)
    expect(
      pickThresholdMetric("compliance_rebate", { ...metrics, complianceRate: null }),
    ).toBe(0)
    expect(
      pickThresholdMetric("volume_rebate", { ...metrics, currentVolume: null }),
    ).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run lib/contracts/__tests__/tier-metric.test.ts`
Expected: `FAIL` with "Cannot find module '@/lib/contracts/tier-metric'".

- [ ] **Step 3: Create the helper**

Create `lib/contracts/tier-metric.ts`:

```ts
/**
 * Canonical "which contract-level metric qualifies tier thresholds for
 * this term type" picker. Single source of truth so readers don't drift
 * — see `docs/superpowers/specs/2026-05-24-rebate-optimizer-tier-drift-design.md`.
 *
 * Background: the rebate engine uses a column-reuse pattern. For every
 * term type, `tier.spendMin` is the threshold the engine compares
 * against — but the UNIT of that threshold depends on the term type:
 *
 *   - spend_rebate / growth_rebate / carve_out → DOLLARS  (currentSpend)
 *   - market_share                              → PERCENT  (currentMarketShare)
 *   - compliance_rebate                         → PERCENT  (complianceRate)
 *   - volume_rebate / rebate_per_use /
 *     capitated_pricing_rebate / po_rebate /
 *     payment_rebate                            → COUNT    (currentVolume)
 *
 * Writers (`lib/actions/pending-contracts.ts:332-341`, `imports/contract-import.ts`)
 * mirror dedicated columns (`marketShareMin`, `volumeMin`) into `spendMin`
 * at write time so the engine remains metric-agnostic. Callers (this
 * helper's consumers) are responsible for feeding the right metric.
 *
 * Mirrors the writer-side switch in `lib/contracts/recompute/threshold.ts`.
 */

export interface ThresholdMetricInputs {
  currentSpend: number
  currentMarketShare: number | null
  complianceRate: number | null
  currentVolume: number | null
}

export function pickThresholdMetric(
  termType: string,
  metrics: ThresholdMetricInputs,
): number {
  switch (termType) {
    case "market_share":
      return metrics.currentMarketShare ?? 0
    case "compliance_rebate":
      return metrics.complianceRate ?? 0
    case "volume_rebate":
    case "rebate_per_use":
    case "capitated_pricing_rebate":
    case "po_rebate":
    case "payment_rebate":
      return metrics.currentVolume ?? 0
    case "spend_rebate":
    case "growth_rebate":
    case "carve_out":
    case "tie_in":
    default:
      return metrics.currentSpend
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run lib/contracts/__tests__/tier-metric.test.ts`
Expected: `PASS` — 10 test cases (4 inputs covered by `it.each`, etc.).

- [ ] **Step 5: Commit**

```bash
git add lib/contracts/tier-metric.ts lib/contracts/__tests__/tier-metric.test.ts
git commit -m "feat(contracts): pickThresholdMetric — term-type → metric helper

Canonical helper that picks which contract-level metric qualifies tier
thresholds for a given term type. Eliminates the silent assumption that
'currentSpend' is the right metric for every term type — market-share
and compliance terms have always needed currentMarketShare / complianceRate,
volume terms need a unit count.

Mirrors the writer-side switch in lib/contracts/recompute/threshold.ts.
Foundation for fixing bug cluster B (rebate optimizer tier drift).

Spec: docs/superpowers/specs/2026-05-24-rebate-optimizer-tier-drift-design.md"
```

---

## Task 2: Rewrite `getRebateOpportunities` (OLD action)

**Files:**
- Modify: `lib/actions/rebate-optimizer.ts:40-178`
- Test: `lib/actions/__tests__/rebate-optimizer-market-share.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `lib/actions/__tests__/rebate-optimizer-market-share.test.ts`:

```ts
/**
 * Bug cluster B (2026-05-24): the OLD getRebateOpportunities must
 * surface market-share contracts with the CORRECT current tier, picked
 * against Contract.currentMarketShare — not against trailing-12mo spend.
 *
 * Fixture mirrors the Smith & Nephew screenshot:
 *   tiers: T1 ≥ 10% MS → 10%, T2 ≥ 50% MS → 15%, T3 ≥ 100% MS → 20%
 *   currentMarketShare = 92.6
 *   trailing-12mo spend = $7,325,983 (irrelevant for tier qualification)
 *
 * Expected: currentTier=2, currentRebatePercent=15, nextTier=3, nextRebatePercent=20.
 * Pre-fix behaviour: currentTier=1 (read from contract.periods[0].tierAchieved
 * or fall back to tiers[0]). Now must read from currentMarketShare via
 * pickThresholdMetric.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

type Tier = {
  tierNumber: number
  tierName: string | null
  spendMin: number
  spendMax: number | null
  rebateValue: number
  rebateType: string
}
type Term = {
  id: string
  termType: string
  rebateMethod: string | null
  tiers: Tier[]
}
type Period = { totalSpend: number; tierAchieved: number | null }
type Contract = {
  id: string
  name: string
  vendorId: string
  status: string
  currentMarketShare: number | null
  complianceRate: number | null
  vendor: { name: string }
  terms: Term[]
  periods: Period[]
}

let contractRows: Contract[] = []
let cogAggRows: Array<{ vendorId: string; _sum: { extendedPrice: number } }> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findMany: vi.fn(async () => contractRows) },
    cOGRecord: { groupBy: vi.fn(async () => cogAggRows) },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1", name: "Surgical Center at Columbia" },
  })),
}))

vi.mock("@/lib/serialize", () => ({ serialize: (x: unknown) => x }))

describe("getRebateOpportunities — market_share metric routing", () => {
  beforeEach(() => {
    contractRows = []
    cogAggRows = []
  })

  it("picks Tier 2 at 92.6% market share, not Tier 1 (stale period) or Tier 3 (spend overflow)", async () => {
    contractRows = [
      {
        id: "sn-rebate",
        name: "Smith & Nephew Rebate Agreement",
        vendorId: "vendor-sn",
        status: "active",
        currentMarketShare: 92.6,
        complianceRate: null,
        vendor: { name: "Smith & Nephew" },
        periods: [{ totalSpend: 600_000, tierAchieved: 1 }],
        terms: [
          {
            id: "term-1",
            termType: "market_share",
            rebateMethod: "cumulative",
            tiers: [
              {
                tierNumber: 1, tierName: null,
                spendMin: 10, spendMax: 1_499_999, // sentinel from screenshot
                rebateValue: 0.10, rebateType: "percent_of_spend",
              },
              {
                tierNumber: 2, tierName: null,
                spendMin: 50, spendMax: 1_999_999,
                rebateValue: 0.15, rebateType: "percent_of_spend",
              },
              {
                tierNumber: 3, tierName: null,
                spendMin: 100, spendMax: null,
                rebateValue: 0.20, rebateType: "percent_of_spend",
              },
            ],
          },
        ],
      },
    ]
    cogAggRows = [{ vendorId: "vendor-sn", _sum: { extendedPrice: 7_325_983 } }]

    const { getRebateOpportunities } = await import("@/lib/actions/rebate-optimizer")
    const result = await getRebateOpportunities()

    expect(result).toHaveLength(1)
    const opp = result[0]
    expect(opp.contractId).toBe("sn-rebate")
    expect(opp.currentTier).toBe(2)
    expect(opp.nextTier).toBe(3)
    expect(opp.currentRebatePercent).toBe(15)
    expect(opp.nextRebatePercent).toBe(20)
  })

  it("spend_rebate path still uses currentSpend, not currentMarketShare", async () => {
    contractRows = [
      {
        id: "spend-only",
        name: "Spend-Rebate Contract",
        vendorId: "v-2",
        status: "active",
        currentMarketShare: 95, // ignored
        complianceRate: null,
        vendor: { name: "VendorTwo" },
        periods: [],
        terms: [
          {
            id: "t-2",
            termType: "spend_rebate",
            rebateMethod: "cumulative",
            tiers: [
              { tierNumber: 1, tierName: null, spendMin: 100_000, spendMax: 500_000, rebateValue: 0.02, rebateType: "percent_of_spend" },
              { tierNumber: 2, tierName: null, spendMin: 500_000, spendMax: null,    rebateValue: 0.04, rebateType: "percent_of_spend" },
            ],
          },
        ],
      },
    ]
    cogAggRows = [{ vendorId: "v-2", _sum: { extendedPrice: 250_000 } }]

    const { getRebateOpportunities } = await import("@/lib/actions/rebate-optimizer")
    const result = await getRebateOpportunities()

    expect(result).toHaveLength(1)
    expect(result[0].currentTier).toBe(1)
    expect(result[0].currentRebatePercent).toBe(2)
    expect(result[0].nextTier).toBe(2)
    expect(result[0].nextRebatePercent).toBe(4)
  })

  it("market_share contract with currentMarketShare=null reads as below baseline (no opportunity emitted)", async () => {
    contractRows = [
      {
        id: "no-ms",
        name: "MS unknown",
        vendorId: "v-3",
        status: "active",
        currentMarketShare: null,
        complianceRate: null,
        vendor: { name: "VendorThree" },
        periods: [],
        terms: [
          {
            id: "t-3",
            termType: "market_share",
            rebateMethod: "cumulative",
            tiers: [
              { tierNumber: 1, tierName: null, spendMin: 10, spendMax: null, rebateValue: 0.10, rebateType: "percent_of_spend" },
              { tierNumber: 2, tierName: null, spendMin: 50, spendMax: null, rebateValue: 0.15, rebateType: "percent_of_spend" },
            ],
          },
        ],
      },
    ]
    cogAggRows = [{ vendorId: "v-3", _sum: { extendedPrice: 1_000_000 } }]

    const { getRebateOpportunities } = await import("@/lib/actions/rebate-optimizer")
    const result = await getRebateOpportunities()
    // Below baseline → opportunity is "spend X to reach tier 1" — but
    // since currentSpend would be 0 in the MS-metric sense, this still
    // emits an opportunity targeting tier 2 (next from tier 1).
    expect(result).toHaveLength(1)
    expect(result[0].currentTier).toBe(0)
    expect(result[0].nextTier).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run lib/actions/__tests__/rebate-optimizer-market-share.test.ts`
Expected: `FAIL`. Pre-fix `getRebateOpportunities` reads `contract.periods[0].tierAchieved=1` → returns `currentTier=1`, not 2.

- [ ] **Step 3: Rewrite `getRebateOpportunities`**

Replace lines 40-178 of `lib/actions/rebate-optimizer.ts` with the version below. The key changes:
- Add `currentMarketShare`, `complianceRate` to the Prisma select.
- Drop the `period.tierAchieved` source (line 109 in current file) and the `findIndex(tierNumber === currentTierAchieved)` lookup (lines 114-117).
- Compute `metric` per term via `pickThresholdMetric(term.termType, ...)`.
- Compute `currentTier` by sorting `term.tiers` on `spendMin` and picking the highest qualifying.

New body of `lib/actions/rebate-optimizer.ts` lines 40-178:

```ts
export async function getRebateOpportunities(_facilityId?: string): Promise<RebateOpportunity[]> {
  const { facility } = await requireFacility()
  const facilityId = facility.id

  const contracts = await prisma.contract.findMany({
    where: {
      OR: [
        { facilityId },
        { contractFacilities: { some: { facilityId } } },
      ],
      status: { in: ["active", "expiring"] },
    },
    include: {
      vendor: { select: { name: true } },
      terms: {
        include: {
          tiers: { orderBy: { tierNumber: "asc" } },
        },
      },
    },
  })

  // Trailing-12-month spend from canonical COG source (single batched groupBy).
  const trailingStart = new Date()
  trailingStart.setMonth(trailingStart.getMonth() - 12)
  const vendorIds = Array.from(
    new Set(
      contracts.map((c) => c.vendorId).filter((v): v is string => Boolean(v)),
    ),
  )
  const spendRows = vendorIds.length
    ? await prisma.cOGRecord.groupBy({
        by: ["vendorId"],
        where: {
          facilityId,
          vendorId: { in: vendorIds },
          transactionDate: { gte: trailingStart },
        },
        _sum: { extendedPrice: true },
      })
    : []
  const spendByVendor = new Map<string, number>()
  for (const r of spendRows) {
    if (r.vendorId) {
      spendByVendor.set(r.vendorId, Number(r._sum.extendedPrice ?? 0))
    }
  }

  const opportunities: RebateOpportunity[] = []

  for (const contract of contracts) {
    const currentSpend = contract.vendorId
      ? spendByVendor.get(contract.vendorId) ?? 0
      : 0
    // Charles 2026-05-24 (Bug Cluster B): per-term metric routing. The
    // engine compares against tier.spendMin regardless of term type
    // (column-reuse pattern), but the UNIT of that threshold differs:
    // market_share → percent, volume_rebate → count, etc. Routing each
    // term through pickThresholdMetric eliminates the silent
    // wrong-metric drift that produced Tier 1 in the optimizer while
    // Contract Detail (qualifying by spend) showed Tier 3.
    const metricInputs = {
      currentSpend,
      currentMarketShare:
        contract.currentMarketShare === null ? null : Number(contract.currentMarketShare),
      complianceRate:
        contract.complianceRate === null ? null : Number(contract.complianceRate),
      // currentVolume not on Contract yet — volume terms still fall through
      // to currentSpend until that column exists (separate task).
      currentVolume: null,
    }

    for (const term of contract.terms) {
      if (term.tiers.length < 2) continue

      const metric = pickThresholdMetric(term.termType, metricInputs)

      // Sort tiers by spendMin and pick the highest-qualifying tier.
      const sortedTiers = [...term.tiers].sort(
        (a, b) => Number(a.spendMin) - Number(b.spendMin),
      )

      // Below-baseline: metric < lowest tier's spendMin → currentTier=0,
      // nextTier is sortedTiers[0]. We still surface this as an
      // opportunity so the UI can render "spend X to unlock tier 1".
      const lowestMin = Number(sortedTiers[0].spendMin)
      let currentIdx = -1
      for (let i = 0; i < sortedTiers.length; i++) {
        if (metric >= Number(sortedTiers[i].spendMin)) currentIdx = i
      }

      const nextIdx = currentIdx + 1
      if (nextIdx >= sortedTiers.length) continue // already at top

      const currentTier = currentIdx >= 0 ? sortedTiers[currentIdx] : null
      const nextTier = sortedTiers[nextIdx]

      const nextThreshold = Number(nextTier.spendMin)
      const metricGap = Math.max(0, nextThreshold - metric)
      // For spend terms this is a dollar gap; for market-share terms it's
      // a percent-points gap. The output field name stays `spendGap` for
      // back-compat with the UI — its UNIT now matches the term's metric.
      const spendGap = metricGap

      const currentRebatePercent = currentTier
        ? toDisplayRebateValue(currentTier.rebateType, Number(currentTier.rebateValue))
        : 0
      const nextRebatePercent = toDisplayRebateValue(
        nextTier.rebateType,
        Number(nextTier.rebateValue),
      )

      // Projection: for spend terms, (Δrate × currentSpend / 100). For
      // market-share terms, the projection is "if we reached the next
      // tier, the SAME spend earns at the higher rate" — same formula.
      const projectedAdditionalRebate =
        ((nextRebatePercent - currentRebatePercent) * currentSpend) / 100

      const percentToNextTier =
        nextThreshold > 0
          ? Math.min(100, (metric / nextThreshold) * 100)
          : 100

      opportunities.push({
        contractId: contract.id,
        contractName: contract.name,
        vendorName: contract.vendor.name,
        currentTier: currentTier?.tierNumber ?? 0,
        nextTier: nextTier.tierNumber,
        currentSpend,
        nextTierThreshold: nextThreshold,
        spendGap,
        projectedAdditionalRebate,
        percentToNextTier,
        currentRebatePercent,
        nextRebatePercent,
        topTierRebatePercent: (() => {
          const top = sortedTiers[sortedTiers.length - 1]
          return top
            ? toDisplayRebateValue(top.rebateType, Number(top.rebateValue))
            : nextRebatePercent
        })(),
        topTierThreshold: Number(
          sortedTiers[sortedTiers.length - 1]?.spendMin ?? nextThreshold,
        ),
      })
    }
  }

  return serialize(
    opportunities.sort(
      (a, b) => b.projectedAdditionalRebate - a.projectedAdditionalRebate,
    ),
  )
}
```

Also: add the import at the top of the file.

```ts
import { pickThresholdMetric } from "@/lib/contracts/tier-metric"
```

And remove this stanza from the Prisma include (no longer needed):

```ts
periods: {
  select: { totalSpend: true, tierAchieved: true },
  orderBy: { periodEnd: "desc" },
  take: 4,
},
```

…and update the `contract` Prisma select to include the two new columns. Currently the spread `findMany` doesn't explicitly select fields (it returns the full Contract row by default) — but `currentMarketShare` and `complianceRate` ARE on the Contract model so they'll be present. **No schema change needed.**

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run lib/actions/__tests__/rebate-optimizer-market-share.test.ts`
Expected: all 3 cases PASS. Specifically, market_share case returns `{ currentTier: 2, currentRebatePercent: 15, nextTier: 3, nextRebatePercent: 20 }`.

- [ ] **Step 5: Run the existing optimizer tests to verify no regressions**

Run: `bunx vitest run lib/actions/__tests__/rebate-optimizer-engine.test.ts lib/actions/__tests__/rebate-optimizer-insights.test.ts`
Expected: PASS — these tests target the NEW engine, untouched by this change.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/rebate-optimizer.ts lib/actions/__tests__/rebate-optimizer-market-share.test.ts
git commit -m "fix(rebate-optimizer): route per-term metric for tier qualification

Bug Cluster B (#4, #5, #6, #8, #10, #11): the OLD getRebateOpportunities
sourced currentTier from contract.periods[0].tierAchieved (stale,
sometimes missing → falls back to tiers[0]). For market_share terms it
should compare Contract.currentMarketShare against tier.spendMin
(column-reuse convention); for compliance_rebate, complianceRate.

Now each term picks its metric via pickThresholdMetric and qualifies
the highest tier from the sorted ladder. At 92% market share with
tiers [10%, 50%, 100%], the optimizer surfaces Tier 2 (15%) as
current and Tier 3 (20%) as next — matching what Contract Detail
will show after Task 3.

Spec: docs/superpowers/specs/2026-05-24-rebate-optimizer-tier-drift-design.md"
```

---

## Task 3: Wire contract-terms-display through the helper

**Files:**
- Modify: `components/contracts/contract-terms-display.tsx`

The component has TWO independent tier qualifiers, both must change:
1. `TierProgressCard` (lines 42-90) — calls `calculateTierProgress(currentSpend, ...)`. For market-share terms this should be `calculateTierProgress(currentMarketShare, ...)`.
2. The in-line qualifier at lines 547-565 — does its own `if (effectiveSpend >= Number(sorted[i].spendMin))` loop to compute `currentTierNumber`. Same fix.

The contract row already provides `currentMarketShare` because the page-level loader fetches the full Contract. We need to thread it through the props.

- [ ] **Step 1: Find the prop boundary**

Run: `grep -n "ContractTermsDisplay\|currentMarketShare" components/contracts/contract-terms-display.tsx | head -20`

Locate the component's prop interface (look for the function signature near the top: `export function ContractTermsDisplay(props: ...)`). Determine if `contract.currentMarketShare` and `contract.complianceRate` are already passed in. If not, we'll add them as optional props.

- [ ] **Step 2: Add metric props (no-op test first to ensure type safety holds)**

Modify the prop interface to accept the two new metrics. For example, if the interface is `ContractTermsDisplayProps`, add:

```ts
/**
 * Contract-level qualification metrics, threaded through to the per-term
 * tier qualifier so market_share / compliance_rebate terms compare
 * against the right metric (not dollar spend). Bug Cluster B fix.
 */
currentMarketShare?: number | null
complianceRate?: number | null
```

- [ ] **Step 3: Update TierProgressCard to accept and route the metric**

Replace lines 42-90 of `components/contracts/contract-terms-display.tsx` so `TierProgressCard` takes the new metrics and picks via `pickThresholdMetric`. Specifically:

```tsx
function TierProgressCard({
  term,
  currentSpend,
  currentMarketShare,
  complianceRate,
}: {
  term: ContractTermWithTiers
  currentSpend: number
  currentMarketShare?: number | null
  complianceRate?: number | null
}) {
  if (term.tiers.length === 0) return null

  const tiersForEngine: TierLike[] = term.tiers.map((t) => ({
    tierNumber: t.tierNumber,
    tierName: t.tierName ?? null,
    spendMin: Number(t.spendMin),
    spendMax: t.spendMax ? Number(t.spendMax) : null,
    rebateValue: Number(t.rebateValue),
  }))
  const method = (term.rebateMethod ?? "cumulative") as RebateMethodName

  // Bug Cluster B fix: route market-share / compliance terms through the
  // contract-level metric instead of dollar spend. Spec:
  // docs/superpowers/specs/2026-05-24-rebate-optimizer-tier-drift-design.md
  const metric = pickThresholdMetric(term.termType, {
    currentSpend,
    currentMarketShare: currentMarketShare ?? null,
    complianceRate: complianceRate ?? null,
    currentVolume: null,
  })

  const progress = calculateTierProgress(metric, tiersForEngine, method)

  // …rest of function unchanged (currentLabel, nextLabel, rebateDisplay, render)
}
```

Add to imports at the top of the file:

```ts
import { pickThresholdMetric } from "@/lib/contracts/tier-metric"
```

- [ ] **Step 4: Update the in-line qualifier (lines 547-565)**

Replace the IIFE block that computes `currentTierNumber` so it uses `metric` instead of `effectiveSpend`:

```tsx
{(() => {
  const metric = pickThresholdMetric(term.termType, {
    currentSpend: effectiveSpend,
    currentMarketShare: currentMarketShare ?? null,
    complianceRate: complianceRate ?? null,
    currentVolume: null,
  })
  const sorted = [...term.tiers].sort(
    (a, b) => Number(a.spendMin) - Number(b.spendMin),
  )
  let currentTierNumber = 0
  for (let i = 0; i < sorted.length; i++) {
    if (metric >= Number(sorted[i].spendMin)) {
      currentTierNumber = sorted[i].tierNumber
    }
  }
  const topTierNumber = sorted[sorted.length - 1].tierNumber
  const isTopTierReached =
    currentTierNumber > 0 && currentTierNumber === topTierNumber
  return (
    <div className="space-y-2">
      {term.tiers.map((tier) => (
        <TierDisplay
          // ...existing props
        />
      ))}
    </div>
  )
})()}
```

And pass the new props to `TierProgressCard`:

```tsx
<TierProgressCard
  term={term}
  currentSpend={effectiveSpend}
  currentMarketShare={currentMarketShare}
  complianceRate={complianceRate}
/>
```

- [ ] **Step 5: Thread the new props from every parent caller**

Run: `grep -rn "ContractTermsDisplay" components/ app/ | grep -v __tests__ | head`

For each call site, pass `currentMarketShare={contract.currentMarketShare ? Number(contract.currentMarketShare) : null}` and `complianceRate={contract.complianceRate ? Number(contract.complianceRate) : null}`.

Typical call site (`components/contracts/tabs/overview-tab.tsx` and similar):

```tsx
<ContractTermsDisplay
  // ...existing props
  currentMarketShare={contract.currentMarketShare ? Number(contract.currentMarketShare) : null}
  complianceRate={contract.complianceRate ? Number(contract.complianceRate) : null}
/>
```

- [ ] **Step 6: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors. If a call site is missing the new props, the optional `?` keeps it compiling — but every facility-side parent should pass them for correctness.

- [ ] **Step 7: Run the contract-terms-display test suite**

Run: `bunx vitest run components/contracts/__tests__ 2>&1 | tail -20`
Expected: PASS (no regressions to existing spend-based behaviour).

- [ ] **Step 8: Commit**

```bash
git add components/contracts/contract-terms-display.tsx components/contracts/tabs/overview-tab.tsx
git commit -m "fix(contract-terms-display): route per-term metric to tier qualifier

Bug Cluster B (#4, #5, #6): the Rebates & Tiers tab's TierProgressCard
and inline tier qualifier both compared dollar spend against
tier.spendMin even for market_share terms — so at 92% MS the qualifier
picked Tier 3 (because spend in millions trivially exceeds the
percent-sized spendMin sentinel of 100).

Both qualifiers now route through pickThresholdMetric so market-share
terms qualify by Contract.currentMarketShare. Contract Detail now
agrees with the optimizer (Tier 2 / 15% at 92% MS).

Spec: docs/superpowers/specs/2026-05-24-rebate-optimizer-tier-drift-design.md"
```

---

## Task 4: Extend the list/detail parity test

**Files:**
- Modify: `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`

- [ ] **Step 1: Read the existing parity test to find the right place to add a case**

Run: `grep -n "describe\|it(\|test(" lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts | head -30`

Look for the existing pattern (likely a `describe('Cluster B' …)` or `describe('W2.A.3' …)` block).

- [ ] **Step 2: Add a market-share parity case**

Append a new `it` block inside the existing top-level `describe`:

```ts
it("market-share contract — list and detail show the same currentTier", async () => {
  // Bug Cluster B (2026-05-24) regression guard: an MS contract at 92%
  // market share with tiers [10%, 50%, 100%] must surface Tier 2 from
  // BOTH the contracts list (via getRebateOpportunities) and the
  // contract detail tier qualifier. Pre-fix the list showed Tier 1
  // (period.tierAchieved fallback) while detail showed Tier 3 (spend
  // overflowed the percent-sized spendMin sentinel).

  // The exact wiring follows the existing fixture-builder helpers in
  // this file; replicate the dual-source call and assert equality on
  // (currentTier, currentRebatePercent). If the helpers don't exist,
  // call the two sources directly with the same Contract row.

  // PSEUDO-CODE — replace with the project's existing helper invocation
  // pattern observed in the rest of this file:
  // const listResult = await runListSource(msContract)
  // const detailResult = computeDetailTier(msContract)
  // expect(listResult.currentTier).toBe(detailResult.currentTier)
  // expect(listResult.currentTier).toBe(2)
})
```

> **Subagent note:** Replace the pseudo-code with the project's existing helper pattern from the surrounding file — do NOT invent a new helper. Match style.

- [ ] **Step 3: Run the parity test**

Run: `bunx vitest run lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`
Expected: PASS — Task 2 + Task 3 make both sources agree.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts
git commit -m "test(contracts): list/detail parity guard for market-share tier

Regression guard for Bug Cluster B. Without it, a future refactor that
hand-rolls a tier qualifier on either surface will silently diverge
again."
```

---

## Task 5: Verify in dev server (smoke test)

**Files:** none — manual verification per CLAUDE.md release hygiene.

- [ ] **Step 1: Full verify gate per CLAUDE.md**

Run:
```bash
bunx tsc --noEmit && bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'
```
Expected: 0 typecheck errors, all tests green.

- [ ] **Step 2: Clear `.next/` and start dev**

Run:
```bash
rm -rf .next && bun run dev
```
Wait for the dev server to come up.

- [ ] **Step 3: Smoke the surfaces**

Manually visit (or screenshot):
1. `http://localhost:3000/dashboard/contracts/<smith-nephew-id>` — Rebates & Tiers tab: confirm "Current: Tier 2 · 15%" (not Tier 3).
2. `http://localhost:3000/dashboard/rebate-optimizer` — confirm the Smith & Nephew row shows "CURRENT REBATE 15%" and "Next rate 20%" (not 10% / $10 (1%)).
3. Click into Rebate Calculator dialog — confirm Current Tier and Next Tier are populated correctly.

If anything still shows the wrong tier, return to Phase 1 of systematic-debugging — do NOT add a third fix without investigating.

- [ ] **Step 4: Final commit if any test/fix tweaks happened during smoke**

```bash
git add -A && git commit -m "chore: bug cluster B smoke fixes"
```

---

## Out of scope (separate tasks)

- Cosmetic "1,499,999.0% market share" display sentinel — `contract-terms-display.tsx` should render "X%+" when `spendMax` exceeds a realistic ceiling.
- Bug #7 (Smart Recommendations empty) root cause — the NEW engine's `mapTermKind` still drops market_share. Per user decision, the new engine stays spend-only in this PR.
- Bug #15 (tie-in metrics missing) — same metric-routing root cause but on a different code path.

---

## Self-review checklist

1. **Spec coverage** — every fix path from the spec has a task:
   - Helper `pickThresholdMetric` → Task 1
   - Rewrite OLD `getRebateOpportunities` → Task 2
   - Fix `contract-terms-display.tsx` → Task 3
   - Parity guard → Task 4
   - Manual smoke → Task 5
2. **Placeholder scan** — Task 4 has one PSEUDO-CODE block, called out explicitly with a subagent note to replace it with the file's existing helper pattern (the existing parity test file's style is not yet visible to the planner; the executing subagent reads the file). Otherwise no placeholders.
3. **Type consistency** — `pickThresholdMetric` signature `(termType: string, metrics: ThresholdMetricInputs)` is used identically in Tasks 1, 2, 3. `ThresholdMetricInputs` exports `{ currentSpend, currentMarketShare, complianceRate, currentVolume }` — every consumer passes the same shape.
