/**
 * Division CATEGORY scope — the isolation key for rows that carry a product
 * category but no `vendorDivisionId` column (facility `COGRecord`,
 * `ProductBenchmark`). A `VendorDivision` declares its `categories[]`; a
 * division-restricted caller sees only rows whose category canonically
 * matches one of their divisions' categories ("each division behaves like a
 * separate company", by product line).
 *
 * Semantics mirror `callerVendorDivisionIds` / `divisionScopeWhere`:
 *   divisionIds undefined → null (enterprise/Super — no restriction)
 *   divisionIds []        → empty Set (attached to nothing — sees NOTHING)
 *   divisionIds [ids], but those divisions declare NO categories →
 *                           null (there is nothing to isolate BY — falls back
 *                           to vendor-wide, the pre-feature behavior, rather
 *                           than silently zeroing every surface)
 *   divisionIds [ids] w/ categories → Set of canonical category keys
 *
 * Server-only module (imports prisma) — NOT a "use server" file, so it can
 * export the sync predicate alongside the async fetch.
 */
import { prisma } from "@/lib/db"
import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"

export async function divisionCategoryKeySet(
  divisionIds: string[] | undefined,
): Promise<Set<string> | null> {
  if (divisionIds === undefined) return null
  if (divisionIds.length === 0) return new Set()
  const divisions = await prisma.vendorDivision.findMany({
    where: { id: { in: divisionIds } },
    select: { categories: true },
  })
  const keys = new Set(
    divisions
      .flatMap((d) => d.categories)
      .map(canonicalizeCategoryName)
      .filter((k) => k !== ""),
  )
  return keys.size > 0 ? keys : null
}

/**
 * Whether a row's category falls inside the caller's division-category scope.
 * `null` keys = unrestricted. Under restriction, uncategorized rows
 * (null/empty category) are OUT of scope — they belong to no division.
 */
export function categoryInDivisionScope(
  category: string | null | undefined,
  keys: Set<string> | null,
): boolean {
  if (keys === null) return true
  const canon = canonicalizeCategoryName(category ?? "")
  return canon !== "" && keys.has(canon)
}
