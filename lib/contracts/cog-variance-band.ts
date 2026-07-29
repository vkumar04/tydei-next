/**
 * COG price-variance banding and spend-trend classification.
 *
 * Migrated out of `lib/v0-spec/` on 2026-07-29 with ZERO behaviour change —
 * de-branded and rehomed, arithmetic untouched. See the header on
 * `lib/contracts/tie-in-bundle-math.ts` for why `v0-spec` went away.
 *
 * NOTE ON THE TWO VARIANCE SCALES. This 5-band split is a FINER classification
 * than the 3-level severity (ACCEPTABLE / WARNING / CRITICAL) used elsewhere in
 * price-variance reporting. Both are intentional and they answer different
 * questions — this one distinguishes discounts from overcharges (direction),
 * the severity scale grades magnitude only. Do not collapse one into the other;
 * the report surfaces read them separately.
 */

// ─── Price variance banding ─────────────────────────────────────────

export type CogVarianceBand =
  | "significant_discount"
  | "minor_discount"
  | "at_contract"
  | "minor_overcharge"
  | "significant_overcharge"

/**
 * Classify a paid unit price against its contract price.
 *
 * `variancePct` is signed and relative to the CONTRACT price:
 *   (unitPrice − contractPrice) / contractPrice × 100
 * so negative means we paid LESS than contract (a discount) and positive
 * means we overpaid. Getting the denominator wrong here — dividing by
 * `unitPrice` instead — quietly compresses every band.
 *
 * Bands, checked in this order (the order matters):
 *   |v| < 0.5   at_contract              — noise floor, both directions
 *   v ≤ -5      significant_discount
 *   v < 0       minor_discount
 *   v ≤ 5       minor_overcharge
 *   else        significant_overcharge
 *
 * A non-positive `contractPrice` means there is nothing to compare against
 * (no contract price on file), so this reports `at_contract` with 0 variance
 * rather than dividing by zero and emitting Infinity/NaN into a report.
 * Callers that need to distinguish "on contract at parity" from "no contract
 * price known" must check `contractPrice` themselves — this function
 * deliberately does not invent a third state.
 */
export function cogPriceVarianceBand(
  unitPrice: number,
  contractPrice: number,
): { variancePct: number; band: CogVarianceBand } {
  if (contractPrice <= 0) return { variancePct: 0, band: "at_contract" }
  const variancePct = ((unitPrice - contractPrice) / contractPrice) * 100
  let band: CogVarianceBand
  if (Math.abs(variancePct) < 0.5) band = "at_contract"
  else if (variancePct <= -5) band = "significant_discount"
  else if (variancePct < 0) band = "minor_discount"
  else if (variancePct <= 5) band = "minor_overcharge"
  else band = "significant_overcharge"
  return { variancePct, band }
}

// ─── Spend trend ────────────────────────────────────────────────────

export type SpendTrend = "up" | "down" | "stable"

/**
 * Classify a spend trend by comparing the last 3 months' average against the
 * 3 months before that. Up if >10%, down if <−10%, else stable.
 *
 * Requires at least 6 data points; fewer returns `stable` at 0% rather than
 * guessing from a partial window — a 2-month "trend" is noise, and reporting
 * it as a direction is worse than reporting nothing.
 *
 * A non-positive prior average also returns stable: growth from a zero base
 * is infinite, and "∞% up" is not a useful thing to render.
 *
 * `monthlySpend` is expected oldest-first; the function reads from the END of
 * the array, so extra leading history is harmless.
 */
export function spendTrend(monthlySpend: number[]): {
  changePct: number
  trend: SpendTrend
} {
  if (monthlySpend.length < 6) return { changePct: 0, trend: "stable" }
  const recent = monthlySpend.slice(-3)
  const prior = monthlySpend.slice(-6, -3)
  const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length
  const priorAvg = prior.reduce((s, v) => s + v, 0) / prior.length
  if (priorAvg <= 0) return { changePct: 0, trend: "stable" }
  const changePct = ((recentAvg - priorAvg) / priorAvg) * 100
  const trend: SpendTrend =
    changePct > 10 ? "up" : changePct < -10 ? "down" : "stable"
  return { changePct, trend }
}
