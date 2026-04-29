# 2026-04-28 — Charles iMessage bug triage

Six bugs from Charles's 8:03 PM message thread on 2026-04-28. Two
shipped, four need DB-side reproduction or product clarification.

## Status

| # | Bug | Status | Commit |
|---|---|---|---|
| 1 | "will not allow XLS files to be loaded" | ✅ shipped | `5eb9786` |
| 2 | Red error overlay on contract create + COG import | 🔍 needs digest | — |
| 3 | "I had to get rid of a couple tiers it did not like them" | 🔍 needs repro | — |
| 4 | "rebate is quarterly but tier being capture is monthly" | ✅ shipped | `5eb9786` |
| 5 | "dashboard categories only for the first contract" | 🔍 data flow | — |
| 6 | "only Spend rebate is working, the rest do not" | 🔴 needs DB | — |

## Shipped

### Bug 1 — XLS upload (5eb9786)

**Root cause.** `app/api/parse-file/route.ts:40` uses ExcelJS's
`workbook.xlsx.load()`, which only handles .xlsx (zip-based). Legacy
.xls (BIFF binary) throws "Can't find end of central directory" — the
catch block reinterprets that as "not a valid xlsx," but the UI's
accept lists advertise `.xls` support.

**Fix.** Detect `.xls` extension explicitly, return actionable message:
"Legacy .xls workbooks are not supported. Open the file and save as
.xlsx (or export as .csv)." Did NOT remove `.xls` from UI accept lists
— users on macOS sometimes have `.xls` files that are actually .xlsx
under the hood, and dropping the option entirely would block those.

**Real .xls support** would require adding the `xlsx` (sheetjs) library
or `node-xlsx`. Deferred — sheetjs has license complexity and most
modern files are .xlsx anyway.

### Bug 4 — Tier-capture cadence (5eb9786)

**Root cause.** `components/contracts/tabs/_performance-summary.tsx`
hardcoded "Monthly spend on this contract" subtitle AND iterated
`periods` (always monthly from `getContractPeriods`'s synthetic
fallback) for the Tier Achievement panel, regardless of the term's
`evaluationPeriod`. A quarterly term with $86K/mo would render every
month as "N/A" because each month falls below a $50K-but-quarterly tier
even though the quarter total ($258K) clearly hits.

**Fix.** Pass `evaluationPeriod` through from the contract; roll up the
synthetic monthly period rows into evaluation-period buckets when the
term is quarterly/semi/annual. Tier Achievement shows correct cadence;
Spend by Period subtitle clarifies.

**NOT fixed.** The synthetic-periods generator in
`lib/actions/contract-periods.ts:131-148` still produces monthly
buckets regardless of `evaluationPeriod`. Roll-up at display time was
the conservative move — a deeper fix in the generator changes a function
shared with persisted-period paths that may break invariants. Defer.

## Outstanding

### Bug 2 — Red server-component error overlay

**Symptom.** "An error occurred in the Server Components render. The
specific message is omitted in production builds…" appears in the
import dialog AND on contract create.

**What we need.** The error digest from the Vercel/Next logs (search
`X-Vercel-Id` matching the request, or grep server logs for the
digest hash shown in the overlay).

**Likely culprits.**
- One of the new computed-field actions (`refreshContractMetrics`,
  `getFacilityCategorySpend`) may throw on a contract with a missing
  vendor or unexpected null value.
- AI-action error path rule (CLAUDE.md "AI-action error path") says
  every Anthropic API caller must `console.error` with context. Some
  paths may still be missing this.

**Suggested next step.** Reproduce locally against a copy of Charles's
DB; identify the digest; trace the throwing action.

### Bug 3 — "had to get rid of a couple tiers"

**Symptom.** Some tiers were rejected on contract save.

**What we need.** Charles's tier configuration (rebateType,
rebateValue, spendMin, spendMax) for the rejected tiers.

**Likely culprits.**
- `lib/validators/contracts.ts` tier validation now refuses certain
  combinations (e.g., `fixed_rebate_per_unit` with no spendMax,
  growth-baseline tiers without `baselineType`).
- The `derive-from-cog` AI extractor may emit tiers with field shapes
  the validator rejects.

**Suggested next step.** Capture the failing tier shape (browser
DevTools → Network → save POST payload). Inspect against
`createContractBase` in `lib/validators/contracts.ts`.

### Bug 5 — Dashboard categories only show first contract

**Symptom.** "On the dashboard categories coming up are only fir the
first contract I entered the rest are not coming up after entering two
more."

**Root cause hypothesis.** `getFacilityCategorySpend` reads
`cOGRecord` rows for the facility in the trailing-12mo window. If
Charles created 3 contracts but only imported COG for the first one,
only the first contract's category appears — that's working as
designed.

**Alternative hypothesis.** `cog-import` sets `category` via
`resolveCategoryNamesBulk` (which uses canonical-name resolver from
recent COG-import work). If the resolver returns null on certain
inputs, those rows have `category=null` and aggregate into
`uncategorizedSpend` rather than showing as a category row.

**Suggested next step.** SQL: `SELECT category, COUNT(*),
SUM(extendedPrice) FROM "COGRecord" WHERE "facilityId" = '<charles>'
AND "transactionDate" > NOW() - INTERVAL '12 months' GROUP BY 1`. If
many rows are `category=null`, the canonical resolver is failing
silently. If categories are sparse, it's a data-coverage issue (Charles
only imported COG for one contract).

### Bug 6 — Only Spend rebate is working (Charles flagged biggest)

**Symptom.** Non-spend term types (market_share, growth_rebate,
compliance_rebate, etc.) produce $0 earned rebates even when the
contract should qualify.

**What we know about the recompute path** (`lib/actions/contracts/recompute-accrual.ts`):
- `spend_rebate`, `growth_rebate`, `tie_in_capital` → spend writer
  (default path)
- `volume_rebate`, `rebate_per_use`, `capitated_pricing_rebate` →
  volume engine
- `carve_out` → carve dispatcher
- `po_rebate` → PO engine
- `payment_rebate` → invoice engine
- `compliance_rebate`, `market_share` → threshold engine
- `price_reduction`, `market_share_price_reduction`,
  `capitated_price_reduction`, `locked_pricing`, `fixed_fee` →
  **NOT WIRED** (no engine consumes these for the Rebate ledger)

**Hypothesis A (MOST LIKELY).** The threshold engine for `market_share`
runs `recomputeThresholdAccrualForTerm`, which short-circuits to
`{ inserted: 0, sumEarned: 0 }` when `metricValue == null` (line 128
of `lib/contracts/recompute/threshold.ts`). Charles's
`Contract.currentMarketShare` is null because the form input was
removed in Plan #1's transition (computed-only fields). The dynamic
derivation at `recompute-accrual.ts:861` uses
`computeCategoryMarketShare` over the trailing-12mo COG, but if the
contract's vendor has no COG yet, the derivation returns null too.

**Hypothesis B.** `growth_rebate` runs through the spend writer but
requires `spendBaseline` to be set; without it, `evaluate on full
spend` (`accrual.ts:339-345`). If Charles set `baselineType` but
forgot `spendBaseline`, the math may degenerate to 0.

**Hypothesis C.** Term has `effectiveStart` in the future or
`effectiveEnd` in the past; engine emits 0 buckets.

**Suggested next step.**
1. SQL: `SELECT id, "termType", "evaluationPeriod", "spendBaseline",
   "baselineType", "effectiveStart", "effectiveEnd" FROM
   "ContractTerm" WHERE "contractId" = '<charles_contract>'`.
2. SQL: `SELECT id, "currentMarketShare", "complianceRate" FROM
   "Contract" WHERE id = '<charles_contract>'`.
3. SQL: `SELECT COUNT(*), SUM("rebateEarned") FROM "Rebate" WHERE
   "contractId" = '<charles_contract>' AND notes LIKE
   '[auto-threshold-accrual]%'`.

If hypothesis A confirms, the proper fix is to make
`refreshContractMetrics` a hard-prerequisite of the recompute pipeline
(currently it runs after recompute, not before — so the first
recompute on a fresh contract reads `currentMarketShare = null`, no
rebates emit, then refresh updates the field, then NO ONE runs
recompute again).

## Two-line summary for Charles

> Pushed fixes for the .xls upload error and the quarterly-vs-monthly
> tier display (cherry-picked to main as `5eb9786`). The other four
> need either your DB / digest or a quick clarification — see the spec
> at `docs/superpowers/specs/2026-04-28-charles-iMessage-bugs.md`.
