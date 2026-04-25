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

// Charles audit pass-4 NIT: removed dead `getChangeProposals` —
// zero call sites in app/components/hooks. If a future "history"
// view needs unfiltered proposals for a contract, add it back with
// an explicit status filter that decides whether to include
// withdrawn / rejected.

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

/**
 * Charles audit pass-4 round-5 NIT: renamed from `getVendorProposals`
 * to disambiguate from the unrelated `getVendorProposals` export in
 * `lib/actions/prospective.ts` (which lists vendor *prospective*
 * (alert-based) proposals, not change-proposals). The duplicate name
 * was a future-trap for auto-imports.
 */
export async function getVendorChangeProposals(_vendorId?: string) {
  const { vendor } = await requireVendor()

  // Charles audit pass-2: hide withdrawn proposals from the active
  // list (withdrawn means the vendor pulled it; they shouldn't see it
  // in their in-flight queue). A future "history" view can include
  // status: "withdrawn" explicitly.
  const proposals = await prisma.contractChangeProposal.findMany({
    where: { vendorId: vendor.id, status: { not: "withdrawn" } },
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
  // Charles audit round-5 CONCERN: scope to the authenticated vendor.
  // Earlier code accepted vendorId/vendorName + contractId from the
  // client and wrote them verbatim — any authenticated vendor could
  // submit a proposal impersonating another vendor against an
  // arbitrary contract. Now: ignore client-supplied vendor identity
  // and verify the target contract actually belongs to the
  // authenticated vendor before writing.
  const { vendor } = await requireVendor()
  const data = createChangeProposalSchema.parse(input)

  const contract = await prisma.contract.findUnique({
    where: { id: data.contractId },
    select: { id: true, vendorId: true, facilityId: true, facility: { select: { name: true } } },
  })
  if (!contract || contract.vendorId !== vendor.id) {
    throw new Error("Contract not found or not owned by this vendor.")
  }

  const proposal = await prisma.contractChangeProposal.create({
    data: {
      contractId: data.contractId,
      // Authoritative vendor identity — never trust the client.
      vendorId: vendor.id,
      vendorName: vendor.name,
      // Facility identity comes from the contract row, not the client.
      facilityId: contract.facilityId ?? data.facilityId,
      facilityName: contract.facility?.name ?? data.facilityName,
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

/**
 * Charles 2026-04-25 (vendor-mirror Phase 3 follow-up — B2):
 * delegate to the canonical per-action helpers in
 * `lib/actions/contracts/proposals.ts`. The previous in-line
 * implementation here flipped status but skipped the patch-extraction,
 * audit log, and vendor notifications. Routing through the canonical
 * helpers keeps every approve path going through the same code so the
 * vendor mirror can't silently regress.
 */
export async function reviewChangeProposal(
  id: string,
  input: ReviewChangeProposalInput
) {
  const data = reviewChangeProposalSchema.parse(input)

  const {
    approveContractChangeProposal,
    rejectContractChangeProposal,
    requestProposalRevision,
    counterContractChangeProposal,
  } = await import("@/lib/actions/contracts/proposals")

  switch (data.action) {
    case "approve":
      await approveContractChangeProposal(id)
      break
    case "reject":
      await rejectContractChangeProposal(id, data.notes ?? "")
      break
    case "revision_requested":
      await requestProposalRevision(id, data.notes ?? "")
      break
    case "counter_propose":
      await counterContractChangeProposal(id, data.notes ?? "")
      break
  }

  const updated = await prisma.contractChangeProposal.findUniqueOrThrow({
    where: { id },
  })
  return serialize(updated)
}

// ─── Withdraw Proposal (Vendor) ─────────────────────────────────

/**
 * Charles 2026-04-25 audit re-pass: ProposalStatus now has a
 * dedicated `withdrawn` value so reports / analytics can distinguish
 * vendor-initiated withdrawal from facility rejection.
 */
export async function withdrawChangeProposal(id: string) {
  const { vendor } = await requireVendor()

  const result = await prisma.contractChangeProposal.updateMany({
    where: { id, vendorId: vendor.id, status: "pending" },
    data: { status: "withdrawn", reviewNotes: "Withdrawn by vendor" },
  })
  if (result.count === 0) {
    // Charles 2026-04-25 audit re-pass C4: surface "no-op withdraw"
    // (already approved/rejected, or wrong vendor) instead of a
    // silent success toast.
    throw new Error(
      "Cannot withdraw proposal: not found or already finalized.",
    )
  }
  return serialize(result)
}
