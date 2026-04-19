import { z } from "zod"

/**
 * Renewal Brief — AI-generated negotiation primer (Tier 4).
 *
 * Shape is locked by the spec:
 *   docs/superpowers/specs/2026-04-19-rebate-optimizer-ai-design.md §4.2
 *
 * Notes on constraints: as with the Tier 1 schema, we intentionally avoid
 * `.min()`/`.max()` on numeric leaves so the schema stays compatible with
 * Anthropic's JSON Schema validator. Integer constraints use `.int()` only
 * (maps to `type: "integer"`) — no range bounds that would emit
 * `minimum`/`maximum` keywords.
 */

export const renewalBriefAskSchema = z.object({
  rank: z
    .number()
    .int()
    .describe("1-indexed rank; 1 is the highest-priority ask"),
  ask: z
    .string()
    .describe(
      "Headline for the ask (e.g., 'Lower Tier 3 threshold by 10%')",
    ),
  rationale: z
    .string()
    .describe(
      "Why this ask — historical support from missed tiers / capture rate / amendment context",
    ),
  quantifiedImpact: z
    .string()
    .nullable()
    .describe(
      "Free-form dollar / percent / quarter-count impact derived from the inputs, or null if not quantifiable",
    ),
})

export type RenewalBriefAsk = z.infer<typeof renewalBriefAskSchema>

export const renewalBriefConcessionSchema = z.object({
  concession: z
    .string()
    .describe("A concession the facility could offer in return"),
  estimatedCost: z
    .string()
    .nullable()
    .describe(
      "Free-form estimated cost of the concession (e.g., '~$32K over 3 years'), or null if not quantifiable",
    ),
})

export type RenewalBriefConcession = z.infer<
  typeof renewalBriefConcessionSchema
>

export const renewalBriefMissedTierSchema = z.object({
  quarter: z
    .string()
    .describe(
      "ISO-ish quarter label (e.g., '2025-Q2') derived from the input rebate history",
    ),
  tierMissed: z.number().int().describe("The tier number that was missed"),
  shortfallDollars: z
    .number()
    .describe("Spend shortfall below the tier threshold, in dollars"),
  estimatedLostRebate: z
    .number()
    .describe("Estimated rebate dollars forgone because of the miss"),
})

export type RenewalBriefMissedTier = z.infer<
  typeof renewalBriefMissedTierSchema
>

export const renewalBriefPerformanceSchema = z.object({
  termMonths: z
    .number()
    .int()
    .describe("Total contract term in months (end - start)"),
  totalSpend: z
    .number()
    .describe("Total facility spend against the contract to date, in dollars"),
  projectedFullSpend: z
    .number()
    .describe(
      "Projected end-of-term spend if current run rate holds, in dollars",
    ),
  captureRate: z
    .number()
    .describe(
      "Earned rebate / max-possible rebate, 0-1 fraction",
    ),
  missedTiers: z.array(renewalBriefMissedTierSchema),
})

export type RenewalBriefPerformance = z.infer<
  typeof renewalBriefPerformanceSchema
>

export const renewalBriefSchema = z.object({
  contractId: z.string(),
  generatedAt: z.string().describe("ISO-8601 timestamp"),
  executiveSummary: z
    .string()
    .describe(
      "2-3 sentence plain-English summary of the renewal posture",
    ),
  performanceSummary: renewalBriefPerformanceSchema,
  primaryAsks: z
    .array(renewalBriefAskSchema)
    .describe("3-6 ranked asks the facility should bring to the negotiation"),
  concessionsOnTable: z
    .array(renewalBriefConcessionSchema)
    .describe("2-4 concessions the facility could offer if needed"),
})

export type RenewalBrief = z.infer<typeof renewalBriefSchema>

// ─── Input schema (payload fed into the Claude prompt) ────────────

export const renewalBriefInputContractSchema = z.object({
  id: z.string(),
  name: z.string(),
  contractNumber: z.string().nullable().optional(),
  vendorId: z.string().nullable().optional(),
  vendorName: z.string(),
  effectiveDate: z.string().describe("ISO-8601 date"),
  expirationDate: z.string().describe("ISO-8601 date"),
  totalValue: z.number(),
  annualValue: z.number(),
  performancePeriod: z.string(),
  rebatePayPeriod: z.string(),
  autoRenewal: z.boolean(),
})

export const renewalBriefInputTierSchema = z.object({
  tierNumber: z.number().int(),
  tierName: z.string().nullable().optional(),
  spendMin: z.number(),
  spendMax: z.number().nullable().optional(),
  rebateType: z.string(),
  /**
   * Stored as a fraction in Prisma (0.02 = 2%); passed through as-is so the
   * model sees the same number it would see in the DB.
   */
  rebateValue: z.number(),
})

export const renewalBriefInputTermSchema = z.object({
  id: z.string(),
  termName: z.string(),
  termType: z.string(),
  baselineType: z.string(),
  rebateMethod: z.string(),
  effectiveStart: z.string(),
  effectiveEnd: z.string(),
  spendBaseline: z.number().nullable().optional(),
  tiers: z.array(renewalBriefInputTierSchema),
})

export const renewalBriefInputRebateSchema = z.object({
  id: z.string(),
  periodId: z.string().nullable().optional(),
  rebateEarned: z.number(),
  rebateCollected: z.number(),
  payPeriodStart: z.string(),
  payPeriodEnd: z.string(),
  collectionDate: z.string().nullable().optional(),
})

export const renewalBriefInputPeriodSchema = z.object({
  id: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  totalSpend: z.number(),
  rebateEarned: z.number(),
  rebateCollected: z.number(),
  tierAchieved: z.number().int().nullable().optional(),
})

export const renewalBriefInputAmendmentSchema = z.object({
  id: z.string(),
  proposalType: z.string(),
  status: z.string(),
  submittedAt: z.string(),
  reviewedAt: z.string().nullable().optional(),
  vendorMessage: z.string().nullable().optional(),
})

export const renewalBriefInputSchema = z.object({
  contract: renewalBriefInputContractSchema,
  terms: z.array(renewalBriefInputTermSchema),
  rebateHistory: z.array(renewalBriefInputRebateSchema),
  periodHistory: z.array(renewalBriefInputPeriodSchema),
  amendmentHistory: z.array(renewalBriefInputAmendmentSchema),
})

export type RenewalBriefInput = z.infer<typeof renewalBriefInputSchema>
