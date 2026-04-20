# W1.U Retrospective — Charles's 8-Bug Cluster After a Clean Deep-Test

**Date:** 2026-04-19
**Deep-test SHA:** `08f8bc5` (claimed green)
**Fix SHAs:** `1bcb2dd` (W1.U-A category filter), `66dcb7e` (W1.U-B earned reducer)
**Still in-flight:** W1.U-C (stale Server Action), W1.U-D (Renewal Brief AI)

Blameless. The bugs were in the code long before today — today just put them
in front of a user. This doc is about the process that let them stay hidden.

---

## 1. Timeline

- **All day 2026-04-19:** Shipped ~20 commits for R5.x + W1.x + AI Waves 1 & 2
  (Tier 1 Smart Recs `70a33e6`, Tier 4 Renewal Brief `5510fd4`, tie-in capital
  refactor W1.E→W1.T, collected-rebate canonicalization W1.R `54dfa67`,
  accrual-cadence fix W1.O `b54c4d2`, etc.).
- **End of day:** Deep-test subagent at `08f8bc5` reported `tsc=0`, `lint=0/194`,
  `vitest=1831 pass / 2 skipped / 7 pre-existing parse fails`, 14 targeted Charles
  items verified with DB probes + curl. Declared green.
- **Minutes later:** Charles tested live and found 8 bugs. Four (#5/#6/#7/#8) all
  traced to one missing read-path feature — category filtering on COG for
  category-scoped `ContractTerm`s. One (#4) was a second instance of the exact
  class we had JUST fixed for Collected in W1.R. Two (#1/#2) were build-artifact
  hygiene. One (#3) was AI error-handling strip-in-prod.
- **Fixed today:** W1.U-A (`1bcb2dd`) centralized category filtering in
  `lib/contracts/cog-category-filter.ts` and applied it in
  `recomputeAccrualForContract`, `getAccrualTimeline`, and the contracts-list
  trailing-12mo cascade. W1.U-B (`66dcb7e`) introduced `sumEarnedRebatesLifetime`
  / `sumEarnedRebatesYTD` in `lib/contracts/rebate-earned-filter.ts` and routed
  both header and ledger through them.
- **Pattern observation:** the tests we had (1831 passing) were all asking the
  wrong questions.

---

## 2. Root Cause Categories

### Bucket A — Feature built for the write path, never for the read path

**Bugs:** #5 duplicate ledger rows, #6 $0 spend on contract with COG activity,
#7 blank Spend/Outstanding columns, #8 category-scoped term computes $0.

`ContractTerm.appliesTo` (`"all_products" | "specific_category"`) and
`ContractTerm.categories: string[]` have existed in the schema
(`prisma/schema.prisma:681`) since early in the project. The **edit-term UI**
accepts them; the **rebate math engine** honors them
(`lib/rebates/engine/spend-rebate.ts:58`, `lib/rebates/from-prisma.ts:132-157`
both filter by `config.categories`); the **engine unit tests** cover them
(`lib/rebates/engine/__tests__/spend-rebate.test.ts:160`,
`tier-price-reduction.test.ts:273`).

But the three Prisma read sites that feed the engine never filtered:

- `lib/actions/contracts/recompute-accrual.ts` — `prisma.cOGRecord.findMany`
  by `vendorId` only.
- `lib/actions/contracts/accrual.ts` — `getAccrualTimeline`, same shape.
- `lib/actions/contracts-list.ts` — trailing-12mo Spend cascade, same shape.

Git history confirms: no earlier commit touched category filtering in these
three files. It was never half-built — it was never started. The engine authors
correctly parameterized `categories`, but when the **display-facing callers**
were wired up (over multiple weeks and multiple Charles items), no one ever
wrote the glue. Result: engine-as-designed never saw the vendor-entire-spend
problem because its unit tests always handed it a pre-filtered series.

### Bucket B — Invariant without a canonical reducer

**Bug:** #4 Earned card $1,121 vs ledger in thousands.

CLAUDE.md explicitly encodes the invariant: "Rebates are NEVER auto-computed
for display ... Earned counts only periods where `payPeriodEnd <= today`;
collected counts only rows with a `collectionDate` set." But before W1.U-B,
each surface that needed "earned" rolled its own reducer:

- Header card: YTD filter (`payPeriodEnd` within current calendar year).
- Transactions ledger: lifetime sum.
- Contracts-list column: yet another variation.

W1.R (`54dfa67`) fixed **exactly this class of bug for Collected** by
centralizing in `sumCollectedRebatesFromRows`. The equivalent Earned
canonicalization was not done at the same time — the two share one invariant
but had four reducers.

### Bucket C — AI action with unsafe error path in prod

**Bug:** #3 Renewal Brief fails with stripped digest.

`lib/actions/contracts/renewal-brief.ts:189-208` does wrap the generation in
`try/catch` but the caught message is re-thrown inside a Server Component
render path, where Next.js strips it to a digest in prod. There is no
server-side log of the underlying error (Zod parse failure vs model vs missing
`contract.terms[0]`) — the only debugging path is edit-code-and-redeploy. A
shipped AI feature should not require a code edit to learn *why* it failed.

### Bucket D — Build/cache hygiene

**Bugs:** #1 Server Action hash `40529…` not found, #2 "Could not derive from COG"
toast.

Dev-server and Next `.next` cache can hold stale action manifests after a
file-rename-heavy day (W1.T renamed/moved tie-in functions). Recovery is
`rm -rf .next && bun run dev`. Not a code bug — a release-hygiene gap.

---

## 3. Why the Tests Didn't Catch It

Per bucket:

### A — No seed exercises `appliesTo: "specific_category"`

- `prisma/seeds/` was grepped for `appliesTo` and `categories:` in term
  definitions: only `payor-contracts.ts` uses `appliesTo` (different schema —
  CPT multi-procedure rule). Zero seeded `ContractTerm` rows set
  `appliesTo: "specific_category"`. Every demo contract falls back to the
  schema default `"all_products"` (`schema.prisma:681`).
- The test we had — `lib/actions/__tests__/multi-term-accrual.test.ts` — covers
  two-term contracts but both terms are all-products; it never sets
  `categories` on the mocked term, so the `vendorId`-only query shape is never
  exercised against a stricter expected slice.
- `accrual-date-field.test.ts` is a pure `transactionDate` vs `createdAt` test.
- `recompute-accrual-category-scope.test.ts` **now exists** (added in
  `1bcb2dd` as part of the fix) — but it was not a pre-existing regression.

**Missing test shape:** "for every value of `appliesTo`, a seed contract +
at least one contract-level integration test that asserts earned math matches
a hand-computed expected on a category-restricted spend slice".

### B — No card-vs-ledger parity test existed for Earned

- `contracts-rebate-filters.test.ts` (added for W1.R) tests Collected. There
  is no parallel test for Earned.
- `get-contract-rebate-ytd.test.ts` tests the single `rebateEarnedYTD` field in
  isolation; nothing cross-compares it against what the ledger would sum.

**Missing test shape:** a single "parity" test file that, given a fixture of
Rebate rows, asserts the header reducer and the ledger reducer produce values
that stand in the documented relationship (`lifetime >= YTD >= collected`).

### C — AI actions have no "golden failure" harness

- `rebate-optimizer-insights.test.ts` exists but tests happy-path output
  shape; no test forces an underlying throw and asserts the caller surfaces
  a *useful* message (not a digest).

**Missing test shape:** a `throwsUsefulErrorWhenInputMalformed` spec that
feeds a known-invalid contract (no terms, empty rebate history, etc.) and
asserts the error string points at a file/field, not `"Digest: ..."`.

### D — Deep-test agent didn't include "fresh build" in its checklist

- `bunx tsc --noEmit` and `bunx vitest run` both operate on source, not the
  compiled `.next` manifest. The 14 curl smokes hit endpoints but did not
  include "click Suggest-from-COG on the edit-contract page in a fresh
  browser session". Stale-manifest failures are by definition invisible to
  both tooling passes.

**Missing test shape:** one-line pre-hand-off step that nukes `.next` and
does an e2e smoke against the specific form actions touched by the day's
commit range.

### Common meta-failure

The 1831 passing tests measured **unit correctness of isolated
reducers/engines**. Charles's bugs all lived in the **seam between a
correct engine and a display-path caller that never invoked the
parameter**. Seams are not covered by unit tests.

---

## 4. Process Fixes (Actionable)

### Fix 1 — Canonical-reducer registry in CLAUDE.md

**Action:** add a section to `CLAUDE.md` titled "Canonical reducers for
CLAUDE.md-declared invariants" listing every business-level invariant and the
ONE function that enforces it. Starting set:

| Invariant | Canonical reducer | Surfaces that MUST call it |
|---|---|---|
| Earned rebate (lifetime) | `sumEarnedRebatesLifetime` in `lib/contracts/rebate-earned-filter.ts` | contracts-list, contract-detail header card, Transactions ledger, reports |
| Earned rebate (YTD) | `sumEarnedRebatesYTD` | contract-detail "Earned (YTD)" card |
| Collected rebate | `sumCollectedRebatesFromRows` in `lib/contracts/rebate-collected-filter.ts` | same list |
| COG-in-term-scope | `buildCategoryWhereClause` + `buildUnionCategoryWhereClause` in `lib/contracts/cog-category-filter.ts` | `recomputeAccrualForContract`, `getAccrualTimeline`, contracts-list trailing-12mo cascade |
| Contract ownership | `contractOwnershipWhere` / `contractsOwnedByFacility` | every read in `lib/actions/` |

**Enforcement:** on every PR that adds or changes a surface that reads rebates,
spend, or contract ownership, the reviewer verifies the surface calls the
listed reducer. Future invariants get appended as they're discovered.

### Fix 2 — Seed-scope coverage requirement

**Action:** amend `scripts/qa-sanity.ts` with invariants that assert the demo
database includes at least one contract/term in each variation of every
enum-like schema field:

- `ContractTerm.appliesTo`: at least one `"all_products"` AND at least one
  `"specific_category"` with `categories.length >= 1`.
- `ContractTerm.evaluationPeriod`: one of each (`monthly`, `quarterly`, `annual`).
- `ContractTerm.paymentCadence`: one of each.
- `ContractTerm.rebateMethod`: one of each method name.

If any is missing, qa-sanity fails and points at the exact seed file to amend.
Next step after landing this: add one `"specific_category"` term to the
Medtronic or Stryker seeded contract in `prisma/seeds/` so every developer
running `db:seed` sees a category-scoped contract on the demo facility.

### Fix 3 — Card-vs-ledger parity test template

**Action:** introduce `lib/actions/__tests__/_parity.test.ts` (or similar)
that, given a fixture of `Rebate` rows, asserts:

```
sumLifetime >= sumYTD
sumYTD >= sumCollected
headerCard(contractId) === sumYTD(rows scoped to contract)
ledgerReducer(contractId) === sumLifetime(rows scoped to contract)
contractsList.earned(contractId) === headerCard(contractId).ytd
```

One test file. Every future reducer on this invariant gets a line in this
file. If someone forks a reducer, the parity test fails.

### Fix 4 — Pre-hand-off smoke script

**Action:** add `scripts/pre-ship-smoke.ts` (invokable as `bun run smoke`)
that does the minimum a human would do before saying "ship it":

1. `rm -rf .next` and rebuild.
2. Start dev server, wait for ready.
3. Hit the 5-10 pages that use Server Actions we edited today (detected via
   `git diff main... --name-only lib/actions/`).
4. Parse HTML for a known Server Action hash pattern, confirm the hash in the
   response matches the hash in the compiled manifest.
5. Compare golden numbers across related surfaces for one seeded contract:
   - contracts-list earned column
   - contract-detail header earned card
   - contract-detail Transactions ledger earned sum
   - Must all be equal (or stand in the documented YTD-vs-lifetime relation).

The deep-test agent adds this to its checklist. If numbers disagree, it blocks
ship regardless of tsc/vitest status.

### Fix 5 — AI actions must log before they re-throw

**Action:** codify in CLAUDE.md: every `lib/actions/**/ai-*.ts` or
`renewal-brief.ts`-class action must `console.error('[<action-name>]', err, {
inputs })` immediately before any re-throw, and must surface a user-facing
message that identifies the action by name (not a digest). One-line lint rule
candidate: `grep 'Server Components render' lib/actions/**/*.ts` should return
zero non-commented hits.

---

## 5. Immediate Follow-Ups (Backlog)

Track these in the plan folder — not shipping today.

- **B1:** Audit every invariant in CLAUDE.md for canonical-reducer coverage.
  Known today: Earned, Collected, category-scope, ownership. Unknown: the
  rebate-engine-units rule (`rebateValue` fraction vs integer percent) — is
  there a single boundary helper, or is `* 100` sprinkled through the codebase?
  Grep `* 100` in `lib/contracts/` and `lib/rebates/` and either consolidate
  or document.
- **B2:** Port the Fix-2 seed-scope check into an actual seed amendment: add
  one contract per enum variation to `prisma/seeds/payor-contracts.ts` or
  `prisma/seeds/contracts.ts` (whichever seeds the demo Lighthouse Community
  contracts). At least one must have `appliesTo: "specific_category"` with
  COG rows spanning three categories and only one matching.
- **B3:** Retrofit W1.U-A integration test
  (`lib/actions/__tests__/recompute-accrual-category-scope.test.ts`) to also
  cover `getAccrualTimeline` and the contracts-list trailing-12mo cascade
  — right now the new test only covers the write path.
- **B4:** Build the Fix-4 smoke script. Wire it into the deep-test agent's
  default checklist.
- **B5:** Audit all `"use server"` files under `lib/actions/` for "throws a
  string that will be digest-stripped in prod". At least Renewal Brief is
  known affected; Smart Recs (`rebate-optimizer-insights.ts`) has similar
  Zod-parse shape and likely suffers the same.
- **B6:** Document the `rm -rf .next` recovery step in CONTRIBUTING (or
  CLAUDE.md) under a "Release hygiene after file-rename days" note, so future
  Charles-style bundle-hash bugs resolve in seconds not minutes.
- **B7:** Lint rule or CI check: every new file under
  `lib/actions/contracts/*accrual*.ts` and `lib/actions/contracts-list.ts`
  must import from `lib/contracts/cog-category-filter.ts`. Prevents the
  "engine parameter never wired" class of regression.

---

## Appendix — The one-line takeaway

> Our unit tests verified that each box in the diagram works. The bugs lived
> on the arrows between boxes. Category scope was correctly defined in the
> schema, the engine, and the edit UI — but the display-path query never set
> the parameter. Earned was correctly defined in CLAUDE.md — but no one
> reducer owned it. Next wave of tests lives on the arrows.
