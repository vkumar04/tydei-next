"use server"

/**
 * "Match Pricing" action — COG row → Contract vendor resolution.
 *
 * Extracted from lib/actions/cog-records.ts during subsystem-9 tech
 * debt split. Updates vendorId on COG rows that can be resolved via
 * the shared vendor resolver (no parallel match path).
 *
 * Not to be confused with:
 *   - lib/contracts/match.ts — the pure matchCOGRecordToContract
 *     algorithm (what determines matchStatus/contractId)
 *   - lib/cog/recompute.ts — the column-write pipeline triggered by
 *     contract CRUD
 *
 * This action only resolves vendor identities from the facility-side
 * "Match Pricing" button. Per-row enrichment columns (matchStatus,
 * contractId, etc.) are written by recomputeMatchStatusesForVendor.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { resolveVendorIdsBulk } from "@/lib/vendors/resolve"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"

export async function matchCOGToContracts(): Promise<{
  totalRecords: number
  vendorsMatched: number
  vendorsUnmatched: number
  recordsUpdated: number
  onContractAfter: number
}> {
  const { facility } = await requireFacility()

  // 1. Get distinct (vendorName, current vendorId) pairs
  const distinctVendors = await prisma.cOGRecord.groupBy({
    by: ["vendorName", "vendorId"],
    where: { facilityId: facility.id },
    _count: true,
  })

  // 2. Resolve every distinct name to an id via the shared resolver
  //    (createMissing: false — if a name can't match, we leave it alone
  //    rather than fragment the vendor table further).
  const distinctNames = distinctVendors
    .map((g) => g.vendorName ?? "")
    .filter((n) => n.trim())
  const resolved = await resolveVendorIdsBulk(distinctNames, { createMissing: false })

  // 3. Load vendors that have active contracts at this facility so we
  //    can tell the user which matches are "on contract" vs just "matched".
  const contractedVendorIds = new Set(
    (
      await prisma.contract.findMany({
        where: {
          status: { in: ["active", "expiring"] },
          ...contractsOwnedByFacility(facility.id),
        },
        select: { vendorId: true },
        distinct: ["vendorId"],
      })
    ).map((c) => c.vendorId),
  )

  let vendorsMatched = 0
  let vendorsUnmatched = 0
  let recordsUpdated = 0
  const totalRecords = distinctVendors.reduce((s, v) => s + v._count, 0)

  for (const group of distinctVendors) {
    const vendorName = group.vendorName ?? ""
    if (!vendorName.trim()) continue

    const currentVendorId = group.vendorId
    if (currentVendorId && contractedVendorIds.has(currentVendorId)) {
      vendorsMatched++
      continue
    }

    const matchedId = resolved.get(vendorName.toLowerCase())
    if (matchedId && matchedId !== currentVendorId) {
      const result = await prisma.cOGRecord.updateMany({
        where: {
          facilityId: facility.id,
          vendorName: { equals: vendorName, mode: "insensitive" },
        },
        data: { vendorId: matchedId },
      })
      recordsUpdated += result.count

      if (contractedVendorIds.has(matchedId)) {
        vendorsMatched++
      } else {
        vendorsUnmatched++
      }
    } else {
      vendorsUnmatched++
    }
  }

  // 4b. For every contracted vendor at this facility, recompute COG
  //     enrichment columns so matchStatus / contractId / isOnContract
  //     reflect the freshly-resolved vendorIds. Without this step the
  //     "Match Pricing" button only updates vendorId — matchStatus stays
  //     `pending` and Charles sees nothing linked to a contract.
  for (const vendorId of contractedVendorIds) {
    await recomputeMatchStatusesForVendor(vendorId, facility.id)
  }

  // 5. Count on-contract after matching — now driven by matchStatus so the
  //    badge on the UI matches the toast count.
  const onContractAfter = await prisma.cOGRecord.count({
    where: {
      facilityId: facility.id,
      matchStatus: { in: ["on_contract", "price_variance"] },
    },
  })

  return {
    totalRecords,
    vendorsMatched,
    vendorsUnmatched,
    recordsUpdated,
    onContractAfter,
  }
}
