/**
 * Canonical "which contract-level metric qualifies tier thresholds for
 * this term type" picker. Single source of truth so readers don't drift
 * — see `docs/superpowers/specs/2026-05-24-rebate-optimizer-tier-drift-design.md`.
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
