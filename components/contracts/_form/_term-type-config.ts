import {
  DollarSign,
  TrendingUp,
  Percent,
  PieChart,
  BarChart3,
  Shield,
  Lock,
  Coins,
} from "lucide-react"
import type { TermFormValues, TierInput } from "@/lib/validators/contract-terms"

/*
 * Visible term-type picker.
 *
 * Display order:
 *   1. Spend        → spend_rebate
 *   2. Market Share Spend → market_share
 *   3. Volume       → volume_rebate
 *   4. Carve Out    → carve_out
 *   5. Price reduction → price_reduction
 *   6. Market share Price reduction → market_share_price_reduction
 *
 * "Order" (po_rebate) was removed from the selectable picker + legend on
 * Charles 2026-06-07 (unused). It stays in the Prisma TermType enum and the
 * `hidden`-list below for back-compat with existing rows; the renderer still
 * shows it when an existing term already uses it (`tt.value === term.termType`).
 *
 * `growth_rebate` was retired this same session — growth is now a
 * property of any spend-basis term (`growthOnly: true`) rather than a
 * distinct term type. See prisma/migrations/20260525120000_drop_growth_rebate_term_type/.
 *
 * The remaining hidden entries (capitated_*, payment_rebate,
 * compliance_rebate, fixed_fee, locked_pricing, rebate_per_use) stay in
 * the Prisma enum for back-compat with existing rows but are not
 * surfaced for new-term creation. `hidden: true` is the sole filter;
 * the renderer below skips entries with that flag.
 */
export const termTypes = [
  // ── Visible (in display order) ─────────────────────────────────
  // 1. Spend
  { value: "spend_rebate", label: "Spend", icon: DollarSign, description: "Rebate based on spend thresholds. Pair with the \"Growth\" baseline calculation method to rebate only spend above a baseline.", disabled: false },
  // 2. Market Share Spend — flat tier dollar amount per evaluation
  // period when `Contract.currentMarketShare` crosses the tier's
  // threshold. Threshold = spendMin column (interpreted as %);
  // rebate = rebateValue (flat $).
  { value: "market_share", label: "Market Share Spend", icon: PieChart, description: "Flat per-period rebate when current market share % crosses tier threshold. Update Current Market Share on the contract.", disabled: false },
  // 3. Volume — counts CPT-coded procedure occurrences across the
  // facility's Cases (deduped by case+CPT) within the term window.
  { value: "volume_rebate", label: "Volume", icon: TrendingUp, description: "Rebate based on procedure count. Set CPT codes on the term; tier thresholds are interpreted as occurrences (not dollars).", disabled: false },
  // 4. Carve Out — specific items excluded from the broader contract
  // terms; per-line carve-out percent applied via the Pricing tab.
  { value: "carve_out", label: "Carve Out", icon: Shield, description: "Specific items excluded from the broader contract terms — per-line carve-out percent applied via the Pricing tab.", disabled: false },
  // 5. Price reduction — no separate rebate accrual; enforced by the
  // contract's ContractPricing rows (the matched price IS the reduced
  // price).
  { value: "price_reduction", label: "Price reduction", icon: Percent, description: "Pricing-only contract — discounted prices applied via the Pricing tab. No separate rebate accrual.", disabled: false },
  // 6. Market share Price reduction — pricing-only; discount applies
  // once market share target is met. Configured via ContractPricing.
  // (Unhidden 2026-05-25 per Charles Bugs.rtfd.)
  { value: "market_share_price_reduction", label: "Market share Price reduction", icon: PieChart, description: "Pricing-only — discounted prices once market share target is met. Configure prices on the Pricing tab.", disabled: false },

  // ── Hidden (legacy / advanced types kept for back-compat) ──────
  // Order — po_rebate counts qualifying PurchaseOrder rows (status
  // submitted | approved | received) at the contract's vendor +
  // facility within the term's evaluation period. Tier thresholds are
  // PO COUNTS, rebateValue is dollars-per-PO at the achieved tier.
  // Removed from the selectable picker 2026-06-07 (Charles, unused);
  // hidden:true keeps it visible only on existing po_rebate terms.
  { value: "po_rebate", label: "Order", icon: DollarSign, description: "Per-order rebate. Tier thresholds are order counts; rebate values are dollars per order.", disabled: false, hidden: true },
  // Pricing-only — procedure-spend trigger.
  { value: "capitated_price_reduction", label: "Capitated Price Reduction", icon: BarChart3, description: "Pricing-only — discounted procedures once spend threshold is met. Configure prices on the Pricing tab.", disabled: false, hidden: true },
  // Per-procedure rebate. Routes through the volume bridge.
  { value: "capitated_pricing_rebate", label: "Capitated Pricing Rebate", icon: BarChart3, description: "Per-procedure rebate when CPT count crosses tier. Set CPT codes; tier rebateValue is $/procedure.", disabled: false, hidden: true },
  // Flat tier dollar amount per evaluation period when
  // `Contract.complianceRate` crosses the tier's threshold.
  { value: "compliance_rebate", label: "Compliance Rebate", icon: Shield, description: "Flat per-period rebate when compliance % crosses tier threshold. Update Compliance Rate on the contract.", disabled: false, hidden: true },
  // Flat dollar rebate per period via a single fixed_rebate tier.
  { value: "fixed_fee", label: "Fixed Fee", icon: Coins, description: "Fixed dollar rebate per period. Add one tier with rebate type Fixed Rebate and the dollar amount.", disabled: false, hidden: true },
  // Price catalog locked for the contract duration; no engine wiring.
  { value: "locked_pricing", label: "Locked Pricing", icon: Lock, description: "Price catalog locked for the contract duration. Pricing rows are managed via the Pricing tab; no separate rebate accrual.", disabled: false, hidden: true },
  // Shares the volume bridge — counts CPT occurrences, pays $/occurrence.
  { value: "rebate_per_use", label: "Rebate Per Use", icon: Coins, description: "Per-procedure rebate. Set CPT codes and add one tier at threshold 0 with the dollars per occurrence.", disabled: false, hidden: true },
  // Per-invoice rebate; counts qualifying Invoice rows within the
  // evaluation window.
  { value: "payment_rebate", label: "Payment Rebate", icon: Coins, description: "Per-invoice rebate. Tier thresholds are invoice counts; rebate values are dollars per invoice.", disabled: false, hidden: true },
] as const

export const baselineTypes = [
  { value: "spend_based", label: "Spend Based" },
  { value: "volume_based", label: "Volume Based" },
  { value: "growth_based", label: "Growth Based" },
] as const

/**
 * TermTypes whose engines have no defined per-period $ base to apply a
 * percent against — percent_of_spend tiers are incoherent for them.
 *
 * rebate_per_use, capitated_pricing_rebate, compliance_rebate,
 * fixed_fee, payment_rebate, po_rebate stay locked: their engine
 * paths quantify achievement in occurrences or percent points
 * without a per-period dollar base, so a percent rebate has nothing
 * well-defined to apply against until each gets its own COG-records
 * or invoice-records bridge.
 *
 * volume_rebate and market_share ARE legal % targets (bugs #16, #17)
 * so they stay off this list.
 *
 * This single set replaces three hand-rolled mirrors (the rebate-type
 * picker filter in contract-tier-row.tsx, the mount self-heal in
 * _use-term-form-state.ts, and the type-change cascade in
 * _term-type-select.tsx). Only the MEMBERSHIP is shared — the
 * consumers' transforms intentionally differ (self-heal preserves the
 * dollar value × 100; the type-change cascade zeroes rebateValue).
 */
export const NON_PERCENT_TIER_TERM_TYPES = new Set([
  "rebate_per_use",
  "capitated_pricing_rebate",
  "compliance_rebate",
  "fixed_fee",
  "payment_rebate",
  "po_rebate",
])

export function createEmptyTerm(): TermFormValues {
  return {
    termName: "",
    termType: "spend_rebate",
    baselineType: "spend_based",
    evaluationPeriod: "annual",
    paymentTiming: "quarterly",
    appliesTo: "all_products",
    rebateMethod: "cumulative",
    growthOnly: false,
    effectiveStart: "",
    effectiveEnd: "",
    tiers: [],
  }
}

export function createEmptyTier(
  tierNumber: number,
  termType?: string,
): TierInput {
  // Charles 2026-04-25 audit C6 + re-pass F6: every term type whose
  // engine adapter reads `tier.rebateValue` as flat dollars-per-event
  // (or per period) defaults to `fixed_rebate` so a user typing
  // "1000" stores as $1,000 not 100% of spend. The engine treats
  // fraction values as percent at the boundary, so a percent_of_spend
  // default would silently scale × 100 in the engine and pay $0.X
  // instead of $X. Verified against:
  //   - recompute-volume-accrual.ts (occurrences × rebateValue)
  //   - recompute-po-accrual.ts (count × rebateValue)
  //   - recompute-invoice-accrual.ts (count × rebateValue)
  //   - recompute-threshold-accrual.ts (per-period payoutForTier)
  // All other term types (spend_rebate, growth_rebate, …) keep the
  // percent_of_spend default.
  // Bug 2026-06-08 ("hit a particular % → get a particular rebate; this is
  // just showing a dollar amount"): `market_share` was defaulting new tiers
  // to fixed_rebate, so a user building a "hit X% share → earn Y% on
  // category spend" rebate got flat dollars. Default market_share tiers to
  // percent_of_spend instead — the threshold writer already handles
  // market_share + percent_of_spend (per-period spend × percent). Users who
  // genuinely want a flat per-period payout can still switch the tier's
  // rebate type to Fixed Rebate. market_share_price_reduction is
  // pricing-only and never reaches this tier-default path.
  const flatPayoutTermTypes = new Set([
    "fixed_fee",
    "compliance_rebate",
    "payment_rebate",
    "rebate_per_use",
    "capitated_pricing_rebate",
    "po_rebate",
  ])
  // Bug #25 (2026-05-11, Vick): volume_rebate's natural default is
  // $-per-unit (qty × rate), not flat $-per-period. The user reported
  // entering "$5" expecting "$5 × units used" but the writer
  // interpreted it as a flat $5 per period. Default new volume tiers
  // to `fixed_rebate_per_unit` so the UI label, engine math, and user
  // mental model all line up.
  let rebateType: TierInput["rebateType"]
  if (termType === "volume_rebate") {
    rebateType = "fixed_rebate_per_unit"
  } else if (termType && flatPayoutTermTypes.has(termType)) {
    rebateType = "fixed_rebate"
  } else {
    rebateType = "percent_of_spend"
  }
  return {
    tierNumber,
    spendMin: 0,
    rebateType,
    rebateValue: 0,
  }
}
