/**
 * Seasonal decomposition — monthly multipliers.
 *
 * Ported from the v0 prototype's `lib/forecasting.ts`. Given a monthly
 * time series, returns a Map<month 0..11, factor> where each factor is
 * that month's average value ÷ the mean of all monthly averages.
 * Factor 1.2 means "that month typically runs 20% above average."
 *
 * Used to de-trend a linear-regression forecast so projected years
 * reflect the facility's actual seasonal shape — hospital supply
 * spend frequently peaks in Q1/Q4 (elective-surgery schedules).
 *
 * Returns empty Map when fewer than 12 months of history (no meaningful
 * season signal).
 */

export interface SeasonalPoint {
  /** JS `Date`, or anything `new Date()` accepts. */
  date: Date | string
  value: number
}

export function calculateSeasonalFactors(
  data: readonly SeasonalPoint[],
): Map<number, number> {
  if (data.length < 12) return new Map()

  const monthlyTotals = new Map<number, { sum: number; count: number }>()
  for (const point of data) {
    const month = new Date(point.date).getMonth()
    const existing = monthlyTotals.get(month) ?? { sum: 0, count: 0 }
    monthlyTotals.set(month, {
      sum: existing.sum + point.value,
      count: existing.count + 1,
    })
  }

  const monthlyAverages = new Map<number, number>()
  let sumOfAverages = 0
  let distinctMonths = 0
  for (const [month, { sum, count }] of monthlyTotals) {
    const avg = count > 0 ? sum / count : 0
    monthlyAverages.set(month, avg)
    sumOfAverages += avg
    distinctMonths += 1
  }

  const mean = distinctMonths > 0 ? sumOfAverages / distinctMonths : 0
  if (mean === 0) return new Map()

  const factors = new Map<number, number>()
  for (const [month, avg] of monthlyAverages) {
    factors.set(month, avg / mean)
  }
  return factors
}
