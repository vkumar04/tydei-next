"use server"

import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"
import type { CreateChangeProposalInput } from "@/lib/validators/change-proposals"

// ─── Create Change Proposal ─────────────────────────────────────

export async function createChangeProposal(input: CreateChangeProposalInput) {
  await requireAuth()

  return prisma.contractChangeProposal.create({
    data: {
      contractId: input.contractId,
      vendorId: input.vendorId,
      vendorName: input.vendorName,
      facilityId: input.facilityId,
      facilityName: input.facilityName,
      proposalType: input.proposalType,
      changes: JSON.parse(JSON.stringify(input.changes)),
      proposedTerms: input.proposedTerms ? JSON.parse(JSON.stringify(input.proposedTerms)) : undefined,
      vendorMessage: input.vendorMessage,
    },
  })
}

// ─── Get Proposals by Contract ──────────────────────────────────

export async function getChangeProposals(contractId: string) {
  await requireAuth()

  const proposals = await prisma.contractChangeProposal.findMany({
    where: { contractId },
    orderBy: { submittedAt: "desc" },
  })

  return proposals.map((p) => ({
    ...p,
    submittedAt: p.submittedAt.toISOString(),
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
  }))
}

// ─── Get Pending Proposals for Facility ─────────────────────────

export async function getPendingProposals(facilityId: string) {
  await requireAuth()

  const proposals = await prisma.contractChangeProposal.findMany({
    where: { facilityId, status: "pending" },
    include: { contract: { select: { name: true } } },
    orderBy: { submittedAt: "desc" },
  })

  return proposals.map((p) => ({
    ...p,
    contractName: p.contract.name,
    submittedAt: p.submittedAt.toISOString(),
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
  }))
}

// ─── Review Change Proposal ─────────────────────────────────────

export async function reviewChangeProposal(
  id: string,
  input: {
    action: "approve" | "reject" | "revision_requested"
    reviewedBy: string
    notes?: string
  }
) {
  await requireAuth()

  await prisma.contractChangeProposal.update({
    where: { id },
    data: {
      status: input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "revision_requested",
      reviewedBy: input.reviewedBy,
      reviewNotes: input.notes,
      reviewedAt: new Date(),
    },
  })
}
