"use server"

/**
 * Vendor-side mirror of the facility's spend-concentration HHI:
 * how concentrated is this vendor's revenue across the facilities
 * they sell to? High HHI = a few facilities account for the bulk
 * of revenue (lock-in / churn risk on the vendor side).
 *
 * Reuses `v0SpendConcentration` so vendors and facilities see the
 * same banding (low / moderate / high) and the math stays in one
 * place.
 */

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { v0SpendConcentration } from "@/lib/v0-spec/contract-performance"
import { withTelemetry } from "@/lib/actions/analytics/_telemetry"

export async function getVendorCustomerConcentration(input?: {
  trailingDays?: number
}) {
  return withTelemetry(
    "getVendorCustomerConcentration",
    { trailingDays: input?.trailingDays ?? 365 },
    () => _getVendorCustomerConcentrationImpl(input),
  )
}

async function _getVendorCustomerConcentrationImpl(input?: {
  trailingDays?: number
}) {
  const { vendor } = await requireVendor()
  const days = input?.trailingDays ?? 365

  const today = new Date()
  const since = new Date(today)
  since.setDate(since.getDate() - days)

  const rows = await prisma.cOGRecord.groupBy({
    by: ["facilityId"],
    where: {
      vendorId: vendor.id,
      transactionDate: { gte: since, lte: today },
    },
    _sum: { extendedPrice: true },
  })

  const byId = new Map<string, number>()
  for (const r of rows) {
    if (!r.facilityId) continue
    byId.set(r.facilityId, Number(r._sum.extendedPrice ?? 0))
  }

  const facilities = await prisma.facility.findMany({
    where: { id: { in: Array.from(byId.keys()) } },
    select: { id: true, name: true },
  })
  const nameById = new Map(facilities.map((f) => [f.id, f.name]))

  const facilitySpends = Array.from(byId.entries()).map(([id, spend]) => ({
    vendorId: nameById.get(id) ?? id, // helper's API name; the entity is a facility here
    spend,
  }))

  const result = v0SpendConcentration(facilitySpends)
  return serialize({
    ...result,
    facilityCount: facilitySpends.length,
    trailingDays: days,
  })
}
