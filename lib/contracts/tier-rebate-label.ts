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
