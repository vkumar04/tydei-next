"use server"

/**
 * Per-category market share for a vendor at a facility.
 *
 * Charles 2026-04-25: vendor commitments are usually per-category
 * ("60% of Joint Replacement, 40% of Spine"). This action computes
 * per-category share on the fly from COG. Time-windowed: trailing 12
 * months by default.
 *
 * 2026-04-26: math extracted to `computeCategoryMarketShare` in
 * `lib/contracts/market-share-filter.ts` so the vendor-portal action
 * shares the same effectiveCategory + bucket logic. See spec
 * `2026-04-26-v0-parity-engines-design.md` Bucket A1.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { serialize } from "@/lib/serialize"
import { loadConfirmedCategoryMap } from "@/lib/categories/resolve"
import { mappedCategoryUniverse } from "@/lib/contracts/mapped-category-universe"
import {
  computeCategoryMarketShare,
  type MarketShareResult,
  type MarketShareRow,
} from "@/lib/contracts/market-share-filter"

export type CategoryMarketShareRow = MarketShareRow
export type CategoryMarketShareResult = MarketShareResult

export async function getCategoryMarketShareForVendor(input: {
  vendorId: string
  monthsBack?: number
  /**
   * Optional contract id to pull per-category commitment overlays
   * from `Contract.marketShareCommitmentByCategory`. When omitted
   * the result rows have `commitmentPct: null`.
   */
  contractId?: string
}): Promise<CategoryMarketShareResult> {
  try {
    const { facility } = await requireFacility()
    const months = input.monthsBack ?? 12
    const since = new Date()
    since.setMonth(since.getMonth() - months)

    // Optional commitment overlay per category. Schema stores user-set
    // targets as `[{category, commitmentPct}, ...]` JSON on Contract.
    // Tolerate any non-array shape (old contracts / hand-edits) by
    // treating it as an empty map.
    const commitmentByCategory = new Map<string, number>()
    // Bug 7/11 (Vick 2026-06-02): for a GROUPED contract the share
    // numerator must sum every participating vendor, not just the primary.
    // Default to the single input vendor; widen to the contract's full
    // vendor set when a contractId is supplied and the contract is grouped.
    let numeratorVendorIds: string | string[] = input.vendorId
    if (input.contractId) {
      const c = await prisma.contract.findFirst({
        where: contractOwnershipWhere(input.contractId, facility.id),
        select: {
          marketShareCommitmentByCategory: true,
          vendorId: true,
          additionalVendorIds: true,
        },
      })
      if (c) {
        const groupIds = contractVendorIds(c)
        // Only widen when the input vendor actually belongs to the
        // contract's group (defensive: don't silently swap vendors).
        if (groupIds.includes(input.vendorId)) numeratorVendorIds = groupIds
      }
      const raw = c?.marketShareCommitmentByCategory
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (
            entry &&
            typeof entry === "object" &&
            "category" in entry &&
            "commitmentPct" in entry &&
            typeof (entry as Record<string, unknown>).category === "string" &&
            typeof (entry as Record<string, unknown>).commitmentPct === "number"
          ) {
            commitmentByCategory.set(
              (entry as { category: string }).category,
              (entry as { commitmentPct: number }).commitmentPct,
            )
          }
        }
      }
    }

    const cogRows = await prisma.cOGRecord.findMany({
      where: {
        facilityId: facility.id,
        // 2026-06-09 vendor audit: bound the window at NOW — prod carries
        // $12.4M of future-dated COG (transactionDate up to 2026-12) which
        // a gte-only window silently included, inflating "trailing N
        // months" market share. Future transactions are not current share.
        transactionDate: { gte: since, lte: new Date() },
      },
      select: {
        vendorId: true,
        category: true,
        extendedPrice: true,
        contractId: true,
      },
    })

    const contractIds = Array.from(
      new Set(cogRows.map((r) => r.contractId).filter((v): v is string => !!v)),
    )
    const contractCategoryRows =
      contractIds.length > 0
        ? await prisma.contract.findMany({
            where: { id: { in: contractIds } },
            select: {
              id: true,
              productCategory: { select: { name: true } },
            },
          })
        : []
    const contractCategoryMap = new Map<string, string | null>(
      contractCategoryRows.map((c) => [c.id, c.productCategory?.name ?? null]),
    )

    // Charles 2026-06-07: honor the user's confirmed CategoryMapping remaps
    // so an explicit "Map Categories" rule (e.g. Ortho-Upper Extremity ->
    // Ortho-Extremity) collapses the source into its target here, exactly as
    // the import path applies it (resolveCategoryNamesBulk Pass 0).
    // bugs.rtfd 2026-06-13 ("cog and pricing file mapped categories should be
    // the only ones displayed"): restrict the rendered rows to the mapped
    // universe so raw unmapped COG buckets ("Supplies & Materials:OR …", the
    // concatenated variants) don't surface.
    const [confirmedCategoryMap, displayUniverse] = await Promise.all([
      loadConfirmedCategoryMap(),
      mappedCategoryUniverse(facility.id),
    ])

    const computed = computeCategoryMarketShare({
      rows: cogRows,
      contractCategoryMap,
      vendorId: numeratorVendorIds,
      commitmentByCategory,
      confirmedCategoryMap,
      displayCategoryUniverse: displayUniverse,
    })

    return serialize(computed)
  } catch (err) {
    console.error("[getCategoryMarketShareForVendor]", err, {
      vendorId: input.vendorId,
    })
    throw err
  }
}
