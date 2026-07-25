/**
 * Canonical "which contract-level metric qualifies tier thresholds for
 * this term type" picker. Single source of truth so readers don't drift.
 *
 * Background: the rebate engine uses a column-reuse pattern. For every
 * term type, `tier.spendMin` is the threshold the engine compares
 * against — but the UNIT of that threshold depends on the term type:
 *
 *   - spend_rebate / carve_out                 → DOLLARS  (currentSpend)
 *   - market_share                              → PERCENT  (currentMarketShare)
 *   - compliance_rebate                         → PERCENT  (complianceRate)
 *   - volume_rebate / rebate_per_use /
 *     capitated_pricing_rebate / po_rebate /
 *     payment_rebate                            → COUNT    (currentVolume)
 *
 * Writers (`lib/actions/pending-contracts.ts:332-341`, `imports/contract-import.ts`)
 * mirror dedicated columns (`marketShareMin`, `volumeMin`) into `spendMin`
 * at write time so the engine remains metric-agnostic. Callers (this
 * helper's consumers) are responsible for feeding the right metric.
 *
 * Threshold metric routing for `market_share` and `compliance_rebate`
 * mirrors the writer-side `ThresholdMetric` union in
 * `lib/contracts/recompute/threshold.ts`. The volume-family routing
 * (`volume_rebate`, `rebate_per_use`, `capitated_pricing_rebate`,
 * `po_rebate`, `payment_rebate` → `currentVolume`) is established by
 * this helper as the new canonical convention for those term types.
 */

export interface ThresholdMetricInputs {
  currentSpend: number
  currentMarketShare: number | null
  complianceRate: number | null
  currentVolume: number | null
}

export function pickThresholdMetric(
  termType: string,
  metrics: ThresholdMetricInputs,
): number {
  switch (termType) {
    case "market_share":
      return metrics.currentMarketShare ?? 0
    case "compliance_rebate":
      return metrics.complianceRate ?? 0
    case "volume_rebate":
    case "rebate_per_use":
    case "capitated_pricing_rebate":
    case "po_rebate":
    case "payment_rebate":
      return metrics.currentVolume ?? 0
    case "spend_rebate":
    case "carve_out":
    case "tie_in":
    default:
      return metrics.currentSpend
  }
}

/**
 * Term types whose tier `spendMin` is a market-share PERCENT (0–100) or a
 * unit COUNT rather than DOLLARS of spend. For these, comparing a dollar
 * spend figure against the tier threshold is meaningless — see the
 * spend-utilization card bug (2026-06-08): a `market_share` term's tiers
 * (thresholds 0/60/100 %) were fed dollar spend ($96K–$20M) into
 * `calculateCumulative`, so spend always dwarfed the top threshold and the
 * card projected the top tier as "achieved" (false 100% utilization / a
 * `10% × $20.9M = $2,094,670` projection).
 *
 * Mirrors the non-`currentSpend` branches of `pickThresholdMetric` above —
 * keep the two in sync.
 */
const NON_SPEND_DOLLAR_THRESHOLD_TERM_TYPES = new Set([
  "market_share",
  "compliance_rebate",
  "volume_rebate",
  "rebate_per_use",
  "capitated_pricing_rebate",
  "po_rebate",
  "payment_rebate",
])

/**
 * True when a term type's tier thresholds are denominated in DOLLARS of
 * spend (so the spend × rate utilization card is meaningful). False for
 * percent-threshold (`market_share`, `compliance_rebate`) and count-based
 * term types. Single source of truth for any spend-based projection
 * surface so they don't drift.
 */
export function isSpendDollarThresholdTermType(termType: string): boolean {
  return !NON_SPEND_DOLLAR_THRESHOLD_TERM_TYPES.has(termType)
}

/**
 * Canonical per-tier progress-bar fill (0–100) for the Rebates & Tiers tab.
 *
 * `metric` and the thresholds must be in the SAME unit: dollars for
 * spend-dollar terms, percent 0–100 for market_share terms (per
 * `pickThresholdMetric` above). Bug A3 (bugs.rtfd 2026-06-11): `TierDisplay`
 * inlined this math with `currentSpend` (dollars, e.g. $782,541) compared
 * against `tier.spendMin` — which for market_share terms stores a PERCENT
 * via the writer's column-reuse mirror — so `metric >= thresholdMin` was
 * always true and every tier bar (0%+ / 50%+ / 100%+) rendered fully
 * achieved at 71.1% actual share. Extracted here so both unit families
 * share one formula and the unit routing happens at the call site.
 */
export function computeTierBarProgress(opts: {
  metric: number // dollars for spend terms, percent 0-100 for market-share
  thresholdMin: number
  thresholdMax: number | null
}): number {
  const { metric, thresholdMin, thresholdMax } = opts
  if (metric < thresholdMin) return 0
  if (thresholdMax == null || metric >= thresholdMax) return 100
  return ((metric - thresholdMin) / (thresholdMax - thresholdMin)) * 100
}

/**
 * True when a term carries a REAL spend-dollar tier ladder that should drive
 * spend-tier display surfaces (Tier Achievement, Rebate utilization).
 *
 * `isSpendDollarThresholdTermType` alone is not enough: `carve_out` and
 * `tie_in` are classified as spend-dollar (their threshold metric IS spend),
 * but their rebate comes from per-SKU `ContractPricing.carveOutPercent`, not
 * tiers. Auto-created carve-out terms carry a single PLACEHOLDER tier
 * (`spendMin: 0, rebateValue: 0`). Feeding that placeholder into the spend ×
 * rate utilization math yields `$0 / $0 → 0.0%`, and into the Tier
 * Achievement walk yields a bogus "Tier 1"/top-tier badge on a contract that
 * has no real tiers (2026-06-08 Charles "carve out has NOT tiers but it has
 * tiers 4,3,7"). Requiring at least one tier with a non-zero `rebateValue`
 * excludes the placeholder (and any all-zero ladder), so carve-out contracts
 * correctly fall through to their dedicated carve-out surfaces.
 */
export function hasSpendDollarTierLadder(term: {
  termType: string
  tiers: Array<{ rebateValue: unknown }>
}): boolean {
  return (
    isSpendDollarThresholdTermType(term.termType) &&
    term.termType !== "carve_out" &&
    term.termType !== "tie_in" &&
    term.tiers.length > 0 &&
    term.tiers.some((t) => Number(t.rebateValue) > 0)
  )
}
