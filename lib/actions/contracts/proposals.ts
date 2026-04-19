"use server"

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"

// ─── Queries ─────────────────────────────────────────────────────

/**
 * Fetch pending vendor-submitted ContractChangeProposals for a given
 * contract, scoped to the current facility.
 */
export async function getPendingProposalsForContract(contractId: string) {
  const { facility } = await requireFacility()
  const proposals = await prisma.contractChangeProposal.findMany({
    where: {
      contractId,
      status: "pending",
      contract: { facilityId: facility.id },
    },
    orderBy: { submittedAt: "desc" },
  })
  return serialize(proposals)
}

// ─── Mutations ───────────────────────────────────────────────────

/**
 * Approve a pending proposal. Atomically applies any `contract_edit`
 * field changes to the contract and flips the proposal status to
 * "approved". Term-shape proposals (term_change / new_term / remove_term)
 * flip status only — term persistence is handled by the dedicated
 * contract-terms actions once approved upstream.
 */
export async function approveContractChangeProposal(
  proposalId: string,
): Promise<void> {
  const { facility, user } = await requireFacility()

  const proposal = await prisma.contractChangeProposal.findUniqueOrThrow({
    where: { id: proposalId },
    include: { contract: { select: { id: true, facilityId: true } } },
  })

  if (proposal.contract.facilityId !== facility.id) {
    throw new Error("Forbidden: proposal belongs to a different facility")
  }
  if (proposal.status !== "pending") {
    throw new Error(`Cannot approve proposal in status ${proposal.status}`)
  }

  const contractUpdateData = extractContractUpdateData(
    proposal.proposalType,
    proposal.changes as Prisma.JsonValue,
  )

  await prisma.$transaction(async (tx) => {
    if (contractUpdateData && Object.keys(contractUpdateData).length > 0) {
      await tx.contract.update({
        where: { id: proposal.contractId },
        data: contractUpdateData,
      })
    }
    await tx.contractChangeProposal.update({
      where: { id: proposalId },
      data: {
        status: "approved",
        reviewedAt: new Date(),
        reviewedBy: user.id,
      },
    })
  })

  await logAudit({
    userId: user.id,
    action: "contract_change_proposal.approved",
    entityType: "contract_change_proposal",
    entityId: proposalId,
    metadata: {
      contractId: proposal.contractId,
      changes: (proposal.changes ?? null) as Prisma.InputJsonValue,
    },
  })
}

/**
 * Reject a pending proposal with a required reviewer note.
 */
export async function rejectContractChangeProposal(
  proposalId: string,
  notes: string,
): Promise<void> {
  const { facility, user } = await requireFacility()

  const proposal = await prisma.contractChangeProposal.findUniqueOrThrow({
    where: { id: proposalId },
    include: { contract: { select: { facilityId: true } } },
  })
  if (proposal.contract.facilityId !== facility.id) {
    throw new Error("Forbidden: proposal belongs to a different facility")
  }
  if (proposal.status !== "pending") {
    throw new Error(`Cannot reject proposal in status ${proposal.status}`)
  }

  await prisma.contractChangeProposal.update({
    where: { id: proposalId },
    data: {
      status: "rejected",
      reviewNotes: notes,
      reviewedAt: new Date(),
      reviewedBy: user.id,
    },
  })

  await logAudit({
    userId: user.id,
    action: "contract_change_proposal.rejected",
    entityType: "contract_change_proposal",
    entityId: proposalId,
    metadata: { notes },
  })
}

/**
 * Send a pending proposal back to the vendor for revision.
 */
export async function requestProposalRevision(
  proposalId: string,
  notes: string,
): Promise<void> {
  const { facility, user } = await requireFacility()

  const proposal = await prisma.contractChangeProposal.findUniqueOrThrow({
    where: { id: proposalId },
    include: { contract: { select: { facilityId: true } } },
  })
  if (proposal.contract.facilityId !== facility.id) {
    throw new Error("Forbidden: proposal belongs to a different facility")
  }
  if (proposal.status !== "pending") {
    throw new Error(
      `Cannot request revision for proposal in status ${proposal.status}`,
    )
  }

  await prisma.contractChangeProposal.update({
    where: { id: proposalId },
    data: {
      status: "revision_requested",
      reviewNotes: notes,
      reviewedAt: new Date(),
      reviewedBy: user.id,
    },
  })

  await logAudit({
    userId: user.id,
    action: "contract_change_proposal.revision_requested",
    entityType: "contract_change_proposal",
    entityId: proposalId,
    metadata: { notes },
  })
}

// ─── Internals ───────────────────────────────────────────────────

/**
 * Whitelist of `Contract` fields that an approved contract_edit
 * proposal is allowed to mutate. Keeps the approve path from turning
 * into an arbitrary field-write primitive.
 */
const ALLOWED_CONTRACT_EDIT_FIELDS = new Set<string>([
  "name",
  "vendorName",
  "description",
  "totalValue",
  "startDate",
  "endDate",
  "notes",
])

type ContractEditPatch = Record<string, unknown>

function extractContractUpdateData(
  proposalType: string,
  changes: Prisma.JsonValue,
): ContractEditPatch | null {
  if (proposalType !== "contract_edit") return null
  if (changes === null || changes === undefined) return null

  const patch: ContractEditPatch = {}

  if (Array.isArray(changes)) {
    // Shape: [{ field: string, newValue: unknown }, ...]
    for (const entry of changes) {
      if (entry === null || typeof entry !== "object") continue
      const row = entry as Record<string, unknown>
      const field = typeof row.field === "string" ? row.field : null
      if (field && ALLOWED_CONTRACT_EDIT_FIELDS.has(field)) {
        patch[field] = row.newValue
      }
    }
  } else if (typeof changes === "object") {
    for (const [key, value] of Object.entries(
      changes as Record<string, unknown>,
    )) {
      if (ALLOWED_CONTRACT_EDIT_FIELDS.has(key)) {
        patch[key] = value
      }
    }
  }

  if (Object.keys(patch).length === 0) return null
  return patch
}
