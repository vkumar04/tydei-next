/**
 * Canonical SKU key for COG↔pricing-file matching. Folds the common
 * formatting drift between a vendor's COG export and the contract pricing file
 * (case, surrounding/internal whitespace, hyphens / dots / spaces) so
 * "ABC-123", "abc 123", "ABC.123 " all match. Does NOT strip leading zeros
 * (too aggressive — would collapse genuinely distinct SKUs). Returns "" for
 * null/blank so callers can skip empty keys.
 */
export function normalizeSku(sku: string | null | undefined): string {
  if (sku == null) return ""
  return sku
    .trim()
    .toLowerCase()
    .replace(/[\s.\-_/]+/g, "") // fold whitespace, hyphen, dot, underscore, slash
}
