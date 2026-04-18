"use server"

/**
 * COG enrichment batch backfill — subsystem 3 of the COG data
 * rewrite. Complements the per-vendor recompute fired from
 * `bulkImportCOGRecords` by providing a facility-wide "re-match all"
 * entry point.
 *
 * Use-cases:
 *   - A contract was edited and the user wants every prior COG row
 *     re-scored against the new pricing.
 *   - A pricing file was replaced / re-uploaded.
 *   - An admin is turning on enrichment for the first time against
 *     historical rows.
 *
 * Spec: docs/superpowers/specs/2026-04-18-cog-data-rewrite.md §
 * "Subsystem 3 — COG import pipeline".
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"

/**
 * Re-enriches every COG record at the facility. Used for bulk backfill
 * after a contract edit, pricing-file change, or explicit user
 * "re-match all" trigger.
 */
export async function recomputeAllCOGEnrichments(): Promise<{
  vendorsProcessed: number
  totalRecordsUpdated: number
}> {
  const { facility, user } = await requireFacility()

  // Distinct vendorIds across all COG rows at this facility. Using
  // groupBy (rather than distinct select) keeps the row count around
  // for audit purposes and is friendlier to the mocked prisma client
  // in tests.
  const rows = await prisma.cOGRecord.findMany({
    where: { facilityId: facility.id, vendorId: { not: null } },
    select: { vendorId: true },
  })

  const vendorIds = new Set<string>()
  for (const r of rows) {
    if (r.vendorId) vendorIds.add(r.vendorId)
  }

  let vendorsProcessed = 0
  let totalRecordsUpdated = 0
  for (const vendorId of vendorIds) {
    try {
      const summary = await recomputeMatchStatusesForVendor(prisma, {
        vendorId,
        facilityId: facility.id,
      })
      vendorsProcessed++
      totalRecordsUpdated += summary.updated
    } catch (err) {
      console.warn(
        `[cog-enrich-batch] recompute failed for vendor ${vendorId}`,
        err,
      )
    }
  }

  await logAudit({
    userId: user.id,
    action: "cog.all_enrichments_recomputed",
    entityType: "cogRecord",
    metadata: {
      vendorsProcessed,
      totalRecordsUpdated,
      vendorsSeen: vendorIds.size,
    },
  })

  return { vendorsProcessed, totalRecordsUpdated }
}
