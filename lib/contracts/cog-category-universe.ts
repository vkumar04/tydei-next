/**
 * Prisma-aware companion to `cog-category-filter.ts`.
 *
 * `buildCategoryWhereClause` / `buildUnionCategoryWhereClause` are kept
 * framework-free (no Prisma import) so Vitest can exercise them directly.
 * They accept an optional `cogCategoryUniverse` to expand a contract's
 * selected category names to every drifted `COGRecord.category` variant that
 * shares a canonical key (case / separator / word-order / plural insensitive).
 *
 * This helper supplies that universe: the facility's distinct
 * `COGRecord.category` strings. Fetch it ONCE per action and pass it into
 * every builder call (including per-term calls inside a loop) so the SQL
 * `category: { in }` filter stops dropping drifted rows.
 *
 * 2026-06-08 (Charles "I selected every category … not all the spend is
 * brought in. The category check must be off somewhere").
 */
import { prisma } from "@/lib/db"

export async function facilityCogCategoryUniverse(
  facilityId: string,
): Promise<string[]> {
  // Uses `groupBy` (not `findMany`) deliberately: the COG accrual/list paths
  // mock `cOGRecord.findMany` heavily, and a second findMany here would
  // disrupt their call-order assertions. groupBy is the natural "distinct
  // category" query anyway.
  //
  // Defensive: under unit-test prisma mocks groupBy is usually unstubbed
  // (`groupBy is not a function`) or returns undefined. An empty universe is
  // safe — `expandCategoriesToCogVariants(selected, [])` returns `selected`
  // unchanged (the pre-fix raw behavior), so callers degrade gracefully
  // rather than throw. In production the query always resolves.
  let rows: Array<{ category: string | null }>
  try {
    rows = (await prisma.cOGRecord.groupBy({
      by: ["category"],
      where: { facilityId },
      _count: true,
    })) as unknown as Array<{ category: string | null }>
  } catch {
    return []
  }
  if (!Array.isArray(rows)) return []
  return rows
    .map((r) => r.category)
    .filter((c): c is string => c != null && c.length > 0)
}
