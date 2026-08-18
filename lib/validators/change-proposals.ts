import { z } from "zod"

const money = z.number().finite().gte(0).lte(1e9)

/** One pricing row a vendor proposes: a new SKU, or a new price for one the
 *  contract already carries. Classification is `matchProposedPricing`'s job —
 *  the wire payload never asserts add-vs-update, so a stale client cannot
 *  mislabel a reprice as an add. */
export const proposedPricingItemSchema = z.object({
  vendorItemNo: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  category: z.string().max(200).optional(),
  unitPrice: money,
  uom: z.string().max(20).optional(),
})

export type ProposedPricingItemInput = z.infer<typeof proposedPricingItemSchema>

/** A document backing the proposal — the amendment PDF the AI read, say.
 *  `url` is a storage key, and a client-supplied key is never trusted on its
 *  own: the write path checks it was minted by the caller (keyBelongsToTenant),
 *  and the download path re-authorizes it (assertKeyVisibleToUser). */
export const proposedDocumentSchema = z.object({
  name: z.string().trim().min(1).max(300),
  url: z.string().trim().min(1).max(500),
})

export type ProposedDocumentInput = z.infer<typeof proposedDocumentSchema>

/** Structured payload carried in the existing `proposedTerms` Json column, so
 *  richer proposals need no migration. */
export const proposedTermsSchema = z.object({
  pricingItems: z.array(proposedPricingItemSchema).max(5_000).optional(),
  documents: z.array(proposedDocumentSchema).max(20).optional(),
})

export type ProposedTermsInput = z.infer<typeof proposedTermsSchema>

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
  proposedTerms: proposedTermsSchema.optional(),
  vendorMessage: z.string().optional(),
})

export type CreateChangeProposalInput = z.infer<typeof createChangeProposalSchema>

export const reviewChangeProposalSchema = z.object({
  action: z.enum(["approve", "reject", "revision_requested", "counter_propose"]),
  reviewedBy: z.string().min(1),
  notes: z.string().optional(),
})

export type ReviewChangeProposalInput = z.infer<typeof reviewChangeProposalSchema>
