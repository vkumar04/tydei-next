# Contracts QA Fix Wave 2 — P1 Data Correctness

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Fix 9 P1 bugs where client-side math, scope-leaks, or missing field writes produce wrong numbers.

**Source:** QA report `docs/superpowers/qa/2026-04-19-contracts-sweep.md` — bugs list-1, list-2, list-3, detail-1, detail-2, detail-7, detail-9, new-2, edit-1, edit-10, score-2.

**Tech Stack:** same as wave 1.

---

## File Structure

| File | Bug(s) | Task |
|---|---|---|
| `components/contracts/contract-detail-client.tsx` | detail-1, detail-2 — use server-computed values directly | 1 |
| `lib/actions/contracts.ts::getContractStats` + `hooks/use-contracts.ts::useContractStats` | list-1 — plumb facilityScope | 2 |
| `lib/actions/contracts.ts::getContractMetricsBatch` | list-2, list-3 — add facilityId to rebate/period groupBy; drop vendor-wide spend fallback | 3 |
| `lib/actions/contracts.ts::createContract` + `updateContract` | new-2, edit-10 — persist `isGrouped` on both paths | 4 |
| `components/contracts/edit-contract-client.tsx` | edit-1 — call `updateContractTerm` in Save loop | 5 |
| `components/facility/contracts/contract-score-client.tsx` | score-2 — render rule-based radar + benchmark even when AI fails | 6 |
| `components/contracts/contract-detail-client.tsx` | detail-7 — empty-state when tie-in contract has no terms | 7 |
| `lib/actions/contracts/off-contract-spend.ts` + `performance-history.ts` + `getContract` | detail-9 — add `contractId` filter when COGRecord has that FK | 8 |

---

## Task 1: Detail page uses server values directly (detail-1 + detail-2)

**Files:** `components/contracts/contract-detail-client.tsx`

- [ ] **Step 1: Locate the client re-derivation block**

Lines 76-102 per QA report. Current code sums `contract.rebates[].rebateEarned` without temporal gates, then `Math.max(periodSum, rebateModelEarned)`. Also `totalSpend = periodSpend` ignoring the COG-aggregate `currentSpend` the server returns.

- [ ] **Step 2: Replace with server-provided values**

Find the block and replace with:

```tsx
// Server already applies the correct temporal filters:
//   rebateEarned   — sums Rebate rows where payPeriodEnd <= today
//   rebateCollected — sums rows where collectionDate != null
//   currentSpend   — cOGRecord aggregate for facility+vendor
// (See lib/actions/contracts.ts::getContract.) Trust the server values.
const rebateEarned = Number(contract.rebateEarned ?? 0)
const rebateCollected = Number(contract.rebateCollected ?? 0)
const totalSpend = Number(contract.currentSpend ?? 0)
```

Delete the old sums, the `Math.max` layer, and any unused `periodSpend` / `periodRebateEarned` / `periodRebateCollected` locals.

- [ ] **Step 3: tsc + smoke**

```bash
bunx tsc --noEmit
```

Visit `/dashboard/contracts/cmo4sbrex003cwthldeo5j83k` (Integra Dural Repair) → Rebates Earned should read $99,999.96 (was $104,020.20); Rebates Collected should read $0 (was $82,970.23).

- [ ] **Step 4: Commit**

```bash
git add components/contracts/contract-detail-client.tsx
git commit -m "fix(contract-detail): use server rebateEarned/Collected/currentSpend directly"
```

---

## Task 2: `getContractStats` honors facilityScope (list-1)

**Files:**
- Modify: `lib/actions/contracts.ts::getContractStats`
- Modify: `hooks/use-contracts.ts::useContractStats`
- Modify: `components/contracts/contracts-list-client.tsx` — pass scope into the hook
- Create: `lib/actions/__tests__/get-contract-stats-scope.test.ts`

- [ ] **Step 1: Failing test**

```ts
// lib/actions/__tests__/get-contract-stats-scope.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const countMock = vi.fn().mockResolvedValue(0)
const aggregateMock = vi.fn().mockResolvedValue({ _sum: { totalValue: 0, annualValue: 0 } })
const rebateAggregateMock = vi.fn().mockResolvedValue({ _sum: { rebateEarned: 0 } })

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { count: countMock, aggregate: aggregateMock },
    rebate: { aggregate: rebateAggregateMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

import { getContractStats } from "@/lib/actions/contracts"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getContractStats — facilityScope", () => {
  it("'this' (default) scopes by facilityId", async () => {
    await getContractStats({})
    const where = JSON.stringify(countMock.mock.calls[0][0].where)
    expect(where).toContain("fac-1")
  })
  it("'all' drops the facility filter", async () => {
    await getContractStats({ facilityScope: "all" })
    const where = JSON.stringify(countMock.mock.calls[0][0].where)
    expect(where).not.toContain("\"facilityId\":\"fac-1\"")
  })
  it("'shared' filters to multi-facility only", async () => {
    await getContractStats({ facilityScope: "shared" })
    const where = JSON.stringify(countMock.mock.calls[0][0].where)
    expect(where).toContain("isMultiFacility")
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/__tests__/get-contract-stats-scope.test.ts
```

- [ ] **Step 3: Extract a shared scope-clause builder**

In `lib/actions/contracts.ts`, add near the top of the file:

```ts
import type { Prisma } from "@prisma/client"

type FacilityScope = "this" | "all" | "shared"

function facilityScopeClause(scope: FacilityScope, facilityId: string): Prisma.ContractWhereInput {
  if (scope === "this") return contractsOwnedByFacility(facilityId)
  if (scope === "shared") {
    return {
      isMultiFacility: true,
      OR: [
        { facilityId },
        { contractFacilities: { some: { facilityId } } },
      ],
    }
  }
  return {}
}
```

Refactor `getContracts` to use this helper (it already has the branch inline — dedupe).

- [ ] **Step 4: Thread scope through `getContractStats`**

Change the signature:

```ts
export async function getContractStats(
  input: { facilityScope?: FacilityScope } = {},
): Promise<ContractStats> {
  const { facility } = await requireFacility()
  const scope = input.facilityScope ?? "this"
  const where = facilityScopeClause(scope, facility.id)

  const [totalContracts, aggregates] = await Promise.all([
    prisma.contract.count({ where }),
    prisma.contract.aggregate({ where, _sum: { totalValue: true, annualValue: true } }),
  ])

  // Rebate aggregate — keep the payPeriodEnd <= today gate; optionally
  // scope facilityId for "this" and "shared" modes. "all" leaves it open.
  const rebateWhere =
    scope === "all"
      ? { payPeriodEnd: { lte: new Date() } }
      : { facilityId: facility.id, payPeriodEnd: { lte: new Date() } }
  const rebateAgg = await prisma.rebate.aggregate({
    where: rebateWhere,
    _sum: { rebateEarned: true },
  })

  return {
    totalContracts,
    totalValue: Number(aggregates._sum.totalValue ?? 0),
    totalRebates: Number(rebateAgg._sum.rebateEarned ?? 0),
  }
}
```

- [ ] **Step 5: Update the hook**

In `hooks/use-contracts.ts`, change `useContractStats` to accept scope and include it in the query key:

```ts
export function useContractStats(scope: FacilityScope = "this") {
  return useQuery({
    queryKey: queryKeys.contracts.stats({ facilityScope: scope }),
    queryFn: () => getContractStats({ facilityScope: scope }),
  })
}
```

Update `queryKeys.contracts.stats` in `lib/query-keys.ts` to accept an object (or just add the scope to the key). If the key shape is rigid, add a new sibling key like `statsScoped` and migrate callers.

- [ ] **Step 6: Thread into list client**

In `components/contracts/contracts-list-client.tsx`, wherever `useContractStats()` is called, pass the current `facilityScope` state.

- [ ] **Step 7: Run test, tsc, commit**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/__tests__/get-contract-stats-scope.test.ts
bunx tsc --noEmit
git add lib/actions/contracts.ts hooks/use-contracts.ts components/contracts/contracts-list-client.tsx lib/query-keys.ts lib/actions/__tests__/get-contract-stats-scope.test.ts
git commit -m "fix(contracts-list): getContractStats honors facilityScope"
```

---

## Task 3: metricsBatch scope-safe aggregates (list-2 + list-3)

**Files:** `lib/actions/contracts.ts::getContractMetricsBatch` + `lib/actions/__tests__/contract-metrics-batch.test.ts`

- [ ] **Step 1: Add `facilityId` filter to rebate + period groupBys**

Current code (around lines 484-500):

```ts
prisma.rebate.groupBy({
  by: ["contractId"],
  where: { contractId: { in: contractIds }, payPeriodEnd: { lte: new Date() } },
  _sum: { rebateEarned: true },
}),
prisma.contractPeriod.groupBy({
  by: ["contractId"],
  where: { contractId: { in: contractIds }, periodEnd: { lte: new Date() } },
  _sum: { rebateEarned: true },
}),
```

Change both `where` clauses to add `facilityId: facility.id`.

- [ ] **Step 2: Drop the vendor-wide spend fallback**

Current code at line 521 falls back to `vendorSpend` (vendor-wide COG total) when both enrichment pass and ContractPeriod pass return 0. That inflates when a vendor has ≥2 contracts. Drop it:

```ts
// Precedence: COG enrichment (contractId) → ContractPeriod rollup.
// When neither produces a number, return 0 (never vendor-wide COG total).
const spend = enriched[c.id] ?? periodSpend[c.id] ?? 0
```

Delete the `vendorSpendAgg` query and the vendor map if they're no longer referenced.

- [ ] **Step 3: Update existing test to match**

Open `lib/actions/__tests__/contract-metrics-batch.test.ts`. Any assertion that expected `vendorSpend` fallback needs to change to expect `0`. Search for "vendor" to find them.

Add a new test asserting `facilityId` is included in the rebate + period groupBys:

```ts
it("scopes rebate aggregation by facilityId", async () => {
  await getContractMetricsBatch(["c-1"])
  const rebateCall = rebateGroupByMock.mock.calls[0][0]
  expect(rebateCall.where.facilityId).toBe("fac-1")
})
```

- [ ] **Step 4: Run tests + tsc + commit**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/__tests__/contract-metrics-batch.test.ts
bunx tsc --noEmit
git add lib/actions/contracts.ts lib/actions/__tests__/contract-metrics-batch.test.ts
git commit -m "fix(contracts-list): scope-safe metrics; drop vendor-wide spend fallback"
```

---

## Task 4: Persist `isGrouped` on create + update (new-2 + edit-10)

**Files:** `lib/actions/contracts.ts`

- [ ] **Step 1: Failing test**

Add a case to the existing `contract-actions.test.ts` (or create a small one):

```ts
it("persists isGrouped=true on createContract", async () => {
  // ...existing mock setup... pass isGrouped:true in input
  // Assert prisma.contract.create was called with data.isGrouped === true
})

it("persists isGrouped on updateContract", async () => {
  // ...similar with updateContract + isGrouped:true
})
```

- [ ] **Step 2: Implement**

In `createContract`, the Prisma `data` block (around line 541-580) maps each field. Add:

```ts
isGrouped: data.isGrouped ?? false,
```

In `updateContract` (around line 641-658), add a copy-through branch:

```ts
if (data.isGrouped !== undefined) updateData.isGrouped = data.isGrouped
```

- [ ] **Step 3: Run tests + tsc + commit**

```bash
bunx tsc --noEmit
git add lib/actions/contracts.ts lib/actions/__tests__/contract-actions.test.ts
git commit -m "fix(contracts): persist isGrouped on create + update"
```

---

## Task 5: Edit page's Save loop persists term edits (edit-1)

**Files:** `components/contracts/edit-contract-client.tsx`

- [ ] **Step 1: Inspect the Save loop**

Around lines 99-135 per QA report. Current shape:

```tsx
for (const term of terms) {
  if (term.id) {
    await upsertContractTiers(term.id, term.tiers)
  } else {
    await createContractTerm({ ...term, contractId: contract.id })
  }
}
```

- [ ] **Step 2: Add updateContractTerm call for existing terms**

Change to:

```tsx
import { updateContractTerm, createContractTerm, upsertContractTiers } from "@/lib/actions/contract-terms"

for (const term of terms) {
  if (term.id) {
    // Persist term-level edits in addition to tier changes.
    await updateContractTerm(term.id, {
      termName: term.termName,
      termType: term.termType,
      baselineType: term.baselineType,
      evaluationPeriod: term.evaluationPeriod,
      paymentTiming: term.paymentTiming,
      appliesTo: term.appliesTo,
      rebateMethod: term.rebateMethod,
      effectiveStart: term.effectiveStart,
      effectiveEnd: term.effectiveEnd,
      volumeType: term.volumeType,
      spendBaseline: term.spendBaseline,
      volumeBaseline: term.volumeBaseline,
      growthBaselinePercent: term.growthBaselinePercent,
      desiredMarketShare: term.desiredMarketShare,
      scopedCategoryId: term.scopedCategoryId,
      scopedCategoryIds: term.scopedCategoryIds,
      scopedItemNumbers: term.scopedItemNumbers,
      capitalCost: term.capitalCost,
      interestRate: term.interestRate,
      termMonths: term.termMonths,
    })
    await upsertContractTiers(term.id, term.tiers)
  } else {
    await createContractTerm({ ...term, contractId: contract.id })
  }
}
```

Verify `updateContractTerm` is exported from `lib/actions/contract-terms.ts` (it should be — it existed before Task 2 fixed it).

- [ ] **Step 3: tsc + commit**

```bash
bunx tsc --noEmit
git add components/contracts/edit-contract-client.tsx
git commit -m "fix(contract-edit): Save loop calls updateContractTerm for existing terms"
```

---

## Task 6: Score page renders rule-based + benchmark even when AI fails (score-2)

**Files:** `components/facility/contracts/contract-score-client.tsx`

- [ ] **Step 1: Find the early-return error branch**

Around line 404 per QA report — `if (error || !aiScore || !dimensions) { return <FullPageError /> }`.

- [ ] **Step 2: Localize the error to the AI section**

Replace the early return with a scoped banner:

```tsx
// Rule-based radar + benchmark + margin card are server-computed props;
// they should render even when the AI call fails.
const aiFailed = !!error || !aiScore || !dimensions

return (
  <div className="space-y-6">
    {/* AI overall-score section — show error banner here, not whole page */}
    {aiFailed ? (
      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle>AI Scoring Unavailable</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The AI scoring service is temporarily unavailable. The rule-based
            dimensions below are still accurate.
          </p>
        </CardContent>
      </Card>
    ) : (
      <AiOverallScoreCard aiScore={aiScore} dimensions={dimensions} />
    )}

    {/* Rule-based radar + benchmark — always rendered */}
    {ruleBasedComponents && (
      <ContractScoreRadar components={ruleBasedComponents} benchmark={benchmark} />
    )}

    {/* Contract margin card + KPI tabs — always rendered */}
    <ContractMarginCard contractId={contractId} />
    {/* ...existing tabs... */}
  </div>
)
```

The exact JSX depends on what the current AI section and tabs look like. The principle: pull the AI UI into its own block with a local error fallback; render the rule-based + margin + tabs unconditionally.

- [ ] **Step 3: tsc + commit**

```bash
bunx tsc --noEmit
git add components/facility/contracts/contract-score-client.tsx
git commit -m "fix(score): render rule-based radar + margin when AI fails"
```

---

## Task 7: Tie-in empty state when no terms (detail-7)

**Files:** `components/contracts/contract-detail-client.tsx`

- [ ] **Step 1: Find the tie-in card guard**

Around line 475 per QA report: `{contract.contractType === "tie_in" && contract.terms[0] && (...)`

- [ ] **Step 2: Add an empty-state branch**

```tsx
{contract.contractType === "tie_in" && (
  <Card>
    <CardHeader>
      <CardTitle>Tie-In Capital</CardTitle>
    </CardHeader>
    <CardContent>
      {contract.terms[0] ? (
        <div className="grid gap-4 sm:grid-cols-3 text-sm">
          {/* ...existing capitalCost / interestRate / termMonths display... */}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            This tie-in contract has no terms yet. Add a term to capture
            the capital cost, interest rate, and payoff schedule.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/contracts/${contract.id}/terms`}>
              Add Terms
            </Link>
          </Button>
        </div>
      )}
    </CardContent>
  </Card>
)}
```

- [ ] **Step 3: tsc + commit**

```bash
bunx tsc --noEmit
git add components/contracts/contract-detail-client.tsx
git commit -m "fix(contract-detail): tie-in empty state when contract has no terms"
```

---

## Task 8: Cross-contract spend contamination (detail-9)

**Files:**
- `lib/actions/contracts.ts::getContract` (around line 332-338)
- `lib/actions/contracts/performance-history.ts:21-28`
- `lib/actions/contracts/off-contract-spend.ts:26-54`

- [ ] **Step 1: Check whether COGRecord has a `contractId` FK**

```bash
grep -n "contractId" prisma/schema.prisma | grep -i "cogrecord\|model CoG"
```

Confirm the column exists (it's referenced as the enrichment target throughout — per `lib/cog/match.ts`).

- [ ] **Step 2: Add the contractId filter where available**

In each of the 3 sites, add `contractId: contract.id` to the COGRecord `where` clause — keep the existing `facilityId + vendorId` filter as the fallback scope for records that haven't been enriched yet (pre-enrichment, their contractId is null).

**`getContract` currentSpend:**

```ts
const cogAgg = await prisma.cOGRecord.aggregate({
  where: {
    facilityId: facility.id,
    OR: [
      { contractId: contract.id },
      { contractId: null, vendorId: contract.vendorId },
    ],
  },
  _sum: { extendedPrice: true },
})
```

**Same pattern for `performance-history.ts` and `off-contract-spend.ts`.**

This preserves pre-enrichment behavior (un-enriched rows still count toward the vendor's contract) while stopping cross-contract leakage once enrichment runs.

- [ ] **Step 3: Extend tests**

Add a case to `lib/actions/contracts/__tests__/off-contract-spend.test.ts`: seed COG rows with a different `contractId` for the same vendor; assert they're excluded.

- [ ] **Step 4: tsc + commit**

```bash
bunx tsc --noEmit
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' lib/actions/contracts/__tests__/off-contract-spend.test.ts
git add lib/actions/contracts.ts lib/actions/contracts/performance-history.ts lib/actions/contracts/off-contract-spend.ts lib/actions/contracts/__tests__/off-contract-spend.test.ts
git commit -m "fix(contracts): filter COG by contractId when enriched (no more vendor leakage)"
```

---

## Task 9: Smoke + finalize

- [ ] **Step 1: Full unit suite**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' 2>&1 | tail -5
```

- [ ] **Step 2: tsc**

```bash
bunx tsc --noEmit 2>&1 | tail -3
```

- [ ] **Step 3: Push (per-task already pushed)**

---

## Self-Review

| QA bug | Task | Severity |
|---|---|---|
| detail-1 | Task 1 | P1 |
| detail-2 | Task 1 | P1 |
| list-1 | Task 2 | P1 |
| list-2 | Task 3 | P1 |
| list-3 | Task 3 | P1 |
| new-2 | Task 4 | P1 |
| edit-10 | Task 4 | P2 (bundled since same file) |
| edit-1 | Task 5 | P1 |
| score-2 | Task 6 | P1 |
| detail-7 | Task 7 | P1 |
| detail-9 | Task 8 | P1 |

**Type consistency:** `FacilityScope` type defined once in Task 2 + used by Task 3's metrics-batch. `facilityScopeClause` helper extracted in Task 2 can be reused elsewhere.

**Placeholder scan:** each step has runnable code + runnable command. No TBDs. Task 6 specifies the JSX shape in prose with a concrete skeleton — subagent must read the current file to match the real imports.

**Scope:** Tasks 1, 4, 7 all touch `contract-detail-client.tsx` — dispatch sequentially (or one subagent handles the 3 small edits).
