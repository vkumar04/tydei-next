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
} from "@/lib/rebates/calculate"

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
export type EvaluationPeriod =
  | "annual"
  | "monthly"
  | "quarterly"
  | "semi_annual"

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
  // on its own. Use the engine's rebateEarned directly for both
  // cumulative and marginal methods. Charles 2026-04-21: previously
  // the cumulative branch recomputed accruedAmount as (spend × percent
  // / 100), which zeroes fixed_rebate tiers (their rebatePercent is 0
  // but rebateEarned is the flat dollar amount). Trust the engine.
  if (evaluationPeriod === "monthly") {
    const result = fn(monthlySpend, tiers)
    return {
      accruedAmount: result.rebateEarned,
      tierAchieved: result.tierAchieved,
      rebatePercent: result.rebatePercent,
    }
  }

  // ─── Quarterly + semi-annual evaluation period ───────────────────
  // Vick rule (2026-04-20): tier qualification resets at every
  // evaluation-period boundary. The caller
  // (`buildMonthlyAccruals` / callers that do their own windowing)
  // supplies the accumulated in-period spend via `rollingWindowSpend`
  // so this function stays pure; the engine just runs the engine on
  // that window and attributes THIS month's slice of the rebate.
  if (evaluationPeriod === "quarterly" || evaluationPeriod === "semi_annual") {
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
    // Cumulative: attribute THIS month's slice of the period's rebate.
    // For percent-of-spend tiers: (monthlySpend × percent / 100) is
    // exactly the slice. For fixed_rebate tiers: rebatePercent is 0 but
    // the flat amount was already earned at qualification — prefer the
    // engine's rebateEarned, and attribute the slice proportional to
    // how much of the window this month represents.
    const result = fn(windowSpend, tiers)
    const percentSlice = (monthlySpend * result.rebatePercent) / 100
    const windowShare = windowSpend > 0 ? monthlySpend / windowSpend : 0
    const fixedSlice = percentSlice === 0
      ? result.rebateEarned * windowShare
      : 0
    return {
      accruedAmount: percentSlice + fixedSlice,
      tierAchieved: result.tierAchieved,
      rebatePercent: result.rebatePercent,
    }
  }

  // ─── Annual evaluation period (default) ──────────────────────────
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
  // Mirrors the quarterly/semi-annual branch: percent math is the
  // month × percent slice; fixed_rebate tiers have rebatePercent = 0
  // but rebateEarned holds the flat dollars — attribute
  // proportionally to the month's share of in-period spend.
  const result = fn(cumulativeSpendEndOfMonth, tiers)
  const percentSlice = (monthlySpend * result.rebatePercent) / 100
  const windowShare =
    cumulativeSpendEndOfMonth > 0 ? monthlySpend / cumulativeSpendEndOfMonth : 0
  const fixedSlice =
    percentSlice === 0 ? result.rebateEarned * windowShare : 0
  return {
    accruedAmount: percentSlice + fixedSlice,
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
  const rows: TimelineRow[] = []

  // Vick rule (2026-04-20): tier qualification RESETS at every
  // evaluation-period boundary. If the contract evaluates quarterly
  // and tiers are 0-100 / 101-200, Q1 spend of $150 qualifies tier 2,
  // then Q2 starts fresh at $0 — a Q2 spend of $50 qualifies tier 1,
  // not a tier-2 holdover from Q1.
  //
  // `cumulative` therefore resets at the start of each period:
  //   monthly    — resets every month (= this month's spend only)
  //   quarterly  — resets at calendar quarters (Jan-Mar, Apr-Jun, …)
  //   semi_annual— resets at H1/H2 (Jan-Jun, Jul-Dec)
  //   annual     — resets at calendar-year boundaries (Jan 1)
  //
  // Previously this function ran a lifetime cumulative across the
  // whole series AND used a rolling-3-month window for quarterly,
  // both of which carried spend across periods and violated the rule.
  function periodKeyFor(month: string): string {
    const [y, m] = month.split("-").map((n) => Number(n))
    if (evaluationPeriod === "monthly") return month
    if (evaluationPeriod === "quarterly") {
      const q = Math.floor((m - 1) / 3) + 1
      return `${y}-Q${q}`
    }
    if (evaluationPeriod === "semi_annual") {
      const h = m <= 6 ? 1 : 2
      return `${y}-H${h}`
    }
    return `${y}`
  }

  // Two trackers:
  //   `windowSpend` — period-scoped, RESETS at each period boundary.
  //      Feeds the rebate engine (tier qualification per Vick rule).
  //   `displayCumulative` — lifetime running total across the whole
  //      series. Feeds the timeline `cumulativeSpend` column so the UI
  //      shows a clean running line (Charles W1.X-B).
  let currentPeriod: string | null = null
  let windowSpend = 0
  let displayCumulative = 0

  for (const entry of series) {
    const periodKey = periodKeyFor(entry.month)
    if (periodKey !== currentPeriod) {
      currentPeriod = periodKey
      windowSpend = 0
    }
    windowSpend += entry.spend
    displayCumulative += entry.spend

    // For calculateMonthlyAccrual:
    //   - quarterly/semi-annual branches read `rollingWindowSpend` —
    //     pass the current period's accumulated spend so the engine
    //     evaluates against the reset window.
    //   - annual branch reads `cumulativeSpendEndOfMonth` — pass the
    //     in-year window (resets Jan 1 via periodKeyFor).
    const rollingWindowSpend =
      evaluationPeriod === "quarterly" || evaluationPeriod === "semi_annual"
        ? windowSpend
        : undefined

    const accrual = calculateMonthlyAccrual(
      entry.spend,
      windowSpend, // in-period cumulative, NOT lifetime
      tiers,
      method,
      evaluationPeriod,
      rollingWindowSpend,
    )
    rows.push({
      month: entry.month,
      spend: entry.spend,
      cumulativeSpend: displayCumulative,
      accruedAmount: accrual.accruedAmount,
      tierAchieved: accrual.tierAchieved,
      rebatePercent: accrual.rebatePercent,
    })
  }

  return rows
}

// ─── Multi-term aggregation (Charles R5.29) ─────────────────────────

/**
 * One term's config, used by `buildMultiTermMonthlyAccruals` to compute
 * its own accrual series before summing across terms.
 *
 * `effectiveStart` / `effectiveEnd` (if provided) bound which months
 * this term contributes to. A null/undefined bound is treated as open
 * (−∞ for start, +∞ for end).
 */
export interface TermAccrualConfig {
  tiers: TierLike[]
  method: RebateMethodName
  evaluationPeriod: EvaluationPeriod
  effectiveStart?: Date | null
  effectiveEnd?: Date | null
}

/**
 * Charles R5.29: contracts with multiple terms (e.g. "Qualified Annual
 * Spend Rebate" + "Distal Extremities Rebate") were under-reporting
 * because the accrual engine iterated only `contract.terms[0]`. Every
 * additional term's rebates silently dropped on the floor.
 *
 * This helper runs the existing per-term accrual pipeline for EACH
 * term, then sums the per-month accrued amounts across terms. The
 * returned rows have:
 *   - `accruedAmount`: SUM of every contributing term's accrual for
 *     the month.
 *   - `tierAchieved` / `rebatePercent`: pulled from the term with the
 *     largest accrual contribution in that month (primarily for the
 *     `[auto-accrual]` notes label — aggregates don't rely on these).
 *   - `termContributions`: which term ids fed the total, used to shape
 *     the notes string.
 *
 * A term only contributes to a month whose `YYYY-MM` falls inside the
 * term's `[effectiveStart, effectiveEnd]` window (inclusive). Terms
 * with no bounds contribute to every month in `series`.
 */
export interface MultiTermTimelineRow extends TimelineRow {
  termContributions: {
    termIndex: number
    accruedAmount: number
    tierAchieved: number
    rebatePercent: number
  }[]
}

function monthKeyToDate(key: string): Date {
  const [year, month] = key.split("-").map((n) => Number(n))
  return new Date(Date.UTC(year, month - 1, 1))
}

function monthKeyEndOfMonth(key: string): Date {
  const [year, month] = key.split("-").map((n) => Number(n))
  return new Date(Date.UTC(year, month, 0))
}

// ─── Cadence-aware bucketing (Charles W1.O) ─────────────────────────

/**
 * Rebate ledger cadence — matches the `PaymentCadence` enum on
 * `ContractTerm`. Used to group monthly accrual rows into cadence-sized
 * buckets before writing Rebate rows. `getAccrualTimeline` still returns
 * monthly rows; only the persisted Rebate ledger honors this bucket.
 */
export type PaymentCadence = "monthly" | "quarterly" | "annual"

export interface CadenceBucket {
  /** Period start at UTC midnight. */
  periodStart: Date
  /** Period end at UTC last-moment-of-day. */
  periodEnd: Date
  /** Sum of `accruedAmount` across all months in this bucket. */
  rebateEarned: number
  /** Sum of `spend` across all months in this bucket. */
  totalSpend: number
  /** Label shaped like "Q2 2025" / "May 2025" / "2025" for notes. */
  label: string
  /** Representative tier (from the largest-contribution month). */
  tierAchieved: number
  /** Representative rebate percent (from the largest-contribution month). */
  rebatePercent: number
  /** Distinct term indices that contributed any accrual in this bucket. */
  termCount: number
}

function bucketKey(month: string, cadence: PaymentCadence): string {
  const [year, mm] = month.split("-").map((n) => Number(n))
  if (cadence === "annual") return `${year}`
  if (cadence === "quarterly") {
    const quarter = Math.floor((mm - 1) / 3) + 1
    return `${year}-Q${quarter}`
  }
  return month
}

function bucketBounds(
  key: string,
  cadence: PaymentCadence,
): { periodStart: Date; periodEnd: Date; label: string } {
  if (cadence === "annual") {
    const year = Number(key)
    return {
      periodStart: new Date(Date.UTC(year, 0, 1)),
      periodEnd: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
      label: `${year}`,
    }
  }
  if (cadence === "quarterly") {
    const [yearStr, qStr] = key.split("-Q")
    const year = Number(yearStr)
    const q = Number(qStr)
    const startMonth = (q - 1) * 3
    return {
      // Last day of quarter = day 0 of month after the quarter's last month.
      periodStart: new Date(Date.UTC(year, startMonth, 1)),
      periodEnd: new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999)),
      label: `Q${q} ${year}`,
    }
  }
  // Monthly: key is "YYYY-MM".
  const [year, mm] = key.split("-").map((n) => Number(n))
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ]
  return {
    periodStart: new Date(Date.UTC(year, mm - 1, 1)),
    periodEnd: new Date(Date.UTC(year, mm, 0, 23, 59, 59, 999)),
    label: `${monthNames[mm - 1]} ${year}`,
  }
}

/**
 * Charles W1.O: collapse the monthly accrual rows produced by
 * `buildMultiTermMonthlyAccruals` into cadence-sized buckets (monthly,
 * quarterly, annual) before the caller persists them to the Rebate
 * ledger. For monthly cadence this is effectively a passthrough — one
 * bucket per non-zero month. For quarterly, months collapse into
 * calendar quarters (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec). For annual,
 * into calendar years.
 *
 * Zero-spend buckets are dropped. Representative tier/percent are
 * pulled from the month with the largest `accruedAmount` in the bucket
 * so the notes label reads naturally for single-term contracts; the
 * notes string itself is shaped by the caller.
 */
export function bucketAccrualsByCadence(
  rows: MultiTermTimelineRow[],
  cadence: PaymentCadence,
): CadenceBucket[] {
  const byKey = new Map<
    string,
    {
      rebateEarned: number
      totalSpend: number
      topContribution: number
      tierAchieved: number
      rebatePercent: number
      termIndices: Set<number>
    }
  >()

  for (const row of rows) {
    if (row.accruedAmount <= 0) continue
    const key = bucketKey(row.month, cadence)
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = {
        rebateEarned: 0,
        totalSpend: 0,
        topContribution: -1,
        tierAchieved: 0,
        rebatePercent: 0,
        termIndices: new Set<number>(),
      }
      byKey.set(key, bucket)
    }
    bucket.rebateEarned += row.accruedAmount
    bucket.totalSpend += row.spend
    for (const c of row.termContributions) {
      bucket.termIndices.add(c.termIndex)
    }
    // Use the month with the largest per-month accrual as the
    // "representative" for tier/percent labeling.
    if (row.accruedAmount > bucket.topContribution) {
      bucket.topContribution = row.accruedAmount
      bucket.tierAchieved = row.tierAchieved
      bucket.rebatePercent = row.rebatePercent
    }
  }

  const result: CadenceBucket[] = []
  // Sort keys chronologically. For "YYYY" or "YYYY-MM" or "YYYY-QN" the
  // lexicographic order coincides with chronological order.
  const sortedKeys = Array.from(byKey.keys()).sort()
  for (const key of sortedKeys) {
    const bucket = byKey.get(key)!
    const bounds = bucketBounds(key, cadence)
    result.push({
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      rebateEarned: bucket.rebateEarned,
      totalSpend: bucket.totalSpend,
      label: bounds.label,
      tierAchieved: bucket.tierAchieved,
      rebatePercent: bucket.rebatePercent,
      termCount: bucket.termIndices.size,
    })
  }
  return result
}

// ─── Evaluation-period aggregation (Charles W1.W-B1) ────────────────

/**
 * Number of months in one evaluation-period window. Annual = 12,
 * semi-annual = 6, quarterly = 3, monthly = 1. Anything outside the
 * known enum values falls back to annual (safest: one big bucket).
 */
function monthsInEvaluationPeriod(evaluationPeriod: EvaluationPeriod): number {
  if (evaluationPeriod === "monthly") return 1
  if (evaluationPeriod === "quarterly") return 3
  if (evaluationPeriod === "semi_annual") return 6
  return 12
}

export interface EvaluationPeriodBucket {
  /** Period start at UTC midnight (aligned to `effectiveStart`'s month). */
  periodStart: Date
  /** Period end at UTC last-moment-of-day. periodStart + N months − 1 day. */
  periodEnd: Date
  /** Aggregate COG spend across every month in this window. */
  totalSpend: number
  /** Aggregate rebate earned: engine run once on `totalSpend`. */
  rebateEarned: number
  /** Tier hit by `totalSpend`. */
  tierAchieved: number
  /** Rate at the achieved tier. */
  rebatePercent: number
  /** "2025" / "Q2 2025" / "H1 2025" / "May 2025" — for notes. */
  label: string
}

function addMonthsUTC(d: Date, months: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()),
  )
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

function formatPeriodLabel(
  start: Date,
  evaluationPeriod: EvaluationPeriod,
): string {
  const year = start.getUTCFullYear()
  const month = start.getUTCMonth() // 0-indexed
  if (evaluationPeriod === "annual") {
    return `${year}`
  }
  if (evaluationPeriod === "semi_annual") {
    const half = month < 6 ? 1 : 2
    return `H${half} ${year}`
  }
  if (evaluationPeriod === "quarterly") {
    const q = Math.floor(month / 3) + 1
    return `Q${q} ${year}`
  }
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ]
  return `${monthNames[month]} ${year}`
}

/**
 * Charles W1.W-B1: for terms whose `evaluationPeriod` is longer than a
 * month (annual / semi-annual / quarterly), tier qualification is
 * determined by AGGREGATE spend over the full evaluation window, not by
 * per-month deltas. The ledger must emit ONE Rebate row at period-end,
 * carrying the full-period spend and the full-period earned value.
 *
 * Prior to this helper the recompute pipeline iterated monthly rows and
 * accrued a sliver every month, which Charles reported as "annual-eval
 * contracts accruing monthly with $0 spend and non-zero earned" — the
 * per-month accruals clocked in as scattered non-zero rows instead of
 * one clean year-end row.
 *
 * Semantics:
 *   - Windows are ALIGNED to `effectiveStart.month`: an annual term
 *     starting 2025-03-15 produces windows 2025-03-01→2026-02-28,
 *     2026-03-01→2027-02-28, etc. Windows align to month boundaries so
 *     YYYY-MM spend buckets fall cleanly in/out.
 *   - A window is only emitted when its LAST day ≤ `boundedUntil`
 *     (defaults to the last month of the series). Windows whose
 *     period-end has not yet completed are DROPPED — the "earned ≤
 *     today" ledger filter expects no auto-accrual rows past today, and
 *     a 2025-01-01 annual term on 2025-06-12 should not show a year-end
 *     $0 row yet.
 *   - For `monthly` evaluation period, this helper is a passthrough —
 *     one bucket per input month (no aggregation). The caller should
 *     continue to use `bucketAccrualsByCadence` for monthly-eval
 *     contracts, which honors the contract's paymentCadence.
 */
export function buildEvaluationPeriodAccruals(
  series: MonthlySpend[],
  tiers: TierLike[],
  method: RebateMethodName,
  evaluationPeriod: EvaluationPeriod,
  effectiveStart: Date,
  options?: { boundedUntil?: Date },
): EvaluationPeriodBucket[] {
  if (series.length === 0 || tiers.length === 0) return []

  const width = monthsInEvaluationPeriod(evaluationPeriod)
  const fn = engine(method)

  const byMonth = new Map<string, number>()
  for (const s of series) byMonth.set(s.month, s.spend)

  const firstWindowStart = new Date(
    Date.UTC(
      effectiveStart.getUTCFullYear(),
      effectiveStart.getUTCMonth(),
      1,
    ),
  )
  const lastSeriesMonthKey = series[series.length - 1].month
  const [lsY, lsM] = lastSeriesMonthKey.split("-").map((n) => Number(n))
  const seriesLastMonthEnd = new Date(Date.UTC(lsY, lsM, 0, 23, 59, 59, 999))
  const boundedUntil = options?.boundedUntil ?? seriesLastMonthEnd

  const buckets: EvaluationPeriodBucket[] = []
  let cursorStart = firstWindowStart
  const maxIterations = 40 * (12 / width)
  for (let iter = 0; iter < maxIterations; iter++) {
    const nextStart = addMonthsUTC(cursorStart, width)
    const periodEnd = new Date(nextStart.getTime() - 1)

    if (periodEnd.getTime() > boundedUntil.getTime()) break

    let totalSpend = 0
    const monthCursor = new Date(cursorStart)
    while (monthCursor.getTime() < nextStart.getTime()) {
      const key = monthKey(monthCursor)
      totalSpend += byMonth.get(key) ?? 0
      monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1)
    }

    const result = fn(totalSpend, tiers)
    buckets.push({
      periodStart: cursorStart,
      periodEnd,
      totalSpend,
      rebateEarned: result.rebateEarned,
      tierAchieved: result.tierAchieved,
      rebatePercent: result.rebatePercent,
      label: formatPeriodLabel(cursorStart, evaluationPeriod),
    })

    cursorStart = nextStart
  }

  return buckets
}

export function buildMultiTermMonthlyAccruals(
  series: MonthlySpend[],
  terms: TermAccrualConfig[],
): MultiTermTimelineRow[] {
  if (terms.length === 0) {
    return series.map((entry, i) => ({
      month: entry.month,
      spend: entry.spend,
      cumulativeSpend: series
        .slice(0, i + 1)
        .reduce((s, e) => s + e.spend, 0),
      accruedAmount: 0,
      tierAchieved: 0,
      rebatePercent: 0,
      termContributions: [],
    }))
  }

  // Compute each term's full accrual series, then index by month for
  // aggregation. Each term sees the SAME spend series — per-term spend
  // splits would require product-level attribution we don't track.
  const perTermRows: TimelineRow[][] = terms.map((t) =>
    buildMonthlyAccruals(series, t.tiers, t.method, t.evaluationPeriod),
  )

  let runningCumulative = 0
  return series.map((entry, i) => {
    runningCumulative += entry.spend

    const monthStart = monthKeyToDate(entry.month)
    const monthEnd = monthKeyEndOfMonth(entry.month)

    let total = 0
    let bestTier = 0
    let bestPercent = 0
    let bestContribution = -1
    const contributions: MultiTermTimelineRow["termContributions"] = []

    for (let t = 0; t < terms.length; t++) {
      const term = terms[t]
      // Term window check — treat null bounds as open.
      const startOk =
        term.effectiveStart == null || term.effectiveStart <= monthEnd
      const endOk =
        term.effectiveEnd == null || term.effectiveEnd >= monthStart
      if (!startOk || !endOk) continue

      const row = perTermRows[t][i]
      if (!row || row.accruedAmount <= 0) {
        // Still record zero-contributions so the caller can see which
        // terms were considered. Skip for now to keep the list tight.
        continue
      }
      total += row.accruedAmount
      contributions.push({
        termIndex: t,
        accruedAmount: row.accruedAmount,
        tierAchieved: row.tierAchieved,
        rebatePercent: row.rebatePercent,
      })
      if (row.accruedAmount > bestContribution) {
        bestContribution = row.accruedAmount
        bestTier = row.tierAchieved
        bestPercent = row.rebatePercent
      }
    }

    return {
      month: entry.month,
      spend: entry.spend,
      cumulativeSpend: runningCumulative,
      accruedAmount: total,
      tierAchieved: bestTier,
      rebatePercent: bestPercent,
      termContributions: contributions,
    }
  })
}
