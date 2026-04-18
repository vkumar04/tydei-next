"use server"

/**
 * Renewals — vendor proposal server actions.
 *
 * Reference: docs/superpowers/specs/2026-04-18-renewals-rewrite.md §4.2
 *
 * Persists renewal proposals into `ContractChangeProposal`. The spec
 * describes a `proposalType: "renewal"` + `status: "submitted"` shape,
 * but the current Prisma enum vocabulary is narrower
 * (`term_change | new_term | remove_term | contract_edit` and
 * `pending | approved | rejected | revision_requested`). We map:
 *
 *     spec proposalType "renewal"   → Prisma "contract_edit"
 *     spec status       "submitted" → Prisma "pending"
 *     spec decision     "countered" → Prisma "revision_requested"
 *
 * and stash the semantic discriminator (`kind: "renewal"`) inside the
 * `changes` JSON so downstream readers can distinguish renewal proposals
 * from generic AI-advisory ones. This mirrors the approach in
 * `lib/ai/contract-change-proposal.ts`.
 */

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import {
  validateProposedTerms,
  validateReviewDecision,
  type ProposalDecision,
  type ValidatedProposedTerms,
} from "@/lib/renewals/proposal-review"

// ─── Return type — matches Prisma row, dates serialized ──────────

export interface ContractChangeProposal {
  id: string
  contractId: string
  vendorId: string
  vendorName: string
  facilityId: string | null
  facilityName: string | null
  proposalType: string
  status: string
  changes: Prisma.JsonValue
  proposedTerms: Prisma.JsonValue | null
  vendorMessage: string | null
  submittedAt: string
  reviewedAt: string | null
  reviewedBy: string | null
  reviewNotes: string | null
}

/** Semantic payload stored in `changes` JSON for renewal proposals. */
interface RenewalChangesPayload {
  source: "renewal_proposal"
  kind: "renewal"
  notes: string
  terms: {
    effectiveDate: string | null
    expirationDate: string | null
    priceChangePercent: number | null
    rebateRateChangePercent: number | null
    narrative: string | null
  }
  beforeSnapshot: unknown
  afterSnapshot: unknown
}

// ─── Vendor — submit renewal proposal ────────────────────────────

export async function submitRenewalProposal(input: {
  contractId: string
  proposedTerms: unknown
  notes: string
}): Promise<ContractChangeProposal> {
  const { vendor, user } = await requireVendor()

  // Validate the proposed terms via the pure helper. Throws
  // `ProposalValidationError` on bad shape — we let it bubble so the
  // UI can render field-level feedback.
  const validated: ValidatedProposedTerms = validateProposedTerms(
    input.proposedTerms,
  )

  // Ownership: vendor can only propose against a contract they own.
  const contract = await prisma.contract.findFirst({
    where: { id: input.contractId, vendorId: vendor.id },
    select: {
      id: true,
      facilityId: true,
      effectiveDate: true,
      expirationDate: true,
      facility: { select: { name: true } },
    },
  })
  if (!contract) {
    throw new Error("Contract not found")
  }

  const beforeSnapshot = {
    effectiveDate: contract.effectiveDate,
    expirationDate: contract.expirationDate,
  }
  const afterSnapshot = {
    effectiveDate: validated.effectiveDate,
    expirationDate: validated.expirationDate,
    priceChangePercent: validated.priceChangePercent,
    rebateRateChangePercent: validated.rebateRateChangePercent,
  }

  const changesPayload: RenewalChangesPayload = {
    source: "renewal_proposal",
    kind: "renewal",
    notes: input.notes,
    terms: {
      effectiveDate: validated.effectiveDate
        ? validated.effectiveDate.toISOString()
        : null,
      expirationDate: validated.expirationDate
        ? validated.expirationDate.toISOString()
        : null,
      priceChangePercent: validated.priceChangePercent,
      rebateRateChangePercent: validated.rebateRateChangePercent,
      narrative: validated.narrative,
    },
    beforeSnapshot,
    afterSnapshot,
  }

  const proposedTermsJson: Prisma.InputJsonValue = {
    effectiveDate: validated.effectiveDate
      ? validated.effectiveDate.toISOString()
      : null,
    expirationDate: validated.expirationDate
      ? validated.expirationDate.toISOString()
      : null,
    priceChangePercent: validated.priceChangePercent,
    rebateRateChangePercent: validated.rebateRateChangePercent,
    narrative: validated.narrative,
  }

  const created = await prisma.contractChangeProposal.create({
    data: {
      contractId: contract.id,
      vendorId: vendor.id,
      vendorName: vendor.name,
      facilityId: contract.facilityId,
      facilityName: contract.facility?.name ?? null,
      // Map spec "renewal" → Prisma "contract_edit" (broadest variant).
      proposalType: "contract_edit",
      // Map spec "submitted" → Prisma "pending".
      status: "pending",
      changes: changesPayload as unknown as Prisma.InputJsonValue,
      proposedTerms: proposedTermsJson,
      vendorMessage: input.notes,
    },
  })

  await logAudit({
    userId: user.id,
    action: "renewal.proposal_submitted",
    entityType: "contract_change_proposal",
    entityId: created.id,
    metadata: {
      contractId: contract.id,
      vendorId: vendor.id,
    },
  })

  return serialize(created) as unknown as ContractChangeProposal
}

// ─── Facility — review renewal proposal ──────────────────────────

/** Map the spec-level decision to the Prisma `ProposalStatus` enum. */
function statusForDecision(
  decision: ProposalDecision,
): "approved" | "rejected" | "revision_requested" {
  if (decision === "approved") return "approved"
  if (decision === "rejected") return "rejected"
  // "countered" doesn't exist in the Prisma enum — revision_requested
  // is the closest semantic match ("please revise and resubmit").
  return "revision_requested"
}

export async function reviewRenewalProposal(input: {
  proposalId: string
  decision: "approved" | "rejected" | "countered"
  note?: string
}): Promise<ContractChangeProposal> {
  const { facility, user } = await requireFacility()

  // Validate the decision + note (countered/rejected require ≥10 chars).
  const validated = validateReviewDecision({
    decision: input.decision,
    note: input.note ?? "",
  })

  // Ownership: proposal must target this facility.
  const existing = await prisma.contractChangeProposal.findFirst({
    where: { id: input.proposalId, facilityId: facility.id },
    select: { id: true, contractId: true },
  })
  if (!existing) {
    throw new Error("Renewal proposal not found")
  }

  const updated = await prisma.contractChangeProposal.update({
    where: { id: existing.id },
    data: {
      status: statusForDecision(validated.decision),
      reviewedBy: user.id,
      reviewNotes: validated.note.length > 0 ? validated.note : null,
      reviewedAt: new Date(),
    },
  })

  await logAudit({
    userId: user.id,
    action: "renewal.proposal_reviewed",
    entityType: "contract_change_proposal",
    entityId: existing.id,
    metadata: {
      decision: validated.decision,
      contractId: existing.contractId,
      hasNote: validated.note.length > 0,
    },
  })

  return serialize(updated) as unknown as ContractChangeProposal
}
