"use server"

/**
 * Cross-Vendor Tie-In analytics (v0 doc §4 — facility GPO bundle).
 * Reads the facility's active CrossVendorTieIn rows + members, sums
 * the member vendors' YTD COG spend, and runs the bundle through
 * `v0CrossVendorTieIn` for compliance + bundle rebate + facility
 * bonus.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import {
  v0CrossVendorTieIn,
  type V0CrossVendorResult,
} from "@/lib/v0-spec/tie-in"

export interface CrossVendorTieInRow {
  id: string
  name: string
  status: string
  effectiveDate: string
  expirationDate: string
  facilityBonusRate: number
  facilityBonusRequirement: "all_compliant" | "none"
  result: V0CrossVendorResult
  members: Array<{
    vendorId: string
    vendorName: string
    minimumSpend: number
    rebateContribution: number
    currentSpend: number
    metPct: number
  }>
}

export async function getCrossVendorTieIns(): Promise<CrossVendorTieInRow[]> {
  const { facility } = await requireFacility()

  const tieIns = await prisma.crossVendorTieIn.findMany({
    where: { facilityId: facility.id, status: "active" },
    orderBy: { name: "asc" },
    include: {
      members: { include: { vendor: { select: { id: true, name: true } } } },
    },
  })
  if (tieIns.length === 0) return []

  // YTD vendor spend across every member vendor in one batched aggregate.
  const today = new Date()
  const startOfYear = new Date(today.getFullYear(), 0, 1)
  const allVendorIds = Array.from(
    new Set(tieIns.flatMap((t) => t.members.map((m) => m.vendorId))),
  )
  const cog = await prisma.cOGRecord.groupBy({
    by: ["vendorId"],
    where: {
      facilityId: facility.id,
      vendorId: { in: allVendorIds },
      transactionDate: { gte: startOfYear, lte: today },
    },
    _sum: { extendedPrice: true },
  })
  const spendByVendor = new Map<string, number>()
  for (const r of cog) {
    if (r.vendorId) {
      spendByVendor.set(r.vendorId, Number(r._sum.extendedPrice ?? 0))
    }
  }

  const rows: CrossVendorTieInRow[] = tieIns.map((t) => {
    const members = t.members.map((m) => ({
      vendorId: m.vendorId,
      vendorName: m.vendor.name,
      minimumSpend: Number(m.minimumSpend),
      rebateContribution: Number(m.rebateContribution),
      currentSpend: spendByVendor.get(m.vendorId) ?? 0,
    }))

    const result = v0CrossVendorTieIn(members, {
      rate: Number(t.facilityBonusRate),
      requirement:
        t.facilityBonusRequirement === "all_compliant"
          ? "all_compliant"
          : "none",
    })

    return {
      id: t.id,
      name: t.name,
      status: t.status,
      effectiveDate: t.effectiveDate.toISOString(),
      expirationDate: t.expirationDate.toISOString(),
      facilityBonusRate: Number(t.facilityBonusRate),
      facilityBonusRequirement:
        t.facilityBonusRequirement === "all_compliant"
          ? "all_compliant"
          : "none",
      result,
      members: members.map((m) => ({
        ...m,
        metPct:
          m.minimumSpend > 0
            ? Math.min(100, (m.currentSpend / m.minimumSpend) * 100)
            : 100,
      })),
    }
  })

  return serialize(rows)
}
