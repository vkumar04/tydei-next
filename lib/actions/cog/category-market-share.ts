"use server"

/**
 * Per-category market share for a vendor at a facility.
 *
 * Charles 2026-04-25: "Don't seeing anything for category market
 * share … it's going to carry everywhere once you are really using
 * categories everywhere." Today `Contract.currentMarketShare` is
 * one number — vendor's share of facility spend in aggregate. But
 * vendor commitments are usually per-category ("you'll get 60% of
 * our Joint Replacement, 40% of our Spine"). Without a per-category
 * breakdown, market_share rebates can't be evaluated at the level
 * the contract was actually written.
 *
 * This action computes it on the fly from COG instead of requiring
 * a schema migration. For each category the vendor sells in, we
 * sum the vendor's spend and the facility's TOTAL spend in that
 * category (across all vendors), then `share = vendorSpend / catTotal`.
 *
 * Time-windowed: trailing 12 months by default so the share moves
 * with the actual purchase mix. Caller can override the window via
 * `monthsBack` for a different lookback.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"

export interface CategoryMarketShareResult {
  rows: CategoryMarketShareRow[]
  /** Vendor spend at the facility (trailing window) where the COG row
   *  has `category IS NULL`. Surfaced so the card can explain why a
   *  contract with real spend has no per-category breakdown. */
  uncategorizedSpend: number
  /** Sum of all vendor COG rows in the window — categorized +
   *  uncategorized. Useful for the "X% of total is un-categorized"
   *  footnote and for telling "no spend" apart from "all uncategorized". */
  totalVendorSpend: number
}

export interface CategoryMarketShareRow {
  category: string
  vendorSpend: number
  categoryTotal: number
  /** vendorSpend / categoryTotal × 100. 0–100. */
  sharePct: number
  /** Number of vendors competing in this category at the facility. */
  competingVendors: number
  /**
   * Optional per-category commitment % from
   * `Contract.marketShareCommitmentByCategory` JSON. Null when the
   * contract didn't set a commitment for this category. The UI
   * uses this to render "X% / Y% commitment" with progress.
   */
  commitmentPct: number | null
}

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

    // Optional commitment overlay per category. Schema stores the
    // user-set targets as `[{category, commitmentPct}, ...]` JSON
    // on Contract. We tolerate any non-array shape (old contracts
    // / hand-edits) by treating it as an empty map.
    const commitmentByCategory = new Map<string, number>()
    if (input.contractId) {
      // Charles audit round-12 CONCERN: scope by ownership.
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

    // Pull the facility's COG within the window. We DON'T filter on
    // `category != null` here — un-categorized rows still count toward
    // `uncategorizedSpend` so the UI can explain "vendor has spend but
    // none of it is categorized" instead of silently showing nothing.
    const rows = await prisma.cOGRecord.findMany({
      where: {
        facilityId: facility.id,
        transactionDate: { gte: since },
      },
      select: {
        vendorId: true,
        category: true,
        extendedPrice: true,
      },
    })

    // Count un-categorized + total vendor spend up front so we can
    // return them even when the per-category result list ends up empty.
    let uncategorizedSpend = 0
    let totalVendorSpend = 0
    for (const r of rows) {
      if (r.vendorId !== input.vendorId) continue
      const amt = Number(r.extendedPrice ?? 0)
      if (amt <= 0) continue
      totalVendorSpend += amt
      if (!r.category) uncategorizedSpend += amt
    }

    type CatBucket = {
      total: number
      byVendor: Map<string, number>
    }
    const byCategory = new Map<string, CatBucket>()
    for (const r of rows) {
      const cat = r.category
      if (!cat) continue
      const bucket = byCategory.get(cat) ?? {
        total: 0,
        byVendor: new Map<string, number>(),
      }
      const amount = Number(r.extendedPrice ?? 0)
      bucket.total += amount
      if (r.vendorId) {
        bucket.byVendor.set(
          r.vendorId,
          (bucket.byVendor.get(r.vendorId) ?? 0) + amount,
        )
      }
      byCategory.set(cat, bucket)
    }

    const result: CategoryMarketShareRow[] = []
    for (const [category, bucket] of byCategory.entries()) {
      const vendorSpend = bucket.byVendor.get(input.vendorId) ?? 0
      // Skip categories the vendor doesn't sell in — keeps the
      // result list short and meaningful.
      if (vendorSpend <= 0) continue
      result.push({
        category,
        vendorSpend,
        categoryTotal: bucket.total,
        sharePct:
          bucket.total > 0 ? (vendorSpend / bucket.total) * 100 : 0,
        competingVendors: bucket.byVendor.size,
        commitmentPct: commitmentByCategory.get(category) ?? null,
      })
    }

    // Sort descending by category total so the biggest categories
    // surface first.
    result.sort((a, b) => b.categoryTotal - a.categoryTotal)
    return serialize({
      rows: result,
      uncategorizedSpend,
      totalVendorSpend,
    })
  } catch (err) {
    console.error("[getCategoryMarketShareForVendor]", err, {
      vendorId: input.vendorId,
    })
    throw err
  }
}
