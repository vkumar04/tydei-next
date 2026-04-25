"use server"

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"

/**
 * Charles 2026-04-25 (audit follow-up — Vendor mirror Phase 3):
 * notify the vendor org when a ContractChangeProposal is acted on.
 * Mirrors the pending-contract notification pattern: in-app row +
 * email (best-effort), with a deep link back to the contract so
 * the vendor can see the applied changes.
 */
async function notifyVendorOfProposalDecision(input: {
  proposalId: string
  vendorId: string
  contractId: string
  decision: "approved" | "rejected" | "revision_requested"
  reviewNotes: string | null
}): Promise<void> {
  try {
    const { createInAppNotifications } = await import(
      "@/lib/actions/notifications/in-app"
    )
    const vendor = await prisma.vendor.findUnique({
      where: { id: input.vendorId },
      select: {
        organization: {
          select: { members: { select: { user: { select: { id: true } } } } },
        },
      },
    })
    const userIds =
      vendor?.organization?.members.map((m) => m.user.id) ?? []
    if (userIds.length === 0) return
    const decisionLabel =
      input.decision === "approved"
        ? "approved"
        : input.decision === "rejected"
          ? "rejected"
          : "needs revision"
    await createInAppNotifications({
      userIds,
      type: `contract_change_proposal_${input.decision}`,
      title: `Your contract change proposal was ${decisionLabel}`,
      body: input.reviewNotes,
      payload: {
        proposalId: input.proposalId,
        contractId: input.contractId,
        decision: input.decision,
      },
      actionUrl: `/vendor/contracts/${input.contractId}`,
    })
  } catch (err) {
    console.warn("[notifyVendorOfProposalDecision] failed", err)
  }
}

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

  // Charles 2026-04-25 (audit follow-up — Vendor mirror Phase 3):
  // notify the vendor org that their proposal was acted on, both
  // via in-app notification and email when configured.
  await notifyVendorOfProposalDecision({
    proposalId,
    vendorId: proposal.vendorId,
    contractId: proposal.contractId,
    decision: "approved",
    reviewNotes: null,
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

  await notifyVendorOfProposalDecision({
    proposalId,
    vendorId: proposal.vendorId,
    contractId: proposal.contractId,
    decision: "rejected",
    reviewNotes: notes,
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

  await notifyVendorOfProposalDecision({
    proposalId,
    vendorId: proposal.vendorId,
    contractId: proposal.contractId,
    decision: "revision_requested",
    reviewNotes: notes,
  })
}

/**
 * Counter-propose: facility rejects the vendor's terms but offers an
 * alternative (captured in `notes`, and eventually a structured
 * counter-terms payload once the full flow is designed — W1.3 stub).
 *
 * Behaviorally similar to `requestProposalRevision` (ball is in the
 * vendor's court), but uses the distinct `countered` enum value so UIs
 * can render it differently ("Counter-proposed" vs "Revision Requested").
 */
export async function counterContractChangeProposal(
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
      `Cannot counter-propose proposal in status ${proposal.status}`,
    )
  }
  if (notes.trim().length < 10) {
    throw new Error("Counter-proposal requires a note (min 10 chars)")
  }

  await prisma.contractChangeProposal.update({
    where: { id: proposalId },
    data: {
      status: "countered",
      reviewNotes: notes,
      reviewedAt: new Date(),
      reviewedBy: user.id,
    },
  })

  await logAudit({
    userId: user.id,
    action: "contract_change_proposal.countered",
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
 *
 * Charles 2026-04-25 (vendor-mirror Phase 3 follow-up):
 * - Renamed `startDate`/`endDate` to match the actual `Contract`
 *   schema (`effectiveDate`/`expirationDate`).
 * - Extended with the Phase-2 vendor field-parity columns so that
 *   contract_edit proposals submitted by vendors actually apply on
 *   approve instead of being silently dropped.
 */
const ALLOWED_CONTRACT_EDIT_FIELDS: ReadonlySet<ContractEditField> = new Set([
  "name",
  "vendorName",
  "description",
  "totalValue",
  "effectiveDate",
  "expirationDate",
  "notes",
  // Phase-2 vendor-editable contract fields:
  "contractNumber",
  "annualValue",
  "gpoAffiliation",
  "performancePeriod",
  "rebatePayPeriod",
  "autoRenewal",
  "terminationNoticeDays",
  "capitalCost",
  "interestRate",
  "termMonths",
  "downPayment",
  "paymentCadence",
  "amortizationShape",
])

type ContractEditField =
  | "name"
  | "vendorName"
  | "description"
  | "totalValue"
  | "effectiveDate"
  | "expirationDate"
  | "notes"
  | "contractNumber"
  | "annualValue"
  | "gpoAffiliation"
  | "performancePeriod"
  | "rebatePayPeriod"
  | "autoRenewal"
  | "terminationNoticeDays"
  | "capitalCost"
  | "interestRate"
  | "termMonths"
  | "downPayment"
  | "paymentCadence"
  | "amortizationShape"

type ContractEditPatch = Record<string, unknown>

const DATE_FIELDS = new Set<ContractEditField>([
  "effectiveDate",
  "expirationDate",
])
const DECIMAL_FIELDS = new Set<ContractEditField>([
  "totalValue",
  "annualValue",
  "capitalCost",
  "interestRate",
  "downPayment",
])
const INT_FIELDS = new Set<ContractEditField>([
  "terminationNoticeDays",
  "termMonths",
])
const BOOL_FIELDS = new Set<ContractEditField>(["autoRenewal"])

function isAllowedField(name: string): name is ContractEditField {
  return (ALLOWED_CONTRACT_EDIT_FIELDS as ReadonlySet<string>).has(name)
}

/**
 * Coerce a JSON-shaped value into the right Prisma type for the given
 * Contract field. Returns `undefined` if the value can't be coerced —
 * caller drops the field rather than writing a bad value.
 */
function coerceFieldValue(
  field: ContractEditField,
  raw: unknown,
): unknown | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null

  if (DATE_FIELDS.has(field)) {
    if (raw instanceof Date) return raw
    if (typeof raw === "string" && raw.length > 0) {
      const d = new Date(raw)
      return Number.isNaN(d.getTime()) ? undefined : d
    }
    return undefined
  }
  if (DECIMAL_FIELDS.has(field)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return new Prisma.Decimal(raw)
    }
    if (typeof raw === "string" && raw.trim().length > 0) {
      const cleaned = raw.replace(/[$,]/g, "")
      const n = Number(cleaned)
      if (Number.isFinite(n)) return new Prisma.Decimal(cleaned)
    }
    return undefined
  }
  if (INT_FIELDS.has(field)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.trunc(raw)
    }
    if (typeof raw === "string" && raw.trim().length > 0) {
      const n = Number(raw)
      return Number.isFinite(n) ? Math.trunc(n) : undefined
    }
    return undefined
  }
  if (BOOL_FIELDS.has(field)) {
    if (typeof raw === "boolean") return raw
    if (typeof raw === "string") {
      if (raw === "true") return true
      if (raw === "false") return false
    }
    return undefined
  }
  // Plain string-or-enum fields: pass through if it's a string.
  if (typeof raw === "string") return raw
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw)
  return undefined
}

function extractContractUpdateData(
  proposalType: string,
  changes: Prisma.JsonValue,
): ContractEditPatch | null {
  if (proposalType !== "contract_edit") return null
  if (changes === null || changes === undefined) return null

  const patch: ContractEditPatch = {}

  const applyEntry = (field: string, raw: unknown) => {
    if (!isAllowedField(field)) return
    const coerced = coerceFieldValue(field, raw)
    if (coerced === undefined) return
    patch[field] = coerced
  }

  if (Array.isArray(changes)) {
    // Vendor form emits `{ field, currentValue, proposedValue }`.
    // Older clients / facility-side helpers may emit `{ field, newValue }`.
    // Prefer `proposedValue` and fall back to `newValue` for compat.
    for (const entry of changes) {
      if (entry === null || typeof entry !== "object") continue
      const row = entry as Record<string, unknown>
      const field = typeof row.field === "string" ? row.field : null
      if (!field) continue
      const value =
        "proposedValue" in row && row.proposedValue !== undefined
          ? row.proposedValue
          : row.newValue
      applyEntry(field, value)
    }
  } else if (typeof changes === "object") {
    for (const [key, value] of Object.entries(
      changes as Record<string, unknown>,
    )) {
      applyEntry(key, value)
    }
  }

  if (Object.keys(patch).length === 0) return null
  return patch
}
