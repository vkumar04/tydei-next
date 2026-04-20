# Charles W1.X-C — On vs Off Contract Spend: diagnostic + drilldown

**Date:** 2026-04-20
**Author:** Vick (via superpowers brainstorming)
**Reporter:** Charles (iMessage screenshots, 2026-04-20)

## Problem

On the contract detail **On vs Off Contract Spend** card, Charles sees:

- **On Contract:** $0
- **Not Priced:** $0 ("0% leakage" hint)
- **Off Contract:** $4,711,378

Charles (iMessage, 2026-04-20 11:13 AM): *"Off contract still [...] Don't
know where this is coming from?"*

The card doesn't explain which COG rows compose the $4.7M, so the user
can't self-diagnose whether this is misclassified enrichment, a stale
match run, or genuinely out-of-contract purchasing.

## Root cause (hypothesis)

`lib/actions/contracts/off-contract-spend.ts` scopes aggregates to:

```ts
scopeOR = [
  { contractId: contract.id },
  { contractId: null, vendorId: contract.vendorId },
]
```

- **$0 On Contract:** zero COG rows in that scope have `matchStatus IN
  (on_contract, price_variance)`. Likely causes: (a) the contract's
  match hasn't run, so no row is stamped `on_contract`; (b) enrichment
  misclassified rows.
- **$4.7M Off Contract:** rows in scope with `matchStatus IN (out_of_scope,
  unknown_vendor)`. Most likely un-enriched rows on the same vendor
  landed as `out_of_scope`, so they roll up into this contract's card
  even though they aren't really "leakage."

We do not know for sure without querying the demo DB. Hence the
**diagnostic-first** design.

## Approach

### Step 0 — Diagnostic (one-shot)

New script `scripts/diagnose-off-contract-spend.ts`:

- Takes a `contractId` argument (default: the demo contract whose
  screenshot was posted — `cm...whatever`; we'll paste the actual id
  before running).
- Runs the same `scopeOR` the server action uses.
- Groups COG rows by `matchStatus` and prints counts + `SUM(extendedPrice)`
  + a sample of 10 vendor items per bucket.
- Writes output to `docs/superpowers/diagnostics/2026-04-20-w1x-c-off-contract-<contractId>.md`.

The plan's **first** task is running this script and committing its
output. Subsequent tasks are gated on what the diagnostic shows.

### Step 1 — Code fix (data-gated)

If the diagnostic shows **all $4.7M is `out_of_scope` un-enriched rows
for the same vendor**, the reducer's current behavior is technically
correct but misleading — the user's mental model of "off contract" is
*"purchases from vendors outside my contracts,"* not *"same-vendor SKUs
not yet matched to this contract."* Fix:

- **Rename / re-bucket.** Move same-vendor-out-of-scope rows from the
  "Off Contract" bucket into a new **"Pre-Match"** bucket (or fold into
  "Not Priced" with a status note). Reserve "Off Contract" for
  `unknown_vendor` only — genuine different-vendor leakage.
- Update the card UI copy + tooltip to match.

If the diagnostic shows **enrichment misclassification** (rows that
SHOULD be `on_contract` but are stamped `out_of_scope`), fix the
enrichment path in `lib/cog/recompute.ts` or wherever match runs.

### Step 2 — Drilldown UX (data-independent)

`components/contracts/off-contract-spend-card.tsx`: each of the three
bucket headers (On Contract / Not Priced / Off Contract) gets a
collapsible "show rows" expand — same shape as the existing "Top
not-priced items" table, applied uniformly:

- Vendor Item / SKU
- Transaction date (most recent)
- `matchStatus` badge
- Row count + spend
- Top 10 per bucket, with "see all N" link wired to COG Data filtered
  by `contractId + matchStatus`.

Server change: `getOffContractSpend` already returns `topNotPriced` +
`topOffContract`. Add `topOnContract` (same shape, for `on_contract |
price_variance`). No new DB aggregation shape — just one more
`groupBy`.

## Tests

- `lib/actions/contracts/__tests__/off-contract-spend.test.ts`: add a
  case asserting `topOnContract` shape, and (if Step 1 re-buckets) a
  case covering the new "Pre-Match" classification.
- UI render test asserting each bucket card has a "show rows" expand
  that renders after click.

## Files

- `scripts/diagnose-off-contract-spend.ts` — new.
- `docs/superpowers/diagnostics/2026-04-20-w1x-c-off-contract-<id>.md` —
  output, committed.
- `lib/actions/contracts/off-contract-spend.ts` — add `topOnContract`,
  possibly re-bucketing per Step 1.
- `components/contracts/off-contract-spend-card.tsx` — drilldown UX.
- `lib/actions/contracts/__tests__/off-contract-spend.test.ts` — extend.

## Out of scope

- Re-running enrichment across the whole facility (operational, not a
  code change).
- A new "Match this contract's COG rows" button in the UI (could be a
  follow-up if the diagnostic reveals Charles's facility often lands in
  this state).
