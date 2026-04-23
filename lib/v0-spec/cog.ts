/**
 * v0 spec — COG / vendor-key / price-variance rules.
 * Source: docs/cogs-functionality.md, docs/contract-renewals §9.
 */

/**
 * Vendor key normalization: lowercase, trim, split on whitespace/comma,
 * take first token, strip non-alphanumeric.
 * Doc example: "Medtronic, Inc." → "medtronic".
 */
export function v0NormalizeVendorKey(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .split(/[\s,]+/)[0]
    ?.replace(/[^a-z0-9]/gi, "") ?? ""
}

/** On-contract vs off-contract spend split + compliance %. */
export interface V0ContractSplit {
  onContractSpend: number
  offContractSpend: number
  compliancePct: number
}
export function v0ContractSpendSplit(
  records: Array<{ totalCost: number; hasContractPricing: boolean }>,
): V0ContractSplit {
  const total = records.reduce((s, r) => s + r.totalCost, 0)
  const onContractSpend = records
    .filter((r) => r.hasContractPricing)
    .reduce((s, r) => s + r.totalCost, 0)
  const offContractSpend = total - onContractSpend
  const compliancePct = total > 0 ? (onContractSpend / total) * 100 : 0
  return { onContractSpend, offContractSpend, compliancePct }
}

/**
 * Price variance 5-band classification (v0 cogs-functionality.md).
 * Note: this is a richer banding than the 3-tier severity in
 * contract-calculations.md §6. Both exist; rebate-math.ts encodes §6.
 */
export type V0CogVarianceBand =
  | "significant_discount"
  | "minor_discount"
  | "at_contract"
  | "minor_overcharge"
  | "significant_overcharge"

export function v0CogPriceVarianceBand(
  unitPrice: number,
  contractPrice: number,
): { variancePct: number; band: V0CogVarianceBand } {
  if (contractPrice <= 0) return { variancePct: 0, band: "at_contract" }
  const variancePct = ((unitPrice - contractPrice) / contractPrice) * 100
  let band: V0CogVarianceBand
  if (Math.abs(variancePct) < 0.5) band = "at_contract"
  else if (variancePct <= -5) band = "significant_discount"
  else if (variancePct < 0) band = "minor_discount"
  else if (variancePct <= 5) band = "minor_overcharge"
  else band = "significant_overcharge"
  return { variancePct, band }
}

/**
 * Spend trend classification from last 6 months of data.
 * Compares last 3 months average to prior 3 months average.
 * UP if >10% increase, DOWN if <-10%, else STABLE.
 */
export type V0SpendTrend = "up" | "down" | "stable"
export function v0SpendTrend(monthlySpend: number[]): {
  changePct: number
  trend: V0SpendTrend
} {
  if (monthlySpend.length < 6) return { changePct: 0, trend: "stable" }
  const recent = monthlySpend.slice(-3)
  const prior = monthlySpend.slice(-6, -3)
  const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length
  const priorAvg = prior.reduce((s, v) => s + v, 0) / prior.length
  if (priorAvg <= 0) return { changePct: 0, trend: "stable" }
  const changePct = ((recentAvg - priorAvg) / priorAvg) * 100
  const trend: V0SpendTrend =
    changePct > 10 ? "up" : changePct < -10 ? "down" : "stable"
  return { changePct, trend }
}
