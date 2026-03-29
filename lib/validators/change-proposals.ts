import { z } from "zod"

export const createChangeProposalSchema = z.object({
  contractId: z.string().min(1, "Contract is required"),
  vendorId: z.string().min(1),
  vendorName: z.string().min(1),
  facilityId: z.string().optional(),
  facilityName: z.string().optional(),
  proposalType: z.enum(["term_change", "new_term", "remove_term", "contract_edit"]),
  changes: z.array(z.object({
    field: z.string(),
    currentValue: z.string(),
    proposedValue: z.string(),
  })),
  proposedTerms: z.unknown().optional(),
  vendorMessage: z.string().optional(),
})

export type CreateChangeProposalInput = z.infer<typeof createChangeProposalSchema>

export const reviewChangeProposalSchema = z.object({
  action: z.enum(["approve", "reject", "revision_requested"]),
  reviewedBy: z.string().min(1),
  notes: z.string().optional(),
})

export type ReviewChangeProposalInput = z.infer<typeof reviewChangeProposalSchema>
