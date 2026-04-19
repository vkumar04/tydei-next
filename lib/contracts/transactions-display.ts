/**
 * Pure display helpers for the Contract Transactions ledger.
 *
 * Charles W1.N: the ledger merges two sources — `ContractPeriod` rows
 * (seed-synthesized projections) and `Rebate` rows (real facts the
 * user or the accrual engine write). Only `Rebate` rows have a
 * `collectionDate`. Per CLAUDE.md, a rebate is "collected" ONLY when
 * a `Rebate` row has a non-null `collectionDate`. This module encodes
 * that invariant in one helper so the table cell and the summary card
 * cannot drift — they read from the same function.
 *
 * Kept framework-free so Vitest can exercise it without dragging the
 * client component's server-action imports (Stripe, Prisma, etc).
 */

export interface PeriodRow {
  id: string
  periodStart: string
  periodEnd: string
  totalSpend: number
  rebateEarned: number
  rebateCollected: number
  tierAchieved: number | null
  // Rows sourced from the `Rebate` table (vs synthesized ContractPeriods)
  // have a collectionDate + notes. Used to label the row in the ledger
  // and to short-circuit status logic.
  source: "period" | "rebate"
  collectionDate?: string | null
  notes?: string | null
}

/**
 * The value to render in the "Rebate Collected" column and to sum into
 * the "Collected" summary card. Returns 0 unless the row is a `Rebate`
 * row with a non-null `collectionDate`. ContractPeriod rows and
 * pending-collection Rebate rows always render $0 here, even if their
 * underlying `rebateCollected` column is populated by seed data.
 */
export function displayedCollected(row: PeriodRow): number {
  if (row.source === "rebate" && row.collectionDate) return row.rebateCollected
  return 0
}
