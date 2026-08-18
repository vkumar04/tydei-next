/**
 * Reads the pricing items a vendor carried in `ContractChangeProposal.proposedTerms`.
 *
 * That column is `Json?`, so a row written by an older client — or by hand — can
 * be any shape at all. Parse rather than cast: a malformed blob yields no items
 * instead of throwing inside an approval transaction.
 *
 * Directive-free so the approve action, the review UI and the vendor form all
 * read the column the same way.
 */

import {
  proposedTermsSchema,
  type ProposedDocumentInput,
  type ProposedPricingItemInput,
} from "@/lib/validators/change-proposals"

export function extractProposedPricingItems(
  proposedTerms: unknown,
): ProposedPricingItemInput[] {
  const parsed = proposedTermsSchema.safeParse(proposedTerms)
  if (!parsed.success) return []
  return parsed.data.pricingItems ?? []
}

export function extractProposedDocuments(
  proposedTerms: unknown,
): ProposedDocumentInput[] {
  const parsed = proposedTermsSchema.safeParse(proposedTerms)
  if (!parsed.success) return []
  return parsed.data.documents ?? []
}
