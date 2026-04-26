"use server"

import { cache } from "react"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"

/**
 * Resolve a contract for whichever side (facility or vendor) the
 * caller belongs to and verify ownership in one shot. Each analytics
 * action used to call `requireFacility()` directly which made the
 * vendor portal blind to its own contracts; this helper lets the
 * same action serve both sides without duplicating the math.
 *
 * For COG aggregates, downstream actions filter `cOGRecord` rows by
 * `facilityId IN cogScopeFacilityIds`. The list is built per-side:
 *
 *   - **vendor:** the contract's primary `facilityId` only. Vendors
 *     see one facility's COG per contract; they don't aggregate
 *     across every facility they sell to via this entry point.
 *   - **facility:** the union of `Contract.facilityId` (primary)
 *     plus every `ContractFacility.facilityId` (shared). This way a
 *     sister facility user sharing a contract sees TRUE shared
 *     spend across every facility on the contract, not just the
 *     primary owner's slice (security audit Medium 2026-04-26
 *     fix — previously pinned to primary, which leaked the primary
 *     facility's spend to sister facilities and hid the sister's
 *     own spend in the same view).
 */
export type ContractScope =
  | { kind: "facility"; facilityId: string; cogScopeFacilityIds: string[] }
  | { kind: "vendor"; vendorId: string; cogScopeFacilityIds: string[] }

/**
 * Wrapped in React's `cache()` so a single render that triggers
 * multiple analytics actions (Performance tab fans out to 4-6
 * actions) only pays the auth + ownership lookup once. Cache key
 * is the contractId — `requireAuth()` is itself memoized inside,
 * so the dedupe is exact within a render pass.
 */
export const requireContractScope = cache(_requireContractScopeImpl)

async function _requireContractScopeImpl(
  contractId: string,
): Promise<ContractScope> {
  const session = await requireAuth()

  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { facility: true, vendor: true } } },
  })

  const facility = member?.organization?.facility
  const vendor = member?.organization?.vendor

  // Defense in depth: if a future Member/Organization restructure
  // ever lets a single user belong to BOTH a facility and a vendor
  // org, the implicit "vendor wins" branch ordering would silently
  // route through the wrong scope. Reject explicitly so it surfaces
  // as an error instead of a data leak.
  if (facility && vendor) {
    throw new Error(
      "Ambiguous membership: user has both facility and vendor scope",
    )
  }

  if (vendor) {
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, vendorId: vendor.id },
      select: { facilityId: true },
    })
    if (!contract?.facilityId) {
      throw new Error("Contract not found or not accessible")
    }
    return {
      kind: "vendor",
      vendorId: vendor.id,
      cogScopeFacilityIds: [contract.facilityId],
    }
  }

  if (facility) {
    const contract = await prisma.contract.findFirst({
      where: contractOwnershipWhere(contractId, facility.id),
      select: {
        facilityId: true,
        contractFacilities: { select: { facilityId: true } },
      },
    })
    if (!contract) {
      throw new Error("Contract not found or not accessible")
    }
    // Union of primary + every shared facility on the contract.
    const facilityIds = new Set<string>()
    if (contract.facilityId) facilityIds.add(contract.facilityId)
    for (const cf of contract.contractFacilities) {
      facilityIds.add(cf.facilityId)
    }
    if (facilityIds.size === 0) {
      // Truly orphaned — fall back to the caller's facility so the
      // query returns nothing rather than blowing up.
      facilityIds.add(facility.id)
    }
    return {
      kind: "facility",
      facilityId: facility.id,
      cogScopeFacilityIds: Array.from(facilityIds),
    }
  }

  throw new Error("No facility or vendor membership for this user")
}
