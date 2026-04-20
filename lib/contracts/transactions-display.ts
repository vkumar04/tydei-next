/**
 * Pure display helpers for the Contract Transactions ledger.
 *
 * Charles W1.N / W1.R: the ledger merges two sources — `ContractPeriod`
 * rows (seed-synthesized projections) and `Rebate` rows (real facts the
 * user or the accrual engine write). Only `Rebate` rows have a
 * `collectionDate`. Per CLAUDE.md, a rebate is "collected" ONLY when a
 * `Rebate` row has a non-null `collectionDate`. The per-row display and
 * the summary-card total both delegate to the canonical
 * `sumCollectedRebates` helper so the Transactions tab, the contract
 * detail header card, and the contracts list row can never drift apart.
 *
 * Kept framework-free so Vitest can exercise it without dragging the
 * client component's server-action imports (Stripe, Prisma, etc).
 */

import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"

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
 *
 * Delegates to `sumCollectedRebates` so the invariant lives in exactly
 * one place — see `lib/contracts/rebate-collected-filter.ts`.
 */
export function displayedCollected(row: PeriodRow): number {
  if (row.source !== "rebate") return 0
  return sumCollectedRebates([
    {
      collectionDate: row.collectionDate ?? null,
      rebateCollected: row.rebateCollected,
    },
  ])
}

/**
 * Sum of "Collected" across all ledger rows. The Transactions tab's
 * summary card calls this so its total is guaranteed to equal the
 * contract detail header card's "$X collected (lifetime)".
 */
export function sumDisplayedCollected(rows: readonly PeriodRow[]): number {
  return sumCollectedRebates(
    rows
      .filter((r) => r.source === "rebate")
      .map((r) => ({
        collectionDate: r.collectionDate ?? null,
        rebateCollected: r.rebateCollected,
      })),
  )
}
