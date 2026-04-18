/**
 * Facility dashboard — monthly spend projection helper.
 *
 * Pure function. Consumes 6-12 months of historical spend plus a
 * partial current-month total and produces the canonical projection
 * widget payload: annual projection, trailing 3-month average, trend
 * signal, and current-month-to-date figure.
 *
 * No Prisma/date-fns imports. Month strings use the canonical YYYY-MM
 * format so inputs are storage-agnostic.
 *
 * Reference: docs/superpowers/specs/2026-04-18-facility-dashboard-rewrite.md §6
 */

export interface MonthlySpendObservation {
  month: string // YYYY-MM
  spend: number
}

export interface SpendProjection {
  projectedAnnualSpend: number
  trailing3MonthAvg: number
  currentMonthToDate: number
  remainingMonthsInYear: number
  /** Signal: "UP" when trailing 3-month avg > prior 3-month avg by >5%, "DOWN" <-5%, else "FLAT". */
  trend: "UP" | "DOWN" | "FLAT"
}

export interface SpendProjectionInput {
  history: MonthlySpendObservation[] // last 6-12 months
  currentMonthToDate: number // current-month partial spend
  referenceDate?: Date
}

/** Return YYYY-MM for a date, using UTC to avoid timezone drift. */
function toYearMonth(d: Date): string {
  const year = d.getUTCFullYear().toString().padStart(4, "0")
  const month = (d.getUTCMonth() + 1).toString().padStart(2, "0")
  return `${year}-${month}`
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

/**
 * Project annualized spend from recent monthly history and current
 * month-to-date.
 *
 * Algorithm:
 *   1. Sort history ascending by month (YYYY-MM string compare).
 *   2. Strip any observation whose month === current month
 *      (callers sometimes include a partial row that would double-count
 *      against currentMonthToDate).
 *   3. trailing3MonthAvg = mean of last 3 full months in history.
 *   4. prior3MonthAvg = mean of months 4-6 from end.
 *   5. trend: delta = (trailing - prior) / prior × 100
 *        > 5 → UP, < -5 → DOWN, else FLAT. FLAT when prior == 0.
 *   6. remainingMonthsInYear = 12 - referenceDate.getUTCMonth() - 1
 *      (excludes current month).
 *   7. projectedAnnualSpend =
 *        sum(full months in history this year) +
 *        currentMonthToDate +
 *        (remainingMonthsInYear × trailing3MonthAvg)
 */
export function projectAnnualSpend(
  input: SpendProjectionInput,
): SpendProjection {
  const { history, currentMonthToDate, referenceDate = new Date() } = input

  const currentYearMonth = toYearMonth(referenceDate)
  const currentYear = referenceDate.getUTCFullYear()

  const sorted = [...history].sort((a, b) => a.month.localeCompare(b.month))
  const fullMonths = sorted.filter((o) => o.month !== currentYearMonth)

  const lastThree = fullMonths.slice(-3).map((o) => o.spend)
  const priorThree = fullMonths.slice(-6, -3).map((o) => o.spend)

  const trailing3MonthAvg = meanOf(lastThree)
  const prior3MonthAvg = meanOf(priorThree)

  let trend: SpendProjection["trend"] = "FLAT"
  if (prior3MonthAvg !== 0) {
    const deltaPct = ((trailing3MonthAvg - prior3MonthAvg) / prior3MonthAvg) * 100
    if (deltaPct > 5) trend = "UP"
    else if (deltaPct < -5) trend = "DOWN"
    else trend = "FLAT"
  }

  const remainingMonthsInYear = Math.max(
    0,
    12 - referenceDate.getUTCMonth() - 1,
  )

  const yearPrefix = `${currentYear.toString().padStart(4, "0")}-`
  const fullMonthsThisYearSpend = fullMonths
    .filter((o) => o.month.startsWith(yearPrefix))
    .reduce((sum, o) => sum + o.spend, 0)

  const projectedAnnualSpend =
    fullMonthsThisYearSpend +
    currentMonthToDate +
    remainingMonthsInYear * trailing3MonthAvg

  return {
    projectedAnnualSpend,
    trailing3MonthAvg,
    currentMonthToDate,
    remainingMonthsInYear,
    trend,
  }
}
