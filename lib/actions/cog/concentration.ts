"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import {
  calculateSpendConcentration,
  type ConcentrationResult,
} from "@/lib/contracts/performance"

/**
 * Facility-scoped vendor-spend concentration for the COG Data page.
 * Aggregates COG extendedPrice by vendorId, then runs it through the
 * v0-locked Herfindahl-Hirschman classifier.
 */
export async function getVendorConcentration(
  _facilityId: string,
): Promise<ConcentrationResult & { totalSpend: number }> {
  try {
    const { facility } = await requireFacility()
    const rows = await prisma.cOGRecord.groupBy({
      by: ["vendorId"],
      where: { facilityId: facility.id, vendorId: { not: null } },
      _sum: { extendedPrice: true },
    })
    const vendorSpends = rows
      .filter((r): r is typeof r & { vendorId: string } => r.vendorId !== null)
      .map((r) => ({
        vendorId: r.vendorId,
        spend: Number(r._sum.extendedPrice ?? 0),
      }))
    const totalSpend = vendorSpends.reduce((s, v) => s + v.spend, 0)
    const result = calculateSpendConcentration(vendorSpends)
    return serialize({ ...result, totalSpend })
  } catch (err) {
    console.error("[getVendorConcentration]", err)
    throw err
  }
}
