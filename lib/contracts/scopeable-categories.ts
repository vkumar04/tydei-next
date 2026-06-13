import { canonicalizeCategoryName } from "./category-canonical"

export interface PickableCategory {
  id: string
  name: string
}

/**
 * The categories a contract TERM can be scoped to (bugs.rtfd 2026-06-13
 * "not all categories are on the category list").
 *
 * The term picker used to be restricted to the contract's already-selected
 * categories, hiding real categories the facility has spend in. And the raw
 * `ProductCategory` table is import-junk-heavy (78 rows: "0", "EA",
 * malformed delimiters, …) with several taxonomy rows that canonicalize to
 * the same real category (e.g. "Joints-Ortho" / "Ortho Joints" /
 * "Ortho-Joints").
 *
 * This returns, from the full taxonomy list, the categories that either
 *   (a) have REAL COG spend (canonical match against the facility's COG
 *       category universe), or
 *   (b) are already selected on the contract/term (so a selection never
 *       silently vanishes),
 * deduplicated by canonical name — one row per real category. When several
 * spellings collide, prefer a SELECTED one (keeps its id in the list so the
 * badge resolves), then the exact COG spelling, then the first seen.
 */
export function selectScopeableCategories(
  all: readonly PickableCategory[],
  cogCategories: readonly string[],
  selectedIds: Iterable<string>,
): PickableCategory[] {
  const cogByCanon = new Map<string, string>()
  for (const n of cogCategories) cogByCanon.set(canonicalizeCategoryName(n), n)
  const selected = new Set(selectedIds)

  const score = (c: PickableCategory, canon: string): number => {
    if (selected.has(c.id)) return 2
    if (cogByCanon.get(canon) === c.name) return 1
    return 0
  }

  const byCanon = new Map<string, PickableCategory>()
  for (const c of all) {
    const canon = canonicalizeCategoryName(c.name)
    if (!cogByCanon.has(canon) && !selected.has(c.id)) continue
    const existing = byCanon.get(canon)
    if (!existing || score(c, canon) > score(existing, canon)) {
      byCanon.set(canon, c)
    }
  }

  return [...byCanon.values()].sort((a, b) => a.name.localeCompare(b.name))
}
