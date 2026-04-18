/**
 * True margin analysis — procedure margin with proportional rebate
 * allocation. Spec section 7 of contract-calculations.md.
 *
 * Two pure functions:
 * - allocateRebatesToProcedures: proportional allocation by spend share
 * - calculateMargins: standard + rebate-adjusted margin for a procedure
 */

export interface ProcedureSpend {
  procedureId: string
  /** Dollars spent with the vendor on supplies used in this procedure. */
  vendorSpend: number
}

export interface MarginCosts {
  revenue: number
  costs: number
}

export interface MarginResult {
  standardMargin: number
  trueMargin: number
  rebateContribution: number
  /** null when revenue is 0. */
  standardMarginPercent: number | null
  trueMarginPercent: number | null
}

/**
 * Allocate a total rebate across procedures in proportion to each
 * procedure's share of vendor spend. Returns a map from procedureId to
 * allocated rebate dollars.
 */
export function allocateRebatesToProcedures(
  procedures: ProcedureSpend[],
  totalVendorSpend: number,
  totalRebate: number,
): Map<string, number> {
  const result = new Map<string, number>()

  if (procedures.length === 0) return result
  if (totalVendorSpend <= 0 || totalRebate <= 0) {
    for (const p of procedures) result.set(p.procedureId, 0)
    return result
  }

  for (const p of procedures) {
    const share = p.vendorSpend / totalVendorSpend
    result.set(p.procedureId, totalRebate * share)
  }
  return result
}

/**
 * Standard margin = revenue − costs.
 * True margin = revenue − (costs − rebateAllocation) = standard + rebate.
 * Percent margins are null when revenue is 0.
 */
export function calculateMargins(
  pnl: MarginCosts,
  rebateAllocation: number,
): MarginResult {
  const standardMargin = pnl.revenue - pnl.costs
  const trueMargin = standardMargin + rebateAllocation

  const standardMarginPercent =
    pnl.revenue > 0 ? (standardMargin / pnl.revenue) * 100 : null
  const trueMarginPercent =
    pnl.revenue > 0 ? (trueMargin / pnl.revenue) * 100 : null

  return {
    standardMargin,
    trueMargin,
    rebateContribution: rebateAllocation,
    standardMarginPercent,
    trueMarginPercent,
  }
}
