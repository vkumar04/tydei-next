/**
 * Invoice discrepancy priority classifier (v0
 * facility-invoice-validation-functionality.md §26).
 *
 *   nonMatchingItem → always high
 *   |variance%| > 5 → high
 *   |variance%| > 2 → medium
 *   |variance%| > 0 → low
 *   else            → none
 */
export type InvoicePriority = "high" | "medium" | "low" | "none"

export function classifyInvoicePriority(input: {
  variancePct: number
  nonMatchingItem?: boolean
}): InvoicePriority {
  if (input.nonMatchingItem) return "high"
  const abs = Math.abs(input.variancePct)
  if (abs > 5) return "high"
  if (abs > 2) return "medium"
  if (abs > 0) return "low"
  return "none"
}
