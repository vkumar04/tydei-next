"use server"

/**
 * Monthly accrual timeline for one contract.
 *
 * Extracted from lib/actions/contracts.ts during subsystem F5 (tech
 * debt split). Re-exported from there for backward-compat.
 *
 * Charles 2026-04-26 #62: split the auth + contract-resolution out
 * of the body so vendors can read the same timeline scoped through
 * their session via `getVendorAccrualTimeline` below. The body is
 * facility-id-pinned (COG queries hang off facilityId), but the
 * contract's primary facility is the same data point in either
 * scope, so the inner helper is reusable.
 *
 * 2026-08-05 decomposition: the timeline body now lives in
 * `lib/contracts/accrual-timeline/` (non-action modules). ONLY the two
 * actions stay in this file — moving them would change their compiled
 * action ids (stale-client "Server Action ... was not found" window on
 * deploy), and the ownership-scoped resolution of the client-supplied
 * contractId must stay in this scanner-covered file. The builder
 * receives an ALREADY-AUTHORIZED contract row.
 */
import { prisma } from "@/lib/db"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { buildAccrualTimelineForContract } from "@/lib/contracts/accrual-timeline/build-timeline"

export async function getAccrualTimeline(contractId: string) {
  const { facility } = await requireFacility()

  // Charles audit round-11 BLOCKER: scope by ownership.
  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      // bugs.rtfd 2026-06-13 M: the market-share display overlay scopes
      // its categories exactly like the threshold writer's dispatcher,
      // whose fallback is `contract.productCategory?.name`.
      productCategory: { select: { name: true } },
    },
  })
  return buildAccrualTimelineForContract(contract, facility.id)
}

/**
 * Vendor-scoped read of the accrual timeline. The vendor session
 * authorizes on `Contract.vendorId === session.vendor.id`; the COG
 * query underneath still keys off the contract's primary facilityId
 * (the canonical "this contract's spend lives at this facility"
 * pivot — same one the facility-side caller uses).
 *
 * Charles 2026-04-26 #62: paired with the new vendor Accruals tab in
 * `vendor-contract-detail-client.tsx` to bring the vendor surface to
 * facility parity.
 */
export async function getVendorAccrualTimeline(contractId: string) {
  const { vendor } = await requireVendor()
  const contract = await prisma.contract.findFirstOrThrow({
    where: { id: contractId, vendorId: vendor.id },
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      // bugs.rtfd 2026-06-13 M: see facility-scoped query above.
      productCategory: { select: { name: true } },
    },
  })
  return buildAccrualTimelineForContract(contract, contract.facilityId)
}
