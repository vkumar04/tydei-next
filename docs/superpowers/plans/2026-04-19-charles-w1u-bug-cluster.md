# Charles W1.U — Multi-Bug Cluster Plan

**Date:** 2026-04-19
**Scope:** 8 bugs reported live after the W1.T shipping wave.

## Cluster A — Category-scoped terms don't filter COG

**Bugs:** #5 duplicate rows, #6 nothing on contract, #7 spend/outstanding blank, #8 category-rebate computes $0.

**Root cause:** `recomputeAccrualForContract`, `getAccrualTimeline`, and `contracts-list.ts` trailing-12mo cascade all query `cOGRecord` by `vendorId` only. `ContractTerm.categories: string[]` exists but is ignored. For category-scoped terms, the engine receives the vendor's entire spend, not the category's slice.

**Fix:**
- Add a pure helper `lib/contracts/cog-category-filter.ts` with `buildCategoryWhereClause(term)` that returns `{ category: { in: term.categories } }` when `term.categories.length > 0`, else `{}`.
- Apply in `lib/actions/contracts/recompute-accrual.ts` (the COG `findMany`), `lib/actions/contracts/accrual.ts` (`getAccrualTimeline`), `lib/actions/contracts-list.ts` (trailing-12mo cascade).
- For multi-term contracts with different category scopes: the current `buildMultiTermMonthlyAccruals` combines term math; we now need to feed each term its own category-filtered spend series. Either refactor to pass a per-term spend series, or query COG once per unique category set per contract.
- Tests: regression case with a term scoped to `["Extremities & Trauma"]`, COG rows across 3 categories, assert earned math uses only the scoped slice.

## Cluster B — Earned card ↔ ledger reconciliation

**Bug:** #4 header shows `$1,121` but ledger shows thousands.

**Root cause:** Two reducers. Header uses YTD filter; ledger sums lifetime. Same drift hazard W1.R fixed for Collected.

**Fix:**
- New helper `lib/contracts/rebate-earned-filter.ts` with:
  - `sumEarnedRebatesLifetime(rows)` — sums all Rebate rows with `payPeriodEnd <= today`.
  - `sumEarnedRebatesYTD(rows, today)` — same plus `payPeriodEnd >= Jan 1 of today's year`.
- Route `getContract.rebateEarnedYTD`, contracts-list earned aggregate, and the Transactions tab summary card through these helpers.
- Clarify the header card label: "Earned (YTD)" with tooltip "Lifetime earned in the Transactions tab".
- Tests: 3 cases — all rows in current year, some in prior years, some future-dated.

## Cluster C — Stale server actions + "Could not derive from COG"

**Bugs:** #1 Server Action 40529… not found. #2 "Could not derive total from COG" toast.

**Hypothesis:** Both are client-bundle-vs-server action-hash drift after W1.T renamed/removed actions. `deriveContractTotalFromCOG` still exists and returns zeros harmlessly when COG is empty — so the toast firing means the server action call itself throws, likely because the client bundle references a hash the server no longer advertises.

**Fix:**
- Kill existing `bun run dev` instance.
- `rm -rf .next`
- Restart `bun run dev`.
- Reproduce: open edit contract page, click "Suggest from COG" (if still available), confirm no toast.
- If issue persists, grep for any removed/renamed server actions in today's commit range (`git log 393b198..HEAD`); confirm every `"use server"` export name is unchanged or re-exported.
- Tests: N/A — this is a build-artifact issue.

## Cluster D — Renewal Brief Wave 2 AI runtime error

**Bug:** #3 "Failed to generate renewal brief. An error occurred in the Server Components render."

**Hypothesis:** Error digest is stripped in prod; need the actual exception. Possibilities: Zod validation fails on an empty field, the prompt exceeds max context, `contract.terms[0]` is undefined for contracts with no terms, or a Prisma relation missing post-W1.T refactor.

**Fix:**
- Open `lib/actions/contracts/renewal-brief.ts`; add a temporary `try/catch` that logs the real exception with `console.error('[renewal-brief]', err)`.
- Run dev server with the error surfaced. Trigger against the contract Charles tested ("Preferred Supplier-Provider Rebate Agreement", 5 days from expiration).
- Fix root cause:
  - If it's a missing/null field, add defaults in the `RenewalBriefInput` builder.
  - If it's a Zod mismatch, tighten the schema or coerce.
  - If it's an AI-SDK issue (model not available, context too large), fall back to a shorter prompt.
- Remove temp logging, commit fix.
- Test: manual smoke on the contract + a cache-hit test.

## Verification (post-all-clusters)

- `bunx tsc --noEmit` → 0 errors.
- `bunx vitest run --exclude '**/.claude/**'` → all green.
- Live smoke on the contract Charles tested: category rebate computes, earned card = ledger, no console errors, renewal brief renders.

## Commit map

One commit per cluster:
1. `fix(accrual): filter COG by term categories (Charles W1.U-A)`
2. `fix(rebates): canonicalize Earned reducer — header + ledger agree (Charles W1.U-B)`
3. `fix(build): clear stale action manifest (Charles W1.U-C)` OR no-code if just dev restart
4. `fix(ai): renewal brief error path + missing-data defaults (Charles W1.U-D)`
