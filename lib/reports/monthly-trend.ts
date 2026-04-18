/**
 * Reports hub — monthly spend + rebate trend.
 *
 * Pure function: takes per-transaction spend + per-contract rebate
 * rows, buckets by YYYY-MM, returns a series covering the last N months
 * (default 12). Fills missing months with zero so the resulting chart
 * shape is continuous.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.0
 */

export interface SpendRecord {
  /** Transaction date — bucketing uses UTC year+month. */
  transactionDate: Date
  /** Dollars. */
  extendedPrice: number
}

export interface RebateRecord {
  /** Period end date — bucketing uses UTC year+month of this date. */
  periodEndDate: Date
  rebateEarned: number
}

export interface MonthlyTrendPoint {
  /** YYYY-MM */
  month: string
  spend: number
  rebate: number
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * Build a monthly trend series with a fixed N-month window ending at
 * `referenceDate` (defaults to `new Date()`). Every month in the window
 * appears in the output — missing months are zero-filled.
 */
export function buildMonthlySpendRebateTrend(
  spend: SpendRecord[],
  rebates: RebateRecord[],
  options?: {
    months?: number
    referenceDate?: Date
  },
): MonthlyTrendPoint[] {
  const months = options?.months ?? 12
  const ref = options?.referenceDate ?? new Date()

  // Build keys for every month in the window, oldest → newest.
  const windowKeys: string[] = []
  const cursor = new Date(
    Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - (months - 1), 1),
  )
  for (let i = 0; i < months; i++) {
    windowKeys.push(monthKey(cursor))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }

  const inWindow = new Set(windowKeys)

  // Aggregate spend by month.
  const spendByMonth = new Map<string, number>()
  for (const s of spend) {
    const key = monthKey(s.transactionDate)
    if (!inWindow.has(key)) continue
    spendByMonth.set(key, (spendByMonth.get(key) ?? 0) + s.extendedPrice)
  }

  // Aggregate rebates by month.
  const rebateByMonth = new Map<string, number>()
  for (const r of rebates) {
    const key = monthKey(r.periodEndDate)
    if (!inWindow.has(key)) continue
    rebateByMonth.set(key, (rebateByMonth.get(key) ?? 0) + r.rebateEarned)
  }

  return windowKeys.map((k) => ({
    month: k,
    spend: spendByMonth.get(k) ?? 0,
    rebate: rebateByMonth.get(k) ?? 0,
  }))
}
