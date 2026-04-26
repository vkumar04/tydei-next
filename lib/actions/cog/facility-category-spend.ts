"use server"

/**
 * Facility-side per-category spend breakdown with top-vendor mix.
 *
 * Sister action to getCategoryMarketShareForVendor (which is vendor-
 * scoped). This one is FACILITY-scoped: for each product category in
 * the trailing window, returns the facility's total spend in that
 * category and the top vendors competing for it.
 *
 * Charles prod feedback 2026-04-26 (dashboard Spend tab):
 *   "Need something that has market share category and category
 *    spend here."
 *
 * Same canonical source as the standalone CategoryMarketShareCard:
 * cOGRecord rows in the trailing window. Per CLAUDE.md, every spend-
 * by-vendor / share number traces back to cOGRecord, never to the
 * sparse ContractPeriod rollups.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

export interface FacilityCategorySpendVendor {
  vendorId: string
  vendorName: string
  spend: number
  /** vendorSpend / categoryTotal × 100 — 0–100. */
  sharePct: number
}

export interface FacilityCategorySpendRow {
  category: string
  totalSpend: number
  /** totalSpend / facilityTotalSpend × 100 — 0–100. */
  pctOfFacility: number
  vendorCount: number
  topVendors: FacilityCategorySpendVendor[]
}

export interface FacilityCategorySpendResult {
  rows: FacilityCategorySpendRow[]
  /** Sum of vendor COG with category=NULL. Surfaced so the UI can
   *  explain how much of the facility's spend isn't categorized
   *  (and link to the same fix the standalone card recommends). */
  uncategorizedSpend: number
  /** Sum of all facility COG in the window (categorized + uncategorized). */
  facilityTotalSpend: number
}

export async function getFacilityCategorySpend(input: {
  monthsBack?: number
  /** Cap how many vendors to enumerate per category (1-10). Default 5. */
  topVendorsPerCategory?: number
} = {}): Promise<FacilityCategorySpendResult> {
  try {
    const { facility } = await requireFacility()
    const months = input.monthsBack ?? 12
    const topN = Math.max(1, Math.min(10, input.topVendorsPerCategory ?? 5))
    const since = new Date()
    since.setMonth(since.getMonth() - months)

    // One pass over the COG rows. We need both
    //   1. per-category totals
    //   2. per-(category, vendor) totals for the top-N drill-down
    // so a single findMany + in-memory groupBy beats two SQL passes.
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

    let uncategorizedSpend = 0
    let facilityTotalSpend = 0
    type VendorAgg = { spend: number }
    type CatBucket = {
      total: number
      byVendor: Map<string, VendorAgg>
    }
    const byCategory = new Map<string, CatBucket>()

    for (const r of rows) {
      const amt = Number(r.extendedPrice ?? 0)
      if (amt <= 0) continue
      facilityTotalSpend += amt
      if (!r.category) {
        uncategorizedSpend += amt
        continue
      }
      const bucket = byCategory.get(r.category) ?? {
        total: 0,
        byVendor: new Map<string, VendorAgg>(),
      }
      bucket.total += amt
      if (r.vendorId) {
        const v = bucket.byVendor.get(r.vendorId) ?? { spend: 0 }
        v.spend += amt
        bucket.byVendor.set(r.vendorId, v)
      }
      byCategory.set(r.category, bucket)
    }

    // Resolve vendor names in one shot for the top-N vendors across
    // every category (avoids N+1 lookups).
    const vendorIds = new Set<string>()
    for (const bucket of byCategory.values()) {
      const sortedVendors = Array.from(bucket.byVendor.entries())
        .sort((a, b) => b[1].spend - a[1].spend)
        .slice(0, topN)
      for (const [vid] of sortedVendors) vendorIds.add(vid)
    }
    const vendorRows = vendorIds.size
      ? await prisma.vendor.findMany({
          where: { id: { in: [...vendorIds] } },
          select: { id: true, name: true, displayName: true },
        })
      : []
    const vendorNameById = new Map(
      vendorRows.map((v) => [v.id, v.displayName ?? v.name]),
    )

    const result: FacilityCategorySpendRow[] = []
    for (const [category, bucket] of byCategory.entries()) {
      const sortedVendors = Array.from(bucket.byVendor.entries())
        .sort((a, b) => b[1].spend - a[1].spend)
        .slice(0, topN)
        .map(([vendorId, agg]) => ({
          vendorId,
          vendorName: vendorNameById.get(vendorId) ?? "Unknown vendor",
          spend: agg.spend,
          sharePct:
            bucket.total > 0 ? (agg.spend / bucket.total) * 100 : 0,
        }))
      result.push({
        category,
        totalSpend: bucket.total,
        pctOfFacility:
          facilityTotalSpend > 0
            ? (bucket.total / facilityTotalSpend) * 100
            : 0,
        vendorCount: bucket.byVendor.size,
        topVendors: sortedVendors,
      })
    }

    // Biggest categories first.
    result.sort((a, b) => b.totalSpend - a.totalSpend)

    return serialize({
      rows: result,
      uncategorizedSpend,
      facilityTotalSpend,
    })
  } catch (err) {
    console.error("[getFacilityCategorySpend]", err)
    throw err
  }
}
