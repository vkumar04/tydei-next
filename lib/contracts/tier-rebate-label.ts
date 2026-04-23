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
  spendMax?: number | null
  rebateType: RebateType
  rebateValue: number
}

export function formatTierDollarAnnotation(
  tier: TierDollarAnnotationTier,
  currentSpend: number,
  currentTierNumber: number,
  isTopTier: boolean,
  rebateMethod: "cumulative" | "marginal" = "cumulative",
): string | null {
  if (tier.rebateType !== "percent_of_spend") {
    const suffix = formatTierRebateUnitSuffix(tier.rebateType)
    return suffix
      ? `${formatCurrency(tier.rebateValue, true)} ${suffix}`
      : null
  }

  // Below baseline: currentTierNumber === 0 means spend hasn't crossed
  // the lowest tier's spendMin yet (Charles iMessage 2026-04-20). Every
  // tier should read as "unlocks at $X" — never a projection, because
  // no rebate will earn at all until spend reaches tier 1's floor.
  if (currentTierNumber === 0) {
    const delta = Math.max(0, tier.spendMin - currentSpend)
    if (delta === 0) return null
    return `${formatCurrency(delta)} to unlock`
  }

  // percent_of_spend. The tier-progress annotation is an engine
  // PROJECTION (spend × rate) — it is NOT the ledger-based earned
  // amount. Charles iMessage 2026-04-20 N10: label used to read
  // "currently earning $X" which users read as an actual earned value
  // while the canonical "Rebates Earned (YTD)" card showed $0 (no
  // Rebate rows yet). Per CLAUDE.md "Rebates are NEVER auto-computed
  // for display" — projections are fine when CLEARLY labeled as such.
  // Rewording to `projects $X at this rate` makes the projection
  // explicit so it cannot be mistaken for the ledger total.
  if (tier.tierNumber === currentTierNumber) {
    const projected = Math.max(0, currentSpend) * tier.rebateValue
    if (isTopTier) {
      return `top rate — projects ${formatCurrency(projected)} at current spend`
    }
    return `projects ${formatCurrency(projected)} at ${formatCurrency(currentSpend)} spend`
  }

  if (tier.tierNumber < currentTierNumber) {
    // Tier below current — already unlocked. Label differs by rebate
    // method because the tier's actual contribution to earnings does.
    //
    // CUMULATIVE: once a higher tier is achieved, the whole spend earns
    // the higher tier's rate — this tier is a threshold that was
    // crossed, not an ongoing contributor. Label accordingly so users
    // don't read it as "still earning $X at 5%" when they're actually
    // earning at the higher tier's rate on the whole spend.
    //
    // MARGINAL: each tier earns its rate on its own spend slice. Show
    // the slice's actual contribution: (min(spend, spendMax) - spendMin)
    // × rate. That's the real dollar amount this tier produces.
    if (rebateMethod === "marginal") {
      const sliceMax = tier.spendMax ?? Number.POSITIVE_INFINITY
      const sliceTop = Math.min(Math.max(0, currentSpend), sliceMax)
      const sliceAmount = Math.max(0, sliceTop - tier.spendMin)
      const earned = sliceAmount * tier.rebateValue
      return `earned ${formatCurrency(earned)} on this slice`
    }
    return `achieved — superseded by tier ${currentTierNumber} rate`
  }

  // Above current: unlock distance
  const delta = Math.max(0, tier.spendMin - currentSpend)
  if (delta === 0) return null
  return `${formatCurrency(delta)} to unlock`
}
