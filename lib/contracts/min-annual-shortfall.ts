/**
 * Charles W1.Y-D — Minimum Annual Purchase floor math.
 *
 * Pure reducer: given a rolling-12 spend number and an optional
 * `minAnnualPurchase` floor (tie-in contracts), returns the gap and a
 * met/unmet flag. Null/zero floor is treated as "no floor" → met=true.
 *
 * Surfaced on the Capital Amortization card for tie-in contracts. Non-tie-in
 * surfaces treat the field as reference-only (see W1.Y-D design doc).
 */

export interface MinAnnualShortfallResult {
  floor: number | null
  spend: number
  gap: number
  met: boolean
}

export function computeMinAnnualShortfall(
  rolling12Spend: number,
  minAnnualPurchase: number | null,
): MinAnnualShortfallResult {
  if (minAnnualPurchase == null || minAnnualPurchase <= 0) {
    return { floor: null, spend: rolling12Spend, gap: 0, met: true }
  }
  const gap = Math.max(minAnnualPurchase - rolling12Spend, 0)
  return {
    floor: minAnnualPurchase,
    spend: rolling12Spend,
    gap,
    met: gap === 0,
  }
}
