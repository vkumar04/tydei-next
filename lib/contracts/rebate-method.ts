/**
 * Rebate calculation engines for cumulative and marginal tier methods.
 *
 * - Cumulative (most common): the entire spend receives the rate of the
 *   highest tier achieved. Spec section 2.1.1 of contract-calculations.md.
 * - Marginal (bracket): each spend bracket receives its own rate.
 *   Spec section 2.1.2.
 *
 * Tiers are sorted by spendMin ascending inside each function, so callers
 * don't have to pre-sort.
 */

export type RebateMethodName = "cumulative" | "marginal"

export interface TierLike {
  tierNumber: number
  spendMin: number | string | { toString(): string }
  spendMax?: number | string | { toString(): string } | null
  rebateValue: number | string | { toString(): string }
}

export interface RebateEngineResult {
  tierAchieved: number
  rebatePercent: number
  rebateEarned: number
}

// ─── Helpers ────────────────────────────────────────────────────────

function numericValue(v: TierLike["spendMin"]): number {
  return typeof v === "number" ? v : Number(v)
}

function nullableNumeric(v: TierLike["spendMax"]): number | null {
  if (v === null || v === undefined) return null
  return typeof v === "number" ? v : Number(v)
}

function sortedByMin(tiers: TierLike[]): TierLike[] {
  return [...tiers].sort(
    (a, b) => numericValue(a.spendMin) - numericValue(b.spendMin),
  )
}

// ─── Cumulative ─────────────────────────────────────────────────────

export function calculateCumulative(
  spend: number,
  tiers: TierLike[],
): RebateEngineResult {
  if (tiers.length === 0) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }

  const sorted = sortedByMin(tiers)
  // Default to the lowest tier (spend >= its min, which is usually 0).
  let applicable = sorted[0]

  for (const tier of sorted) {
    if (spend >= numericValue(tier.spendMin)) {
      applicable = tier
    }
  }

  const rebatePercent = numericValue(applicable.rebateValue)
  const rebateEarned = (spend * rebatePercent) / 100

  return {
    tierAchieved: applicable.tierNumber,
    rebatePercent,
    rebateEarned,
  }
}

// ─── Marginal ───────────────────────────────────────────────────────

export function calculateMarginal(
  spend: number,
  tiers: TierLike[],
): RebateEngineResult {
  if (tiers.length === 0) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }

  const sorted = sortedByMin(tiers)
  let totalRebate = 0
  let tierAchieved = sorted[0].tierNumber
  let topRate = numericValue(sorted[0].rebateValue)

  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i]
    const tierMin = numericValue(tier.spendMin)
    const tierMax = nullableNumeric(tier.spendMax)
    const nextMin =
      i + 1 < sorted.length ? numericValue(sorted[i + 1].spendMin) : null

    // Non-final tier without an upper bound (no spendMax AND no
    // meaningful nextMin) is ambiguous — we can't compute the bracket width.
    const isFinal = i === sorted.length - 1
    if (!isFinal && tierMax === null && (nextMin === null || nextMin <= tierMin)) {
      throw new Error(
        `Marginal method requires spendMax on non-final tier (tier ${tier.tierNumber})`,
      )
    }

    // Upper bound of this bracket: prefer explicit spendMax, fall back to
    // next tier's spendMin, fall back to infinity (only valid on final tier).
    const upperBound = tierMax ?? nextMin ?? Infinity

    if (spend <= tierMin) break

    const spendInBracket = Math.min(spend, upperBound) - tierMin
    if (spendInBracket <= 0) continue

    const rate = numericValue(tier.rebateValue)
    totalRebate += (spendInBracket * rate) / 100

    tierAchieved = tier.tierNumber
    topRate = rate

    if (spend <= upperBound) break
  }

  return {
    tierAchieved,
    rebatePercent: topRate,
    rebateEarned: totalRebate,
  }
}

// ─── Dispatcher ─────────────────────────────────────────────────────

export function calculateRebate(
  spend: number,
  tiers: TierLike[],
  method: RebateMethodName = "cumulative",
): RebateEngineResult {
  return method === "marginal"
    ? calculateMarginal(spend, tiers)
    : calculateCumulative(spend, tiers)
}
