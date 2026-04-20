import { z } from "zod"

/**
 * Renewal Brief — AI-generated negotiation primer (Tier 4).
 *
 * Shape is locked by the spec:
 *   docs/superpowers/specs/2026-04-19-rebate-optimizer-ai-design.md §4.2
 *
 * Notes on constraints: Anthropic's JSON Schema validator rejects
 * `minimum`/`maximum` keywords on numeric leaves. Zod 4's `.int()` emits
 * `type: "integer"` **together with** `minimum: -2^53+1, maximum: 2^53-1`
 * (the safe-integer range), which Anthropic refuses with:
 *
 *   output_config.format.schema: For 'integer' type, properties maximum,
 *   minimum are not supported
 *
 * So we avoid `.int()` entirely: every numeric leaf is `z.number()` and the
 * "integer" semantic is documented in `.describe(...)`. Runtime enforcement
 * happens when we Zod-parse the Claude response (rounding via `Math.trunc`
 * inside the post-processor if needed). No `.min()`/`.max()` either.
 */

export const renewalBriefAskSchema = z.object({
  rank: z
    .number()
    .describe("Integer rank, 1-indexed; 1 is the highest-priority ask"),
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
  tierMissed: z
    .number()
    .describe("Integer tier number that was missed"),
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
    .describe("Integer number of months in the contract term (end - start)"),
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

export const renewalBriefSchema = z
  .object({
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
  .describe(
    "AI-authored renewal brief: executive summary, performance summary, ranked asks, and suggested concessions.",
  )

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
  tierNumber: z.number().describe("Integer tier number"),
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
  tierAchieved: z
    .number()
    .nullable()
    .optional()
    .describe("Integer tier achieved, or null"),
})

export const renewalBriefInputAmendmentSchema = z.object({
  id: z.string(),
  proposalType: z.string(),
  status: z.string(),
  submittedAt: z.string(),
  reviewedAt: z.string().nullable().optional(),
  vendorMessage: z.string().nullable().optional(),
})

export const renewalBriefInputSchema = z
  .object({
    contract: renewalBriefInputContractSchema,
    terms: z.array(renewalBriefInputTermSchema),
    rebateHistory: z.array(renewalBriefInputRebateSchema),
    periodHistory: z.array(renewalBriefInputPeriodSchema),
    amendmentHistory: z.array(renewalBriefInputAmendmentSchema),
  })
  .describe(
    "Input payload fed to the Renewal Brief Claude prompt: contract metadata, all terms/tiers, rebate history, period rollups, and amendment history.",
  )

export type RenewalBriefInput = z.infer<typeof renewalBriefInputSchema>
