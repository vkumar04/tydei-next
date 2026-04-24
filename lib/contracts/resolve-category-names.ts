import { prisma } from "@/lib/db"

/**
 * Resolve an array of `ProductCategory.id` values to their category names
 * (the string form expected by `ContractTerm.categories`, which is then
 * compared against `COGRecord.category` — also a name string).
 *
 * The UI picks category IDs from a dropdown (see contract-terms-entry.tsx
 * — `scopedCategoryIds` holds cuid IDs). Previously the write path stored
 * those IDs verbatim into `term.categories`, but every downstream reader
 * (`buildCategoryWhereClause`, accrual, match engine) compares the array
 * against category NAMES. Result: scoped terms never matched, because
 * `COGRecord.category === 'cmnzby28e0sv90ys9cgcehbkh'` is always false.
 *
 * This helper is the one place the ID → name resolution lives. It's
 * defensively idempotent — if a caller has already resolved names and
 * accidentally passes them in, they fall through unchanged (since a
 * category-name query `findMany({ where: { id: { in: [name] } } })`
 * returns nothing, we detect and pass through).
 */
export async function resolveCategoryIdsToNames(
  ids: string[] | null | undefined,
): Promise<string[]> {
  if (!ids || ids.length === 0) return []
  const unique = Array.from(new Set(ids))
  const rows = await prisma.productCategory.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  })
  if (rows.length === 0) {
    // Nothing matched — either the input was already names, or the IDs
    // are stale. Return the input unchanged so legacy writes that passed
    // names survive this helper without breaking.
    return unique
  }
  const byId = new Map(rows.map((r) => [r.id, r.name] as const))
  return unique.map((x) => byId.get(x) ?? x)
}
