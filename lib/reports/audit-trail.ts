/**
 * Reports hub — rebate calculation audit trail builder.
 *
 * Pure function that assembles a full `RebateCalcAudit` shape from
 * already-loaded contract + tier + purchase data. Used by the
 * Calculations tab in the reports hub (facility-reports canonical §4)
 * and by the "explain this rebate" surface in the AI agent.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.0 + §4.4
 */

export interface AuditContractInfo {
  id: string
  name: string
  vendor: string
  type: string
  effectiveDate: Date
  expirationDate: Date
}

export interface AuditTier {
  name: string
  minSpend: number
  maxSpend: number | null
  rebateRate: number
}

export interface AuditPurchase {
  poNumber: string
  date: Date
  amount: number
  /**
   * When the purchase was excluded from the rebate calculation, this
   * is the reason. When included, this should be null.
   */
  exclusionReason?: string | null
  /**
   * One of: 'off_contract' | 'out_of_scope' | 'excluded_item' | 'carve_out'
   * — aligns with canonical match-status categories. Only populated
   * when `exclusionReason` is non-null.
   */
  exclusionCategory?:
    | "off_contract"
    | "out_of_scope"
    | "excluded_item"
    | "carve_out"
    | null
}

export interface AuditAdjustment {
  /** Human-readable description, e.g. "Administrative fee (2%)". */
  description: string
  /** Signed dollars — negative = deduction, positive = credit. */
  amount: number
}

export interface RebateCalcAudit {
  contract: AuditContractInfo
  tiers: AuditTier[]
  currentTier: string
  tierDefinition: string
  calc: {
    totalEligibleSpend: number
    currentTierRate: number
    grossRebate: number
    adjustments: AuditAdjustment[]
    exclusions: Array<{
      category: "off_contract" | "out_of_scope" | "excluded_item" | "carve_out"
      amount: number
      description: string
    }>
    netRebate: number
    formula: string
    detailedFormula: string
  }
  inclusions: Array<{
    poNumber: string
    date: Date
    amount: number
    status: "included"
  }>
  excludedPOs: Array<{
    poNumber: string
    date: Date
    amount: number
    reason: string
  }>
}

export function buildRebateCalculationAudit(input: {
  contract: AuditContractInfo
  tiers: AuditTier[]
  currentTierName: string
  purchases: AuditPurchase[]
  adjustments?: AuditAdjustment[]
}): RebateCalcAudit {
  const { contract, tiers, currentTierName, purchases } = input
  const adjustments = input.adjustments ?? []

  const tierDefinition =
    "Cumulative spend determines tier. Reaching a tier applies the new rate RETROACTIVELY to all eligible spend."

  // Partition purchases.
  const inclusions: RebateCalcAudit["inclusions"] = []
  const excludedPOs: RebateCalcAudit["excludedPOs"] = []
  for (const p of purchases) {
    if (p.exclusionReason) {
      excludedPOs.push({
        poNumber: p.poNumber,
        date: p.date,
        amount: p.amount,
        reason: p.exclusionReason,
      })
    } else {
      inclusions.push({
        poNumber: p.poNumber,
        date: p.date,
        amount: p.amount,
        status: "included",
      })
    }
  }

  const totalEligibleSpend = inclusions.reduce((s, p) => s + p.amount, 0)

  // Find the active tier.
  const tier = tiers.find((t) => t.name === currentTierName)
  const currentTierRate = tier?.rebateRate ?? 0

  const grossRebate = (totalEligibleSpend * currentTierRate) / 100
  const adjustmentsSum = adjustments.reduce((s, a) => s + a.amount, 0)
  const netRebate = grossRebate + adjustmentsSum

  // Exclusions summary — group excluded purchases by category.
  const exclusionsMap = new Map<
    "off_contract" | "out_of_scope" | "excluded_item" | "carve_out",
    { amount: number; count: number; reasons: Set<string> }
  >()
  for (const p of purchases) {
    if (!p.exclusionReason || !p.exclusionCategory) continue
    const entry = exclusionsMap.get(p.exclusionCategory) ?? {
      amount: 0,
      count: 0,
      reasons: new Set<string>(),
    }
    entry.amount += p.amount
    entry.count += 1
    entry.reasons.add(p.exclusionReason)
    exclusionsMap.set(p.exclusionCategory, entry)
  }
  const exclusions = Array.from(exclusionsMap.entries()).map(
    ([category, data]) => ({
      category,
      amount: data.amount,
      description: Array.from(data.reasons).join(" · "),
    }),
  )

  // Formula strings.
  const formula = "Net Rebate = (Eligible Spend × Tier Rate) + Adjustments"
  const detailedFormula =
    adjustments.length > 0
      ? `$${totalEligibleSpend.toLocaleString()} × ${currentTierRate}% = $${grossRebate.toLocaleString()}` +
        adjustments
          .map(
            (a) =>
              ` ${a.amount >= 0 ? "+" : "-"} $${Math.abs(a.amount).toLocaleString()} (${a.description})`,
          )
          .join("") +
        ` = $${netRebate.toLocaleString()}`
      : `$${totalEligibleSpend.toLocaleString()} × ${currentTierRate}% = $${grossRebate.toLocaleString()}`

  return {
    contract,
    tiers,
    currentTier: currentTierName,
    tierDefinition,
    calc: {
      totalEligibleSpend,
      currentTierRate,
      grossRebate,
      adjustments,
      exclusions,
      netRebate,
      formula,
      detailedFormula,
    },
    inclusions,
    excludedPOs,
  }
}
