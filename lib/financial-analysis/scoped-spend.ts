/**
 * Scope the deal-scenario spend base to a selection of categories AND vendors
 * (Vick 2026-06-21: "click per spend category & vendors"). Intersection
 * semantics — a category×vendor spend cell counts only when BOTH its category
 * and its vendor are selected. `null` selection = everything selected.
 *
 * Returns the fraction (0–1) of matrixed spend that the selection covers, so a
 * caller scales the (possibly slider-adjusted) total vendor spend by it:
 *   scopedSpend = currentVendorSpend × computeScopedSpendFraction(...)
 * Empty matrix → 1 (treat as "all", e.g. the no-COG seed case).
 */

export interface CategoryVendorSpendRow {
  category: string
  vendor: string
  spend: number
}

export function computeScopedSpendFraction(
  rows: CategoryVendorSpendRow[],
  selectedCategories: Set<string> | null,
  selectedVendors: Set<string> | null,
): number {
  let total = 0
  let selected = 0
  for (const r of rows) {
    if (r.spend <= 0) continue
    total += r.spend
    const catOk = selectedCategories === null || selectedCategories.has(r.category)
    const venOk = selectedVendors === null || selectedVendors.has(r.vendor)
    if (catOk && venOk) selected += r.spend
  }
  if (total <= 0) return 1
  return selected / total
}
