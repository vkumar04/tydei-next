/**
 * COG analytics helpers — vendor key normalization, on/off contract
 * split, trend classification. Pure functions. v0 spec from
 * docs/cogs-functionality.md + docs/contract-renewals §9.
 */

/**
 * Vendor key normalization — "Medtronic, Inc." → "medtronic".
 * Lowercase, trim, split on whitespace/comma, take first token, strip
 * non-alphanumeric. Used for matching COG vendor names to canonical
 * Vendor rows when the source data carries free-text vendor names.
 */
export function normalizeVendorKey(raw: string): string {
  return (
    raw
      .toLowerCase()
      .trim()
      .split(/[\s,]+/)[0]
      ?.replace(/[^a-z0-9]/gi, "") ?? ""
  )
}

/**
 * On/off contract spend split + compliance %.
 * Pure function over a pre-loaded set of COG rows.
 */
export interface ContractSplitResult {
  onContractSpend: number
  offContractSpend: number
  totalSpend: number
  compliancePct: number
}

export function contractSpendSplit(
  records: Array<{ totalCost: number; hasContractPricing: boolean }>,
): ContractSplitResult {
  const total = records.reduce((s, r) => s + r.totalCost, 0)
  const onContractSpend = records
    .filter((r) => r.hasContractPricing)
    .reduce((s, r) => s + r.totalCost, 0)
  const offContractSpend = total - onContractSpend
  return {
    onContractSpend,
    offContractSpend,
    totalSpend: total,
    compliancePct: total > 0 ? (onContractSpend / total) * 100 : 0,
  }
}

/**
 * Spend trend: last 3 months vs prior 3 months.
 *   change > 10%  → "up"
 *   change < -10% → "down"
 *   else          → "stable"
 * Returns { changePct: 0, trend: "stable" } when fewer than 6
 * data points are available.
 */
export function classifySpendTrend(monthlySpend: number[]): {
  changePct: number
  trend: "up" | "down" | "stable"
} {
  if (monthlySpend.length < 6) return { changePct: 0, trend: "stable" }
  const recent = monthlySpend.slice(-3)
  const prior = monthlySpend.slice(-6, -3)
  const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length
  const priorAvg = prior.reduce((s, v) => s + v, 0) / prior.length
  if (priorAvg <= 0) return { changePct: 0, trend: "stable" }
  const changePct = ((recentAvg - priorAvg) / priorAvg) * 100
  return {
    changePct,
    trend: changePct > 10 ? "up" : changePct < -10 ? "down" : "stable",
  }
}
