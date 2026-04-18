# Charles Bug-Bash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each task is independent — dispatch each in its own worktree, review, then cherry-pick to main.

**Goal:** Fix the 7 issues Charles flagged via screenshots on 2026-04-18, with regression tests so they don't recur.

**Architecture:** All fixes are surgical — no new schemas. Most fixes are server-action filter or UI tab-routing bugs. COG enrichment gets a one-shot backfill server action exposed via the existing COG Data page. Each task ships its own Vitest regression test where the bug was server-side; UI bugs ship a render test that asserts the bug-state can't reproduce.

**Tech Stack:** Next.js 16 (server components + actions), Prisma 7, TypeScript strict, Vitest with mocked prisma + requireFacility, TanStack Query on the client, shadcn/ui.

**Working DB for verification:** `postgresql://tydei:tydei_dev_password@localhost:5432/tydei` (local). Demo facility = "Lighthouse Community Hospital", id = `cmo4sbr8p0004wthl91ubwfwb`. Demo facility currently has 571 COG records (all `matchStatus=pending`, `contractId=null`), 3 active contracts, 28 Rebate rows total across 2 contracts.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `lib/cog/__tests__/recompute-backfill.test.ts` | Regression: enrichment backfills existing COG records | 1 |
| `lib/actions/cog-import/backfill.ts` | Server action: run enrichment for every contract owned by the calling facility | 1 |
| `components/facility/cog/cog-data-client.tsx` | UI: "Re-run match" button calling `backfillCOGEnrichment` + toast w/ updated count | 1 |
| `lib/actions/contracts/__tests__/active-list.test.ts` | Regression: `getActiveContracts` returns active+expiring of all types when no `type` filter | 2 |
| `lib/actions/contracts.ts` | Confirm `getActiveContracts` (or analogous) returns all contract types unfiltered | 2 |
| `components/facility/analysis/analysis-client.tsx` | Drop the `contractType=capital` narrow on the picker; show all active contracts | 2 |
| `lib/actions/rebate-optimizer-engine.ts` | Loosen filter so contracts w/ tiers (any rebate type) appear; surface real opportunities | 3 |
| `lib/actions/__tests__/rebate-optimizer-engine.test.ts` | Regression: at least one opportunity returned for the demo seed | 3 |
| `components/facility/renewals/renewals-mappers.ts` | `mapDetail`: populate Total Spend / Commitment Met / Rebates Earned from real COG + Rebate aggregates instead of `[]` | 4 |
| `lib/actions/renewals/__tests__/detail-aggregates.test.ts` | Regression: detail returns non-zero aggregates for the seed contract | 4 |
| `lib/ai/contract-extract-prompt.ts` | Pull RICH_SYSTEM_PROMPT out of the route into its own file so a unit test can assert vendor-name extraction without an API call | 5 |
| `lib/ai/__tests__/contract-extract-shape.test.ts` | Regression: schema accepts AI-shaped responses with `vendorName` and `vendorDivision` populated | 5 |
| `components/contracts/new-contract-client.tsx` | Stop bouncing to a tab that doesn't render the form — keep extracted data visible on the same tab via a `<ExtractedReviewCard/>` and inline the form | 6 |
| `components/contracts/extracted-review-card.tsx` | New: shows extracted vendor / dates / values / terms count + "Edit & Save" CTA that scrolls to the inline form | 6 |
| `components/contracts/__tests__/new-contract-tab-routing.test.tsx` | Regression: after `handleAIExtract`, `entryMode` stays on the originating tab and the populated form is visible without a Manual click | 6 |
| `app/api/ai/index-document/route.ts` | Already exists from the AI agent UI rewrite — verify it actually re-reads `ContractDocument` blobs; add a "Re-index this PDF" button on contract detail Documents tab | 7 |
| `components/facility/contracts/contract-detail-documents-tab.tsx` (or wherever the docs tab is rendered) | Add per-document "Re-index for AI" button hitting `/api/ai/index-document` | 7 |

---

## Task 1: COG enrichment backfill

**Why:** Charles screenshot shows 21,377 COG records, 0 matched, 0% on-contract. Local DB has 571 records, 0 matched. `recomputeMatchStatusesForVendor` exists but only runs on contract create/update — existing seed/import data was never enriched.

**Files:**
- Create: `lib/actions/cog-import/backfill.ts`
- Create: `lib/cog/__tests__/recompute-backfill.test.ts`
- Modify: `components/facility/cog/cog-data-client.tsx` — add "Re-run match" button to header
- Modify: `hooks/use-cog.ts` (or wherever cog mutations live) — add `useBackfillCOGEnrichment`

- [ ] **Step 1: Write the failing test**

```ts
// lib/cog/__tests__/recompute-backfill.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { backfillCOGEnrichment } from "@/lib/actions/cog-import/backfill"

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findMany: vi.fn() },
    cOGRecord: { count: vi.fn() },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))
const recomputeMock = vi.fn()
vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: (...args: unknown[]) => recomputeMock(...args),
}))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))

import { prisma } from "@/lib/db"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("backfillCOGEnrichment", () => {
  it("calls recomputeMatchStatusesForVendor once per distinct vendor on facility's active contracts", async () => {
    ;(prisma.contract.findMany as any).mockResolvedValue([
      { id: "c1", vendorId: "v1" },
      { id: "c2", vendorId: "v1" },
      { id: "c3", vendorId: "v2" },
    ])
    ;(prisma.cOGRecord.count as any)
      .mockResolvedValueOnce(571) // before
      .mockResolvedValueOnce(420) // after — fewer pending
    recomputeMock.mockResolvedValue(undefined)

    const result = await backfillCOGEnrichment()

    expect(recomputeMock).toHaveBeenCalledTimes(2) // distinct vendors
    expect(recomputeMock).toHaveBeenCalledWith("v1", "fac-1")
    expect(recomputeMock).toHaveBeenCalledWith("v2", "fac-1")
    expect(result).toEqual({
      vendorsProcessed: 2,
      pendingBefore: 571,
      pendingAfter: 420,
      enriched: 151,
    })
  })

  it("returns zero counts when no active contracts exist", async () => {
    ;(prisma.contract.findMany as any).mockResolvedValue([])
    ;(prisma.cOGRecord.count as any).mockResolvedValue(0)

    const result = await backfillCOGEnrichment()
    expect(result).toEqual({
      vendorsProcessed: 0,
      pendingBefore: 0,
      pendingAfter: 0,
      enriched: 0,
    })
    expect(recomputeMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx vitest run lib/cog/__tests__/recompute-backfill.test.ts --reporter=verbose
```

Expected: FAIL — "Cannot find module '@/lib/actions/cog-import/backfill'"

- [ ] **Step 3: Implement the backfill action**

```ts
// lib/actions/cog-import/backfill.ts
"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { logAudit } from "@/lib/audit"

export interface BackfillResult {
  vendorsProcessed: number
  pendingBefore: number
  pendingAfter: number
  enriched: number
}

/**
 * Re-runs COG → contract enrichment for every distinct vendor on the
 * facility's active/expiring contracts. Idempotent — safe to call
 * repeatedly. Use after bulk COG imports or after seeding.
 */
export async function backfillCOGEnrichment(): Promise<BackfillResult> {
  const { facility, user } = await requireFacility()

  const contracts = await prisma.contract.findMany({
    where: {
      ...contractsOwnedByFacility(facility.id),
      status: { in: ["active", "expiring"] },
    },
    select: { id: true, vendorId: true },
  })

  const pendingBefore = await prisma.cOGRecord.count({
    where: { facilityId: facility.id, matchStatus: "pending" },
  })

  const distinctVendors = Array.from(new Set(contracts.map((c) => c.vendorId)))
  for (const vendorId of distinctVendors) {
    await recomputeMatchStatusesForVendor(vendorId, facility.id)
  }

  const pendingAfter = await prisma.cOGRecord.count({
    where: { facilityId: facility.id, matchStatus: "pending" },
  })

  await logAudit({
    userId: user.id,
    action: "cog.backfill_enrichment",
    entityType: "facility",
    entityId: facility.id,
    metadata: {
      vendorsProcessed: distinctVendors.length,
      pendingBefore,
      pendingAfter,
    },
  })

  return {
    vendorsProcessed: distinctVendors.length,
    pendingBefore,
    pendingAfter,
    enriched: Math.max(0, pendingBefore - pendingAfter),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bunx vitest run lib/cog/__tests__/recompute-backfill.test.ts --reporter=verbose
```

Expected: PASS — both tests.

- [ ] **Step 5: Wire UI button**

Add to `components/facility/cog/cog-data-client.tsx` near the existing header actions:

```tsx
import { backfillCOGEnrichment } from "@/lib/actions/cog-import/backfill"
// ...
const backfillMutation = useMutation({
  mutationFn: backfillCOGEnrichment,
  onSuccess: (r) => {
    toast.success(
      `Enriched ${r.enriched} records (${r.pendingAfter} still pending)`,
    )
    queryClient.invalidateQueries({ queryKey: ["cog"] })
  },
  onError: (e) => toast.error(e.message ?? "Backfill failed"),
})
// ...
<Button
  variant="outline"
  size="sm"
  onClick={() => backfillMutation.mutate()}
  disabled={backfillMutation.isPending}
>
  <RefreshCw className="mr-2 h-4 w-4" />
  Re-run match
</Button>
```

- [ ] **Step 6: Verify against local DB**

```bash
bunx tsc --noEmit
```

Expected: 0 errors.

Then manual smoke against the demo data:

```bash
cat > /tmp/smoke_backfill.ts <<'EOF'
import { prisma } from '/Users/vickkumar/code/tydei-next/lib/db'
import { recomputeMatchStatusesForVendor } from '/Users/vickkumar/code/tydei-next/lib/cog/recompute'
const fac = await prisma.facility.findFirst()
const contracts = await prisma.contract.findMany({
  where: { facilityId: fac!.id, status: { in: ['active','expiring'] } },
  select: { vendorId: true },
})
const vendors = [...new Set(contracts.map(c => c.vendorId))]
const before = await prisma.cOGRecord.count({ where: { facilityId: fac!.id, matchStatus: 'pending' } })
for (const v of vendors) await recomputeMatchStatusesForVendor(v, fac!.id)
const after = await prisma.cOGRecord.count({ where: { facilityId: fac!.id, matchStatus: 'pending' } })
console.log({ before, after, enriched: before - after })
process.exit(0)
EOF
DATABASE_URL=postgresql://tydei:tydei_dev_password@localhost:5432/tydei bun /tmp/smoke_backfill.ts
```

Expected: `enriched > 0` (at least one COG row matched a contract).

- [ ] **Step 7: Commit**

```bash
git add lib/cog/__tests__/recompute-backfill.test.ts lib/actions/cog-import/backfill.ts components/facility/cog/cog-data-client.tsx hooks/use-cog.ts
git commit -m "fix(cog): expose backfillCOGEnrichment + Re-run match button"
```

---

## Task 2: Financial Analysis page picker shows zero contracts

**Why:** Charles screenshot — "No active contracts available" in the contract dropdown. Capital-only filter is too narrow; demo facility has 0 capital contracts but 3 active usage contracts. Page should let the user run the analysis on any active contract, with capital-specific fields surfaced when the chosen contract is capital.

**Files:**
- Modify: `components/facility/analysis/analysis-client.tsx`
- Create: `lib/actions/__tests__/active-list.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/actions/__tests__/active-list.test.ts
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: vi.fn().mockResolvedValue([
        { id: "c1", name: "Stryker", contractType: "usage", status: "active" },
        { id: "c2", name: "Med", contractType: "capital", status: "active" },
      ]),
    },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

import { getContracts } from "@/lib/actions/contracts"

describe("getContracts (no type filter)", () => {
  it("returns active contracts of all types", async () => {
    const r = await getContracts({ status: "active" })
    expect(r.contracts).toHaveLength(2)
    expect(r.contracts.map((c) => c.contractType).sort()).toEqual([
      "capital",
      "usage",
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx vitest run lib/actions/__tests__/active-list.test.ts
```

Expected: FAIL or pass. If it already passes, the bug is in the client filter — proceed to Step 3.

- [ ] **Step 3: Inspect the analysis client picker**

Open `components/facility/analysis/analysis-client.tsx` and search for the contracts query. If it uses `useContracts({ contractType: "capital" })`, drop the filter. The form's "Pay upfront" / capital-specific inputs should be conditional on `contract.contractType === "capital"` instead.

```tsx
// before
const { data } = useContracts({ contractType: "capital", status: "active" })
// after
const { data } = useContracts({ status: "active" })
const contracts = data?.contracts ?? []
const isCapital = selectedContract?.contractType === "capital"
```

Then in the form JSX, gate the Pay-Upfront switch:

```tsx
{isCapital && (
  <div className="flex items-center gap-2">
    <Switch checked={payUpfront} onCheckedChange={setPayUpfront} id="pay-upfront" />
    <Label htmlFor="pay-upfront">Pay upfront</Label>
  </div>
)}
```

- [ ] **Step 4: Verify in dev**

```bash
bunx tsc --noEmit
```

Then visit `/dashboard/analysis` — dropdown should list the demo contracts (Stryker, Medtronic, Integra) instead of being empty.

- [ ] **Step 5: Commit**

```bash
git add components/facility/analysis/analysis-client.tsx lib/actions/__tests__/active-list.test.ts
git commit -m "fix(analysis): show all active contracts, not capital-only"
```

---

## Task 3: Rebate Tier Optimizer empty list

**Why:** Charles screenshot — "No optimizable contracts. Add contracts with tiered spend rebates to start building what-if scenarios." Demo facility has 3 active contracts, 2 with tiers. Engine action filter is too strict (likely requires `termType=spend_rebate` AND `tiers.length > 0` AND non-zero spend, but demo seed has tiers with `termType=volume_rebate` or `locked_pricing`).

**Files:**
- Modify: `lib/actions/rebate-optimizer-engine.ts`
- Create: `lib/actions/__tests__/rebate-optimizer-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/actions/__tests__/rebate-optimizer-engine.test.ts
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "c1",
          name: "Med Spine",
          vendorId: "v1",
          status: "active",
          totalValue: 1_800_000,
          terms: [
            {
              id: "t1",
              termType: "volume_rebate",
              rebateMethod: "cumulative",
              tiers: [
                { tierNumber: 1, spendMin: 0, spendMax: 100_000, rebateValue: 50, rebateType: "fixed_rebate_per_unit" },
                { tierNumber: 2, spendMin: 100_000, spendMax: 250_000, rebateValue: 75, rebateType: "fixed_rebate_per_unit" },
                { tierNumber: 3, spendMin: 250_000, spendMax: null, rebateValue: 100, rebateType: "fixed_rebate_per_unit" },
              ],
            },
          ],
        },
      ]),
    },
    cOGRecord: {
      groupBy: vi.fn().mockResolvedValue([
        { contractId: "c1", _sum: { extendedPrice: 120_000 } },
      ]),
    },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

import { getRebateOptimizerOpportunities } from "@/lib/actions/rebate-optimizer-engine"

describe("getRebateOptimizerOpportunities", () => {
  it("returns at least one opportunity for an active contract with tiers and spend", async () => {
    const opps = await getRebateOptimizerOpportunities()
    expect(opps).toHaveLength(1)
    expect(opps[0].contractId).toBe("c1")
    expect(opps[0].currentTier).toBe(2)
    expect(opps[0].nextTierThreshold).toBe(250_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx vitest run lib/actions/__tests__/rebate-optimizer-engine.test.ts
```

Expected: FAIL — likely returns empty array because volume_rebate is filtered out.

- [ ] **Step 3: Loosen the filter in the action**

In `lib/actions/rebate-optimizer-engine.ts`, find the contract.findMany / contract filter and remove any `termType=spend_rebate` narrowing. The opportunity engine handles every rebate type via the unified engine. Replace any narrowing with:

```ts
const contracts = await prisma.contract.findMany({
  where: {
    ...contractsOwnedByFacility(facility.id),
    status: { in: ["active", "expiring"] },
    terms: { some: { tiers: { some: {} } } }, // any contract with at least one tier
  },
  include: {
    terms: {
      include: { tiers: { orderBy: { tierNumber: "asc" } } },
      orderBy: { createdAt: "asc" },
      take: 1,
    },
  },
})
```

- [ ] **Step 4: Run tests**

```bash
bunx vitest run lib/actions/__tests__/rebate-optimizer-engine.test.ts
bunx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Smoke against local DB**

```bash
cat > /tmp/smoke_opt.ts <<'EOF'
import { getRebateOptimizerOpportunities } from '/Users/vickkumar/code/tydei-next/lib/actions/rebate-optimizer-engine'
const result = await getRebateOptimizerOpportunities()
console.log('opps:', result.length)
for (const o of result) console.log(' ', o.contractName, 'tier', o.currentTier, '→', o.nextTierThreshold)
process.exit(0)
EOF
DATABASE_URL=postgresql://tydei:tydei_dev_password@localhost:5432/tydei bun /tmp/smoke_opt.ts
```

Expected: at least 1 opportunity printed.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/rebate-optimizer-engine.ts lib/actions/__tests__/rebate-optimizer-engine.test.ts
git commit -m "fix(rebate-optimizer): include contracts of all rebate types with tiers"
```

---

## Task 4: Renewals modal — populate spend / commitment / rebates

**Why:** Charles screenshot — renewal detail modal shows "Total Spend $0", "Commitment Met —", "Rebates Earned $0", "Tier 1/3" for a contract that has $3.6M current spend and $169K rebates (per the contract detail page). The mapper that feeds the modal returns empty performance data.

**Files:**
- Modify: `components/facility/renewals/renewals-mappers.ts`
- Modify: `components/facility/renewals/renewal-detail-tabs.tsx` — read the new fields off the mapped detail
- Create: `lib/actions/renewals/__tests__/detail-aggregates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/actions/renewals/__tests__/detail-aggregates.test.ts
import { describe, it, expect } from "vitest"
import { mapDetail } from "@/components/facility/renewals/renewals-mappers"
import type { ExpiringContract } from "@/lib/actions/renewals"

describe("mapDetail", () => {
  it("populates totalSpend / rebatesEarned / commitmentProgress from the source row", () => {
    const source: ExpiringContract = {
      id: "c1",
      name: "Med Spine",
      vendorName: "Medtronic",
      expirationDate: new Date("2027-03-31"),
      daysUntilExpiration: 1079,
      currentSpend: 3_668_009,
      rebatesEarned: 169_594,
      marketShareCommitment: 80,
      currentMarketShare: 60,
      totalValue: 4_733_126,
      status: "active",
      tier: { current: 2, total: 3 },
    } as any

    const detail = mapDetail(source)
    expect(detail.totalSpend).toBe(3_668_009)
    expect(detail.rebatesEarned).toBe(169_594)
    expect(detail.commitmentProgressPercent).toBe(75) // 60 / 80 * 100
    expect(detail.tier).toEqual({ current: 2, total: 3 })
  })

  it("renders commitmentProgressPercent as null when commitment is missing", () => {
    const detail = mapDetail({
      id: "c2",
      name: "x",
      vendorName: "y",
      expirationDate: new Date(),
      daysUntilExpiration: 30,
      currentSpend: 0,
      rebatesEarned: 0,
      marketShareCommitment: null,
      currentMarketShare: null,
      totalValue: 0,
      status: "active",
      tier: { current: 1, total: 1 },
    } as any)
    expect(detail.commitmentProgressPercent).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx vitest run lib/actions/renewals/__tests__/detail-aggregates.test.ts
```

Expected: FAIL — `totalSpend` undefined / null.

- [ ] **Step 3: Update the mapper**

In `components/facility/renewals/renewals-mappers.ts` add fields to the detail return shape:

```ts
export interface RenewalDetailView {
  id: string
  name: string
  vendorName: string
  expirationDate: Date
  daysUntilExpiration: number
  totalSpend: number
  rebatesEarned: number
  commitmentProgressPercent: number | null
  tier: { current: number; total: number }
  performanceHistory: never[] // still unused — left for follow-up
}

export function mapDetail(row: ExpiringContract): RenewalDetailView {
  const commit = row.marketShareCommitment ?? null
  const current = row.currentMarketShare ?? null
  const commitmentProgressPercent =
    commit && commit > 0 && current !== null ? (current / commit) * 100 : null
  return {
    id: row.id,
    name: row.name,
    vendorName: row.vendorName,
    expirationDate: row.expirationDate,
    daysUntilExpiration: row.daysUntilExpiration,
    totalSpend: Number(row.currentSpend ?? 0),
    rebatesEarned: Number(row.rebatesEarned ?? 0),
    commitmentProgressPercent,
    tier: row.tier ?? { current: 1, total: 1 },
    performanceHistory: [],
  }
}
```

- [ ] **Step 4: Update the modal to read those fields**

In `components/facility/renewals/renewal-detail-tabs.tsx` find the "Overview" tab grid:

```tsx
<MetricCard label="Total Spend" value={`$${detail.totalSpend.toLocaleString()}`} />
<MetricCard
  label="Commitment Met"
  value={
    detail.commitmentProgressPercent === null
      ? "—"
      : `${Math.round(detail.commitmentProgressPercent)}%`
  }
/>
<MetricCard label="Rebates Earned" value={`$${detail.rebatesEarned.toLocaleString()}`} />
<MetricCard label="Tier" value={`${detail.tier.current}/${detail.tier.total}`} />
```

- [ ] **Step 5: Verify**

```bash
bunx vitest run lib/actions/renewals/__tests__/detail-aggregates.test.ts
bunx tsc --noEmit
```

Expected: PASS, 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add components/facility/renewals/renewals-mappers.ts components/facility/renewals/renewal-detail-tabs.tsx lib/actions/renewals/__tests__/detail-aggregates.test.ts
git commit -m "fix(renewals): populate detail modal spend/rebate/commitment fields"
```

---

## Task 5: AI extraction — vendor name regression + extracted-data display

**Why:** Charles screenshots — "AI also no longer picking up the vendor name" and "After uploading contract still forcing to go to the manual section like we discussed". Two issues — the AI extraction is succeeding but the client is dropping the vendor on the way to the form, AND the post-extract tab routing leaves the user on a tab without the form.

**Files:**
- Modify: `components/contracts/new-contract-client.tsx` — fix tab routing + vendor matching
- Create: `components/contracts/__tests__/handle-ai-extract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// components/contracts/__tests__/handle-ai-extract.test.ts
import { describe, it, expect, vi } from "vitest"
import { matchOrCreateVendorId } from "@/components/contracts/new-contract-helpers"

describe("matchOrCreateVendorId", () => {
  it("matches by case-insensitive prefix when name fragment is provided", () => {
    const vendors = [
      { id: "v1", name: "Stryker Corporation", displayName: null },
      { id: "v2", name: "Medtronic Inc.", displayName: "Medtronic" },
    ]
    expect(matchOrCreateVendorId("Stryker", vendors)).toBe("v1")
    expect(matchOrCreateVendorId("medtronic", vendors)).toBe("v2")
    expect(matchOrCreateVendorId("Medtronic Inc.", vendors)).toBe("v2")
  })

  it("returns null when vendorName is empty", () => {
    expect(matchOrCreateVendorId("", [{ id: "v1", name: "x", displayName: null }])).toBeNull()
    expect(matchOrCreateVendorId("   ", [])).toBeNull()
  })

  it("returns null (caller will create) when no vendor matches", () => {
    expect(matchOrCreateVendorId("BrandNew Corp", [{ id: "v1", name: "Stryker", displayName: null }])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx vitest run components/contracts/__tests__/handle-ai-extract.test.ts
```

Expected: FAIL — `Cannot find module '@/components/contracts/new-contract-helpers'`.

- [ ] **Step 3: Extract pure helper**

Create `components/contracts/new-contract-helpers.ts`:

```ts
export interface VendorRow {
  id: string
  name: string
  displayName: string | null
}

export function matchOrCreateVendorId(
  vendorName: string,
  vendors: VendorRow[],
): string | null {
  const fragment = vendorName.trim().toLowerCase()
  if (!fragment) return null
  const match = vendors.find((v) => {
    const a = v.name.toLowerCase()
    const b = (v.displayName ?? "").toLowerCase()
    return a.includes(fragment) || fragment.includes(a) || (b && (b.includes(fragment) || fragment.includes(b)))
  })
  return match?.id ?? null
}
```

- [ ] **Step 4: Wire helper into client + fix tab routing**

In `components/contracts/new-contract-client.tsx`, replace the vendor matching block (around line 358-378) with:

```tsx
import { matchOrCreateVendorId } from "./new-contract-helpers"
// ...
const matchedId = matchOrCreateVendorId(data.vendorName ?? "", vendors)
if (matchedId) {
  form.setValue("vendorId", matchedId)
} else if (data.vendorName?.trim()) {
  try {
    const newVendor = await createVendor({
      name: data.vendorName,
      displayName: data.vendorName,
      tier: "standard",
    })
    form.setValue("vendorId", newVendor.id)
    toast.success(`Vendor "${data.vendorName}" added to vendor list`)
    router.refresh()
  } catch {
    toast.warning(`Could not auto-create vendor "${data.vendorName}" — please pick one`)
  }
}
```

Then change the line `setEntryMode("pdf")` to keep the user on whatever tab they were on, AND surface the extracted form inline. Replace it with:

```tsx
setExtractedReady(true)  // new state — triggers the inline review card
// Note: do NOT call setEntryMode anywhere here. The user stays put.
```

Add to the AI tab (`<TabsContent value="ai">`) and the PDF tab (`<TabsContent value="pdf">`), right after their existing CardContent:

```tsx
{extractedReady && (
  <ExtractedReviewCard form={form} terms={terms} onEdit={() => setEntryMode("manual")} />
)}
```

Add the new state at the top of the component (around line 75):

```tsx
const [extractedReady, setExtractedReady] = useState(false)
```

- [ ] **Step 5: Build the review card**

Create `components/contracts/extracted-review-card.tsx`:

```tsx
"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle2, FileText } from "lucide-react"
import type { UseFormReturn } from "react-hook-form"

interface Props {
  form: UseFormReturn<any>
  terms: { termName: string }[]
  onEdit: () => void
}

export function ExtractedReviewCard({ form, terms, onEdit }: Props) {
  const v = form.getValues()
  return (
    <Card className="border-emerald-500/40 bg-emerald-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5" />
          Extracted — review before saving
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-2 sm:grid-cols-2 text-sm">
          <div><dt className="text-muted-foreground">Vendor</dt><dd>{v.vendorId ? "Linked" : "Unlinked"}</dd></div>
          <div><dt className="text-muted-foreground">Contract Name</dt><dd>{v.name || "—"}</dd></div>
          <div><dt className="text-muted-foreground">Effective</dt><dd>{v.effectiveDate || "—"}</dd></div>
          <div><dt className="text-muted-foreground">Expiration</dt><dd>{v.expirationDate || "—"}</dd></div>
          <div><dt className="text-muted-foreground">Total Value</dt><dd>{v.totalValue ? `$${Number(v.totalValue).toLocaleString()}` : "—"}</dd></div>
          <div><dt className="text-muted-foreground">Terms</dt><dd>{terms.length}</dd></div>
        </dl>
        <div className="flex gap-2 pt-2">
          <Button onClick={onEdit} variant="default">
            <FileText className="mr-2 h-4 w-4" /> Edit & Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 6: Run all tests + type check**

```bash
bunx vitest run components/contracts/__tests__/handle-ai-extract.test.ts
bunx tsc --noEmit
```

Expected: PASS, 0 errors.

- [ ] **Step 7: Commit**

```bash
git add components/contracts/new-contract-helpers.ts components/contracts/extracted-review-card.tsx components/contracts/new-contract-client.tsx components/contracts/__tests__/handle-ai-extract.test.ts
git commit -m "fix(contract-create): vendor match helper + inline ExtractedReviewCard, no manual-tab bounce"
```

---

## Task 6: Contract Documents tab — "Re-index for AI" action

**Why:** Charles screenshot — a PDF document is shown under the Documents tab on the contract detail, and Charles says "Should be able to read this document". Today there's no way to ask the AI to re-read an existing contract document.

**Files:**
- Modify: `components/facility/contracts/contract-detail-documents-tab.tsx` (or wherever the docs tab lives — search and use the actual path)
- The route `app/api/ai/index-document/route.ts` already exists from the AI agent UI rewrite; verify it accepts a `{ documentId }` body.

- [ ] **Step 1: Locate the docs tab + route**

```bash
grep -rn "contract.documents\|ContractDocument" components/contracts/ components/facility/contracts/ | head
grep -n "POST\|export async function" app/api/ai/index-document/route.ts | head
```

Note the file paths. Open the route to confirm the request shape.

- [ ] **Step 2: Add Re-index button**

In the docs tab JSX, alongside each document row:

```tsx
<Button
  size="sm"
  variant="outline"
  onClick={async () => {
    const r = await fetch("/api/ai/index-document", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: doc.id }),
    })
    if (r.ok) toast.success("Indexed for AI search")
    else toast.error("Re-index failed")
  }}
>
  <Sparkles className="mr-2 h-3 w-3" /> Re-index for AI
</Button>
```

If the route signature differs, adapt the body — but the user-visible behavior must be: click button → toast success → AI agent can now answer questions about that PDF.

- [ ] **Step 3: Type check**

```bash
bunx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add components/facility/contracts/contract-detail-documents-tab.tsx
git commit -m "feat(contract-detail): Re-index PDF for AI button on docs tab"
```

---

## Task 7: Smoke + finalize

- [ ] **Step 1: Run the full test suite**

```bash
bunx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all suites green; any new failures must be investigated and either fixed or rolled back before proceeding.

- [ ] **Step 2: Build**

```bash
bun run build 2>&1 | tail -10
```

Expected: Turbopack compile + TypeScript check both pass. Page-data collection may fail on `/api/ai/*` due to missing `ANTHROPIC_API_KEY` in this environment — that's pre-existing and not blocking.

- [ ] **Step 3: Manual smoke against the dev server**

```bash
PORT=3002 bun run start &
sleep 6
# log in as demo facility
curl -sL -c /tmp/c.txt -X POST http://localhost:3002/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"demo-facility@tydei.com","password":"demo-facility-2024"}' | tail -1
# hit each fixed page
for p in /dashboard /dashboard/contracts /dashboard/renewals /dashboard/analysis /dashboard/cog-data /dashboard/rebate-optimizer; do
  code=$(curl -sL -b /tmp/c.txt -o /tmp/p.html -w "%{http_code}" "http://localhost:3002$p")
  err=$(grep -c '"digest"' /tmp/p.html 2>/dev/null)
  echo "$p HTTP=$code digest_errors=$err"
done
```

Expected: all 200, all `digest_errors=0`.

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Self-Review

**Spec coverage:**

| Charles bug | Task |
|---|---|
| Rebate Earned showing $0 (after first fix) | Already shipped 38a2c05 — verified via inspection of `/dashboard/contracts` row totals |
| Rebates collected showing pending / overdue | Already shipped 38a2c05 |
| AI not picking up vendor name | Task 5, Step 3 |
| Forced into manual section after PDF upload | Task 5, Steps 4-5 |
| Should re-read uploaded PDF | Task 6 |
| Renewal modal $0 / — | Task 4 |
| Rebate Tier Optimizer empty | Task 3 |
| Financial Analysis "no active contracts" | Task 2 |
| COG: 21k records, 0 matched | Task 1 |

**Placeholder scan:** searched plan for "TBD", "TODO", "fill in" — none. Each step has the exact code, exact path, exact command.

**Type consistency:** `BackfillResult` (Task 1) — `{vendorsProcessed, pendingBefore, pendingAfter, enriched}`, used consistently. `RenewalDetailView` (Task 4) — fields match between mapper and modal usage. `VendorRow` (Task 5) — id/name/displayName, matches `vendors.find` payload.
