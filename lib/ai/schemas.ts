import { z } from "zod"

// ─── Contract Extraction Schema ──────────────────────────────────

export const extractedContractSchema = z.object({
  contractName: z.string().describe("The name or title of the contract"),
  vendorName: z.string().describe("The vendor/manufacturer name"),
  contractType: z
    .enum(["usage", "capital", "service", "tie_in", "grouped", "pricing_only"])
    .describe("The type of contract"),
  effectiveDate: z.string().describe("Effective date in YYYY-MM-DD format"),
  expirationDate: z.string().describe("Expiration date in YYYY-MM-DD format"),
  totalValue: z.number().optional().describe("Total contract value in dollars"),
  description: z.string().optional().describe("Brief description of the contract"),
  terms: z.array(
    z.object({
      termName: z.string().describe("Name of the term/tier structure"),
      termType: z.string().describe("Type: spend_rebate, volume_rebate, etc."),
      tiers: z.array(
        z.object({
          tierNumber: z.number().describe("Tier number (1 = lowest)"),
          spendMin: z.number().optional().describe("Minimum spend threshold"),
          spendMax: z.number().optional().describe("Maximum spend threshold"),
          rebateType: z.string().optional().describe("Rebate type"),
          rebateValue: z.number().optional().describe("Rebate value (percentage or fixed)"),
        })
      ),
    })
  ),
})

export type ExtractedContractData = z.infer<typeof extractedContractSchema>

// ─── Deal Score Schema ───────────────────────────────────────────

export const dealScoreSchema = z.object({
  financialValue: z.number().min(0).max(100).describe("Financial value score 0-100"),
  rebateEfficiency: z.number().min(0).max(100).describe("Rebate efficiency score 0-100"),
  pricingCompetitiveness: z
    .number()
    .min(0)
    .max(100)
    .describe("Pricing competitiveness score 0-100"),
  marketShareAlignment: z
    .number()
    .min(0)
    .max(100)
    .describe("Market share alignment score 0-100"),
  complianceLikelihood: z
    .number()
    .min(0)
    .max(100)
    .describe("Compliance likelihood score 0-100"),
  overallScore: z.number().min(0).max(100).describe("Overall deal score 0-100"),
  recommendation: z.string().describe("Brief recommendation summary"),
  negotiationAdvice: z
    .array(z.string())
    .describe("Actionable negotiation advice bullet points"),
})

export type DealScoreResult = z.infer<typeof dealScoreSchema>

// ─── Supply Match Schema ─────────────────────────────────────────

export const supplyMatchSchema = z.object({
  matchedVendorItemNo: z.string().nullable().describe("Matched vendor item number or null"),
  matchedDescription: z.string().nullable().describe("Matched item description or null"),
  confidence: z.number().min(0).max(1).describe("Confidence score 0-1"),
  reasoning: z.string().describe("Explanation of why this match was chosen"),
})

export type SupplyMatchResult = z.infer<typeof supplyMatchSchema>
