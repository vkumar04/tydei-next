import { z } from "zod"
import {
  TermTypeSchema,
  BaselineTypeSchema,
  VolumeTypeSchema,
  RebateTypeSchema,
  RebateMethodSchema,
} from "@/lib/validators"

// ─── Tier Input ──────────────────────────────────────────────────

export const tierInputSchema = z.object({
  id: z.string().optional(),
  tierNumber: z.number().int().min(1).default(1),
  spendMin: z.number().min(0).default(0),
  spendMax: z.number().min(0).optional(),
  volumeMin: z.number().int().min(0).optional(),
  volumeMax: z.number().int().min(0).optional(),
  marketShareMin: z.number().min(0).max(100).optional(),
  marketShareMax: z.number().min(0).max(100).optional(),
  rebateType: RebateTypeSchema.default("percent_of_spend"),
  rebateValue: z.number().min(0).default(0),
})

export type TierInput = z.infer<typeof tierInputSchema>

// ─── Create Term Schema ──────────────────────────────────────────

export const createTermSchema = z.object({
  contractId: z.string().min(1, "Contract ID is required"),
  termName: z.string().min(1, "Term name is required"),
  termType: TermTypeSchema.default("spend_rebate"),
  baselineType: BaselineTypeSchema.default("spend_based"),
  evaluationPeriod: z.string().optional().default("annual"),
  paymentTiming: z.string().optional().default("quarterly"),
  appliesTo: z.string().optional().default("all_products"),
  rebateMethod: RebateMethodSchema.default("cumulative"),
  effectiveStart: z.string().min(1, "Start date is required"),
  effectiveEnd: z.string().min(1, "End date is required"),
  volumeType: VolumeTypeSchema.optional(),
  spendBaseline: z.number().min(0).optional(),
  volumeBaseline: z.number().int().min(0).optional(),
  growthBaselinePercent: z.number().min(0).max(100).optional(),
  desiredMarketShare: z.number().min(0).max(100).optional(),
  scopedCategoryId: z.string().optional(),
  scopedItemNumbers: z.array(z.string()).optional(),
  // Tie-in capital schedule fields (nullable on ContractTerm; only used
  // when contract.contractType === "tie_in").
  capitalCost: z.number().nullable().optional(),
  interestRate: z.number().nullable().optional(),
  termMonths: z.number().int().nullable().optional(),
  tiers: z.array(tierInputSchema).optional().default([]),
})

export type CreateTermInput = z.infer<typeof createTermSchema>

// ─── Update Term Schema ──────────────────────────────────────────

export const updateTermSchema = createTermSchema.partial().omit({ contractId: true })

export type UpdateTermInput = z.infer<typeof updateTermSchema>

// ─── Form-level schemas (used by contract form for embedded terms) ──

export const termFormSchema = z.object({
  id: z.string().optional(),
  termName: z.string().min(1, "Term name is required"),
  termType: TermTypeSchema.default("spend_rebate"),
  baselineType: BaselineTypeSchema.default("spend_based"),
  evaluationPeriod: z.string().optional().default("annual"),
  paymentTiming: z.string().optional().default("quarterly"),
  appliesTo: z.string().optional().default("all_products"),
  rebateMethod: RebateMethodSchema.default("cumulative"),
  effectiveStart: z.string().min(1, "Start date is required"),
  effectiveEnd: z.string().min(1, "End date is required"),
  volumeType: VolumeTypeSchema.optional(),
  spendBaseline: z.number().min(0).optional(),
  volumeBaseline: z.number().int().min(0).optional(),
  growthBaselinePercent: z.number().min(0).max(100).optional(),
  desiredMarketShare: z.number().min(0).max(100).optional(),
  scopedCategoryId: z.string().optional(),
  scopedItemNumbers: z.array(z.string()).optional(),
  // Tie-in capital schedule fields (nullable on ContractTerm; only used
  // when contract.contractType === "tie_in").
  capitalCost: z.number().nullable().optional(),
  interestRate: z.number().nullable().optional(),
  termMonths: z.number().int().nullable().optional(),
  tiers: z.array(tierInputSchema).default([]),
})

export type TermFormValues = z.infer<typeof termFormSchema>
