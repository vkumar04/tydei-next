# Market-Share Rebate Bug Bash — 2026-06-08

Source: `~/Desktop/bugs 1.14.12 PM.rtfd` (6 bugs + 11 screenshots). All
six center on `market_share` (the "Market Share Spend" term type). The
root cause is a single architectural seam: **`market_share` terms store a
market-share PERCENT (0–100) in `ContractTier.spendMin` and pay a flat /
percent-of-category-spend payout when the contract's market share crosses
that threshold — but two surfaces treat those tiers as if `spendMin` were
DOLLARS of spend.**

## Background: how `market_share` is supposed to work

- `ContractTier.spendMin` = the market-share % threshold (0–100).
- Payout = `rebateValue` (flat $ for `fixed_rebate`, or % of in-scope
  category spend for `percent_of_spend`).
- The qualifying metric is `Contract.currentMarketShare`
  (`pickThresholdMetric` → `currentMarketShare`), evaluated by
  `recomputeThresholdAccrualForTerm` (the real accrual path) and by the
  per-category card (`computeCategoryMarketShare`).

## The six bugs → root causes

1. **"numbers on contract and contract totals are very off"** and
6. **"says the 100% rebate is paid but the highest share is 98.5%"**
   Both are the **Rebate utilization** card. `getContractPerformance`
   (`lib/actions/contracts/performance-read.ts`) feeds the `market_share`
   term's tiers + dollar `actualSpend` into `calculateRebateUtilization`
   → `calculateCumulative`. Dollar spend ($96K–$20M) is compared against
   the % thresholds (0/60/100), so spend always dwarfs the top threshold
   → the engine "achieves" the top tier and projects either the flat $30
   (→ "100% utilization, top tier achieved" even though true share is
   98.5%) or `10% × $20.9M = $2,094,670`. The card is meaningless for
   threshold/unit term types.

2. **"needs 0% to get a rebate and nothing is coming up"**
   `recomputeThresholdAccrualForTerm` early-returns `{inserted:0}` when
   `metricValue == null`. For `market_share` the metric is often null
   (no `currentMarketShare`, derivation finds no categorized COG), so a
   tier whose threshold is `0%` never pays — even though `0%+` means
   "always qualifies."

3. **"hit a particular % → get a particular rebate; this is just showing
   a dollar amount"**
   The form (`contract-terms-entry.tsx`) defaults `market_share` tiers to
   `fixed_rebate` (`createEmptyTier` → `flatPayoutTermTypes`), and added
   tiers are blank `fixed_rebate`, so a user who wants a %-of-spend
   market-share rebate gets flat dollars on tiers 2+.

4. **"when market share is selected, categories need to be chosen"**
   Switching the term type to `market_share` leaves `appliesTo` at
   `all_products`. Market share is inherently per-category.

5. **"I selected categories that were mapped differently"**
   `computeContractMetrics` (`derived-metrics.ts`) filters the
   market-share scope with `scopeSet.has(row.category)` on RAW names. The
   term scope ("Joints-Ortho") never equals the COG display name
   ("Ortho-Joints") even though `computeCategoryMarketShare` canonicalizes
   internally — so those categories silently contribute 0 to
   `currentMarketShare`. It also never passes the confirmed
   `CategoryMapping`.

## Fixes

1. **`lib/contracts/tier-metric.ts`** — add
   `isSpendDollarThresholdTermType(termType)` (true for every type whose
   `pickThresholdMetric` falls to the `currentSpend` branch; false for
   `market_share`, `compliance_rebate`, and the count/unit types). Single
   source so the utilization card and future surfaces agree.

2. **`lib/actions/contracts/performance-read.ts`** — restrict the
   `effectiveTerm` candidates to `isSpendDollarThresholdTermType`. If no
   spend-dollar term exists, `utilization` is `null` (tile hidden). Kills
   bugs 1 & 6. The per-category market-share tiles already show the real
   77.4% / 98.5%.

3. **`lib/contracts/recompute/threshold.ts`** — when
   `input.metric === "currentMarketShare"` and `metricValue == null`,
   treat it as `0` (so a `0%`-threshold tier qualifies). `complianceRate`
   keeps null→no-rows (compliance genuinely untracked). The existing
   `periodPayment <= 0` guard still suppresses $0 fleets. Fixes bug 2.

4. **`lib/actions/contracts/derived-metrics.ts`** — compare the
   market-share scope by `canonicalizeCategoryName` (and accept the
   confirmed `CategoryMapping` via `loadConfirmedCategoryMap`) so term
   categories reconcile with COG categories. Fixes bug 5's data impact on
   `currentMarketShare`.

5. **`components/contracts/contract-terms-entry.tsx`**
   - `createEmptyTier`: drop `market_share` from `flatPayoutTermTypes` so
     new market-share tiers default to `percent_of_spend` (matching "hit
     X% → earn Y%"). `market_share_price_reduction` is pricing-only and
     unaffected.
   - Add-tier inherits the previous tier's `rebateType` so a term can't
     silently mix % and $ tiers. Fixes bug 3.
   - Switching the term type to `market_share` defaults `appliesTo` to
     `specific_category` when it was `all_products`. Fixes bug 4.

## Tests

- `tier-metric.test.ts`: `isSpendDollarThresholdTermType` truth table.
- `performance-read` / utilization: a `market_share`-only contract yields
  `utilization: null`; a contract with both a `market_share` and a
  `spend_rebate` term computes utilization from the spend term.
- `recompute-threshold-accrual.test.ts`: market_share + null metric +
  0-threshold tier → pays; compliance + null → still no rows.
- `derived-metrics`/market-share-filter: scope reconciliation via
  canonical names.
- form: createEmptyTier default + add-tier inheritance (unit-level).

## Out of scope / data-blocked

The exact `$1,572,589` earned and `$7.4M` off-catalog figures depend on
the user's imported COG transactions (not in the seed DB). The fixes
above remove the structural type-confusion; verifying the precise dollar
deltas needs their COG export.
