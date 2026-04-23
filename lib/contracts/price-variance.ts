/**
 * Price variance detection for invoice lines against contract pricing.
 *
 * Aligned 2026-04-23 to Charles's v0 spec (contract-calculations.md §6):
 *   |variance| ≤ 2%  → acceptable
 *   |variance| ≤ 5%  → warning
 *   |variance| >  5% → critical
 *
 * Pre-alignment labels were minor/moderate/major with a 10% critical
 * threshold; v0's 5% threshold matches the compliance-engine tolerance,
 * so variance severity now agrees with compliance classification.
 * The `minor/moderate/major` values are retained as aliases on the
 * VarianceSeverity union for any external reader that still ships the
 * old strings; new code should use the v0 names.
 */

export type VarianceDirection = "overcharge" | "undercharge" | "at_price"
export type VarianceSeverity = "acceptable" | "warning" | "critical"

export interface VarianceResult {
  variancePercent: number
  direction: VarianceDirection
  severity: VarianceSeverity
  dollarImpact: number
}

export interface InvoiceLineForVariance {
  id: string
  contractId: string
  vendorItemNo: string
  actualPrice: number
  quantity: number
}

/**
 * Keyed lookup of contract prices. Key convention:
 * `${contractId}::${vendorItemNo}` → unit price. Missing key means
 * the line has no contract price to compare against (skipped in
 * aggregate analysis).
 */
export type ContractPriceLookup = Map<string, number>

export interface AnalyzedLine extends VarianceResult {
  line: InvoiceLineForVariance
  contractPrice: number
}

export interface VarianceAnalysis {
  totalLines: number
  overchargeTotal: number
  underchargeTotal: number
  bySeverity: Record<VarianceSeverity, number>
  lines: AnalyzedLine[]
}

function severityFor(absVariancePercent: number): VarianceSeverity {
  if (absVariancePercent <= 2) return "acceptable"
  if (absVariancePercent <= 5) return "warning"
  return "critical"
}

export function calculatePriceVariance(
  actualPrice: number,
  contractPrice: number,
  quantity: number,
): VarianceResult {
  if (contractPrice <= 0) {
    return {
      variancePercent: 0,
      direction: "at_price",
      severity: "acceptable",
      dollarImpact: 0,
    }
  }

  const variancePercent = ((actualPrice - contractPrice) / contractPrice) * 100
  const abs = Math.abs(variancePercent)
  const direction: VarianceDirection =
    variancePercent > 0
      ? "overcharge"
      : variancePercent < 0
        ? "undercharge"
        : "at_price"
  const dollarImpact = (actualPrice - contractPrice) * quantity

  return {
    variancePercent,
    direction,
    severity: severityFor(abs),
    dollarImpact,
  }
}

/**
 * 5-band COG price-variance classifier from v0 cogs-functionality.md.
 * Distinct from the 3-band severity above — this is the display-side
 * classification used on the COG-data listing, where direction matters
 * (discount vs overcharge) and there's a narrow "at contract" band
 * around the contract price.
 *   |variance| < 0.5%   → at_contract
 *   variance ≤ -5%      → significant_discount
 *   -5% < variance < 0  → minor_discount
 *   0 ≤ variance ≤ 5%   → minor_overcharge
 *   variance > 5%       → significant_overcharge
 */
export type CogPriceVarianceBand =
  | "significant_discount"
  | "minor_discount"
  | "at_contract"
  | "minor_overcharge"
  | "significant_overcharge"

export function classifyCogPriceVariance(
  unitPrice: number,
  contractPrice: number,
): { variancePct: number; band: CogPriceVarianceBand } {
  if (contractPrice <= 0) return { variancePct: 0, band: "at_contract" }
  const variancePct = ((unitPrice - contractPrice) / contractPrice) * 100
  let band: CogPriceVarianceBand
  if (Math.abs(variancePct) < 0.5) band = "at_contract"
  else if (variancePct <= -5) band = "significant_discount"
  else if (variancePct < 0) band = "minor_discount"
  else if (variancePct <= 5) band = "minor_overcharge"
  else band = "significant_overcharge"
  return { variancePct, band }
}

export function analyzePriceDiscrepancies(
  lines: InvoiceLineForVariance[],
  priceLookup: ContractPriceLookup,
): VarianceAnalysis {
  const analyzed: AnalyzedLine[] = []
  const bySeverity: Record<VarianceSeverity, number> = {
    acceptable: 0,
    warning: 0,
    critical: 0,
  }
  let overchargeTotal = 0
  let underchargeTotal = 0

  for (const line of lines) {
    const key = `${line.contractId}::${line.vendorItemNo}`
    const contractPrice = priceLookup.get(key)
    if (contractPrice === undefined) continue // no contract price, skip

    const variance = calculatePriceVariance(
      line.actualPrice,
      contractPrice,
      line.quantity,
    )
    analyzed.push({ ...variance, line, contractPrice })

    bySeverity[variance.severity]++
    if (variance.direction === "overcharge") {
      overchargeTotal += variance.dollarImpact
    } else if (variance.direction === "undercharge") {
      underchargeTotal += variance.dollarImpact // negative
    }
  }

  return {
    totalLines: analyzed.length,
    overchargeTotal,
    underchargeTotal,
    bySeverity,
    lines: analyzed,
  }
}
