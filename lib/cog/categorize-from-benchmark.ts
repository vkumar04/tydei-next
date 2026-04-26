/**
 * Pure inference rule for filling COGRecord.category from a
 * ProductBenchmark row keyed on `vendorItemNo`.
 *
 * This is the SAME rule applied at import-time in
 * `lib/actions/cog-import.ts` (commit e482147), extracted so the
 * backfill script can reuse it and so the rule is unit-testable in
 * isolation.
 *
 * Conservative invariants:
 *   1. Never overwrite an existing non-null `currentCategory`.
 *   2. Only return a category when the benchmark map has a hit on
 *      the row's `vendorItemNo`.
 *   3. Rows with no `vendorItemNo` are never inferred against.
 */
export interface CategorizeInput {
  /** Existing category on the COGRecord row. Non-null wins. */
  currentCategory: string | null
  /** vendorItemNo on the COGRecord row. Required for inference. */
  vendorItemNo: string | null
}

/**
 * Returns the category that SHOULD be written to a row, or `null` if
 * no update is warranted (either the row already has a category, or
 * no benchmark hit exists).
 *
 * The benchmark map is `vendorItemNo -> category` and should be
 * pre-filtered to entries with a non-null category.
 */
export function inferCategoryFromBenchmark(
  input: CategorizeInput,
  benchmarkCategoryByItem: ReadonlyMap<string, string>
): string | null {
  // Invariant (1): never overwrite a row that already has a category.
  if (input.currentCategory !== null && input.currentCategory !== "") {
    return null
  }
  // Invariant (3): inference requires a vendorItemNo.
  if (!input.vendorItemNo) {
    return null
  }
  // Invariant (2): benchmark must have a non-null category mapping.
  const inferred = benchmarkCategoryByItem.get(input.vendorItemNo)
  return inferred ?? null
}
