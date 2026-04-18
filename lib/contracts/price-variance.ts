/**
 * Price variance detection for invoice lines against contract pricing.
 *
 * Spec section 6 of contract-calculations.md. Severity thresholds on
 * the absolute variance percent:
 * - minor: 0 ≤ |variance| < 2%
 * - moderate: 2% ≤ |variance| < 10%
 * - major: |variance| ≥ 10%
 *
 * (Note: these thresholds differ from the compliance engine's 5%
 * tolerance. Compliance treats anything over 5% as a compliance issue;
 * variance analysis separately grades severity regardless of
 * compliance.)
 */

export type VarianceDirection = "overcharge" | "undercharge" | "at_price"
export type VarianceSeverity = "minor" | "moderate" | "major"

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
  if (absVariancePercent < 2) return "minor"
  if (absVariancePercent < 10) return "moderate"
  return "major"
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
      severity: "minor",
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

export function analyzePriceDiscrepancies(
  lines: InvoiceLineForVariance[],
  priceLookup: ContractPriceLookup,
): VarianceAnalysis {
  const analyzed: AnalyzedLine[] = []
  const bySeverity: Record<VarianceSeverity, number> = {
    minor: 0,
    moderate: 0,
    major: 0,
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
