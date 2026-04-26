"use server"

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
 * For COG aggregates, the helper returns `cogScopeFacilityId` — the
 * contract's primary facility — so both sides see the same single-
 * facility numbers (vendors don't get to aggregate across every
 * facility they sell to via this entry point; that's a separate
 * cross-facility analytics surface).
 */
export type ContractScope =
  | { kind: "facility"; facilityId: string; cogScopeFacilityId: string }
  | { kind: "vendor"; vendorId: string; cogScopeFacilityId: string }

export async function requireContractScope(
  contractId: string,
): Promise<ContractScope> {
  const session = await requireAuth()

  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { facility: true, vendor: true } } },
  })

  const facility = member?.organization?.facility
  const vendor = member?.organization?.vendor

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
      cogScopeFacilityId: contract.facilityId,
    }
  }

  if (facility) {
    const contract = await prisma.contract.findFirst({
      where: contractOwnershipWhere(contractId, facility.id),
      select: { facilityId: true },
    })
    // contract may live on a sister facility (multi-facility
    // sharing). For COG we pin to its primary owner so the spend
    // window is consistent regardless of which facility the user
    // is signed into.
    if (!contract) {
      throw new Error("Contract not found or not accessible")
    }
    return {
      kind: "facility",
      facilityId: facility.id,
      cogScopeFacilityId: contract.facilityId ?? facility.id,
    }
  }

  throw new Error("No facility or vendor membership for this user")
}
