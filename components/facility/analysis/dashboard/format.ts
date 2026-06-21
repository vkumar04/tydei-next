import { formatCurrency } from "@/lib/formatting"

/**
 * Compact USD for dashboard cards/tables: $41.7M, $625.9K, $444.
 * Falls back to plain `formatCurrency` under $1,000.
 */
export function usdCompact(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? "-" : ""
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return formatCurrency(value)
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
