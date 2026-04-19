/**
 * Aggregates Rebate rows into one bucket per calendar quarter for the
 * "Rebate by Quarter" chart on the contract detail Performance tab
 * (Charles R5.32).
 *
 * Rules — must match the "Rebates Earned (YTD)" card on the same page:
 *   - Earned is summed from `rebateEarned`, bucketed by `payPeriodEnd`
 *     quarter, and ONLY counts rows whose `payPeriodEnd` has already
 *     passed (closed periods). Per CLAUDE.md: "Earned counts only
 *     periods where payPeriodEnd <= today".
 *   - Collected is summed from `rebateCollected`, bucketed by
 *     `collectionDate` quarter, and ONLY counts rows with a real
 *     `collectionDate` set. Per CLAUDE.md: "collected counts only rows
 *     with a collectionDate set".
 *
 * The output is sorted chronologically by quarter and every quarter that
 * appears in either series gets a row (missing side filled with 0) so
 * recharts renders both bars side-by-side.
 */

export interface RebateRowForQuarterly {
  payPeriodEnd: Date | null
  rebateEarned: number | { toString(): string } | null
  rebateCollected: number | { toString(): string } | null
  collectionDate: Date | null
}

export interface QuarterlyRebatePoint {
  quarter: string
  rebateEarned: number
  rebateCollected: number
}

function quarterKey(d: Date): string {
  const y = d.getUTCFullYear()
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  return `${y} Q${q}`
}

function sortKey(k: string): number {
  // "2025 Q2" -> 2025 * 10 + 2
  const [yStr, qStr] = k.split(" Q")
  return Number(yStr) * 10 + Number(qStr)
}

export function aggregateRebatesByQuarter(
  rows: RebateRowForQuarterly[],
  now: Date = new Date(),
): QuarterlyRebatePoint[] {
  const earned = new Map<string, number>()
  const collected = new Map<string, number>()

  for (const r of rows) {
    if (r.payPeriodEnd && r.payPeriodEnd <= now) {
      const k = quarterKey(r.payPeriodEnd)
      earned.set(k, (earned.get(k) ?? 0) + Number(r.rebateEarned ?? 0))
    }
    if (r.collectionDate) {
      const k = quarterKey(r.collectionDate)
      collected.set(k, (collected.get(k) ?? 0) + Number(r.rebateCollected ?? 0))
    }
  }

  const keys = new Set<string>([...earned.keys(), ...collected.keys()])
  return Array.from(keys)
    .sort((a, b) => sortKey(a) - sortKey(b))
    .map((quarter) => ({
      quarter,
      rebateEarned: earned.get(quarter) ?? 0,
      rebateCollected: collected.get(quarter) ?? 0,
    }))
}
