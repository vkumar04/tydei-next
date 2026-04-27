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
import { serialize } from "@/lib/serialize"
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
    if (input.contractId) {
      const c = await prisma.contract.findFirst({
        where: contractOwnershipWhere(input.contractId, facility.id),
        select: { marketShareCommitmentByCategory: true },
      })
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
        transactionDate: { gte: since },
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

    const computed = computeCategoryMarketShare({
      rows: cogRows,
      contractCategoryMap,
      vendorId: input.vendorId,
      commitmentByCategory,
    })

    return serialize(computed)
  } catch (err) {
    console.error("[getCategoryMarketShareForVendor]", err, {
      vendorId: input.vendorId,
    })
    throw err
  }
}
