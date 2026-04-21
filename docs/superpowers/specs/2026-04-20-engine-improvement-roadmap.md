# Rebate engine — improvement roadmap

**Date:** 2026-04-20
**Inputs:**
- Canonical reference engine at `/Users/vickkumar/Downloads/files/rebateEngine.ts` (1697 LOC)
- Tydei's ported engine at `lib/rebates/engine/` (2321 LOC, 106 tests green, dormant)
- Tydei's legacy engine at `lib/contracts/rebate-method.ts` (production path via `computeRebateFromPrismaTiers`)
- v0 prototype at `/Users/vickkumar/Downloads/b_kkwtOYstuRr/`
  - `lib/forecasting.ts` — linear regression + seasonal factors (good)
  - `lib/contract-definitions.ts` — user-education copy (good)
  - `lib/contract-data-store.ts` — 1152 LOC scenario store
  - `lib/contract-change-proposals-store.ts` — redline/proposal tracking
- Industry conventions (GPO admin fees, growth rebates, price escalators, HFMA rebate treatment, Vizient/Premier structures)

**Status:** Design — scopes follow-up work beyond closing Charles's current backlog.

## 1. Close the legacy/new engine fork

The biggest latent risk right now. We have two engines:
- **Legacy** (`lib/contracts/rebate-method.ts`) — cumulative + marginal. Production via `computeRebateFromPrismaTiers`. Today's session fixed below-baseline zeroing.
- **New** (`lib/rebates/engine/`) — full 8-type, tested, **dormant**. Has every audit fix.

**Action:** Migrate to the new engine via Prisma adapters (one per contract-type shape), then delete the legacy engine.

**Acceptance:** grep for `calculateCumulative`/`calculateMarginal` direct imports returns zero. `computeRebateFromPrismaTiers` becomes a thin adapter calling `lib/rebates/engine/spend-rebate.ts::calculateSpendRebate`. Same tests still green (1966 → 1966).

## 2. Projection → forecast (port v0's forecasting)

`computeProjectedRebate` (N14) is a linear extrapolation: `rolling12Spend × tierRate`. That's a point estimate with no confidence and no seasonality.

v0's `lib/forecasting.ts` has:
- `linearRegression({x,y}[]) → {slope, intercept, r2}` — r² gives you confidence.
- `calculateSeasonalFactors` — monthly multipliers; hospital spend has real quarterly seasonality (elective-surgery surges in Q1/Q4).
- Confidence intervals (low/high) on forecast data points.

**Port steps:**
1. Extract `lib/forecasting/linear-regression.ts` + `seasonal-decomposition.ts` as pure helpers.
2. New `forecastAnnualSpend(series, horizonMonths) → {pointEstimate, low, high, r2, seasonalFactors}`.
3. Feed into the rebate engine to produce `{projectedRebatePoint, projectedRebateLow, projectedRebateHigh}`.
4. UI — display projection with a confidence band instead of a single number; show r² when <0.5 so users know "this is a weak trend."

**Acceptance:** Contract detail's "projected year-end" shows a range when r² is low, a tight point when r² is high, and an "insufficient data" label when <6 months of history.

## 3. Industry-convention features not yet modeled

### 3a. GPO admin fees

Most GPO contracts pay the GPO a 3% admin fee on spend. The facility's **net rebate** is `rebateEarned − adminFee`. Tydei currently models gross rebate only.

**Shape:** `ContractTerm.adminFeePercent: Decimal` + engine output gains `adminFee` + `netRebate`.

### 3b. Price escalators (CPI-linked)

Multi-year contracts typically have annual price increases — "prices escalate by CPI-U + 2%." Tydei's `ContractPricing.unitPrice` is static. Over a 5-year contract, this understates expected spend.

**Shape:** `ContractPricing.escalatorPercent: Decimal?` (annual, optional) + `ContractPricing.escalatorBaseIndex: string?` (e.g. `"CPI-U"`). On the display/compare-card side, surface the escalator explicitly.

### 3c. Growth-on-growth

`SpendRebateConfig.growthOnly` + baseline is first-derivative growth (year-over-year). Real contracts sometimes layer a second derivative: "growth over baseline PLUS additional bonus for >10% growth." Engine needs a `growthBonusTiers` field.

### 3d. Compliance bonuses

"Base rebate 3%, +1% for EDI ordering, +0.5% for quarterly attestation." v0's `contract-definitions.ts` names `compliance_based` tier structure but no engine supports it. Add `ComplianceBonusConfig` with rules.

### 3e. Negative-spend / returns

If a purchase is returned, a negative `extendedPrice` row appears. Current engine sums blindly. Two behaviors possible:
- **Calendar-true:** negative rows deduct from spend (could drop below a tier threshold mid-period).
- **Contract-true:** return gets a separate rebate-reversal row (a negative Rebate).

Real GPO contracts usually say "returns within 30 days unwind the rebate." Model this via a configurable `returnWindowDays` + separate reversal rebates.

### 3f. Admin-fee + return audit invariants

For `net rebate`: `netRebate = gross − adminFee − returnReversals`. Add as a canonical reducer.

## 4. Probabilistic / Monte Carlo scenarios

Procurement teams ask: "What's the probability we hit Tier 2 by year-end?" Today we compute a point. A Monte Carlo layer (1000 draws from the historical spend distribution) gives:
- P(tier 1), P(tier 2), P(tier 3)
- 5th/50th/95th percentile year-end rebate
- Expected rebate (integral across all tiers)

**Scope:** pure helper `monteCarloTierQualification(history, tiers, iterations = 1000) → TierProbabilityResult`. Used by the rebate-optimizer already in tree.

## 5. Data-quality / observability gaps

### 5a. Engine version stamping

Every `Rebate` row should have `engineVersion: string`. When the engine math changes (e.g. today's below-baseline fix), old rows shouldn't be silently invalidated — they stay stamped with the old version, and a recompute produces a new row with the new version.

**Schema:** `Rebate.engineVersion String @default("v0")` + bump the version on every math-affecting commit.

### 5b. Warnings + errors channel

The new engine at `lib/rebates/engine/` returns `{warnings: string[], errors: string[]}` on every result. Currently thrown away at the Prisma adapter. Surface in UI:
- Top-of-ledger banner: "Engine warned: PRIOR_YEAR_ACTUAL baseline missing, evaluated on full eligible spend."
- Block recompute when errors[] is non-empty.

### 5c. Three-state precision

Every display surface should know if a number is:
- **Definitive** (ledger — actual Rebate row with `collectionDate`).
- **Earned-pending** (closed period, not yet collected).
- **Projected** (engine output on incomplete-period data).

Tydei today has (definitive vs earned-pending) via `sumCollectedRebates` + `sumEarnedRebatesYTD`. Projected is labeled on the tier-progress card but not on every surface. Make it a type-level distinction: `MoneyNumber = DefinitiveMoney | PendingMoney | ProjectedMoney` so the renderer can never accidentally present a projection as definitive.

## 6. Edge-case hardening

Missing test coverage:

- **Negative spend rows** — returns/credits.
- **Multi-contract-per-vendor overlap** — which contract wins when two active contracts cover the same purchase? (Closest effectiveStart, highest rebate, or oldest contract id?)
- **Prorated baselines** — contract starts Jun 1 with annual baseline $1M. First year baseline should be `1M × 7/12 = $583K`, not $1M.
- **Leap year / DST** — `new Date()` in engine paths uses UTC where needed but some helpers don't.
- **Zero-rate tiers** — tier with `rebateValue = 0` explicit (distinct from null).
- **Tier overlaps** — `spendMin = 100K` on one tier and `spendMax = 150K` on another with overlap. Current matcher scans highest-qualifying; document which wins.
- **Fractional currency** — Prisma Decimal precision; sums of many small rebates can drift by pennies. Add a reconciliation step.

## 7. UX improvements driven by the math layer

### 7a. "Explain why" panel

Every tier/rebate number on the contract detail should have a "why?" drawer:

> Tier 2 achieved — you spent **$425,000** against a tier-2 threshold of **$300,000**.
> At the tier-2 rate (**4%**), your rebate is **$17,000**.
> Tier 3 unlocks at **$500,000** — another $75,000 in spend earns you tier-3 rate (5%) retroactively, for **$25,000** rebate (+$8,000).

This is just rendering the existing `RebateResult` in human terms. Zero engine change.

### 7b. Scenario slider

Drag a slider on projected annual spend → live re-render of projected rebate + which tier. Uses existing engines, adds UI state + debounce.

### 7c. Cross-contract portfolio optimizer

Given the facility's full contract portfolio, the engine can answer: "If you shift $X from vendor A to vendor B, your net rebate changes by $Y because A's tier bracket drops and B's climbs." Already partially modeled in `components/facility/rebate-optimizer/`; needs the multi-vendor math consolidated.

### 7d. Anomaly detection

Monthly spend drop >30% or outlier CPT-price relative to contract → alert. Uses the existing `lib/alerts/` system; add a statistical layer.

## 8. Testing strategy upgrades

### 8a. Property-based (fast-check)

Invariants to fuzz:
- Rebate never exceeds spend.
- Cumulative method: rebate is monotonic in spend (within a tier).
- Marginal method: total rebate = sum of bracket rebates.
- Below-baseline: rebate is always 0.
- Period-reset rule: carrying zero-spend into a new period resets tier.

### 8b. Golden-file snapshots

Real-world contract examples (anonymized) — e.g., Stryker hip+knee tie-in, DePuy spine rebate, Medtronic capital — stored as JSON fixtures with expected outputs at known spend levels. Engine changes can't silently alter these without a review.

### 8c. Cross-surface invariant tests

Single seeded contract → assert the same number appears on:
- Contract detail header YTD card
- Contract detail Transactions tab summary
- Contracts list row
- Dashboard rebates tile
- Reports overview
- Renewals list

This generalizes the `contracts-list-vs-detail-parity.test.ts` I shipped in W1.X-D.

### 8d. E2E gate enforcement

Today `qa:workflows` is manually runnable. Wire it into CI so PRs can't merge with red workflows. Already scoped in a prior spec — just needs the GitHub Actions step.

## 9. External data integrations that multiply engine value

### 9a. CMS procedure pricing

For margin calculation (`calculateMargins`), reimbursement is pulled from `PayorContract.cptRates`. CMS publishes the Medicare Physician Fee Schedule + DRG rates quarterly. A background job could seed `PayorContract` defaults from CMS so new facilities bootstrap with realistic reimbursement benchmarks.

### 9b. ECRI / Vizient / Premier benchmark data (feed-driven)

The reference's `prospectiveAnalysis.ts` names these sources. Tydei could ingest (facility-subscribed) benchmark feeds to show "your contract price is 8% above Vizient median."

### 9c. HFMA rebate treatment

Rebates are revenue offsets under GAAP. Financial reports should classify earned rebate as "reduction of supply cost" not "other income." Small accounting nuance but relevant for CFO adoption.

### 9d. IRS § 162 treatment

Some rebates are taxable. Facility 501(c)(3) vs for-profit status changes the treatment. Surface a tax-treatment flag on the contract.

## 10. Prioritized execution order

Rough sizing / impact matrix. Each is a "W1.AA-*" subsystem (reusing the pattern):

| Rank | Item | Effort | Impact |
|---|---|---|---|
| 1 | Engine migration (legacy → new) — section 1 | 4-6 hrs | Foundation for everything below |
| 2 | Warnings surfacing + engine version stamping — 5a, 5b | 2 hrs | Trust + auditability |
| 3 | Forecasting w/ confidence — section 2 | 3-4 hrs | Closes N14 more robustly |
| 4 | GPO admin fee + net rebate — 3a, 3f | 2 hrs | Every GPO contract |
| 5 | "Explain why" drawer — 7a | 3 hrs | Procurement team trust |
| 6 | Wire carve-out engine (W1.Z-A from gap spec) | 2 hrs | Already scoped; column shipped |
| 7 | Edge-case hardening + property tests — section 6, 8a | 4 hrs | Bug prevention |
| 8 | Cross-surface invariant tests — 8c | 2 hrs | Prevents class of bug we've hit 6× |
| 9 | Monte Carlo tier-probability — section 4 | 4 hrs | Procurement "what are my chances" |
| 10 | Price escalators — 3b | 3 hrs | Multi-year contract accuracy |
| 11 | Scenario slider UI — 7b | 3 hrs | Sales / negotiation tool |
| 12 | CMS / Vizient external feed — 9a, 9b | 8-12 hrs | Data moat |

## 11. What I'd do this week if I were picking

Pragmatic "close Charles then raise the floor" sequence for the next week:

1. **Engine migration** (section 1) — one focused ship, unlocks everything.
2. **Engine version + warnings surfacing** (5a, 5b) — makes future ships debuggable.
3. **Forecast with confidence** (section 2) — upgrades N14 from point to range.
4. **GPO admin fee** (3a) — wins Vizient/Premier-heavy facilities.
5. **Cross-surface invariant test framework** (8c) — stops the drift bugs that have dominated Charles's feedback.

Each is ≤4 hours. Five ships in a week at current velocity.
