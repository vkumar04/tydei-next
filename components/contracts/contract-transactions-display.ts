// Charles W1.P: pure display helpers for the contract Transactions
// ledger. The ledger's single source of truth is the `Rebate` table —
// `ContractPeriod` rollups were dropped because seeded `rebateEarned`
// values don't respect current tier config (a $0-spend period could
// show $76K earned; a 5% contract could show 10% effective).
//
// Everything here is deterministic and unit-testable; the React
// component (`contract-transactions.tsx`) uses these to shape query
// data before rendering.

export interface LedgerRow {
  id: string
  periodStart: string
  periodEnd: string
  totalSpend: number
  rebateEarned: number
  rebateCollected: number
  tierAchieved: number | null
  collectionDate: string | null
  notes: string | null
  // Charles 2026-04-24 (Bug 13): creation timestamp for audit provenance.
  // Shown as a sub-line so users can see when a row was logged, especially
  // useful to distinguish manual entries from auto-accrual rows.
  createdAt: string | null
}

/**
 * Map raw `getContractRebates` results into LedgerRow shape and sort
 * newest-first by `payPeriodEnd`. ContractPeriod rows are NEVER merged
 * here — the engine + manual-entry are the only row sources.
 */
export function mapRebateRowsToLedger(
  rebates: ReadonlyArray<Record<string, unknown>>,
): LedgerRow[] {
  const rows = rebates.map((r) => ({
    id: r.id as string,
    periodStart: r.payPeriodStart as string,
    periodEnd: r.payPeriodEnd as string,
    totalSpend: 0,
    rebateEarned: Number(r.rebateEarned ?? 0),
    rebateCollected: Number(r.rebateCollected ?? 0),
    tierAchieved: null,
    collectionDate: (r.collectionDate as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    createdAt: (r.createdAt as string | null) ?? null,
  }))
  return rows.sort(
    (a, b) => new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime(),
  )
}

/**
 * Ledger renders the empty-state Card (no table) when there are zero
 * Rebate rows. Extracted for test clarity — matches the component's
 * `rows.length === 0` branch.
 */
export function shouldRenderEmptyState(rows: ReadonlyArray<LedgerRow>): boolean {
  return rows.length === 0
}
