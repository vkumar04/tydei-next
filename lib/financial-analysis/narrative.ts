/**
 * Financial-analysis narrative builder (subsystem 5).
 *
 * Pure, deterministic structured-input-to-narrative construction. Takes the
 * fully computed financial-analysis outputs (NPV, IRR, rebates, tax savings,
 * price-lock opportunity cost, clause-risk-adjusted NPV) and produces a
 * `AnalysisNarrative` that:
 *
 *   1. Code can render directly in the Financial Analysis page "AI summary"
 *      card without making any LLM call.
 *   2. Claude can consume as a richer input context (structured bullets + a
 *      signal verdict) for a layered prose summary.
 *
 * No Claude / Anthropic SDK calls. No IO. No randomness. Idempotent for a
 * given input.
 */

export interface NarrativeInput {
  contractName: string
  vendorName: string
  capitalCost: number
  years: number
  npv: number
  /** IRR as decimal (0.128 = 12.8%). null when the cashflow series has no sign change. */
  irr: number | null
  /** Discount rate as a decimal 0-1 (0.08 = 8%). */
  discountRate: number
  totalRebate: number
  totalTaxSavings: number
  totalOpportunityCost: number
  riskAdjustedNPV?: number | null
  /** Signed percent (e.g. -7.5 means NPV reduced by 7.5%). */
  clauseRiskAdjustmentPercent?: number | null
}

export type AnalysisVerdict = "strong" | "moderate" | "weak" | "negative"

export interface AnalysisNarrative {
  headline: string
  verdict: AnalysisVerdict
  bullets: string[]
  risks: string[]
  cta: string
}

/** Round to the nearest integer and render with thousands separators (en-US). */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}

function verdictOf(npv: number, capitalCost: number): AnalysisVerdict {
  if (npv >= 0.5 * capitalCost) return "strong"
  if (npv >= 0.1 * capitalCost) return "moderate"
  if (npv > 0) return "weak"
  return "negative"
}

function headlineOf(
  verdict: AnalysisVerdict,
  contractName: string,
  npv: number,
): string {
  switch (verdict) {
    case "strong":
      return `${contractName} shows strong ROI — NPV $${fmt(npv)}`
    case "moderate":
      return `${contractName} is a moderate win — NPV $${fmt(npv)}`
    case "weak":
      return `${contractName} is borderline — NPV $${fmt(npv)}`
    case "negative":
      return `${contractName} fails ROI — NPV -$${fmt(Math.abs(npv))}`
  }
}

function ctaOf(verdict: AnalysisVerdict): string {
  switch (verdict) {
    case "strong":
      return "Proceed to purchase. Negotiate term extension if available."
    case "moderate":
      return "Proceed with vendor on typical terms."
    case "weak":
      return "Pursue price-protection + term reduction before signing."
    case "negative":
      return "Do not sign. Request revised proposal."
  }
}

/**
 * Build a deterministic narrative from the financial-analysis outputs.
 *
 * The verdict ladder is keyed off NPV as a fraction of capital cost so the
 * narrative scales appropriately across small and large contracts:
 *   - NPV >= 50% of capital → "strong"
 *   - NPV >= 10% of capital → "moderate"
 *   - NPV >  0              → "weak"
 *   - otherwise             → "negative"
 *
 * Bullets enumerate every applicable computed output; risks surface the
 * three deterministic red flags the spec calls out.
 */
export function buildFinancialAnalysisNarrative(
  input: NarrativeInput,
): AnalysisNarrative {
  const {
    contractName,
    capitalCost,
    years,
    npv,
    irr,
    discountRate,
    totalRebate,
    totalTaxSavings,
    totalOpportunityCost,
    riskAdjustedNPV,
    clauseRiskAdjustmentPercent,
  } = input

  const verdict = verdictOf(npv, capitalCost)
  const headline = headlineOf(verdict, contractName, npv)

  const bullets: string[] = []
  bullets.push(
    `Net present value: $${fmt(npv)} over ${years} years at ${(discountRate * 100).toFixed(1)}% discount`,
  )
  if (irr !== null) {
    bullets.push(`Internal rate of return: ${(irr * 100).toFixed(1)}%`)
  }
  bullets.push(`Projected rebates: $${fmt(totalRebate)}`)
  bullets.push(`Tax savings from depreciation: $${fmt(totalTaxSavings)}`)
  if (totalOpportunityCost > 0) {
    bullets.push(`Price-lock opportunity cost: $${fmt(totalOpportunityCost)}`)
  }
  if (
    riskAdjustedNPV !== undefined &&
    riskAdjustedNPV !== null &&
    clauseRiskAdjustmentPercent !== undefined &&
    clauseRiskAdjustmentPercent !== null
  ) {
    const sign = clauseRiskAdjustmentPercent >= 0 ? "+" : ""
    bullets.push(
      `Contract-risk-adjusted NPV: $${fmt(riskAdjustedNPV)} (${sign}${clauseRiskAdjustmentPercent.toFixed(1)}%)`,
    )
  }

  const risks: string[] = []
  if (totalOpportunityCost > 0.2 * npv) {
    risks.push("Price-lock cost is material vs NPV — reconsider shorter term")
  }
  if (irr !== null && irr < discountRate) {
    risks.push("IRR below discount rate — capital better deployed elsewhere")
  }
  if (
    clauseRiskAdjustmentPercent !== undefined &&
    clauseRiskAdjustmentPercent !== null &&
    clauseRiskAdjustmentPercent < -5
  ) {
    risks.push(
      "Clause risk subtracts >5% from NPV — prioritize contract renegotiation",
    )
  }

  return {
    headline,
    verdict,
    bullets,
    risks,
    cta: ctaOf(verdict),
  }
}
