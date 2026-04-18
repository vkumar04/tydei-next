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

  await logAudit({
    userId: user.id,
    action: "cog.backfill_enrichment",
    entityType: "facility",
    entityId: facility.id,
    metadata: {
      vendorsProcessed: distinctVendors.length,
      pendingBefore,
      pendingAfter,
    },
  })

  return {
    vendorsProcessed: distinctVendors.length,
    pendingBefore,
    pendingAfter,
    enriched: Math.max(0, pendingBefore - pendingAfter),
  }
}
