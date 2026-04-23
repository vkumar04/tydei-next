/**
 * Synthesize a 2-year performance history for brand-new contracts that
 * haven't accumulated real history yet. v0 spec
 * docs/contract-renewals-functionality.md §8.
 *
 *   Last year (yearOffset -1): 85% of current values.
 *   Two years ago (-2):         72% of current values.
 *   Compliance floors at 80 / 75 respectively.
 *
 * Used by the renewal brief / new-contract panel to show a plausible
 * backfill ledger so the UI doesn't render "—" everywhere on a
 * first-period contract.
 *
 * Separate from `lib/renewals/performance-history.ts` which projects
 * REAL data from the DB and never synthesizes.
 */
export interface SynthesizedPerformanceRow {
  yearOffset: -1 | -2
  spend: number
  rebate: number
  compliance: number
}

export function synthesizePerformanceHistory(input: {
  currentSpend: number
  earnedRebate: number
  contractComplianceRate: number
}): SynthesizedPerformanceRow[] {
  return [
    {
      yearOffset: -1,
      spend: input.currentSpend * 0.85,
      rebate: input.earnedRebate * 0.85,
      compliance: Math.max(80, input.contractComplianceRate - 5),
    },
    {
      yearOffset: -2,
      spend: input.currentSpend * 0.72,
      rebate: input.earnedRebate * 0.72,
      compliance: Math.max(75, input.contractComplianceRate - 10),
    },
  ]
}
