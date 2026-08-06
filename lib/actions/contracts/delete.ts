"use server"

// Split from lib/actions/contracts.ts (subsystem F5 decomposition,
// 2026-08-05). No barrel at the old path — Next.js disallows
// non-async-function re-exports from "use server" modules.

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import {
  invalidateContractAnalytics,
  invalidateFacilityAnalytics,
} from "@/lib/actions/analytics/_cache"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"

// ─── Delete Contract ─────────────────────────────────────────────

export async function deleteContract(id: string) {
  const session = await requireFacility()
  const { facility } = session
  await requireCanMutate()

  // Verify ownership + capture vendorId AND the full facility set before
  // deleting so we can recompute COG match-statuses everywhere the
  // contract used to cover (W2.A.1 H-B).
  const existing = await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(id, facility.id),
    select: {
      id: true,
      vendorId: true,
      facilityId: true,
      contractFacilities: { select: { facilityId: true } },
    },
  })

  await prisma.contract.delete({ where: { id } })

  await logAudit({
    userId: session.user.id,
    action: "contract.deleted",
    entityType: "contract",
    entityId: id,
  })

  // Recompute: rows that were on this contract flip to
  // off_contract_item / out_of_scope depending on remaining contracts.
  //
  // W2.A.1 H-B: fan out across every facility the deleted contract
  // touched, not just the acting session's facility. Otherwise COG at
  // peer facilities keeps its stale on_contract linkage.
  const facilityIds = new Set<string>()
  if (existing.facilityId) facilityIds.add(existing.facilityId)
  for (const cf of existing.contractFacilities) facilityIds.add(cf.facilityId)
  if (facilityIds.size === 0) facilityIds.add(facility.id)
  for (const facilityId of facilityIds) {
    await recomputeMatchStatusesForVendor(prisma, {
      vendorId: existing.vendorId,
      facilityId,
    })
  }
  revalidatePath("/dashboard/cog")
  revalidatePath("/dashboard/contracts")
  revalidatePath("/dashboard")
  await invalidateContractAnalytics(id)
  if (existing.facilityId) {
    await invalidateFacilityAnalytics(existing.facilityId)
  }
}
