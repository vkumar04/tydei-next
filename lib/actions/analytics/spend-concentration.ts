"use server"

/**
 * Charles audit suggestion (v0-port): Spend Concentration (HHI) for
 * the facility. Routes vendor-spend totals through `v0SpendConcentration`
 * to produce the HHI + Low/Moderate/High classification + top-vendor +
 * top-3 concentration.
 *
 * v0 doc §9: HHI < 1500 = Low, < 2500 = Moderate, ≥ 2500 = High.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { v0SpendConcentration } from "@/lib/v0-spec/contract-performance"

export async function getFacilitySpendConcentration(input?: {
  trailingDays?: number
}) {
  const { facility } = await requireFacility()
  const days = input?.trailingDays ?? 365

  const today = new Date()
  const since = new Date(today)
  since.setDate(since.getDate() - days)

  const rows = await prisma.cOGRecord.groupBy({
    by: ["vendorId"],
    where: {
      facilityId: facility.id,
      transactionDate: { gte: since, lte: today },
    },
    _sum: { extendedPrice: true },
  })

  const byId = new Map<string, number>()
  for (const r of rows) {
    if (!r.vendorId) continue
    byId.set(r.vendorId, Number(r._sum.extendedPrice ?? 0))
  }

  const vendors = await prisma.vendor.findMany({
    where: { id: { in: Array.from(byId.keys()) } },
    select: { id: true, name: true },
  })
  const nameById = new Map(vendors.map((v) => [v.id, v.name]))

  const vendorSpends = Array.from(byId.entries()).map(([id, spend]) => ({
    vendorId: nameById.get(id) ?? id,
    spend,
  }))

  const result = v0SpendConcentration(vendorSpends)
  return serialize(result)
}
