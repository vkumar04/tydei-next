"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { computeBundleStatus } from "@/lib/contracts/bundle-compute"
import { deriveBundleShortfalls } from "@/lib/contracts/bundle-shortfalls"

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
 * Drives the dashboard shortfall card.
 *
 * Uses the canonical `deriveBundleShortfalls` reducer so this surface
 * cannot disagree with the alert synthesizer's tie_in_at_risk rule on
 * who's below minimum.
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
        members: {
          select: {
            contractId: true,
            vendorId: true,
            minimumSpend: true,
            contract: { select: { name: true } },
          },
        },
      },
    })

    const rows: BundleShortfallRow[] = []
    for (const b of bundles) {
      const status = await computeBundleStatus(prisma, b.id, facility.id)
      if (!status) continue
      const result = deriveBundleShortfalls({
        bundleId: b.id,
        bundleLabel: b.primaryContract.name,
        members: b.members.map((m) => ({
          contractId: m.contractId,
          vendorId: m.vendorId,
          minimumSpend: m.minimumSpend == null ? null : Number(m.minimumSpend),
          contractName: m.contract?.name ?? null,
          vendorName: null,
        })),
        status,
      })
      if (!result.hasShortfalls) continue
      rows.push({
        bundleId: b.id,
        bundleLabel: b.primaryContract.name,
        vendorName: b.primaryContract.vendor.name,
        complianceMode: b.complianceMode,
        memberCount: result.memberCount,
        shortfallCount: result.shortfallCount,
        largestShortfall: result.largestShortfall,
      })
    }

    rows.sort((a, b) => b.largestShortfall - a.largestShortfall)
    return serialize(rows)
  } catch (err) {
    console.error("[getFacilityBundleShortfalls]", err)
    throw err
  }
}
