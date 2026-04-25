"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import {
  calculateSpendConcentration,
  type ConcentrationResult,
} from "@/lib/contracts/performance"

/**
 * Charles 2026-04-25 ("these values seem hardcoded"): the card was
 * showing ConcentrationResult only — no proof the numbers came from
 * live data. Adding `recordCount`, `topVendors[]` (name + dollar
 * amount), and `asOf` so the UI can render "Computed from N COG
 * records · top: Stryker $1.6M, Medtronic $710K, …" — making the
 * data lineage visible defeats the "hardcoded" perception.
 */
export interface VendorConcentrationResult extends ConcentrationResult {
  totalSpend: number
  recordCount: number
  topVendors: Array<{ vendorId: string; vendorName: string; spend: number; pct: number }>
  asOf: string
}

/**
 * Facility-scoped vendor-spend concentration for the COG Data page.
 * Aggregates COG extendedPrice by vendorId, then runs it through the
 * v0-locked Herfindahl-Hirschman classifier.
 */
export async function getVendorConcentration(
  _facilityId: string,
): Promise<VendorConcentrationResult> {
  try {
    const { facility } = await requireFacility()
    const [rows, recordCount] = await Promise.all([
      prisma.cOGRecord.groupBy({
        by: ["vendorId"],
        where: { facilityId: facility.id, vendorId: { not: null } },
        _sum: { extendedPrice: true },
      }),
      prisma.cOGRecord.count({
        where: { facilityId: facility.id },
      }),
    ])
    const vendorSpends = rows
      .filter((r): r is typeof r & { vendorId: string } => r.vendorId !== null)
      .map((r) => ({
        vendorId: r.vendorId,
        spend: Number(r._sum.extendedPrice ?? 0),
      }))
    const totalSpend = vendorSpends.reduce((s, v) => s + v.spend, 0)
    const result = calculateSpendConcentration(vendorSpends)

    // Resolve vendor names for the top 3 — give the user concrete
    // names + dollar amounts so the percentages are auditable.
    const sortedVendors = [...vendorSpends].sort((a, b) => b.spend - a.spend)
    const topVendorIds = sortedVendors.slice(0, 3).map((v) => v.vendorId)
    const vendorNameRows =
      topVendorIds.length > 0
        ? await prisma.vendor.findMany({
            where: { id: { in: topVendorIds } },
            select: { id: true, name: true },
          })
        : []
    const nameById = new Map(vendorNameRows.map((v) => [v.id, v.name]))
    const topVendors = sortedVendors.slice(0, 3).map((v) => ({
      vendorId: v.vendorId,
      vendorName: nameById.get(v.vendorId) ?? "(unknown)",
      spend: v.spend,
      pct: totalSpend > 0 ? (v.spend / totalSpend) * 100 : 0,
    }))

    return serialize({
      ...result,
      totalSpend,
      recordCount,
      topVendors,
      asOf: new Date().toISOString(),
    })
  } catch (err) {
    console.error("[getVendorConcentration]", err)
    throw err
  }
}
