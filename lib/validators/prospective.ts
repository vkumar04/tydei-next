import { z } from "zod"

// ─── Proposal Terms ────────────────────────────────────────────

export const proposalTermsSchema = z.object({
  contractLength: z.number().int().min(1).max(120),
  startDate: z.string().min(1),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
})

export type ProposalTerms = z.infer<typeof proposalTermsSchema>

// ─── Proposal Input (Vendor-side) ──────────────────────────────

export const proposalInputSchema = z.object({
  vendorId: z.string(),
  facilityIds: z.array(z.string()).min(1, "Select at least one facility"),
  pricingItems: z
    .array(
      z.object({
        vendorItemNo: z.string().min(1),
        description: z.string().optional(),
        proposedPrice: z.number().min(0),
        quantity: z.number().int().min(1).optional(),
      })
    )
    .min(1, "Add at least one pricing item"),
  terms: proposalTermsSchema,
})

export type ProposalInput = z.infer<typeof proposalInputSchema>

// ─── Deal Score Input ──────────────────────────────────────────

export const dealScoreInputSchema = z.object({
  financialValue: z.number().min(0).max(100),
  rebateEfficiency: z.number().min(0).max(100),
  pricingCompetitiveness: z.number().min(0).max(100),
  marketShareAlignment: z.number().min(0).max(100),
  complianceLikelihood: z.number().min(0).max(100),
})

export type DealScoreInput = z.infer<typeof dealScoreInputSchema>

// ─── Facility Analyze Proposal Input ───────────────────────────

export const analyzeProposalInputSchema = z.object({
  facilityId: z.string(),
  proposedPricing: z
    .array(
      z.object({
        vendorItemNo: z.string().min(1),
        description: z.string().optional(),
        proposedPrice: z.number().min(0),
        currentPrice: z.number().min(0).optional(),
        quantity: z.number().int().min(1).optional(),
      })
    )
    .min(1),
  vendorId: z.string().optional(),
})

export type AnalyzeProposalInput = z.infer<typeof analyzeProposalInputSchema>
