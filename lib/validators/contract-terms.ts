import { z } from "zod"
import {
  TermTypeSchema,
  BaselineTypeSchema,
  VolumeTypeSchema,
  RebateTypeSchema,
  RebateMethodSchema,
} from "@/lib/validators"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"

// ─── Tier Input ──────────────────────────────────────────────────

// Bug 2026-05-25 (Vick Bugs.rtfd): AI-extracted tiers from a PDF
// can carry negative *Max values (the AI emits any number the
// model thinks fits; the AI schema in lib/ai/schemas.ts has no
// .min on tier maxes). The rebate engine treats a missing/null
// *Max as "no upper bound", and the form's "Tiers are not used"
// types (carve_out etc.) leave stale state from a prior termType
// — both paths converge on negative values reaching the
// validator and 500'ing the contract create with
// "Too small: expected number to be >=0". Coerce any negative
// *Max to undefined so the engine reads it as uncapped, matching
// what every downstream consumer (recompute/*, accrual.ts,
// engine-invariants.test.ts) already does.
const uncappedIfNegative = (v: unknown): unknown =>
  typeof v === "number" && v < 0 ? undefined : v

// Charles 2026-06-06 — reference numbers come in two shapes: a string[]
// from the chip-input form, or a comma/newline-separated free-text string
// from AI extraction / bulk paste. Normalize both to a clean string[]:
// split on comma/newline, trim each entry, drop blanks. Leave undefined
// alone so an omitted field doesn't clobber the column on partial update.
// We do NOT case-fold or strip separators here — match-time normalization
// (normalizeSku in match.ts) owns format-robust comparison; storage keeps
// the user's exact reference numbers.
const normalizeReferenceNumbers = (v: unknown): unknown => {
  if (v == null) return v
  const raw: string[] = Array.isArray(v)
    ? v.flatMap((entry) =>
        typeof entry === "string" ? entry.split(/[\n,]+/) : [],
      )
    : typeof v === "string"
      ? v.split(/[\n,]+/)
      : []
  return raw.map((s) => s.trim()).filter((s) => s.length > 0)
}

export const tierInputSchema = z.object({
  id: z.string().optional(),
  tierNumber: z.number().int().min(1).default(1),
  // Charles audit round-1 vendor C2: tierName is on the Prisma
  // ContractTier model and round-trips via hydrateTermsForForm —
  // include it here so the form schema doesn't strip it on save.
  tierName: z.string().nullable().optional(),
  spendMin: z.number().min(0).default(0),
  spendMax: z.preprocess(uncappedIfNegative, z.number().min(0).optional()),
  volumeMin: z.number().int().min(0).optional(),
  volumeMax: z.preprocess(uncappedIfNegative, z.number().int().min(0).optional()),
  marketShareMin: z.number().min(0).max(100).optional(),
  marketShareMax: z.preprocess(uncappedIfNegative, z.number().min(0).max(100).optional()),
  rebateType: RebateTypeSchema.default("percent_of_spend"),
  rebateValue: z.number().min(0).default(0),
}).superRefine((tier, ctx) => {
  // Bug 2026-05-20 (Vick "Volume Growth Rebate %-of-Spend tiers
  // showing 80029, 120165, …"): when rebateType is percent_of_spend,
  // rebateValue is stored as a FRACTION (0.02 = 2%). The form converts
  // display % → fraction via fromDisplayRebateValue, but if an upstream
  // path (AI extract, legacy form, manual SQL) writes a raw dollar
  // value the tier renderer multiplies by 100 and displays nonsense.
  // Enforce 0 ≤ fraction ≤ 1 at the validator boundary so a save can
  // never persist a >100% rate.
  if (tier.rebateType === "percent_of_spend" && tier.rebateValue > 1) {
    const display = toDisplayRebateValue(tier.rebateType, tier.rebateValue)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rebateValue"],
      message: `Rebate % must be ≤ 100%. Got ${display.toFixed(2)}% (stored fraction ${tier.rebateValue}). If you meant a flat dollar amount, switch Rebate Type to "Fixed $" or "Per Unit".`,
    })
  }
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
  termType?: string,
): void {
  // Boundary policy (Charles 2026-04-28 Bug #3 — "had to get rid of a
  // couple tiers it did not like them"). Adjacent tiers like
  //   Tier 1: $0-$50,000
  //   Tier 2: $50,000-∞
  // are valid — neither engine double-counts at the boundary:
  //   - cumulative `determineTier` keeps scanning for a higher match
  //     (engine/shared/determine-tier.ts:51) so the boundary dollar
  //     resolves to the higher tier
  //   - marginal owns brackets as `[tier.thresholdMin, nextTier.thresholdMin)`
  //     half-open (engine/shared/marginal.ts), so the boundary dollar
  //     belongs to the upper bracket
  // Therefore strict overlap (`cur.spendMin < prev.spendMax`) is the
  // real error condition; equality is fine.
  //
  // Bug 2026-05-18 (Vick "Can't make market share contract"): for term
  // types where the UI doesn't render a spendMax field (market_share,
  // compliance_rebate use Threshold % only — see contract-tier-row.tsx
  // `thresholdLabels`), the spendMax field can carry stale state from
  // a previous termType the user switched away from. The user has no
  // way to clear it from the form. Skip the spend-side overlap check
  // for those term types — they're validated by the
  // marketShareMin/Max + volumeMin/Max branches below if applicable.
  const skipSpendOverlap =
    termType === "market_share" || termType === "compliance_rebate"
  const sorted = [...tiers].sort((a, b) => a.tierNumber - b.tierNumber)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (
      !skipSpendOverlap &&
      prev.spendMax != null &&
      cur.spendMin < prev.spendMax
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tiers", i, "spendMin"],
        message: `Tier ${cur.tierNumber} spendMin ($${cur.spendMin.toLocaleString()}) overlaps Tier ${prev.tierNumber}'s spendMax ($${prev.spendMax.toLocaleString()}). Set Tier ${cur.tierNumber}.spendMin to $${prev.spendMax.toLocaleString()} or higher (equal is OK — the engine resolves the boundary to the higher tier).`,
      })
    }
    if (
      prev.volumeMax != null &&
      cur.volumeMin != null &&
      cur.volumeMin < prev.volumeMax
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tiers", i, "volumeMin"],
        message: `Tier ${cur.tierNumber} volumeMin (${cur.volumeMin}) overlaps Tier ${prev.tierNumber}'s volumeMax (${prev.volumeMax}). Equal is OK; strict overlap is not.`,
      })
    }
    if (
      prev.marketShareMax != null &&
      cur.marketShareMin != null &&
      cur.marketShareMin < prev.marketShareMax
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tiers", i, "marketShareMin"],
        message: `Tier ${cur.tierNumber} marketShareMin (${cur.marketShareMin}%) overlaps Tier ${prev.tierNumber}'s marketShareMax (${prev.marketShareMax}%). Equal is OK; strict overlap is not.`,
      })
    }
  }
}

/**
 * bugs.rtfd 2026-06-13 #5 (Vick): "When you select product category units it
 * needs to make you select categories in product scope; All Products should no
 * longer be an option." When volume is counted by product category
 * (`volumeType === "product_category"`), the scope can't be All Products —
 * units are tallied per category, so the term MUST be scoped to at least one
 * specific category. Enforce both halves at the validator boundary so a save
 * can never persist a product_category term with an all-products (or empty)
 * scope, regardless of the form path (manual, AI extract, bulk paste).
 *
 * Category field: `scopedCategoryIds` (canonical array; `scopedCategoryId` is
 * the back-compat first-element mirror written alongside it by the form).
 */
export function refineProductCategoryScope(
  value: {
    volumeType?: string
    appliesTo?: string
    scopedCategoryIds?: string[]
  },
  ctx: z.RefinementCtx,
): void {
  if (value.volumeType !== "product_category") return
  if (
    value.appliesTo !== "specific_category" ||
    (value.scopedCategoryIds ?? []).length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scopedCategoryIds"],
      message:
        "Select at least one product category — 'Product category (units)' counts volume by category, so the scope can't be All Products.",
    })
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
  // Baseline Calculation Method (Charles Bugs.rtfd 2026-05-25).
  // false = "From dollar one" (cumulative — rebate every dollar after
  //         the tier threshold is crossed).
  // true  = "Growth" (rebate only on spend ABOVE the baseline).
  // Backed by Prisma's `growthOnly` boolean. Optional in the schema
  // so existing callers that don't supply the field keep working —
  // when undefined, Prisma uses the column default of false.
  growthOnly: z.boolean().optional(),
  desiredMarketShare: z.number().min(0).max(100).optional(),
  scopedCategoryId: z.string().optional(),
  scopedCategoryIds: z.array(z.string()).optional(),
  scopedItemNumbers: z.array(z.string()).optional(),
  // Charles W1.X-A6 — CPT codes live on ContractTerm (String[]). Used
  // when any tier has rebateType === "per_procedure_rebate": each code
  // is matched against case-costing records to count procedures.
  cptCodes: z.array(z.string()).optional(),
  // Charles 2026-06-06 — cross-vendor reference numbers on ContractTerm
  // (String[]). The matcher uses these as the cross-vendor fallback key
  // (manufacturerNo → referenceNumbers) so a SKU bought by ANY grouped
  // vendor resolves to the contract regardless of vendor-name drift.
  // Until now this column had no capture path (only the seed wrote it),
  // so the fallback was dead in practice. preprocess trims each entry and
  // drops blanks so the stored set is clean for normalized matching.
  referenceNumbers: z.preprocess(normalizeReferenceNumbers, z.array(z.string()).optional()),
  // Tie-in capital schedule fields (nullable on ContractTerm; only used
  // when contract.contractType === "tie_in").
  capitalCost: z.number().nullable().optional(),
  interestRate: z.number().nullable().optional(),
  termMonths: z.number().int().nullable().optional(),
  // Wave B (tie-in parity) — down payment, cadence, min purchase commitment.
  downPayment: z.number().min(0).nullish(),
  paymentCadence: z.enum(["monthly", "quarterly", "semi_annual", "annual"]).optional(),
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
    refineTierOrdering(value.tiers ?? [], ctx, value.termType)
    // bugs.rtfd 2026-06-13 #5 — product_category volume forces Specific Category.
    refineProductCategoryScope(value, ctx)
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
  // Baseline Calculation Method (Charles Bugs.rtfd 2026-05-25).
  // false = "From dollar one" (cumulative — rebate every dollar after
  //         the tier threshold is crossed).
  // true  = "Growth" (rebate only on spend ABOVE the baseline).
  // Backed by Prisma's `growthOnly` boolean. Optional in the schema
  // so existing callers that don't supply the field keep working —
  // when undefined, Prisma uses the column default of false.
  growthOnly: z.boolean().optional(),
  desiredMarketShare: z.number().min(0).max(100).optional(),
  scopedCategoryId: z.string().optional(),
  scopedCategoryIds: z.array(z.string()).optional(),
  scopedItemNumbers: z.array(z.string()).optional(),
  // Charles W1.X-A6 — CPT codes (see createTermSchema above).
  cptCodes: z.array(z.string()).optional(),
  // Charles 2026-06-06 — cross-vendor reference numbers (see createTermSchema).
  referenceNumbers: z.preprocess(normalizeReferenceNumbers, z.array(z.string()).optional()),
  // Tie-in capital schedule fields (nullable on ContractTerm; only used
  // when contract.contractType === "tie_in").
  capitalCost: z.number().nullable().optional(),
  interestRate: z.number().nullable().optional(),
  termMonths: z.number().int().nullable().optional(),
  // Wave B (tie-in parity) — down payment, cadence, min purchase commitment.
  downPayment: z.number().min(0).nullish(),
  paymentCadence: z.enum(["monthly", "quarterly", "semi_annual", "annual"]).optional(),
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
    refineTierOrdering(value.tiers ?? [], ctx, value.termType)
    // bugs.rtfd 2026-06-13 #5 — product_category volume forces Specific Category.
    refineProductCategoryScope(value, ctx)
  },
)

export type TermFormValues = z.infer<typeof termFormSchema>
