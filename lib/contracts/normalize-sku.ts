/**
 * Canonical SKU key for COG↔pricing-file matching.
 *
 * CONSERVATIVE on purpose — "the SKUs are very important" (Charles 2026-06-07):
 * a SKU uniquely identifies a product, and a false match attaches the wrong
 * contract price → fabricated savings/rebates. So we fold ONLY noise that never
 * carries meaning: case and ALL whitespace (incl. trailing/leading/internal).
 * We deliberately PRESERVE meaningful separators — hyphen, dot, underscore,
 * slash — because those distinguish genuinely different catalog numbers
 * ("AB-12" vs "AB1-2"). We do NOT strip leading zeros. Returns "" for
 * null/blank so callers can skip empty keys.
 *
 * If a client's drift is separator-based (e.g. COG "ABC123" vs pricing
 * "ABC-123"), that needs an explicit, confirmed widening — it is NOT folded
 * here by default because it can collapse distinct SKUs.
 */
export function normalizeSku(sku: string | null | undefined): string {
  if (sku == null) return ""
  return sku
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "") // fold whitespace only — keep hyphen/dot/underscore/slash
}
