# Canonical rebate engine — gap analysis vs tydei-next

**Date:** 2026-04-20
**Source reference:** `/Users/vickkumar/Downloads/files/rebateEngine.ts` (1697 LOC) + `prospectiveAnalysis.ts` (2620 LOC). Provided by Vick as "the canonical math layer every surface should agree with."
**Status:** Analysis only — no code changes. This doc scopes follow-up work.

## Executive summary

The reference engine defines **8 rebate types + 2 margin types** with ~10 audited fixes already baked in (A1–A10). **Second-pass audit finding (2026-04-20 pm):** tydei already has the full canonical engine ported at `lib/rebates/engine/` (2321 LOC across 11 files, 106 Vitest tests passing). It covers all 8 rebate types, includes every audit fix, and exposes a clean `RebateConfig | PeriodData → RebateResult` API.

**What's actually missing is the wiring**, not the math:
1. `lib/rebates/engine/index.ts` removed the dispatcher because no server action called it. Only 2 of 8 RebateType branches were reachable from the Prisma bridge.
2. `computeRebateFromPrismaTiers` (in `lib/rebates/calculate.ts`) still routes through the **legacy** `lib/contracts/rebate-method.ts` engine (cumulative/marginal only; no boundary-rule config; no growth-baseline).
3. The Prisma adapter layer needs one function per canonical type that maps `ContractTerm + ContractTier + tier metadata → RebateConfig` so the new engine can be invoked from display / recompute paths.

Three of Charles's open backlog items map directly to types that are already implemented in `lib/rebates/engine/`:

- **N17 carve-out** → `lib/rebates/engine/carve-out.ts` (148 LOC, tested). Needs: `CarveOutConfig` adapter from the contract's pricing-file carve-out column + UI to render `RebateResult.carveOutLines`.
- **N14 projected/trending rebate** → `lib/rebates/engine/spend-rebate.ts` with `growthOnly: true` + `PRIOR_YEAR_ACTUAL` baseline. Needs: historic-spend series feeder + projection card.
- **Tie-in shortfall handling** → `lib/rebates/engine/tie-in-capital.ts` with `BILL_IMMEDIATELY | CARRY_FORWARD`. Needs: integration with the existing amortization card + a new shortfall tile.

## Rebate types: reference vs tydei (second-pass audit)

All 8 types have a tested pure-engine implementation at `lib/rebates/engine/`. "Wired" below = invoked from a server action on a display surface. "Dormant" = code exists but no caller.

| # | Type | Engine file | LOC | Tests | Wired? | Charles backlog |
|---|---|---|---:|---:|---|---|
| 1 | **SPEND_REBATE** | `spend-rebate.ts` | 229 | ✓ | **No** (legacy `lib/contracts/rebate-method.ts` used instead via `computeRebateFromPrismaTiers`) | — |
| 2 | **VOLUME_REBATE** | `volume-rebate.ts` | 292 | ✓ | Dormant | — |
| 3 | **TIER_PRICE_REDUCTION** | `tier-price-reduction.ts` | 152 | ✓ | Dormant | — |
| 4 | **MARKET_SHARE_REBATE** | `market-share-rebate.ts` | 268 | ✓ | Dormant | — |
| 5 | **MARKET_SHARE_PRICE_REDUCTION** | `market-share-price-reduction.ts` | 145 | ✓ | Dormant | — |
| 6 | **CAPITATED** | `capitated.ts` | 212 | ✓ | Dormant | — |
| 7 | **CARVE_OUT** | `carve-out.ts` | 148 | ✓ | **Dormant** | **N17** — carve-out column in pricing file |
| 8 | **TIE_IN_CAPITAL** | `tie-in-capital.ts` | 154 | ✓ | **Partial** — amortization schedule + Paid-to-Date are wired via `sumRebateAppliedToCapital` (W1.Y-C), but `BILL_IMMEDIATELY` / `CARRY_FORWARD` shortfall tracking is dormant | Tie-in shortfall UX |

Shared building blocks (all dormant-friendly, no wiring changes needed):
- `shared/determine-tier.ts` — handles EXCLUSIVE + INCLUSIVE boundary rules (A1)
- `shared/cumulative.ts` — returns null when no tier qualifies (matches today's `eec04c4` fix in the legacy engine)
- `shared/marginal.ts` — returns bracket breakdown + null on no-qualify (A2/A3)
- `shared/price-reduction-lines.ts` — per-purchase line breakdown (A7)
- `shared/sort-tiers.ts` — canonical sort
- `amortization.ts` — PMT formula (already wired via `buildTieInAmortizationSchedule`)

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

## Recommended subsystem split (W1.Z cluster — second-pass scope)

Rescoped to **wire existing engines**, not port them. Each subsystem is a Prisma adapter + UI integration.

- **W1.Z-A — Wire CARVE_OUT (N17).** Add `carveOutPercent` column to the pricing-file import schema; write `toCarveOutConfig(contract, pricingFile) → CarveOutConfig`; route display through `lib/rebates/engine/carve-out.ts::calculateCarveOut`. UI: render `RebateResult.carveOutLines` under the Rebates & Tiers tab. Effort: **~2 hrs.**
- **W1.Z-B — Wire SPEND_REBATE with growth baseline (N14).** Extend `toSpendRebateConfig` adapter to read `ContractTerm.baselineType` + `priorYearActualSpend` from a new column or imported COG cohort. Swap `computeRebateFromPrismaTiers` to call `lib/rebates/engine/spend-rebate.ts::calculateSpendRebate`. Add "Projected" card alongside the YTD earned card. Effort: **~4 hrs** (the schema + adapter + UI).
- **W1.Z-C — Wire VOLUME_REBATE.** Add `cptCode` + `caseId` to `COGRecord` (or route via `CaseSupply` join). Adapter `toVolumeRebateConfig`. Call `calculateVolumeRebate`. Effort: **~3 hrs.**
- **W1.Z-D — Wire tie-in shortfall carry-forward.** Current code routes `paidToDate` through `sumRebateAppliedToCapital`; extend to stamp a `shortfall` + `carriedForwardShortfall` onto each `Rebate` row when `BILL_IMMEDIATELY | CARRY_FORWARD` is set on the contract. UI: new tile on the Capital Amortization card. Effort: **~3 hrs.**
- **W1.Z-E — Wire MARKET_SHARE_REBATE + price reduction.** Requires a `totalCategorySpend` feeder — tydei already has `FacilityCategorySpend` (needs verification); adapter `toMarketShareRebateConfig`. Effort: **~4 hrs.**
- **W1.Z-F — Wire CAPITATED + TIER_PRICE_REDUCTION.** Both have existing engines; each gets a small adapter + a per-contract-type UI branch. Effort: **~3 hrs each.**
- **W1.Z-G — Migrate `computeRebateFromPrismaTiers` off the legacy engine.** Low-risk once A/B/C are proven — delete `lib/contracts/rebate-method.ts` and redirect callers to `lib/rebates/engine/spend-rebate.ts`. Removes the unit-convention scaling boundary (reference uses decimal throughout). Effort: **~2 hrs** if the adapters are in place; blocked by A/B.

## Non-goals (preserved)

- No stack swaps. No Prisma schema wide rewrites — additive column adds only.
- Keep the existing `ContractTier` / `ContractTerm` tables. The reference's flat `RebateTier` + `RebateConfig` maps to tydei's term+tier relational shape via a thin adapter.
- Keep `computeRebateFromPrismaTiers` as the Prisma→engine adapter. New types feed through the same boundary.

## Units + conventions reconciliation

Reference stores `rebatePercentage` as **DECIMAL** (0.03 = 3%). Tydei stores `ContractTier.rebateValue` as **FRACTION** (0.03 = 3%) — same. Tydei's engine currently expects **INTEGER PERCENT** (3 = 3%) and scales at the Prisma boundary via `scaleRebateValueForEngine` — a legacy wart we inherit from the first engine. When porting reference code, either (a) scale at the new-type boundary same way, or (b) switch the engine to accept decimal directly and drop the scaling everywhere. **Option (b) is cleaner but touches more surface** — defer to a separate cleanup subsystem.
