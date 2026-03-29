"use server"

import { prisma } from "@/lib/db"
import { requireVendor, requireFacility } from "@/lib/actions/auth"
import {
  createPendingContractSchema,
  updatePendingContractSchema,
  type CreatePendingContractInput,
  type UpdatePendingContractInput,
} from "@/lib/validators/pending-contracts"

// ─── Vendor: List Pending ───────────────────────────────────────

export async function getVendorPendingContracts(vendorId: string) {
  await requireVendor()

  return prisma.pendingContract.findMany({
    where: { vendorId },
    include: { facility: { select: { id: true, name: true } } },
    orderBy: { submittedAt: "desc" },
  })
}

// ─── Vendor: Create ─────────────────────────────────────────────

export async function createPendingContract(input: CreatePendingContractInput) {
  await requireVendor()
  const data = createPendingContractSchema.parse(input)

  return prisma.pendingContract.create({
    data: {
      vendorId: data.vendorId,
      vendorName: data.vendorName,
      facilityId: data.facilityId,
      facilityName: data.facilityName,
      contractName: data.contractName,
      contractType: data.contractType,
      effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
      expirationDate: data.expirationDate ? new Date(data.expirationDate) : null,
      totalValue: data.totalValue,
      terms: data.terms ?? [],
      documents: data.documents ?? [],
      pricingData: data.pricingData,
      notes: data.notes,
      status: "submitted",
    },
  })
}

// ─── Vendor: Update ─────────────────────────────────────────────

export async function updatePendingContract(id: string, input: UpdatePendingContractInput) {
  await requireVendor()
  const data = updatePendingContractSchema.parse(input)

  return prisma.pendingContract.update({
    where: { id },
    data: {
      ...(data.contractName !== undefined && { contractName: data.contractName }),
      ...(data.contractType !== undefined && { contractType: data.contractType }),
      ...(data.effectiveDate !== undefined && { effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null }),
      ...(data.expirationDate !== undefined && { expirationDate: data.expirationDate ? new Date(data.expirationDate) : null }),
      ...(data.totalValue !== undefined && { totalValue: data.totalValue }),
      ...(data.terms !== undefined && { terms: data.terms }),
      ...(data.documents !== undefined && { documents: data.documents }),
      ...(data.pricingData !== undefined && { pricingData: data.pricingData }),
      ...(data.notes !== undefined && { notes: data.notes }),
    },
  })
}

// ─── Vendor: Withdraw ───────────────────────────────────────────

export async function withdrawPendingContract(id: string) {
  await requireVendor()

  await prisma.pendingContract.update({
    where: { id },
    data: { status: "withdrawn" },
  })
}

// ─── Facility: List Pending ─────────────────────────────────────

export async function getFacilityPendingContracts(facilityId: string) {
  await requireFacility()

  return prisma.pendingContract.findMany({
    where: { facilityId, status: "submitted" },
    include: { vendor: { select: { id: true, name: true, logoUrl: true } } },
    orderBy: { submittedAt: "desc" },
  })
}

// ─── Facility: Approve ──────────────────────────────────────────

export async function approvePendingContract(id: string, reviewedBy: string) {
  const { facility } = await requireFacility()

  const pending = await prisma.pendingContract.findUniqueOrThrow({ where: { id } })

  const contract = await prisma.contract.create({
    data: {
      name: pending.contractName,
      vendorId: pending.vendorId,
      facilityId: pending.facilityId ?? facility.id,
      contractType: pending.contractType,
      status: "active",
      effectiveDate: pending.effectiveDate ?? new Date(),
      expirationDate: pending.expirationDate ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      totalValue: pending.totalValue ?? 0,
    },
  })

  await prisma.pendingContract.update({
    where: { id },
    data: { status: "approved", reviewedAt: new Date(), reviewedBy },
  })

  return contract
}

// ─── Facility: Reject ───────────────────────────────────────────

export async function rejectPendingContract(id: string, reviewedBy: string, notes: string) {
  await requireFacility()

  await prisma.pendingContract.update({
    where: { id },
    data: {
      status: "rejected",
      reviewedAt: new Date(),
      reviewedBy,
      reviewNotes: notes,
    },
  })
}

// ─── Facility: Request Revision ─────────────────────────────────

export async function requestRevision(id: string, reviewedBy: string, notes: string) {
  await requireFacility()

  await prisma.pendingContract.update({
    where: { id },
    data: {
      status: "revision_requested",
      reviewedAt: new Date(),
      reviewedBy,
      reviewNotes: notes,
    },
  })
}
