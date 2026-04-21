/**
 * Tier-progression calculator. Given a contract's tiers and current
 * cumulative spend, returns the currently-achieved tier, the next tier
 * (if any), percent-progress through the current bracket, the dollar
 * amount to the next tier, and a projected-additional-rebate estimate
 * that accounts for cumulative vs marginal method.
 *
 * Spec section 3 of contract-calculations.md.
 */
import {
  calculateCumulative,
  calculateMarginal,
  type TierLike,
  type RebateMethodName,
} from "@/lib/rebates/calculate"

export interface TierProgressTierInfo {
  tierNumber: number
  tierName: string | null
  spendMin: number
  spendMax: number | null
  rebateValue: number
}

export interface TierProgressResult {
  currentTier: TierProgressTierInfo | null
  nextTier: TierProgressTierInfo | null
  /** 0-100. Progress through the current tier's bracket toward the next tier's spendMin. */
  progressPercent: number
  /** Dollars to go until the next tier's spendMin is hit. 0 when at top tier. */
  amountToNextTier: number
  /** Hypothetical: total rebate at next tier's spendMin − total rebate right now. */
  projectedAdditionalRebate: number
}

function n(v: TierLike["spendMin"]): number {
  return typeof v === "number" ? v : Number(v)
}

function nullable(v: TierLike["spendMax"]): number | null {
  if (v === null || v === undefined) return null
  return typeof v === "number" ? v : Number(v)
}

function toInfo(t: TierLike): TierProgressTierInfo {
  return {
    tierNumber: t.tierNumber,
    tierName: t.tierName ?? null,
    spendMin: n(t.spendMin),
    spendMax: nullable(t.spendMax),
    rebateValue: n(t.rebateValue),
  }
}

export function calculateTierProgress(
  currentSpend: number,
  tiers: TierLike[],
  method: RebateMethodName = "cumulative",
): TierProgressResult {
  if (tiers.length === 0) {
    return {
      currentTier: null,
      nextTier: null,
      progressPercent: 0,
      amountToNextTier: 0,
      projectedAdditionalRebate: 0,
    }
  }

  const sorted = [...tiers].sort((a, b) => n(a.spendMin) - n(b.spendMin))

  // Charles iMessage 2026-04-20: when spend hasn't reached tier 1's
  // spendMin, NO tier is current (the contract is "below baseline").
  // The tier-progress card must reflect that — previously it defaulted
  // to tier 1 as current, which paired with the dollar-annotation
  // helper to show a bogus "earning $X" label at e.g. $1.5M against a
  // $5.3M baseline.
  const lowestMin = n(sorted[0].spendMin)
  if (currentSpend < lowestMin) {
    const firstTier = toInfo(sorted[0])
    return {
      currentTier: null,
      nextTier: firstTier,
      progressPercent:
        lowestMin > 0
          ? Math.min(100, (currentSpend / lowestMin) * 100)
          : 0,
      amountToNextTier: Math.max(0, lowestMin - currentSpend),
      projectedAdditionalRebate: 0,
    }
  }

  // Find highest tier whose spendMin is met.
  let currentIdx = 0
  for (let i = 0; i < sorted.length; i++) {
    if (currentSpend >= n(sorted[i].spendMin)) currentIdx = i
  }

  const currentTier = toInfo(sorted[currentIdx])
  const nextTier =
    currentIdx < sorted.length - 1 ? toInfo(sorted[currentIdx + 1]) : null

  if (!nextTier) {
    return {
      currentTier,
      nextTier: null,
      progressPercent: 100,
      amountToNextTier: 0,
      projectedAdditionalRebate: 0,
    }
  }

  const bracketStart = currentTier.spendMin
  const bracketEnd = nextTier.spendMin
  const progressPercent = Math.max(
    0,
    Math.min(
      100,
      ((currentSpend - bracketStart) / (bracketEnd - bracketStart)) * 100,
    ),
  )
  const amountToNextTier = Math.max(0, bracketEnd - currentSpend)

  // Project: what if the user spent exactly enough to hit nextTier.spendMin?
  // Re-run the rebate engine at that spend and take the delta.
  const engine = method === "marginal" ? calculateMarginal : calculateCumulative
  const rebateNow = engine(currentSpend, tiers).rebateEarned
  const rebateAtNextTier = engine(bracketEnd, tiers).rebateEarned
  const projectedAdditionalRebate = Math.max(0, rebateAtNextTier - rebateNow)

  return {
    currentTier,
    nextTier,
    progressPercent,
    amountToNextTier,
    projectedAdditionalRebate,
  }
}
