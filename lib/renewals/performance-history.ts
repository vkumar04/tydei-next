/**
 * Real performance history — pure transformation from ContractPeriod +
 * RebateAccrual rows to the UI shape consumed by the renewals timeline
 * / history card.
 *
 * Spec: docs/superpowers/specs/2026-04-18-renewals-rewrite.md §4.2
 * (subsystem 1, spec §13).
 *
 * NO SYNTHESIS. If source data is absent we return an empty array, and
 * unknown compliance values stay `null` — we never fabricate numbers.
 *
 * Kept deliberately I/O-free: no Prisma, no Date-from-string parsing, no
 * timezone heuristics. Callers must hand us real `Date` instances that
 * were loaded from the database. Year bucketing uses UTC so the result
 * is deterministic regardless of the server's local timezone.
 */

/** One `ContractPeriod` row, narrowed to just the fields we need. */
export interface ContractPeriodRow {
  periodStart: Date
  periodEnd: Date
  totalSpend: number
  /** Null when unknown; do NOT synthesize. */
  compliance: number | null
}

/** One `RebateAccrual` row, narrowed to what the aggregator consumes. */
export interface RebateAccrualRow {
  /** Links to ContractPeriod via period dates overlap or foreign key. */
  periodStart: Date
  periodEnd: Date
  rebateEarned: number
}

/** One year's aggregate row in the UI shape. */
export interface PerformanceHistoryRow {
  year: number
  spend: number
  rebate: number
  /** Null when unknown. */
  compliance: number | null
}

/** Internal per-year accumulator. */
interface YearAccumulator {
  spend: number
  rebate: number
  /** Running sum of non-null compliance values. */
  complianceSum: number
  /** Count of non-null compliance values — 0 means no data → null output. */
  complianceCount: number
}

function emptyAccumulator(): YearAccumulator {
  return { spend: 0, rebate: 0, complianceSum: 0, complianceCount: 0 }
}

/**
 * Build the `{year, spend, rebate, compliance}` rows consumed by the
 * renewals UI from real `ContractPeriod` + `RebateAccrual` data.
 *
 * Algorithm (spec §4.2):
 *   1. Group periods by calendar year of `periodStart.getUTCFullYear()`.
 *      Per year: sum `totalSpend`; compliance = mean of non-null values,
 *      or `null` if every period's compliance is null.
 *   2. Group accruals by year of `periodStart.getUTCFullYear()`. Per
 *      year: sum `rebateEarned`.
 *   3. Emit one row per year present in either group. Years with only
 *      periods get `rebate: 0`; years with only accruals get
 *      `spend: 0` and `compliance: null`.
 *   4. Sort ascending by year.
 *
 * Returns `[]` when both inputs are empty — NO synthesized history.
 */
export function buildRealPerformanceHistory(input: {
  periods: ContractPeriodRow[]
  accruals: RebateAccrualRow[]
}): PerformanceHistoryRow[] {
  const byYear = new Map<number, YearAccumulator>()

  for (const period of input.periods) {
    const year = period.periodStart.getUTCFullYear()
    const acc = byYear.get(year) ?? emptyAccumulator()
    acc.spend += period.totalSpend
    if (period.compliance !== null) {
      acc.complianceSum += period.compliance
      acc.complianceCount += 1
    }
    byYear.set(year, acc)
  }

  for (const accrual of input.accruals) {
    const year = accrual.periodStart.getUTCFullYear()
    const acc = byYear.get(year) ?? emptyAccumulator()
    acc.rebate += accrual.rebateEarned
    byYear.set(year, acc)
  }

  const rows: PerformanceHistoryRow[] = []
  for (const [year, acc] of byYear) {
    rows.push({
      year,
      spend: acc.spend,
      rebate: acc.rebate,
      compliance:
        acc.complianceCount === 0
          ? null
          : acc.complianceSum / acc.complianceCount,
    })
  }

  rows.sort((a, b) => a.year - b.year)
  return rows
}
