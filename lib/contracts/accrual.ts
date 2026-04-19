/**
 * Rebate accrual schedule engines.
 *
 * Spec section 2.2 of contract-calculations.md. Three concepts:
 * - Monthly accrual: each month's spend × currently-achieved rebate rate,
 *   recorded as it happens.
 * - Quarterly true-up: compare cumulative actual rebate at quarter-end to
 *   the sum of accruals so far; emit a positive/negative adjustment.
 * - Annual settlement: final rebate vs total accruals across the year.
 *
 * All three build on the subsystem-1 rebate engine so cumulative and
 * marginal methods stay consistent.
 */
import {
  calculateCumulative,
  calculateMarginal,
  type TierLike,
  type RebateMethodName,
} from "@/lib/contracts/rebate-method"

function engine(method: RebateMethodName) {
  return method === "marginal" ? calculateMarginal : calculateCumulative
}

/**
 * Contract evaluation cadence for tier qualification.
 *
 * - `annual` (default): tier is determined by cumulative-year spend. A
 *   facility must reach tier 1's spendMin in total spend before the
 *   first dollar of rebate accrues.
 * - `monthly`: tier is determined by THIS MONTH'S spend. Each month the
 *   facility earns the rebate at whichever tier its monthly spend
 *   qualifies for — small facilities can earn tier 1 rebates every
 *   month without waiting a year to cross an annual threshold.
 * - `quarterly`: tier is determined by a rolling 3-month spend window.
 *
 * Charles (R4.6): "I made the evaluation period monthly and still no
 * rebate calculated" — before this fix the accrual engine ignored
 * `ContractTerm.evaluationPeriod` entirely and always tier-matched on
 * cumulative annual spend, so a monthly-eval contract with tier 1 at
 * spendMin=$300k and monthly spend of $30k never qualified for any
 * rebate even though each individual month was supposed to stand alone.
 */
export type EvaluationPeriod = "annual" | "monthly" | "quarterly"

// ─── Monthly accrual ────────────────────────────────────────────────

export interface MonthlyAccrualResult {
  accruedAmount: number
  tierAchieved: number
  rebatePercent: number
}

/**
 * Accrue a single month's rebate. For cumulative method: monthlySpend at
 * the tier rate the contract has reached *by end-of-month* (cumulativeSpend
 * includes this month). For marginal method: rebate is the delta between
 * marginal rebate at the end cumulative spend vs at the prior cumulative
 * spend — i.e. the rebate earned on *this month's* spend, correctly split
 * across any bracket boundaries it may have crossed.
 */
export function calculateMonthlyAccrual(
  monthlySpend: number,
  cumulativeSpendEndOfMonth: number,
  tiers: TierLike[],
  method: RebateMethodName = "cumulative",
  evaluationPeriod: EvaluationPeriod = "annual",
  rollingWindowSpend?: number,
): MonthlyAccrualResult {
  if (monthlySpend <= 0 || tiers.length === 0) {
    return { accruedAmount: 0, tierAchieved: 0, rebatePercent: 0 }
  }

  const fn = engine(method)

  // ─── Monthly evaluation period (Charles R4.6) ────────────────────
  // Tier is determined by THIS month's spend alone — each month stands
  // on its own. For marginal, bracket math is scoped to monthly spend
  // rather than cumulative spend, so the full earned amount is returned.
  if (evaluationPeriod === "monthly") {
    if (method === "marginal") {
      const end = fn(monthlySpend, tiers)
      return {
        accruedAmount: end.rebateEarned,
        tierAchieved: end.tierAchieved,
        rebatePercent: end.rebatePercent,
      }
    }
    const result = fn(monthlySpend, tiers)
    return {
      accruedAmount: (monthlySpend * result.rebatePercent) / 100,
      tierAchieved: result.tierAchieved,
      rebatePercent: result.rebatePercent,
    }
  }

  // ─── Quarterly evaluation period ─────────────────────────────────
  // Tier is determined by a rolling 3-month window; rebate accrues on
  // THIS month's spend at that tier's rate. Callers supply the
  // rolling-window total so this function stays pure.
  if (evaluationPeriod === "quarterly") {
    const windowSpend = rollingWindowSpend ?? monthlySpend
    if (method === "marginal") {
      const prior = Math.max(0, windowSpend - monthlySpend)
      const end = fn(windowSpend, tiers)
      const start = fn(prior, tiers)
      return {
        accruedAmount: end.rebateEarned - start.rebateEarned,
        tierAchieved: end.tierAchieved,
        rebatePercent: end.rebatePercent,
      }
    }
    const result = fn(windowSpend, tiers)
    return {
      accruedAmount: (monthlySpend * result.rebatePercent) / 100,
      tierAchieved: result.tierAchieved,
      rebatePercent: result.rebatePercent,
    }
  }

  // ─── Annual evaluation period (default, unchanged) ───────────────
  if (method === "marginal") {
    const prior = Math.max(0, cumulativeSpendEndOfMonth - monthlySpend)
    const end = fn(cumulativeSpendEndOfMonth, tiers)
    const start = fn(prior, tiers)
    return {
      accruedAmount: end.rebateEarned - start.rebateEarned,
      tierAchieved: end.tierAchieved,
      rebatePercent: end.rebatePercent,
    }
  }

  // Cumulative: month's spend earns the end-of-month tier rate.
  const result = fn(cumulativeSpendEndOfMonth, tiers)
  return {
    accruedAmount: (monthlySpend * result.rebatePercent) / 100,
    tierAchieved: result.tierAchieved,
    rebatePercent: result.rebatePercent,
  }
}

// ─── Quarterly true-up ──────────────────────────────────────────────

export interface QuarterlyTrueUpResult {
  actualRebate: number
  previousAccruals: number
  adjustment: number
  newTier: number
}

export function calculateQuarterlyTrueUp(
  quarterlySpend: number,
  tiers: TierLike[],
  previousAccruals: number[],
  method: RebateMethodName = "cumulative",
): QuarterlyTrueUpResult {
  const actual = engine(method)(quarterlySpend, tiers)
  const previous = previousAccruals.reduce((s, v) => s + v, 0)
  return {
    actualRebate: actual.rebateEarned,
    previousAccruals: previous,
    adjustment: actual.rebateEarned - previous,
    newTier: actual.tierAchieved,
  }
}

// ─── Annual settlement ──────────────────────────────────────────────

export interface AnnualSettlementResult {
  finalRebate: number
  totalAccrued: number
  settlementAmount: number
  achievedTier: number
}

export function calculateAnnualSettlement(
  annualSpend: number,
  tiers: TierLike[],
  allAccruals: number[],
  method: RebateMethodName = "cumulative",
): AnnualSettlementResult {
  const final = engine(method)(annualSpend, tiers)
  const totalAccrued = allAccruals.reduce((s, v) => s + v, 0)
  return {
    finalRebate: final.rebateEarned,
    totalAccrued,
    settlementAmount: final.rebateEarned - totalAccrued,
    achievedTier: final.tierAchieved,
  }
}

// ─── Timeline builder (convenience) ─────────────────────────────────

export interface MonthlySpend {
  month: string // YYYY-MM
  spend: number
}

export interface TimelineRow {
  month: string
  spend: number
  cumulativeSpend: number
  accruedAmount: number
  tierAchieved: number
  rebatePercent: number
}

/**
 * Walk a monthly-spend series and return a running accrual timeline.
 * Each row carries the cumulative-spend-to-date so UIs can render the
 * tier journey without recomputing it.
 */
export function buildMonthlyAccruals(
  series: MonthlySpend[],
  tiers: TierLike[],
  method: RebateMethodName = "cumulative",
  evaluationPeriod: EvaluationPeriod = "annual",
): TimelineRow[] {
  let cumulative = 0
  const rows: TimelineRow[] = []

  for (let i = 0; i < series.length; i++) {
    const entry = series[i]
    cumulative += entry.spend
    // 3-month trailing sum for quarterly eval period (inclusive of current).
    const rollingWindowSpend =
      evaluationPeriod === "quarterly"
        ? series
            .slice(Math.max(0, i - 2), i + 1)
            .reduce((sum, e) => sum + e.spend, 0)
        : undefined
    const accrual = calculateMonthlyAccrual(
      entry.spend,
      cumulative,
      tiers,
      method,
      evaluationPeriod,
      rollingWindowSpend,
    )
    rows.push({
      month: entry.month,
      spend: entry.spend,
      cumulativeSpend: cumulative,
      accruedAmount: accrual.accruedAmount,
      tierAchieved: accrual.tierAchieved,
      rebatePercent: accrual.rebatePercent,
    })
  }

  return rows
}
