"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { computeBundleStatus } from "@/lib/contracts/bundle-compute"

export interface BundleShortfallRow {
  bundleId: string
  bundleLabel: string
  vendorName: string
  complianceMode: "all_or_nothing" | "proportional" | "cross_vendor"
  memberCount: number
  shortfallCount: number
  largestShortfall: number
}

/**
 * Aggregates every facility-owned bundle's compliance status and
 * returns only the ones with at least one member below minimum spend.
 *
 * Surfaces on the dashboard so below-minimum members (the #1 driver of
 * bundle payout failure in v0 spec §tie-in) are visible without having
 * to click into each bundle.
 */
export async function getFacilityBundleShortfalls(): Promise<
  BundleShortfallRow[]
> {
  try {
    const { facility } = await requireFacility()
    const bundles = await prisma.tieInBundle.findMany({
      where: {
        primaryContract: {
          OR: [
            { facilityId: facility.id },
            { contractFacilities: { some: { facilityId: facility.id } } },
          ],
        },
      },
      select: {
        id: true,
        complianceMode: true,
        primaryContract: {
          select: {
            name: true,
            vendor: { select: { name: true } },
          },
        },
        _count: { select: { members: true } },
      },
    })

    const rows: BundleShortfallRow[] = []
    for (const b of bundles) {
      const status = await computeBundleStatus(prisma, b.id, facility.id)
      if (!status) continue
      let shortfalls: number[] = []
      if (status.allOrNothing) {
        shortfalls = status.allOrNothing.shortfalls.map((s) => s.shortfall)
      } else if (status.crossVendor) {
        shortfalls = status.crossVendor.perVendor
          .filter((v) => v.shortfall > 0)
          .map((v) => v.shortfall)
      } else if (status.proportional) {
        // Proportional bundles don't hard-fail, but below-minimum
        // members drag weighted compliance down; surface lostRebate as
        // the shortfall magnitude signal.
        if (status.proportional.lostRebate > 0) {
          shortfalls = [status.proportional.lostRebate]
        }
      }
      if (shortfalls.length === 0) continue
      rows.push({
        bundleId: b.id,
        bundleLabel: b.primaryContract.name,
        vendorName: b.primaryContract.vendor.name,
        complianceMode: b.complianceMode,
        memberCount: b._count.members,
        shortfallCount: shortfalls.length,
        largestShortfall: Math.max(...shortfalls),
      })
    }

    rows.sort((a, b) => b.largestShortfall - a.largestShortfall)
    return serialize(rows)
  } catch (err) {
    console.error("[getFacilityBundleShortfalls]", err)
    throw err
  }
}
