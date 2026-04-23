/**
 * v0 spec — reference rebate math, copied verbatim from Charles's v0
 * docs at `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/docs/`.
 *
 * PURPOSE
 *   Oracle ground truth. Whatever this module computes is what the v0
 *   docs say the answer is. The tydei implementation in
 *   `lib/rebates/calculate.ts` / `lib/contracts/accrual.ts` /
 *   `lib/contracts/tie-in.ts` etc. is compared to this module in
 *   `scripts/e2e-synthetic-test.ts` (v0-parity stage). Any divergence
 *   is a bug in tydei — not in this spec.
 *
 * SOURCE
 *   Primary:  docs/contract-calculations.md
 *   Secondary: docs/rebate-optimizer-functionality.md,
 *              docs/cogs-functionality.md
 *
 * CONVENTIONS
 *   - All rebate rates are INTEGER PERCENT (2 for 2%, 3.5 for 3.5%).
 *     Matches the tydei engine's boundary contract; the 100× scaling
 *     from Prisma Decimal happens in `scaleRebateValueForEngine`
 *     before values reach either side of the parity comparison.
 *   - Pure functions. No Prisma, no I/O. Safe to call from the oracle
 *     and from vitest.
 */

export interface V0Tier {
  tierNumber: number
  spendMin: number
  spendMax: number | null
  /** Integer percent — 3 means 3%. */
  rebateValue: number
}

export interface V0RebateResult {
  tierAchieved: number
  rebatePercent: number
  rebateEarned: number
}

/**
 * Cumulative method (docs §2 "Cumulative Method (Most Common)").
 * Entire spend earns the top-qualifying tier's rate. At or above the
 * highest tier's spendMin, ALL spend earns that tier's rate.
 *
 * Doc example: Tiers [($0, 2%), ($50k, 3%), ($100k, 4%)], spend $75k
 *   → Tier 2 at 3%, rebate = $75,000 × 0.03 = $2,250.
 */
export function v0Cumulative(
  spend: number,
  tiers: V0Tier[],
): V0RebateResult {
  if (tiers.length === 0 || spend <= 0) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }
  const sorted = [...tiers].sort((a, b) => a.spendMin - b.spendMin)
  const lowestMin = sorted[0]!.spendMin
  if (spend < lowestMin) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }
  let chosen = sorted[0]!
  for (const t of sorted) {
    if (spend >= t.spendMin) chosen = t
  }
  return {
    tierAchieved: chosen.tierNumber,
    rebatePercent: chosen.rebateValue,
    rebateEarned: spend * (chosen.rebateValue / 100),
  }
}

/**
 * Marginal method (docs §2 "Marginal Method (Tiered Brackets)").
 * Each bracket [spendMin[i], spendMin[i+1]) earns at its own rate; the
 * top bracket is unbounded above. Below the lowest spendMin: no rebate.
 *
 * Doc example: Tiers [($0, 2%), ($50k, 3%), ($100k, 4%)], spend $125k
 *   → $50k × 2% + $50k × 3% + $25k × 4% = $1,000 + $1,500 + $1,000
 *   = $3,500.
 */
export function v0Marginal(
  spend: number,
  tiers: V0Tier[],
): V0RebateResult {
  if (tiers.length === 0 || spend <= 0) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }
  const sorted = [...tiers].sort((a, b) => a.spendMin - b.spendMin)
  const lowestMin = sorted[0]!.spendMin
  if (spend < lowestMin) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }
  let rebate = 0
  let lastTier = sorted[0]!
  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i]!
    if (spend <= tier.spendMin) break
    const nextMin = sorted[i + 1]?.spendMin ?? Infinity
    const bracketEnd = Math.min(spend, nextMin)
    const bracketSpend = Math.max(0, bracketEnd - tier.spendMin)
    rebate += bracketSpend * (tier.rebateValue / 100)
    lastTier = tier
    if (spend <= nextMin) break
  }
  return {
    tierAchieved: lastTier.tierNumber,
    rebatePercent: lastTier.rebateValue,
    rebateEarned: rebate,
  }
}

/**
 * Tier progression (docs §3). Reports the active tier, the next tier,
 * progress % through the current bracket, and amount-to-next.
 *
 * Doc example: tiers [($0, 2%), ($50k, 3%)], current spend $35k
 *   → currentTier Bronze, nextTier Silver, progress 70%,
 *     amountToNextTier $15k.
 */
export interface V0TierProgress {
  currentTierNumber: number
  /** null when at max tier. */
  nextTierNumber: number | null
  progressPct: number
  amountToNextTier: number
}

export function v0TierProgress(
  currentSpend: number,
  tiers: V0Tier[],
): V0TierProgress {
  if (tiers.length === 0) {
    return {
      currentTierNumber: 0,
      nextTierNumber: null,
      progressPct: 0,
      amountToNextTier: 0,
    }
  }
  const sorted = [...tiers].sort((a, b) => a.spendMin - b.spendMin)
  const current = v0Cumulative(currentSpend, sorted)
  const currentIdx = sorted.findIndex(
    (t) => t.tierNumber === current.tierAchieved,
  )
  const next = currentIdx >= 0 ? sorted[currentIdx + 1] : sorted[0]
  if (!next) {
    return {
      currentTierNumber: current.tierAchieved,
      nextTierNumber: null,
      progressPct: 100,
      amountToNextTier: 0,
    }
  }
  const rangeStart = currentIdx >= 0 ? sorted[currentIdx]!.spendMin : 0
  const rangeEnd = next.spendMin
  const rangeSize = rangeEnd - rangeStart
  const spendInRange = Math.max(0, currentSpend - rangeStart)
  const progressPct =
    rangeSize > 0 ? Math.min(100, (spendInRange / rangeSize) * 100) : 0
  return {
    currentTierNumber: current.tierAchieved,
    nextTierNumber: next.tierNumber,
    progressPct,
    amountToNextTier: Math.max(0, rangeEnd - currentSpend),
  }
}

/**
 * Price variance severity bands (docs §6).
 *   |variance| ≤ 2%   → ACCEPTABLE
 *   |variance| ≤ 5%   → WARNING
 *   |variance| > 5%   → CRITICAL
 * Direction: OVERCHARGE when actual > contract, UNDERCHARGE otherwise.
 *
 * Doc example: contract $100, actual $103 → 3% WARNING, OVERCHARGE,
 *   dollarImpact $3 (per unit).
 */
export type V0VarianceSeverity = "ACCEPTABLE" | "WARNING" | "CRITICAL"
export interface V0VarianceResult {
  variancePct: number
  direction: "OVERCHARGE" | "UNDERCHARGE" | "EXACT"
  severity: V0VarianceSeverity
  dollarImpactPerUnit: number
}

export function v0PriceVariance(
  actualPrice: number,
  contractPrice: number,
): V0VarianceResult {
  if (contractPrice <= 0) {
    return {
      variancePct: 0,
      direction: "EXACT",
      severity: "ACCEPTABLE",
      dollarImpactPerUnit: 0,
    }
  }
  const delta = actualPrice - contractPrice
  const variancePct = (delta / contractPrice) * 100
  const abs = Math.abs(variancePct)
  const severity: V0VarianceSeverity =
    abs <= 2 ? "ACCEPTABLE" : abs <= 5 ? "WARNING" : "CRITICAL"
  const direction: V0VarianceResult["direction"] =
    delta > 0 ? "OVERCHARGE" : delta < 0 ? "UNDERCHARGE" : "EXACT"
  return { variancePct, direction, severity, dollarImpactPerUnit: delta }
}

/**
 * Tie-in all-or-nothing compliance (docs §4 "All-or-Nothing Compliance").
 * If every member meets its minimumSpend, base rebate applies to total
 * spend. Optional bonus tiers fire when ALL members exceed by 20% (bonus)
 * or 50% (accelerator).
 *
 * Doc example: minimums [$25k, $40k, $35k], spends [$25k, $40k, $35k]
 *   (exactly compliant), baseRate 2% → rebate = 2% × $100k = $2,000.
 */
export interface V0TieInMember {
  minimumSpend: number
  currentSpend: number
}
export interface V0TieInBundleRebate {
  baseRate: number // integer percent
  bonusRate?: number // integer percent; added to base when all members ≥ 120% of min
  acceleratorMultiplier?: number // applied to (base + bonus) when all ≥ 150%
}
export interface V0TieInResult {
  compliant: boolean
  totalSpend: number
  applicableRate: number // integer percent
  rebateEarned: number
  bonusLevel: "none" | "base" | "bonus" | "accelerator"
}

export function v0TieInAllOrNothing(
  members: V0TieInMember[],
  bundle: V0TieInBundleRebate,
): V0TieInResult {
  const totalSpend = members.reduce((s, m) => s + m.currentSpend, 0)
  const allMet = members.every((m) => m.currentSpend >= m.minimumSpend)
  if (!allMet) {
    return {
      compliant: false,
      totalSpend,
      applicableRate: 0,
      rebateEarned: 0,
      bonusLevel: "none",
    }
  }
  const over20 = members.every((m) => m.currentSpend >= m.minimumSpend * 1.2)
  const over50 = members.every((m) => m.currentSpend >= m.minimumSpend * 1.5)
  let rate = bundle.baseRate
  let level: V0TieInResult["bonusLevel"] = "base"
  if (over50 && bundle.bonusRate != null && bundle.acceleratorMultiplier != null) {
    rate = (bundle.baseRate + bundle.bonusRate) * bundle.acceleratorMultiplier
    level = "accelerator"
  } else if (over20 && bundle.bonusRate != null) {
    rate = bundle.baseRate + bundle.bonusRate
    level = "bonus"
  }
  return {
    compliant: true,
    totalSpend,
    applicableRate: rate,
    rebateEarned: totalSpend * (rate / 100),
    bonusLevel: level,
  }
}

/**
 * Tie-in proportional compliance (docs §4 "Proportional Compliance").
 * Each member contributes weight × min(spend/minimum, 1) to overall
 * compliance. Effective rebate rate = baseRate × overallCompliance.
 *
 * Doc example: weights [0.3, 0.4, 0.3], minimums [$25k, $40k, $35k],
 *   spends [$20k, $40k, $28k] (80%, 100%, 80%) → overall 0.88,
 *   totalSpend $88k, effective rate 2% × 0.88 = 1.76%, rebate
 *   $88k × 1.76% = $1,548.80.
 */
export interface V0TieInProportionalMember extends V0TieInMember {
  weight: number
}
export interface V0TieInProportionalResult {
  overallCompliance: number
  totalSpend: number
  effectiveRate: number // integer percent
  rebateEarned: number
}

export function v0TieInProportional(
  members: V0TieInProportionalMember[],
  baseRate: number,
): V0TieInProportionalResult {
  const overall = members.reduce(
    (sum, m) =>
      sum +
      Math.min(1, m.minimumSpend > 0 ? m.currentSpend / m.minimumSpend : 0) *
        m.weight,
    0,
  )
  const totalSpend = members.reduce((s, m) => s + m.currentSpend, 0)
  const effectiveRate = baseRate * overall
  return {
    overallCompliance: overall,
    totalSpend,
    effectiveRate,
    rebateEarned: totalSpend * (effectiveRate / 100),
  }
}

/**
 * Quarterly true-up (docs §2 "Quarterly True-Up").
 * adjustment = engine(quarterlySpend) − sum(previousMonthlyAccruals).
 * Positive = additional owed; negative = over-accrued.
 */
export interface V0TrueUpResult {
  actualRebate: number
  previousAccruals: number
  adjustment: number
  newTier: number
}

export function v0QuarterlyTrueUp(
  quarterlySpend: number,
  tiers: V0Tier[],
  previousMonthlyAccruals: number[],
  method: "cumulative" | "marginal" = "cumulative",
): V0TrueUpResult {
  const actual = method === "marginal"
    ? v0Marginal(quarterlySpend, tiers)
    : v0Cumulative(quarterlySpend, tiers)
  const previousAccruals = previousMonthlyAccruals.reduce((s, v) => s + v, 0)
  return {
    actualRebate: actual.rebateEarned,
    previousAccruals,
    adjustment: actual.rebateEarned - previousAccruals,
    newTier: actual.tierAchieved,
  }
}

/**
 * Annual settlement (docs §2 "Annual Settlement").
 * finalRebate = engine(annualSpend).
 * settlementAmount = finalRebate − sum(allAccruals).
 */
export interface V0SettlementResult {
  finalRebate: number
  totalAccrued: number
  settlementAmount: number
  achievedTier: number
}

export function v0AnnualSettlement(
  annualSpend: number,
  tiers: V0Tier[],
  allAccruals: number[],
  method: "cumulative" | "marginal" = "cumulative",
): V0SettlementResult {
  const final = method === "marginal"
    ? v0Marginal(annualSpend, tiers)
    : v0Cumulative(annualSpend, tiers)
  const totalAccrued = allAccruals.reduce((s, v) => s + v, 0)
  return {
    finalRebate: final.rebateEarned,
    totalAccrued,
    settlementAmount: final.rebateEarned - totalAccrued,
    achievedTier: final.tierAchieved,
  }
}
