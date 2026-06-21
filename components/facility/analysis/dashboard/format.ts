import { formatCompactCurrency } from "@/lib/formatting"

/**
 * Compact USD for dashboard cards/tables: $41.7M, $625.9K, $444.
 * Falls back to plain `formatCurrency` under $1,000. Thin wrapper over the
 * canonical `formatCompactCurrency` (1-decimal thousands) — kept so its
 * importers (and the `usdDelta` helper below) are unaffected.
 */
export function usdCompact(value: number): string {
  return formatCompactCurrency(value, { kDecimals: 1 })
}

/** Signed compact USD with an explicit leading + for positive deltas. */
export function usdDelta(value: number): string {
  if (value > 0) return `+${usdCompact(value)}`
  return usdCompact(value)
}

/** Fraction (0.4622) → "46.22%". */
export function pctFromFraction(fraction: number, decimals = 2): string {
  return `${(fraction * 100).toFixed(decimals)}%`
}
