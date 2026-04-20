import { z } from "zod"

/**
 * Rebate Optimizer — AI Smart Recommendations schemas.
 *
 * Shape is locked by the spec:
 *   docs/superpowers/specs/2026-04-19-rebate-optimizer-ai-design.md §4.1
 *
 * Notes on constraints: Anthropic's Messages API rejects `minimum`/`maximum`
 * keywords on numeric leaves. Zod 4's `.int()` emits both `type: "integer"` AND
 * the safe-integer min/max bounds, so the API 400s with:
 *
 *   output_config.format.schema: For 'integer' type, properties maximum,
 *   minimum are not supported
 *
 * We therefore avoid `.int()` entirely; every numeric leaf is plain
 * `z.number()` and integer semantics live in `.describe(...)`. See
 * `lib/ai/__tests__/schemas.test.ts` for the drift guard.
 */

export const rebateInsightActionSchema = z.enum([
  "redirect_spend",
  "accelerate_purchase",
  "negotiate_tier",
  "log_collection",
  "review_compliance",
])

export type RebateInsightAction = z.infer<typeof rebateInsightActionSchema>

export const rebateInsightConfidenceSchema = z.enum(["low", "medium", "high"])

export type RebateInsightConfidence = z.infer<typeof rebateInsightConfidenceSchema>

export const rebateInsightSchema = z.object({
  id: z
    .string()
    .describe(
      "Stable slug for this recommendation (kebab-case, deterministic from the citation + action)",
    ),
  rank: z
    .number()
    .describe("Integer rank, 1-indexed; 1 is most actionable"),
  title: z.string().describe("Headline — keep it under ~80 characters"),
  summary: z.string().describe("1-2 sentence pitch the user sees on the card"),
  rationale: z
    .string()
    .describe(
      "3-6 sentence reasoning with dollar figures, tier context, and the trade-off",
    ),
  impactDollars: z
    .number()
    .nullable()
    .describe("Estimated rebate uplift in dollars, or null if not quantifiable"),
  confidence: rebateInsightConfidenceSchema,
  actionType: rebateInsightActionSchema,
  citedContractIds: z
    .array(z.string())
    .describe(
      "Contract IDs referenced by the recommendation — at least one required so the UI can link back",
    ),
})

export type RebateInsight = z.infer<typeof rebateInsightSchema>

export const rebateInsightsResponseSchema = z
  .object({
    facilityId: z.string(),
    generatedAt: z.string().describe("ISO-8601 timestamp"),
    insights: z.array(rebateInsightSchema),
    observations: z
      .array(z.string())
      .optional()
      .describe("Optional portfolio-level notes that are not actionable items"),
  })
  .describe(
    "AI Smart Recommendations response: ranked actionable insights plus optional portfolio-level observations.",
  )

export type RebateInsightsResponse = z.infer<typeof rebateInsightsResponseSchema>

/**
 * Input shape the server action feeds into the Claude prompt. Captured as a
 * Zod schema for documentation + defensive parsing before hashing / serializing.
 */
export const rebateInsightsInputSchema = z
  .object({
    facilityId: z.string(),
    opportunities: z.array(
      z.object({
        contractId: z.string(),
        contractName: z.string(),
        vendorId: z.string().nullable().optional(),
        vendorName: z.string(),
        currentSpend: z.number(),
        currentTierNumber: z.number().nullable().optional(),
        nextTierNumber: z.number(),
        nextTierThreshold: z.number(),
        additionalRebate: z.number(),
        daysRemaining: z.number().nullable().optional(),
      }),
    ),
    alerts: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        title: z.string(),
        message: z.string(),
        contractId: z.string().nullable().optional(),
        impactDollars: z.number().nullable().optional(),
      }),
    ),
    recentSpend: z.array(
      z.object({
        vendorId: z.string(),
        vendorName: z.string(),
        last90DaysSpend: z.number(),
      }),
    ),
  })
  .describe(
    "Input payload fed to the Rebate Optimizer Claude prompt: engine-ranked opportunities, rule-based alerts, and last-90-days per-vendor spend.",
  )

export type RebateInsightsInput = z.infer<typeof rebateInsightsInputSchema>
