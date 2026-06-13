import { prisma } from "@/lib/db"
import { facilityCogCategoryUniverse } from "./cog-category-universe"

/**
 * The categories a facility has "chosen" — the universe the term category
 * picker offers (bugs.rtfd 2026-06-13 "whatever was on the mapping list
 * and chosen").
 *
 * = the confirmed category-mapping TARGETS (what the user consolidated
 *   source COG categories INTO, e.g. "Ortho-Spine" → "Spine") UNION any
 *   COG category that has direct spend.
 *
 * The mapping targets matter because a chosen category (e.g. "Spine") may
 * have no rows stored under its own name — its spend arrives under mapped
 * source names — so the raw COG universe alone would hide it from the
 * picker even though the user explicitly chose it.
 *
 * CategoryMapping is global (no facilityId column), so the confirmed
 * targets are shared across facilities; the COG half stays facility-scoped.
 */
export async function facilityChosenCategoryNames(
  facilityId: string,
): Promise<string[]> {
  const [cog, mappings] = await Promise.all([
    facilityCogCategoryUniverse(facilityId),
    prisma.categoryMapping
      .findMany({
        where: { isConfirmed: true, contractCategory: { not: null } },
        select: { contractCategory: true },
      })
      .catch(() => [] as { contractCategory: string | null }[]),
  ])
  const set = new Set<string>(cog)
  for (const m of mappings) {
    if (m.contractCategory) set.add(m.contractCategory)
  }
  return [...set]
}
