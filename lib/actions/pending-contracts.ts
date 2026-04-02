"use server"

import { prisma } from "@/lib/db"
import { requireVendor, requireFacility } from "@/lib/actions/auth"
import {
  createPendingContractSchema,
  updatePendingContractSchema,
  type CreatePendingContractInput,
  type UpdatePendingContractInput,
} from "@/lib/validators/pending-contracts"
import { serialize } from "@/lib/serialize"

// ─── Vendor: List Pending ───────────────────────────────────────

export async function getVendorPendingContracts(_vendorId?: string) {
  const { vendor } = await requireVendor()

  const contracts = await prisma.pendingContract.findMany({
    where: { vendorId: vendor.id },
    include: { facility: { select: { id: true, name: true } } },
    orderBy: { submittedAt: "desc" },
  })
  return serialize(contracts)
}

// ─── Vendor: Create ─────────────────────────────────────────────

export async function createPendingContract(input: CreatePendingContractInput) {
  await requireVendor()
  const data = createPendingContractSchema.parse(input)

  const contract = await prisma.pendingContract.create({
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
  return serialize(contract)
}

// ─── Vendor: Update ─────────────────────────────────────────────

export async function updatePendingContract(id: string, input: UpdatePendingContractInput) {
  const { vendor } = await requireVendor()
  const data = updatePendingContractSchema.parse(input)

  const contract = await prisma.pendingContract.update({
    where: { id, vendorId: vendor.id },
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
  return serialize(contract)
}

// ─── Vendor: Withdraw ───────────────────────────────────────────

export async function withdrawPendingContract(id: string) {
  const { vendor } = await requireVendor()

  await prisma.pendingContract.update({
    where: { id, vendorId: vendor.id },
    data: { status: "withdrawn" },
  })
}

// ─── Facility: List Pending ─────────────────────────────────────

export async function getFacilityPendingContracts(_facilityId?: string) {
  const { facility } = await requireFacility()

  const contracts = await prisma.pendingContract.findMany({
    where: { facilityId: facility.id, status: "submitted" },
    include: { vendor: { select: { id: true, name: true, logoUrl: true } } },
    orderBy: { submittedAt: "desc" },
  })
  return serialize(contracts)
}

// ─── Facility: Approve ──────────────────────────────────────────

export async function approvePendingContract(id: string, reviewedBy: string) {
  const { facility } = await requireFacility()

  const pending = await prisma.pendingContract.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
  })

  const contract = await prisma.contract.create({
    data: {
      name: pending.contractName,
      vendorId: pending.vendorId,
      facilityId: facility.id,
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

  return serialize(contract)
}

// ─── Facility: Reject ───────────────────────────────────────────

export async function rejectPendingContract(id: string, reviewedBy: string, notes: string) {
  const { facility } = await requireFacility()

  await prisma.pendingContract.update({
    where: { id, facilityId: facility.id },
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
  const { facility } = await requireFacility()

  await prisma.pendingContract.update({
    where: { id, facilityId: facility.id },
    data: {
      status: "revision_requested",
      reviewedAt: new Date(),
      reviewedBy,
      reviewNotes: notes,
    },
  })
}
