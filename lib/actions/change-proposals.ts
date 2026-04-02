"use server"

import { prisma } from "@/lib/db"
import { requireAuth, requireFacility, requireVendor } from "@/lib/actions/auth"
import type { CreateChangeProposalInput, ReviewChangeProposalInput } from "@/lib/validators/change-proposals"
import { createChangeProposalSchema, reviewChangeProposalSchema } from "@/lib/validators/change-proposals"
import { serialize } from "@/lib/serialize"

// ─── Get Single Proposal ────────────────────────────────────────

export async function getChangeProposal(id: string) {
  const session = await requireAuth()

  // Scope to user's facility or vendor
  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { facility: true, vendor: true } } },
  })
  const facilityId = member?.organization?.facility?.id
  const vendorId = member?.organization?.vendor?.id

  const proposal = await prisma.contractChangeProposal.findFirst({
    where: {
      id,
      ...(facilityId ? { facilityId } : vendorId ? { vendorId } : {}),
    },
    include: { contract: { select: { name: true, vendorName: true } } },
  })

  if (!proposal) throw new Error("Not found")

  return serialize({
    ...proposal,
    contractName: proposal.contract.name,
    submittedAt: proposal.submittedAt.toISOString(),
    reviewedAt: proposal.reviewedAt?.toISOString() ?? null,
  })
}

// ─── Get Proposals by Contract ──────────────────────────────────

export async function getChangeProposals(contractId: string) {
  const session = await requireAuth()

  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { facility: true, vendor: true } } },
  })
  const facilityId = member?.organization?.facility?.id
  const vendorId = member?.organization?.vendor?.id

  const proposals = await prisma.contractChangeProposal.findMany({
    where: {
      contractId,
      ...(facilityId ? { facilityId } : vendorId ? { vendorId } : {}),
    },
    orderBy: { submittedAt: "desc" },
  })

  return serialize(proposals.map((p) => ({
    ...p,
    submittedAt: p.submittedAt.toISOString(),
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
  })))
}

// ─── Get Pending Proposals for Facility ─────────────────────────

export async function getPendingProposals(_facilityId?: string) {
  const { facility } = await requireFacility()

  const proposals = await prisma.contractChangeProposal.findMany({
    where: { facilityId: facility.id, status: "pending" },
    include: { contract: { select: { name: true } } },
    orderBy: { submittedAt: "desc" },
  })

  return serialize(proposals.map((p) => ({
    ...p,
    contractName: p.contract.name,
    submittedAt: p.submittedAt.toISOString(),
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
  })))
}

// ─── Get Vendor's Own Proposals ─────────────────────────────────

export async function getVendorProposals(_vendorId?: string) {
  const { vendor } = await requireVendor()

  const proposals = await prisma.contractChangeProposal.findMany({
    where: { vendorId: vendor.id },
    include: { contract: { select: { name: true } } },
    orderBy: { submittedAt: "desc" },
  })

  return serialize(proposals.map((p) => ({
    ...p,
    contractName: p.contract.name,
    submittedAt: p.submittedAt.toISOString(),
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
  })))
}

// ─── Create Change Proposal (Vendor) ────────────────────────────

export async function createChangeProposal(input: CreateChangeProposalInput) {
  await requireVendor()
  const data = createChangeProposalSchema.parse(input)

  const proposal = await prisma.contractChangeProposal.create({
    data: {
      contractId: data.contractId,
      vendorId: data.vendorId,
      vendorName: data.vendorName,
      facilityId: data.facilityId,
      facilityName: data.facilityName,
      proposalType: data.proposalType,
      changes: JSON.parse(JSON.stringify(data.changes)),
      proposedTerms: data.proposedTerms
        ? JSON.parse(JSON.stringify(data.proposedTerms))
        : undefined,
      vendorMessage: data.vendorMessage,
    },
  })
  return serialize(proposal)
}

// ─── Review Change Proposal (Facility) ──────────────────────────

export async function reviewChangeProposal(
  id: string,
  input: ReviewChangeProposalInput
) {
  const { facility } = await requireFacility()
  const data = reviewChangeProposalSchema.parse(input)

  const statusMap = {
    approve: "approved",
    reject: "rejected",
    revision_requested: "revision_requested",
  } as const

  const proposal = await prisma.contractChangeProposal.update({
    where: { id, facilityId: facility.id },
    data: {
      status: statusMap[data.action],
      reviewedBy: data.reviewedBy,
      reviewNotes: data.notes,
      reviewedAt: new Date(),
    },
  })
  return serialize(proposal)
}

// ─── Withdraw Proposal (Vendor) ─────────────────────────────────

export async function withdrawChangeProposal(id: string) {
  const { vendor } = await requireVendor()

  const result = await prisma.contractChangeProposal.updateMany({
    where: { id, vendorId: vendor.id, status: "pending" },
    data: { status: "rejected", reviewNotes: "Withdrawn by vendor" },
  })
  return serialize(result)
}
