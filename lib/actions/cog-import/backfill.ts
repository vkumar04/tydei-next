"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { logAudit } from "@/lib/audit"

export interface BackfillResult {
  vendorsProcessed: number
  pendingBefore: number
  pendingAfter: number
  enriched: number
  /**
   * Post-match distribution across the COGMatchStatus enum, for the
   * transition-count toast surfaced by the empty-state CTA (Charles R5.30).
   */
  onContract: number
  priceVariance: number
  offContract: number
  outOfScope: number
  unknownVendor: number
  pending: number
}

/**
 * Re-runs COG → contract enrichment for every distinct vendor on the
 * facility's active/expiring contracts. Idempotent — safe to call
 * repeatedly. Use after bulk COG imports or after seeding.
 */
export async function backfillCOGEnrichment(): Promise<BackfillResult> {
  const { facility, user } = await requireFacility()

  const contracts = await prisma.contract.findMany({
    where: {
      ...contractsOwnedByFacility(facility.id),
      status: { in: ["active", "expiring"] },
    },
    select: { id: true, vendorId: true },
  })

  const pendingBefore = await prisma.cOGRecord.count({
    where: { facilityId: facility.id, matchStatus: "pending" },
  })

  const distinctVendors = Array.from(new Set(contracts.map((c) => c.vendorId)))
  for (const vendorId of distinctVendors) {
    await recomputeMatchStatusesForVendor(vendorId, facility.id)
  }

  const pendingAfter = await prisma.cOGRecord.count({
    where: { facilityId: facility.id, matchStatus: "pending" },
  })

  // Post-match distribution — one groupBy call, O(buckets) rows, not O(records).
  const dist = await prisma.cOGRecord.groupBy({
    by: ["matchStatus"],
    where: { facilityId: facility.id },
    _count: true,
  })
  const byStatus: Record<string, number> = {}
  for (const row of dist) byStatus[row.matchStatus] = row._count

  await logAudit({
    userId: user.id,
    action: "cog.backfill_enrichment",
    entityType: "facility",
    entityId: facility.id,
    metadata: {
      vendorsProcessed: distinctVendors.length,
      pendingBefore,
      pendingAfter,
      distribution: byStatus,
    },
  })

  return {
    vendorsProcessed: distinctVendors.length,
    pendingBefore,
    pendingAfter,
    enriched: Math.max(0, pendingBefore - pendingAfter),
    onContract: byStatus.on_contract ?? 0,
    priceVariance: byStatus.price_variance ?? 0,
    offContract: byStatus.off_contract_item ?? 0,
    outOfScope: byStatus.out_of_scope ?? 0,
    unknownVendor: byStatus.unknown_vendor ?? 0,
    pending: byStatus.pending ?? 0,
  }
}
