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

/**
 * Charles 2026-04-25: tiers must be strictly non-overlapping. If
 * tier-N's `spendMax` equals tier-(N+1)'s `spendMin`, the boundary
 * dollar belongs to both tiers under the cumulative engine, doubling
 * the rebate at the edge. Same for volume + market-share. Apply this
 * via `superRefine` on every term schema that accepts a tier array.
 */
export function refineTierOrdering(
  tiers: TierInput[],
  ctx: z.RefinementCtx,
): void {
  const sorted = [...tiers].sort((a, b) => a.tierNumber - b.tierNumber)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (prev.spendMax != null && cur.spendMin <= prev.spendMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tiers", i, "spendMin"],
        message: `Tier ${cur.tierNumber} spendMin ($${cur.spendMin.toLocaleString()}) must be greater than Tier ${prev.tierNumber} spendMax ($${prev.spendMax.toLocaleString()}). Overlapping tiers cause the boundary dollar to be rebated twice — set spendMin to $${(prev.spendMax + 1).toLocaleString()} or higher.`,
      })
    }
    if (
      prev.volumeMax != null &&
      cur.volumeMin != null &&
      cur.volumeMin <= prev.volumeMax
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tiers", i, "volumeMin"],
        message: `Tier ${cur.tierNumber} volumeMin (${cur.volumeMin}) must be greater than Tier ${prev.tierNumber} volumeMax (${prev.volumeMax}).`,
      })
    }
    if (
      prev.marketShareMax != null &&
      cur.marketShareMin != null &&
      cur.marketShareMin <= prev.marketShareMax
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tiers", i, "marketShareMin"],
        message: `Tier ${cur.tierNumber} marketShareMin (${cur.marketShareMin}%) must be greater than Tier ${prev.tierNumber} marketShareMax (${prev.marketShareMax}%).`,
      })
    }
  }
}

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
  // Empty string = evergreen (no fixed end). Mirrors
  // createContractSchema.expirationDate — the server action writes the
  // 9999-12-31 sentinel when this is "" so Prisma's NOT NULL column
  // still gets a valid Date. See lib/actions/contracts.ts term-create.
  effectiveEnd: z.string(),
  volumeType: VolumeTypeSchema.optional(),
  spendBaseline: z.number().min(0).optional(),
  volumeBaseline: z.number().int().min(0).optional(),
  growthBaselinePercent: z.number().min(0).max(100).optional(),
  desiredMarketShare: z.number().min(0).max(100).optional(),
  scopedCategoryId: z.string().optional(),
  scopedCategoryIds: z.array(z.string()).optional(),
  scopedItemNumbers: z.array(z.string()).optional(),
  // Charles W1.X-A6 — CPT codes live on ContractTerm (String[]). Used
  // when any tier has rebateType === "per_procedure_rebate": each code
  // is matched against case-costing records to count procedures.
  cptCodes: z.array(z.string()).optional(),
  // Tie-in capital schedule fields (nullable on ContractTerm; only used
  // when contract.contractType === "tie_in").
  capitalCost: z.number().nullable().optional(),
  interestRate: z.number().nullable().optional(),
  termMonths: z.number().int().nullable().optional(),
  // Wave B (tie-in parity) — down payment, cadence, min purchase commitment.
  downPayment: z.number().min(0).nullish(),
  paymentCadence: z.enum(["monthly", "quarterly", "annual"]).optional(),
  minimumPurchaseCommitment: z.number().min(0).nullish(),
  // Wave C — shortfall handling policy for tie-in capital.
  shortfallHandling: z
    .enum(["bill_immediately", "carry_forward"])
    .nullable()
    .optional(),
  // Wave D — symmetrical (PMT-driven) vs custom (user-entered rows).
  // Kept `nullish` so existing callers (edit-contract-client, vendor-
  // submission, tests) compile without threading the new field. The
  // server action treats missing / null as "symmetrical" and clears
  // any persisted rows on that path.
  amortizationShape: z.enum(["symmetrical", "custom"]).nullish(),
  // Wave D — custom-mode per-period amounts. Only read when
  // amortizationShape === "custom". Each row's closingBalance is
  // recomputed server-side from the running opening balance so the
  // client only needs to POST the user-entered amortizationDue.
  customAmortizationRows: z
    .array(
      z.object({
        periodNumber: z.number().int().min(1),
        amortizationDue: z.number().min(0),
      }),
    )
    .optional(),
  tiers: z.array(tierInputSchema).optional().default([]),
})

// Charles 2026-04-25 (Bug 21): tier-ordering refinement is applied as a
// wrapper rather than `.superRefine()` on the object itself, because
// `updateTermSchema = createTermSchema.partial()` below can't be derived
// from a refined object (zod throws "cannot be used on object schemas
// containing refinements"). Keeping the base object unrefined and
// applying the rule at the export boundary preserves both validations
// without breaking the partial-update path.
const _createTermSchemaBase = createTermSchema
export const createTermSchemaWithTierCheck = _createTermSchemaBase.superRefine(
  (value, ctx) => {
    refineTierOrdering(value.tiers ?? [], ctx)
  },
)

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
  // Empty string = evergreen (no fixed end). Mirrors
  // createContractSchema.expirationDate — the server action writes the
  // 9999-12-31 sentinel when this is "" so Prisma's NOT NULL column
  // still gets a valid Date. See lib/actions/contracts.ts term-create.
  effectiveEnd: z.string(),
  volumeType: VolumeTypeSchema.optional(),
  spendBaseline: z.number().min(0).optional(),
  volumeBaseline: z.number().int().min(0).optional(),
  growthBaselinePercent: z.number().min(0).max(100).optional(),
  desiredMarketShare: z.number().min(0).max(100).optional(),
  scopedCategoryId: z.string().optional(),
  scopedCategoryIds: z.array(z.string()).optional(),
  scopedItemNumbers: z.array(z.string()).optional(),
  // Charles W1.X-A6 — CPT codes (see createTermSchema above).
  cptCodes: z.array(z.string()).optional(),
  // Tie-in capital schedule fields (nullable on ContractTerm; only used
  // when contract.contractType === "tie_in").
  capitalCost: z.number().nullable().optional(),
  interestRate: z.number().nullable().optional(),
  termMonths: z.number().int().nullable().optional(),
  // Wave B (tie-in parity) — down payment, cadence, min purchase commitment.
  downPayment: z.number().min(0).nullish(),
  paymentCadence: z.enum(["monthly", "quarterly", "annual"]).optional(),
  minimumPurchaseCommitment: z.number().min(0).nullish(),
  // Wave C — shortfall handling policy for tie-in capital.
  shortfallHandling: z
    .enum(["bill_immediately", "carry_forward"])
    .nullable()
    .optional(),
  // Wave D — see createTermSchema for semantics.
  amortizationShape: z.enum(["symmetrical", "custom"]).nullish(),
  customAmortizationRows: z
    .array(
      z.object({
        periodNumber: z.number().int().min(1),
        amortizationDue: z.number().min(0),
      }),
    )
    .optional(),
  tiers: z.array(tierInputSchema).default([]),
})

// See createTermSchemaWithTierCheck above for the rationale on keeping
// the base object unrefined. termFormSchema is the form-level wrapper
// used by the contract create/edit form's zodResolver, so we want the
// tier-overlap rule to fire there too.
export const termFormSchemaWithTierCheck = termFormSchema.superRefine(
  (value, ctx) => {
    refineTierOrdering(value.tiers ?? [], ctx)
  },
)

export type TermFormValues = z.infer<typeof termFormSchema>
