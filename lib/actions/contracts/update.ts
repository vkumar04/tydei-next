"use server"

// Split from lib/actions/contracts.ts (subsystem F5 decomposition,
// 2026-08-05). No barrel at the old path — Next.js disallows
// non-async-function re-exports from "use server" modules.

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import {
  updateContractSchema,
  type UpdateContractInput,
} from "@/lib/validators/contracts"
import { Prisma } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import {
  invalidateContractAnalytics,
  invalidateFacilityAnalytics,
} from "@/lib/actions/analytics/_cache"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { recomputeCaseSupplyContractStatus } from "@/lib/case-costing/recompute-supply"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"

// ─── Update Contract ─────────────────────────────────────────────

export async function updateContract(id: string, input: UpdateContractInput) {
  try {
    return await _updateContractImpl(id, input)
  } catch (err) {
    // Per CLAUDE.md "AI-action error path" — every server action that can
    // throw should `console.error` with enough breadcrumbs to debug in
    // production logs, because the client only sees a redacted digest
    // ("An error occurred in the Server Components render"). Without
    // this, a Save-failed toast is unactionable — which is exactly the
    // scenario the user hit on 2026-04-23 while editing a tie-in.
    console.error("[updateContract]", err, { contractId: id })
    throw err
  }
}

async function _updateContractImpl(
  id: string,
  input: UpdateContractInput,
) {
  const session = await requireFacility()
  const { facility } = session
  await requireCanMutate()
  const data = updateContractSchema.parse(input)

  // Verify ownership before updating
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(id, facility.id),
    select: { id: true },
  })

  const updateData: Prisma.ContractUpdateInput = {}

  if (data.name !== undefined) updateData.name = data.name
  if (data.contractNumber !== undefined) updateData.contractNumber = data.contractNumber
  if (data.vendorId !== undefined) updateData.vendor = { connect: { id: data.vendorId } }
  if (data.productCategoryId !== undefined) updateData.productCategory = { connect: { id: data.productCategoryId } }
  if (data.contractType !== undefined) updateData.contractType = data.contractType
  if (data.status !== undefined) updateData.status = data.status
  if (data.effectiveDate !== undefined) updateData.effectiveDate = new Date(data.effectiveDate)
  if (data.expirationDate !== undefined)
    updateData.expirationDate = data.expirationDate
      ? new Date(data.expirationDate)
      : new Date(Date.UTC(9999, 11, 31))
  if (data.autoRenewal !== undefined) updateData.autoRenewal = data.autoRenewal
  if (data.terminationNoticeDays !== undefined) updateData.terminationNoticeDays = data.terminationNoticeDays
  if (data.totalValue !== undefined) updateData.totalValue = data.totalValue
  if (data.annualValue !== undefined) updateData.annualValue = data.annualValue
  if (data.description !== undefined) updateData.description = data.description
  if (data.notes !== undefined) updateData.notes = data.notes
  if (data.gpoAffiliation !== undefined) updateData.gpoAffiliation = data.gpoAffiliation
  if (data.performancePeriod !== undefined) updateData.performancePeriod = data.performancePeriod
  if (data.rebatePayPeriod !== undefined) updateData.rebatePayPeriod = data.rebatePayPeriod
  if (data.isMultiFacility !== undefined) updateData.isMultiFacility = data.isMultiFacility
  if (data.isGrouped !== undefined) updateData.isGrouped = data.isGrouped
  if (data.additionalVendorIds !== undefined)
    updateData.additionalVendorIds = data.additionalVendorIds

  // Charles audit suggestion #4 (v0-port): legacy contract-level
  // capital fields removed — capital lives in ContractCapitalLineItem
  // rows now, managed via lib/actions/contracts/capital-line-items.ts.
  // amortizationShape is the only contract-level capital field that
  // survives.
  if (data.amortizationShape !== undefined)
    updateData.amortizationShape = data.amortizationShape
  // Charles 2026-04-25 (audit follow-up): contract-level metrics for
  // compliance + market-share rebate engines. Use undefined-vs-null
  // discipline so the form can explicitly clear a value (set to null)
  // without confusing it with "field not in payload" (undefined).
  if (data.complianceRate !== undefined)
    updateData.complianceRate = data.complianceRate
  if (data.currentMarketShare !== undefined)
    updateData.currentMarketShare = data.currentMarketShare
  if (data.marketShareCommitment !== undefined)
    updateData.marketShareCommitment = data.marketShareCommitment
  if (data.marketShareCommitmentByCategory !== undefined)
    updateData.marketShareCommitmentByCategory =
      data.marketShareCommitmentByCategory === null
        ? Prisma.JsonNull
        : (data.marketShareCommitmentByCategory as Prisma.InputJsonValue)

  if (data.facilityIds !== undefined) {
    await prisma.contractFacility.deleteMany({ where: { contractId: id } })
    if (data.facilityIds.length > 0) {
      updateData.isMultiFacility = true
      await prisma.contractFacility.createMany({
        data: data.facilityIds.map((fId) => ({ contractId: id, facilityId: fId })),
      })
    }
  }

  // Charles W1.Y-A — `additionalFacilityIds` is the companion array for
  // the FacilityMultiSelect picker (contract-form.tsx:790-795). On CREATE
  // these land in the ContractFacility join table (line 703 in this
  // file) with skipDuplicates. On UPDATE the handler was missing
  // entirely, so any facility the user added to a multi-facility
  // contract via that picker silently reverted to the "beginning" on
  // reload. Mirror the create path: run after the facilityIds rewrite
  // above so skipDuplicates protects against a facility appearing in
  // both arrays (the unique index on (contractId, facilityId) would
  // otherwise throw).
  if (data.additionalFacilityIds?.length) {
    await prisma.contractFacility.createMany({
      data: data.additionalFacilityIds.map((fid) => ({
        contractId: id,
        facilityId: fid,
      })),
      skipDuplicates: true,
    })
  }

  if (data.categoryIds !== undefined) {
    await prisma.contractProductCategory.deleteMany({ where: { contractId: id } })
    if (data.categoryIds.length > 0) {
      updateData.productCategory = { connect: { id: data.categoryIds[0] } }
      await prisma.contractProductCategory.createMany({
        data: data.categoryIds.map((cId) => ({ contractId: id, productCategoryId: cId })),
      })
    }
  }

  const contract = await prisma.contract.update({
    where: { id },
    data: updateData,
  })

  // Charles W1.T — persist (or clear) ContractAmortizationSchedule rows
  // when the shape field is in the payload. Symmetrical clears the
  // table so the read path falls back to the live PMT compute; custom
  // replaces every row with the caller-supplied amortizationDue values,
  // rebuilding opening/interest/principal/closing from the running
  // opening balance.
  if (data.amortizationShape === "symmetrical") {
    await prisma.contractAmortizationSchedule.deleteMany({
      where: { contractId: id },
    })
  }
  // Charles audit suggestion #4 (v0-port): customAmortizationRows
  // payload is no longer accepted on updateContract — per-asset
  // payment schedules now live on ContractCapitalLineItem rows
  // (paymentType="variable"). The custom-shape persisted rows are
  // either pre-existing legacy data (read-only) or built by the
  // per-item engine downstream.

  await logAudit({
    userId: session.user.id,
    action: "contract.updated",
    entityType: "contract",
    entityId: id,
    metadata: { updatedFields: Object.keys(updateData) },
  })

  // Recompute COG match-statuses for this contract's vendor. If the vendor
  // changed, recompute for both the old and new vendor so COG rows flip
  // off the old contract and onto (or off of) the new one.
  //
  // W2.A.1 H-B: fan out across every facility the contract touches —
  // {contract.facilityId} ∪ contractFacilities[].facilityId — not just
  // the acting session's facility. Without this, COG at peer facilities
  // in a multi-facility contract stayed pending after an edit.
  const vendorsToRecompute = new Set<string>()
  vendorsToRecompute.add(contract.vendorId)
  if (data.vendorId !== undefined && data.vendorId !== contract.vendorId) {
    vendorsToRecompute.add(data.vendorId)
  }
  // #2 (Vick 2026-05-31): grouped contracts — recompute every participating
  // vendor (old set so removed members get cleared, new set so added members
  // get matched). Without this, editing a group contract leaves the
  // additional vendors' COG at its stale match status → no group spend.
  for (const v of contract.additionalVendorIds ?? []) vendorsToRecompute.add(v)
  for (const v of data.additionalVendorIds ?? []) vendorsToRecompute.add(v)

  // Re-read the contract with its facility join so the recompute set
  // reflects the post-update multi-facility membership (data.facilityIds
  // may have just replaced the whole join table).
  const contractWithFacilities = await prisma.contract.findUnique({
    where: { id },
    select: {
      facilityId: true,
      contractFacilities: { select: { facilityId: true } },
    },
  })
  const facilityIds = new Set<string>()
  if (contractWithFacilities?.facilityId) {
    facilityIds.add(contractWithFacilities.facilityId)
  }
  for (const cf of contractWithFacilities?.contractFacilities ?? []) {
    facilityIds.add(cf.facilityId)
  }
  // Fall back to the session facility if the contract somehow has no
  // facility linkage (shouldn't happen, but keep the old behavior as a
  // safety net rather than skipping recompute entirely).
  if (facilityIds.size === 0) facilityIds.add(facility.id)

  for (const vendorId of vendorsToRecompute) {
    for (const facilityId of facilityIds) {
      await recomputeMatchStatusesForVendor(prisma, {
        vendorId,
        facilityId,
      })
    }
  }

  // Charles 2026-04-25 (Bug 27 part 2): same case-supply recompute as
  // createContract — done once per facility (not per vendor) since the
  // case-supply join doesn't filter by vendor.
  for (const facilityId of facilityIds) {
    try {
      await recomputeCaseSupplyContractStatus(prisma, facilityId)
    } catch (err) {
      console.warn(
        `[updateContract] recomputeCaseSupplyContractStatus(${facilityId}) failed:`,
        err,
      )
    }
  }

  // Contract health-score feature removed 2026-04-23 (Bug 15).
  revalidatePath("/dashboard/cog")
  revalidatePath("/dashboard/contracts")
  revalidatePath(`/dashboard/contracts/${id}`)
  revalidatePath("/dashboard")
  await invalidateContractAnalytics(id)
  if (contract.facilityId) {
    await invalidateFacilityAnalytics(contract.facilityId)
  }

  return serialize(contract)
}
