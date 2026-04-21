# Canonical rebate engine — gap analysis vs tydei-next

**Date:** 2026-04-20
**Source reference:** `/Users/vickkumar/Downloads/files/rebateEngine.ts` (1697 LOC) + `prospectiveAnalysis.ts` (2620 LOC). Provided by Vick as "the canonical math layer every surface should agree with."
**Status:** Analysis only — no code changes. This doc scopes follow-up work.

## Executive summary

The reference engine defines **8 rebate types + 2 margin types** with ~10 audited fixes already baked in (A1–A10). Tydei-next currently implements **1 of the 8 well** (spend-rebate cumulative/marginal, after today's below-baseline fix) and has **partial coverage** of tie-in capital. The remaining **6 rebate types and several margin/true-up niceties are missing**. Three of Charles's open backlog items map directly into the reference (N17 carve-out, N14 projected, true-up shortfall handling).

## Rebate types: reference vs tydei

| # | Reference type | Tydei status | Maps to Charles backlog |
|---|---|---|---|
| 1 | **SPEND_REBATE** (cumulative/marginal, dollar-one or growth, ALL/REFERENCE/CATEGORY/MULTI_CATEGORY basis) | **Partial.** Cumulative + marginal ✓. Basis scoping via `appliesTo`/`categories` ✓. **Missing: growth-only + baseline resolver** (PRIOR_YEAR_ACTUAL vs NEGOTIATED_FIXED) | — |
| 2 | **VOLUME_REBATE** (CPT-occurrence tiers, fixed-per-occurrence option, dedup by caseId+cptCode) | **Not implemented.** `ContractTier.rebateType = per_procedure_rebate` / `fixed_rebate_per_unit` enums exist in schema but the engine routes them to $0 return. | — |
| 3 | **TIER_PRICE_REDUCTION** (spend triggers unit-price drop, RETROACTIVE vs FORWARD_ONLY) | **Not implemented.** | — |
| 4 | **MARKET_SHARE_REBATE** (vendor share of category spend triggers rebate) | **Not implemented** as a rebate config. `Contract.marketShareCommitment` + `currentMarketShare` scalar fields exist but only feed the scoring/commitment heuristic. | — |
| 5 | **MARKET_SHARE_PRICE_REDUCTION** | **Not implemented.** | — |
| 6 | **CAPITATED** (grouped ref# dollar cap + optional inner rebate/reduction) | **Not implemented.** | — |
| 7 | **CARVE_OUT** (per-ref-number custom rate from pricing file) | **Not implemented.** | **N17** — "carve out is something that requires a column to be on the price file that shows the carve out %" |
| 8 | **TIE_IN_CAPITAL** (capital cost + amortization + rebate-stream paydown + shortfall true-up) | **Partial.** Amortization schedule ✓, `sumRebateAppliedToCapital` ✓ (Charles W1.Y-C), `computeCapitalRetirementNeeded` ✓ (W1.Y-D). **Missing: carried-forward shortfall**, **BILL_IMMEDIATELY vs CARRY_FORWARD** semantics, cumulative-rebate tracking across periods. | — |

## Audit fixes (A1–A10) — already in the reference, check against tydei

| # | Reference fix | Tydei status |
|---|---|---|
| A1 | `determineTier` scans ascending, no early break — always returns HIGHEST tier. Handles EXCLUSIVE + INCLUSIVE boundary rules. | **Partial.** Tydei has scan-and-update but **only EXCLUSIVE boundary** (`spend >= spendMin`). No INCLUSIVE/EXCLUSIVE config — reference supports both per-contract. Today's below-baseline fix (`eec04c4`) addressed the related default-to-tier-1 bug. |
| A2 | `calculateMarginalRebate` — no cent-rounding; exact bracket capacity. | **Match.** Tydei uses `upperBound = tierMax ?? nextMin ?? Infinity` + `Math.min(spend, upperBound) - tierMin`. |
| A3 | INCLUSIVE boundary naturally handled. | **Not applicable** — tydei only supports EXCLUSIVE. |
| A4 | `amountToNextTier` uses `totalSpend` (pre-growth-adjustment). | **Match** in `calculateTierProgress` — amountToNextTier = next.spendMin - currentSpend. |
| A5 | Volume rebate dedup prefers `caseId+cptCode` over `date+cptCode`. | **Not applicable** — volume rebate not implemented. |
| A6 | Market share rebate: separate % threshold from $ calc. | **Not applicable.** |
| A7 | `priceReductionLines[]` per-purchase, no single meaningless `effectiveUnitPrice`. | **Not applicable.** |
| A8 | Capitated sub-rebate pre-filters then ALL_SPEND. | **Not applicable.** |
| A9 | `allocateRebatesToProcedures`: guards against zero reimbursement. | **Match.** Tydei's `calculateMargins` returns null percent when revenue=0; `allocateRebatesToProcedures` returns 0 when totalVendorSpend ≤ 0. |
| A10 | True-up sign: positive = owed more, negative = over-accrued. | **Match for tie-in** (via `calculateQuarterlyTrueUp` / `calculateAnnualSettlement`'s `adjustment = actual − previous`). |

## Other reference features not in tydei

- **`baselineType`** (PRIOR_YEAR_ACTUAL | NEGOTIATED_FIXED) — growth rebate baseline source. Tydei has `minimumPurchaseCommitment` per term but no growth/baseline distinction.
- **`PriceReductionTrigger`** (RETROACTIVE | FORWARD_ONLY). Split purchases at the threshold-crossing date.
- **`shortfallHandling`** (BILL_IMMEDIATELY | CARRY_FORWARD). Charles's tie-in Paid-to-Date conversation touches this — today tydei just shows Paid To Date and Balance Due; it does not track an ongoing "carried-forward shortfall" nor surface "billed immediately" messaging.
- **`PurchaseRecord.caseId` / `cptCode`** on the purchase record — tydei has these on `Case` but not on `COGRecord`. Volume rebate needs the CPT on the purchase line.
- **`priorAccruals`** on `PeriodData` — needed for true-up math that compares actual to prior accruals. Tydei has `Rebate` rows but no explicit "priorAccruals" slot into the engine.
- **`marketSharePercent`** as an output + `totalCategorySpend` as an input. Tydei has only `currentMarketShare` and `marketShareCommitment` scalars.
- **`TrueMarginResult.totalContractBenefit`** = rebateAllocation + priceReductionAllocation. Tydei's true-margin engine has rebate allocation only.

## Prospective analysis gaps

The reference's `prospectiveAnalysis.ts` (2620 LOC) covers:

- **Dual-sided benchmarks** — vendor INTERNAL vs facility NATIONAL_CMS / NATIONAL_ECRI / NATIONAL_PREMIER / NATIONAL_VIZIENT / REGIONAL_STATE / REGIONAL_MSA / GPO_CONTRACT / USER_ENTERED.
- **Contract variants** — 13 (USAGE_SPEND, USAGE_VOLUME, USAGE_CARVEOUT, USAGE_MARKET_SHARE, USAGE_CAPITATED, USAGE_TIEIN, CAPITAL_PURCHASE, CAPITAL_LEASE, CAPITAL_TIEIN, SERVICE_MAINTENANCE, SERVICE_FULL, GPO, PRICING_ONLY).
- **Capital structure analysis** — lease vs buy vs tie-in comparison.
- **Pricing floor/target/ceiling** scenario modeling.
- **Clause extraction risk flags** — per-clause LOW/MEDIUM/HIGH/CRITICAL scoring.

Tydei has a separate `components/facility/rebate-optimizer/` and `lib/rebate-optimizer/` — those cover parts of scenario modeling but not the breadth of the reference.

## Maps to Charles's open backlog

| Backlog item | Reference feature to port |
|---|---|
| **N14** — "Rebate earned YTD should be projected / trending based on historic spend" | `calculateRebate` with `growthOnly: true` and `PRIOR_YEAR_ACTUAL` baseline produces a projection automatically. The YTD card can show both "earned-to-date (ledger)" AND "projected year-end (engine × annualized historic spend)". |
| **N17** — "Carve out requires a column on the price file" | Port `CarveOutConfig` + `calculateCarveOut`. Needs a `carveOutPercent` column on the pricing file row schema. |
| **Tie-in shortfall clarity** (Charles iMessage W1.Y-C conversation) | Adopt reference's `BILL_IMMEDIATELY` vs `CARRY_FORWARD` + expose `carriedForwardShortfall` as a tile on the amortization card. |
| **Market-share commitment math** (alluded to in N11 commitment tooltip) | Add `MARKET_SHARE_REBATE` type + `MarketShareRebateConfig`. `marketSharePercent = vendorSpend / totalCategorySpend × 100`. |
| **Volume / per-procedure rebates** | Schema already has `per_procedure_rebate` enum — port `calculateVolumeRebate` to make it real. Dedup by `caseId+cptCode`. |

## Recommended subsystem split (W1.Z cluster)

Each a focused ship, TDD + E2E regression guard:

- **W1.Z-A** — Port `calculateCarveOut` + add `carveOutPercent` column to pricing file. Closes N17. (~2 hrs, single reducer + UI column + parser.)
- **W1.Z-B** — Port `PRIOR_YEAR_ACTUAL` / `NEGOTIATED_FIXED` baseline + growth-only mode on `SpendRebateConfig`. Closes N14 as a projection surface on the contract detail card. (~3 hrs, engine extension + Rebate-row shape + display.)
- **W1.Z-C** — Port `calculateVolumeRebate` including dedup. Schema add `caseId` + `cptCode` to COGRecord (or route via `CaseSupply`). (~4 hrs, schema + engine + tests.)
- **W1.Z-D** — Port tie-in shortfall handling (`CARRY_FORWARD` + `BILL_IMMEDIATELY`). Surface on amortization card as a new tile. (~3 hrs, state-carry across Rebate rows + UI.)
- **W1.Z-E** — Port `calculateMarketShareRebate` + `MARKET_SHARE_PRICE_REDUCTION`. (~5 hrs, totalCategorySpend ingest + tier eval + proportional marginal.)
- **W1.Z-F** — Port `calculateCapitated` + `calculateTierPriceReduction`. (~5 hrs, each is fairly contained once the pattern is set.)
- **W1.Z-G** — True-margin gains `priceReductionAllocation` + `totalContractBenefit` (matches reference `TrueMarginResult`). (~1 hr.)

## Non-goals (preserved)

- No stack swaps. No Prisma schema wide rewrites — additive column adds only.
- Keep the existing `ContractTier` / `ContractTerm` tables. The reference's flat `RebateTier` + `RebateConfig` maps to tydei's term+tier relational shape via a thin adapter.
- Keep `computeRebateFromPrismaTiers` as the Prisma→engine adapter. New types feed through the same boundary.

## Units + conventions reconciliation

Reference stores `rebatePercentage` as **DECIMAL** (0.03 = 3%). Tydei stores `ContractTier.rebateValue` as **FRACTION** (0.03 = 3%) — same. Tydei's engine currently expects **INTEGER PERCENT** (3 = 3%) and scales at the Prisma boundary via `scaleRebateValueForEngine` — a legacy wart we inherit from the first engine. When porting reference code, either (a) scale at the new-type boundary same way, or (b) switch the engine to accept decimal directly and drop the scaling everywhere. **Option (b) is cleaner but touches more surface** — defer to a separate cleanup subsystem.
