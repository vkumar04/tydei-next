/**
 * v0 spec — Invoice validation priority.
 * Source: docs/facility-invoice-validation-functionality.md §26.
 */

/**
 * Invoice discrepancy priority.
 *   |variancePct| > 5  → high
 *   |variancePct| > 2  → medium
 *   |variancePct| > 0  → low
 *   non-matching item  → always high
 */
export type V0InvoicePriority = "high" | "medium" | "low" | "none"

export function v0InvoicePriority(input: {
  variancePct: number
  nonMatchingItem?: boolean
}): V0InvoicePriority {
  if (input.nonMatchingItem) return "high"
  const abs = Math.abs(input.variancePct)
  if (abs > 5) return "high"
  if (abs > 2) return "medium"
  if (abs > 0) return "low"
  return "none"
}
