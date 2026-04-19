# Charles Feedback Round 4 — Investigate + Fix

> **For agentic workers:** Each task is investigate-and-fix. Repro the bug
> first (rule out stale build / cache), then fix or report "already
> resolved." Dispatch 4 parallel subagents in isolated worktrees.

**Goal:** Fix the 4 items Charles flagged after the R3 round shipped. Live
DB state has real data (28 Rebate rows, 72 ContractPeriod rows, ~$1.73M
spend, ~$337K earned for the demo facility) so these are all UI-reads-
wrong-source bugs, not missing data.

---

## Subagent rubric (every task)

1. Reproduce the bug on the live `bun run dev` server (port 3000).
2. Log in as `demo-facility@tydei.com / demo-facility-2024` (cookie jar OK
   at `/tmp/c.txt`). Demo facility ID: `cmo4sbr8p0004wthl91ubwfwb`.
3. If it doesn't reproduce → report `NOT_REPRODUCED` with which commit
   likely fixed it, stop.
4. Read relevant source, find root cause, implement the minimal fix.
   Write a regression test if server-side.
5. `bunx tsc --noEmit` → 0 errors before commit.
6. Commit with `fix(<area>): ...`. Don't push.
7. Report branch + SHA + files + brief root-cause explanation.

Ground-truth query to compare against — run via `bun --env-file=.env -e`:

```js
import{prisma}from"/Users/vickkumar/code/tydei-next/lib/db"
const fid="cmo4sbr8p0004wthl91ubwfwb"
// Rebate rows: 28 | Rebate.rebateEarned past sum: 325742.63
// Rebate.rebateCollected where collectionDate!=null: 9711.29
// ContractPeriod rows: 72 | totalSpend sum: 1730391.58 | earned: 337884.19 | collected: 268409.70
```

---

## Tasks

### Task 1 (R4.1) — "Rebate calculation method" label is unclear

Charles: "Rebate calculation method? not sure what those mean, are those
the baseline calculations we spoke about?" + self-answer: "Dollar 1 is
when it is rebated from below baseline and every dollar above as well.
Growth is when it is only rebated above baseline only."

- **Symptom:** The "Rebate calculation method" select offers two options
  (stored as `cumulative` / `marginal`) but the displayed labels don't
  tell a user what they mean. Charles is asking what to pick.
- **Semantic mapping (Charles's words):**
  - `cumulative` = "Dollar 1" — rebate applies from the first dollar once
    the tier is met (below baseline AND above)
  - `marginal` = "Growth" — rebate only applies to dollars above the
    baseline threshold
- **Scope:** The select lives in `components/contracts/contract-terms-entry.tsx`
  and is read by `contract-terms-page-client.tsx`. Also display-side in
  `contract-terms-display.tsx`. Check also `new-contract-client.tsx` +
  `edit-contract-client.tsx` if they render this select directly.
- **Fix sketch:**
  1. Rename the visible option labels to `Dollar 1 (Cumulative)` and
     `Growth (Marginal)` — keep the enum values as `cumulative` /
     `marginal` so no DB / API change.
  2. Add a small `HelpCircle` icon next to the field label with a
     tooltip: "Dollar 1: rebate applies from the first dollar once the
     tier is met. Growth: rebate applies only to dollars above the
     baseline."
  3. On `contract-terms-display.tsx` (read-only), show the same
     user-friendly label.
- **Files to touch:** ≤3 (the select + display + maybe a shared label
  map).

### Task 2 (R4.2) — "Spend is not populating"

Charles: "Spend is not populating."

- **Symptom:** On some contract view (likely detail page or a card on
  it), a "Spend" field reads 0 or blank. Real DB has $1.73M spend in
  ContractPeriod rows across this facility's contracts.
- **Likely cause:** A card/component is reading `Contract.currentSpend`
  (which does NOT exist as a persisted column on the Contract model —
  verified) instead of summing `ContractPeriod.totalSpend` or an
  aggregated source. OR it's reading a derived spend computed in
  `lib/actions/contracts.ts` / `lib/actions/contracts/*.ts` but the
  aggregation filter is wrong (e.g. date-window not matching real period
  data).
- **Procedure:**
  1. Pick a single contract with non-zero periods:
     `bun --env-file=.env -e 'import{prisma}from"/Users/vickkumar/code/tydei-next/lib/db";const p=await prisma.contractPeriod.findFirst({where:{contract:{facilityId:"cmo4sbr8p0004wthl91ubwfwb"},totalSpend:{gt:0}},select:{contractId:true,totalSpend:true}});console.log(JSON.stringify(p));process.exit(0)'`
  2. Load `/dashboard/contracts/$CID` and identify WHICH "Spend" field
     is showing 0. It's probably on the summary card or Market Share
     card. Note the exact label and component.
  3. Trace where that number is computed. Look in `lib/actions/contracts.ts`
     (`getContract` / `getContractMetricsBatch`) +
     `lib/actions/contracts/*.ts`.
  4. The expected source is `ContractPeriod.totalSpend` aggregated per
     contract. If the code reads a non-existent field or wrong relation,
     fix to use `ContractPeriod.totalSpend`.
- **Constraint:** Respect the CLAUDE.md rule — spend values must come
  from explicit `ContractPeriod` rollups (or equivalent persisted source),
  not from re-deriving via tier engine.

### Task 3 (R4.3) — "Not showing any rebate earned"

Charles: "Not showing any rebate earned."

- **Symptom:** Contract detail shows rebateEarned = 0 (or blank) when
  the Rebate rows exist. Live DB aggregate: $325,742.63 of earned
  rebates for this facility when filtering `payPeriodEnd <= today`.
- **Likely cause:** One of:
  (a) The per-contract sum in `getContracts` /
      `getContractMetricsBatch` / detail-page action doesn't filter
      `payPeriodEnd <= now` per CLAUDE.md rule — either it sums too
      few rows (wrong filter) or the join from contract→rebates is
      broken.
  (b) The detail page component is reading a field that was never
      populated (e.g., `contract.rebateEarned` stale from a pre-wave
      shape).
- **Procedure:**
  1. Pick a contract that has Rebate rows:
     `bun --env-file=.env -e 'import{prisma}from"/Users/vickkumar/code/tydei-next/lib/db";const r=await prisma.rebate.findFirst({where:{contract:{facilityId:"cmo4sbr8p0004wthl91ubwfwb"}},select:{contractId:true,rebateEarned:true,payPeriodEnd:true}});console.log(JSON.stringify(r));process.exit(0)'`
  2. Load `/dashboard/contracts/$CID` and check the Rebate Earned card.
     Should show non-zero.
  3. If 0, grep the contract detail client/server for where
     `rebateEarned` is sourced and fix the aggregation per CLAUDE.md:
     `sum(Rebate.rebateEarned) where contractId=X AND payPeriodEnd<=now()`.
  4. Add a Vitest covering the aggregation if the fix is server-side.

### Task 4 (R4.4) — "I entered a rebate collect but it is not showing up"

Charles: "I entered a rebate collect but it is not showing up."

- **Symptom:** Charles used the UI to log a rebate collection
  (collectionDate + rebateCollected). After save, it doesn't appear —
  either missing from the contract's Rebates list, OR not summed into
  the Collected card.
- **Expected behavior per CLAUDE.md:** rebateCollected values on summary
  cards come from `sum(Rebate.rebateCollected) where collectionDate !=
  null`. And newly-created Rebate rows should appear in any per-contract
  rebates list.
- **Procedure:**
  1. Find the "log rebate collection" UI. Likely a dialog on the contract
     detail page or a Rebates tab. Grep for `collectionDate` +
     `Rebate.create` (or equivalent server action). Server actions likely
     in `lib/actions/rebates.ts` or `lib/actions/contracts/rebates*.ts`.
  2. Open the form, create a new Rebate row with a non-null
     `collectionDate` on an active contract. Verify in Prisma that the
     row persisted with the right fields.
  3. Re-load the contract detail. Check:
     (a) Does the row appear in any rebates list on the page?
     (b) Does the Collected card sum include it?
  4. If either is missing, root cause in the display component or
     `queryClient.invalidateQueries` not firing on the mutation's
     onSuccess.
- **Related:** If R4.3 and R4.4 share the same root cause (same
  aggregation path), consolidate the fix — note in the commit.

### Task 5 (R4.5) — "Front numbers are cut off" (chart axis labels clipped)

Charles: "Front numbers are cut off." (Screenshot shows Monthly Spend
chart on the contract detail with Y-axis labels like `$800,000` /
`$600,000` where the leading character is clipped on the left edge.)

- **Symptom:** On a contract detail chart (most likely the Monthly Spend
  area chart visible in Charles's screenshot), the left Y-axis tick
  labels are horizontally cropped — the first character (`$` or the
  leading digit) is cut off by the chart container.
- **Likely cause:** Recharts `<YAxis>` without enough left margin /
  `width` prop on the axis, or the chart's `<ResponsiveContainer>` sits
  inside a card that doesn't give the axis room. Common fix: set
  `<YAxis width={80}>` + bump the chart wrapper's `margin.left`.
- **Scope:** Grep `components/contracts/*.tsx` and
  `components/facility/contracts/*.tsx` for `Monthly Spend`, `YAxis`, and
  `AreaChart`. Likely component: `contract-monthly-spend-chart.tsx` or
  similar.
- **Fix sketch:**
  1. Pick an active contract with periods; load detail page; confirm
     the Y-axis labels are clipped.
  2. Add / bump `<YAxis width={80} tickFormatter={...}>` (or use
     `formatShortCurrency` to render `$800K` instead of `$800,000` if
     the label is genuinely too wide).
  3. Also bump `<AreaChart margin={{ left: 16 }}>` if needed.
  4. Verify on the live page.

### Task 6 (R4.6 + R4.7) — Rebate engine: monthly evaluation period + tier threshold

Charles:
- R4.6: "I made the evaluation period monthly and still no rebate calculated"
- R4.7: "I think it is forcing me to get to tier 3 before paying a rebate"

Both point at the rebate calc engine and are likely the same root
cause — the engine isn't honoring `evaluationPeriod: "monthly"` (so the
spend denominator stays at annualized amount, never hits tier 1 spendMin)
AND/OR it's skipping tiers 1 and 2 instead of starting at tier 1.

- **Scope:** `lib/contracts/rebate-method.ts`, `lib/rebates/calculate.ts`,
  `lib/rebates/engine/*.ts`, and the accrual path
  `lib/actions/contracts/accrual.ts` + `lib/contracts/accrual.ts`.
- **Likely root causes:**
  (a) `evaluationPeriod` isn't threaded through when computing spend per
      tier — the engine always uses total/annual spend instead of
      monthly slice.
  (b) `applyTiers` / `calculateRebate` returns `tierAchieved = 0` and
      `rebatePercent = 0` when spend < first-tier spendMin because the
      "highest spendMin ≤ spend" logic has an off-by-one.
- **Procedure:**
  1. Pick a contract with a term that has `evaluationPeriod: "monthly"`:
     ```
     bun --env-file=.env -e 'import{prisma}from"/Users/vickkumar/code/tydei-next/lib/db";const t=await prisma.contractTerm.findFirst({where:{contract:{facilityId:"cmo4sbr8p0004wthl91ubwfwb"},evaluationPeriod:"monthly"},include:{tiers:true,contract:{select:{id:true,name:true}}}});console.log(JSON.stringify(t,null,2));process.exit(0)'
     ```
     If none exists, pick any term + set one to monthly as a test
     fixture via Prisma.
  2. Pull its Rebate + ContractPeriod rows for the last 3 months and
     compare expected rebate vs computed:
     expected = `spend_month × tier_rate` where tier_rate = tier whose
     spendMin ≤ monthly spend.
  3. Trace `lib/actions/contracts/accrual.ts::recomputeAccrual` (or
     equivalent) to see whether it passes `evaluationPeriod` into the
     engine. If it just calls `computeRebate(totalSpend, tiers)` without
     slicing by period, that's R4.6.
  4. Inspect `calculateRebate` in `lib/contracts/rebate-method.ts` — the
     cumulative branch should pick the tier whose `spendMin ≤ spend`;
     the marginal branch should pay `(bracketTop - bracketBottom) ×
     rate` per completed bracket. Check for the "must hit tier 3 first"
     bug — likely the tier lookup uses `>=` incorrectly or drops the
     first tier.
  5. Write a unit test: `describe("monthly evaluation period", ...)`
     with two tiers (0-100k=2%, 100k-200k=3%), evaluationPeriod=monthly,
     spend=50k in one month → expected rebate = 1000 (2% × 50k).
  6. Fix engine; re-run tests.
- **Constraints:**
  - Don't break existing cumulative/marginal tests in
    `lib/rebates/engine/__tests__/`.
  - Preserve the CLAUDE.md rule: rebates for display still come from
    Rebate/ContractPeriod rows; this task fixes the *computation engine*
    used during accrual recompute, not the display surface.

Commit: `fix(rebates): honor evaluationPeriod + correct tier-1 threshold (Charles R4.6/R4.7)`.

---

## Handoff

Commits land to main via cherry-pick as each subagent reports. I'll
verify end-to-end after all 4 land.
