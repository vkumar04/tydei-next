/**
 * v0 spec — True margin + rebate allocation.
 * Source: docs/contract-calculations.md §7.
 */

export interface V0MarginResult {
  revenue: number
  directCosts: number
  standardGrossProfit: number
  standardMarginPct: number
  trueGrossProfit: number
  trueMarginPct: number
  marginImprovementPct: number
}

/**
 * Standard vs true margin.
 *   standardMargin = (revenue − directCosts) / revenue
 *   trueMargin     = (revenue − (directCosts − rebateAllocation)) / revenue
 * Improvement = trueMarginPct − standardMarginPct.
 */
export function v0Margins(input: {
  revenue: number
  supplyCosts: number
  laborCosts: number
  overheadCosts: number
  rebateAllocation: number
}): V0MarginResult {
  const directCosts = input.supplyCosts + input.laborCosts + input.overheadCosts
  const standardGrossProfit = input.revenue - directCosts
  const standardMarginPct =
    input.revenue > 0 ? (standardGrossProfit / input.revenue) * 100 : 0
  const effectiveCost = directCosts - input.rebateAllocation
  const trueGrossProfit = input.revenue - effectiveCost
  const trueMarginPct =
    input.revenue > 0 ? (trueGrossProfit / input.revenue) * 100 : 0
  return {
    revenue: input.revenue,
    directCosts,
    standardGrossProfit,
    standardMarginPct,
    trueGrossProfit,
    trueMarginPct,
    marginImprovementPct: trueMarginPct - standardMarginPct,
  }
}

/**
 * Allocate vendor-level rebate to a procedure by the procedure's share
 * of that vendor's total spend.
 * Doc example: Vendor A total spend $100k, rebate $3k. Procedure X
 *   uses $10k from Vendor A (10%) → allocation $300.
 */
export function v0RebateAllocationToProcedure(input: {
  procedureVendorSpend: number
  vendorTotalSpend: number
  vendorTotalRebate: number
}): number {
  if (input.vendorTotalSpend <= 0) return 0
  const share = input.procedureVendorSpend / input.vendorTotalSpend
  return input.vendorTotalRebate * share
}
