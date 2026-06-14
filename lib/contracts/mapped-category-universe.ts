// lib/contracts/mapped-category-universe.ts
import { prisma } from "@/lib/db"

/**
 * The categories that have been EXPLICITLY MAPPED — and are therefore the
 * only ones that should be DISPLAYED on category surfaces (market-share card,
 * term category picker).
 *
 * bugs.rtfd 2026-06-13 (Vick, channeling Charles "COGs without a price file
 * being loaded have No category" → "cog and pricing file mapped categories
 * should be the only ones displayed"): raw COG imports carry a category column
 * (and benchmark inference) that produced ~30 noisy buckets ("Supplies &
 * Materials:OR Supplies & Materials", "Surgical InstrumentationSurgical
 * Instrumentation", …). Those are not something the user chose. The user's
 * intent: only show categories that are mapped, where "mapped" means either
 *   (a) the TARGET of a confirmed `CategoryMapping` (the COG Category Mapping
 *       dialog / price-file Realign both write these), or
 *   (b) a category that appears in a contract's price file (`ContractPricing`).
 *
 * This is a DISPLAY universe — the raw `COGRecord.category` stays intact so the
 * Category Mapping dialog can still surface unmapped strings to be mapped, and
 * the rebate engine's category scope is untouched. Market share already folds
 * mapped variants into their target via `confirmedCategoryMap`; this set is the
 * post-fold allow-list of which buckets to render.
 *
 * Returns the raw display names (NOT canonicalized) — callers canonicalize at
 * the comparison boundary (see `canonicalizeCategoryName`).
 */
export async function mappedCategoryUniverse(
  facilityId: string,
): Promise<string[]> {
  const [mappings, pricing] = await Promise.all([
    // CategoryMapping is global (no facilityId column) — the confirmed
    // targets are the canonical categories the user mapped INTO.
    prisma.categoryMapping.findMany({
      where: { isConfirmed: true, contractCategory: { not: null } },
      select: { contractCategory: true },
    }),
    // Pricing-file categories for THIS facility's contracts.
    prisma.contractPricing.findMany({
      where: { contract: { facilityId } },
      select: { category: true },
      distinct: ["category"],
    }),
  ])

  const out = new Set<string>()
  for (const m of mappings) {
    const t = m.contractCategory?.trim()
    if (t) out.add(t)
  }
  for (const p of pricing) {
    const c = p.category?.trim()
    if (c) out.add(c)
  }
  return [...out]
}
