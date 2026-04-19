import type { RebateType } from "@prisma/client"
import { formatCurrency, formatPercent } from "@/lib/formatting"

/**
 * Format a ContractTier's rebate value for UI display.
 *
 * `ContractTier.rebateValue` is a `Decimal(10,4)` field that stores a
 * percentage as a fraction (e.g. `0.02` for 2%) when `rebateType` is
 * `percent_of_spend`. The rebate engine multiplies by 100 internally
 * (`rebateValue / 100` in engine math after tier values arrive pre-scaled
 * as whole percents), and the PDF export also multiplies by 100 before
 * display. This helper centralises that display convention for the
 * contract Terms & Tiers tab so percent-of-spend tiers no longer render
 * as `0.0%`.
 *
 * For non-percent rebate types (fixed / per-unit / per-procedure) the
 * value is treated as a dollar amount and formatted as currency.
 */
export function formatTierRebateLabel(
  rebateType: RebateType,
  rebateValue: number,
): string {
  if (rebateType === "percent_of_spend") {
    return formatPercent(rebateValue * 100)
  }
  return formatCurrency(rebateValue, true)
}

/**
 * For non-percent tiers, produce a "$X per <unit>" style annotation that
 * clarifies the dollar interpretation of the stored rebateValue. The
 * value is returned as a DOLLAR amount suffix — callers append it next
 * to the base rate label.
 *
 * - `fixed_rebate`:           "flat per period"
 * - `fixed_rebate_per_unit`:  "per unit"
 * - `per_procedure_rebate`:   "per procedure"
 * - `percent_of_spend`:       "" (no suffix — the % already tells the story)
 */
export function formatTierRebateUnitSuffix(rebateType: RebateType): string {
  switch (rebateType) {
    case "fixed_rebate":
      return "flat per period"
    case "fixed_rebate_per_unit":
      return "per unit"
    case "per_procedure_rebate":
      return "per procedure"
    case "percent_of_spend":
    default:
      return ""
  }
}

/**
 * Dollar-earned annotation for a tier on the contract Terms & Tiers tab.
 *
 * Charles W1.I: each tier row should show a dollar-amount context
 * alongside the rate, not just a percent. The annotation differs
 * depending on whether the tier is the current tier, below, above, or
 * top-tier-reached.
 *
 * `tier.rebateValue` is the raw Prisma value (fraction for
 * `percent_of_spend`, dollars for fixed/per-unit/per-procedure).
 */
export interface TierDollarAnnotationTier {
  tierNumber: number
  spendMin: number
  rebateType: RebateType
  rebateValue: number
}

export function formatTierDollarAnnotation(
  tier: TierDollarAnnotationTier,
  currentSpend: number,
  currentTierNumber: number,
  isTopTier: boolean,
): string | null {
  if (tier.rebateType !== "percent_of_spend") {
    const suffix = formatTierRebateUnitSuffix(tier.rebateType)
    return suffix
      ? `${formatCurrency(tier.rebateValue, true)} ${suffix}`
      : null
  }

  // percent_of_spend
  if (tier.tierNumber === currentTierNumber) {
    const earned = Math.max(0, currentSpend) * tier.rebateValue
    if (isTopTier) {
      return `top rate — currently earning ${formatCurrency(earned)}`
    }
    return `earning ${formatCurrency(earned)} at ${formatCurrency(currentSpend)} spend`
  }

  if (tier.tierNumber < currentTierNumber) {
    // Tier below current — already unlocked. Show what it WOULD earn
    // at this tier's rate for the current spend as a reference point.
    const would = Math.max(0, currentSpend) * tier.rebateValue
    return `would earn ${formatCurrency(would)} at current spend`
  }

  // Above current: unlock distance
  const delta = Math.max(0, tier.spendMin - currentSpend)
  if (delta === 0) return null
  return `${formatCurrency(delta)} to unlock`
}
