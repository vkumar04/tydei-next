/**
 * Financial analysis — clause risk adjustment to NPV.
 *
 * Reference: docs/superpowers/specs/2026-04-18-financial-analysis-rewrite.md §4.7
 *
 * Takes a base NPV + a clause analysis (from prospective-analysis subsystem 7)
 * and returns a risk-adjusted NPV with per-adjustment audit trail.
 *
 * Adjustment rules (starter set — can be tuned per-contract-type later):
 *   exclusivity clause (high risk)        → -5%
 *   minimum commitment >80% expected      → -3%
 *   no termination-for-convenience        → -2%
 *   auto-renewal without opt-out window   → -2%
 *   price protection with cap             → +2% (de-risks inflation)
 */

/** Typed subset of clause-analysis findings we depend on (decoupled from
 * the prospective-analysis module to avoid circular-dep pressure). */
export interface ClauseFindingForRisk {
  category: string
  found: boolean
  riskLevel: "low" | "medium" | "high"
  favorability: "facility" | "neutral" | "vendor"
  /** Stable identifier the UI can link to a specific finding. */
  findingId?: string | null
}

export interface AdjustedNPV {
  baseNPV: number
  adjustments: Array<{
    clauseCategory: string
    adjustmentPercent: number // signed percent of baseNPV
    reason: string
    linkToFinding: string | null
  }>
  totalAdjustmentPercent: number
  riskAdjustedNPV: number
}

/**
 * Apply clause-risk rules to a baseline NPV. Positive adjustments raise
 * the NPV (de-risk); negative adjustments reduce it (risk discount).
 */
export function adjustNPVForClauseRisk(
  baseNPV: number,
  findings: ClauseFindingForRisk[],
): AdjustedNPV {
  const adjustments: AdjustedNPV["adjustments"] = []

  const find = (category: string): ClauseFindingForRisk | undefined =>
    findings.find((f) => f.category === category)

  const exclusivity = find("exclusivity")
  if (exclusivity?.found && exclusivity.riskLevel === "high") {
    adjustments.push({
      clauseCategory: "exclusivity",
      adjustmentPercent: -5,
      reason: "High-risk exclusivity clause limits future vendor flexibility",
      linkToFinding: exclusivity.findingId ?? null,
    })
  }

  const minimum = find("minimum_commitment")
  if (minimum?.found && minimum.favorability === "vendor") {
    adjustments.push({
      clauseCategory: "minimum_commitment",
      adjustmentPercent: -3,
      reason: "Minimum commitment above 80% of expected spend is hard to exit",
      linkToFinding: minimum.findingId ?? null,
    })
  }

  const termForConvenience = find("termination_for_convenience")
  if (!termForConvenience?.found) {
    adjustments.push({
      clauseCategory: "termination_for_convenience",
      adjustmentPercent: -2,
      reason: "Missing termination-for-convenience clause — no easy exit if terms degrade",
      linkToFinding: null,
    })
  }

  const autoRenewal = find("auto_renewal")
  if (autoRenewal?.found && autoRenewal.favorability === "vendor") {
    adjustments.push({
      clauseCategory: "auto_renewal",
      adjustmentPercent: -2,
      reason: "Auto-renewal without opt-out window locks the facility in",
      linkToFinding: autoRenewal.findingId ?? null,
    })
  }

  const priceProtection = find("price_protection")
  if (priceProtection?.found && priceProtection.favorability === "facility") {
    adjustments.push({
      clauseCategory: "price_protection",
      adjustmentPercent: 2,
      reason: "Price protection with cap de-risks inflation through contract term",
      linkToFinding: priceProtection.findingId ?? null,
    })
  }

  const totalAdjustmentPercent = adjustments.reduce(
    (sum, a) => sum + a.adjustmentPercent,
    0,
  )

  const riskAdjustedNPV = baseNPV * (1 + totalAdjustmentPercent / 100)

  return {
    baseNPV,
    adjustments,
    totalAdjustmentPercent,
    riskAdjustedNPV,
  }
}
