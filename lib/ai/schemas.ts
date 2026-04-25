import { z } from "zod"

// ─── Contract Extraction Schema ──────────────────────────────────

export const extractedContractSchema = z.object({
  contractName: z.string().describe("The name or title of the contract"),
  contractNumber: z.string().optional().describe("Contract number, agreement number, or reference ID if present"),
  vendorName: z.string().describe("The vendor/manufacturer name"),
  contractType: z
    .enum(["usage", "capital", "service", "tie_in", "grouped", "pricing_only"])
    .describe("The type of contract. Use 'usage' if the contract has rebate tiers based on spend or volume. Use 'pricing_only' ONLY if the contract is purely a price list with no rebates or performance terms. Use 'capital' for equipment purchases. Use 'grouped' for GPO/multi-vendor agreements. Use 'tie_in' for bundled product deals. Use 'service' for service-level agreements."),
  effectiveDate: z
    .string()
    .nullable()
    .describe("Effective date in YYYY-MM-DD format, or null if not stated"),
  expirationDate: z
    .string()
    .nullable()
    .describe(
      "Expiration date in YYYY-MM-DD format, or null if the contract is evergreen / auto-renewing / 'continues until terminated'. Do NOT invent the initial-term end date for an evergreen contract.",
    ),
  totalValue: z
    .number()
    .optional()
    .describe(
      "Total committed or expected contract value in dollars (Total Contract Value, ceiling, or commitment over the full term). Do NOT use rebate tier thresholds, minimum spend qualifications (e.g. 'minimum QAS threshold of $5,300,000'), tier breakpoints, capital costs, or rebate dollar caps. If only a threshold appears and no committed total is stated, return null instead of guessing.",
    ),
  description: z.string().optional().describe("Brief description of the contract"),
  productCategory: z
    .string()
    .optional()
    .describe("Primary product category like Ortho Spine, Medical Supplies, etc."),
  productCategories: z
    .array(z.string())
    .optional()
    .describe(
      "All product categories covered by this contract - contracts often cover multiple categories like Ortho Spine, Ortho Trauma, Sports Medicine, etc."
    ),
  terms: z.array(
    z.object({
      termName: z.string().describe("Name of the term/tier structure"),
      termType: z.string().describe("Type: spend_rebate, volume_rebate, etc."),
      // Charles 2026-04-25 (audit C2): the AI extractor previously only
      // returned termType — the rest of the term shape (baselineType,
      // evaluationPeriod, paymentTiming, appliesTo, rebateMethod) was
      // hardcoded to spend_based / cumulative regardless of what kind
      // of term the contract described, so volume / market-share /
      // capitated extracts were silently mistyped. These are optional
      // hints; the consumer falls back to termType-aware defaults when
      // omitted.
      baselineType: z
        .enum(["spend_based", "volume_based", "growth_based"])
        .optional()
        .describe(
          "Baseline used by the rebate engine. spend_based for $-threshold rebates, volume_based for unit/procedure-count rebates, growth_based when the rebate is keyed off year-over-year growth.",
        ),
      evaluationPeriod: z
        .enum(["monthly", "quarterly", "semi_annual", "annual"])
        .optional()
        .describe(
          "How often performance is evaluated (e.g. quarterly tier achievement).",
        ),
      paymentTiming: z
        .enum(["monthly", "quarterly", "semi_annual", "annual"])
        .optional()
        .describe("How often rebates are paid out."),
      appliesTo: z
        .string()
        .optional()
        .describe(
          "Scope: typically 'all_products' or a category/product label if the term is restricted.",
        ),
      rebateMethod: z
        .enum(["cumulative", "marginal"])
        .optional()
        .describe(
          "cumulative = top tier's rate applies to the entire qualifying spend; marginal = each tier's rate applies only to the slice within that tier.",
        ),
      // Charles 2026-04-25 (audit Bug 2): baseline + scope + procedure
      // hints. Pre-fix the AI mapper dropped these even when present
      // upstream; the consumer in vendor-contract-submission.tsx
      // honors each value when defined.
      volumeType: z
        .enum(["product_category", "catalog_cap_based", "procedure_code"])
        .optional()
        .describe(
          "Volume measurement type for volume_rebate / rebate_per_use terms.",
        ),
      spendBaseline: z
        .number()
        .optional()
        .describe(
          "Prior-year baseline spend for growth_rebate terms (dollars).",
        ),
      volumeBaseline: z
        .number()
        .optional()
        .describe(
          "Prior-year baseline procedure / unit count for volume-based growth.",
        ),
      growthBaselinePercent: z
        .number()
        .optional()
        .describe(
          "Required year-over-year growth percent for the rebate to trigger.",
        ),
      desiredMarketShare: z
        .number()
        .optional()
        .describe(
          "Target market share percent for market_share / market_share_price_reduction terms.",
        ),
      scopedCategoryIds: z
        .array(z.string())
        .optional()
        .describe(
          "Category IDs the term is scoped to (when contract restricts to specific categories).",
        ),
      scopedItemNumbers: z
        .array(z.string())
        .optional()
        .describe(
          "Vendor item numbers / SKUs the term is scoped to.",
        ),
      cptCodes: z
        .array(z.string())
        .optional()
        .describe(
          "CPT procedure codes for per_procedure_rebate / volume_rebate terms.",
        ),
      tiers: z.array(
        z.object({
          tierNumber: z.number().describe("Tier number (1 = lowest)"),
          // Charles audit round-4 vendor: AI now extracts the
          // human-readable tier label when the contract uses one
          // (e.g. "Bronze", "Silver", "Gold"). Optional; null/omitted
          // when the contract uses pure numeric tiers.
          tierName: z
            .string()
            .nullable()
            .optional()
            .describe(
              "Optional human-readable tier label like 'Bronze', 'Silver', 'Gold'. Null/omitted when the contract uses unnamed numeric tiers.",
            ),
          spendMin: z.number().optional().describe("Minimum spend threshold"),
          spendMax: z.number().optional().describe("Maximum spend threshold"),
          // Charles 2026-04-25 (audit Bug 2): per-tier volume + market-
          // share thresholds. Without these, volume_rebate /
          // market_share extracts collapse to a single tier on
          // submission.
          volumeMin: z
            .number()
            .optional()
            .describe("Minimum unit / procedure count for this tier."),
          volumeMax: z
            .number()
            .optional()
            .describe("Maximum unit / procedure count for this tier."),
          marketShareMin: z
            .number()
            .optional()
            .describe("Minimum market share percent for this tier."),
          marketShareMax: z
            .number()
            .optional()
            .describe("Maximum market share percent for this tier."),
          rebateType: z.string().optional().describe("Rebate type"),
          rebateValue: z.number().optional().describe("Rebate value (percentage or fixed)"),
        })
      ),
    })
  ),
})

export type ExtractedContractData = z.infer<typeof extractedContractSchema>

// ─── Rich Contract Extraction Schema (ported from v0) ────────────
// Adapted to tydei's Prisma enum casing: lowercase/snake_case.

export const richContractExtractSchema = z.object({
  // Basic contract info
  contractName: z.string().nullable().describe("The name or title of the contract"),
  contractId: z.string().nullable().describe("The contract ID, contract number, agreement number, or reference number"),
  vendorName: z.string().nullable().describe("The vendor/manufacturer name"),
  vendorDivision: z.string().nullable().describe("Vendor division if mentioned"),
  contractType: z
    .enum(["usage", "capital", "service", "tie_in", "grouped", "pricing_only"])
    .nullable()
    .describe(
      "Type of contract: usage (spend/volume rebates), capital (equipment purchase), service (maintenance/support), tie_in (capital tied to consumables), grouped (multi-division), pricing_only (locked pricing only)"
    ),
  productCategory: z.string().nullable().describe("Primary product category like Ortho Spine, Medical Supplies, etc."),
  productCategories: z
    .array(z.string())
    .nullable()
    .describe(
      "All product categories covered by this contract - contracts often cover multiple categories like Ortho Spine, Ortho Trauma, Sports Medicine, etc."
    ),

  // Dates
  effectiveDate: z.string().nullable().describe("Contract effective/start date in YYYY-MM-DD format"),
  expirationDate: z.string().nullable().describe("Contract expiration/end date in YYYY-MM-DD format"),

  // Rebate pay period
  rebatePayPeriod: z
    .enum(["monthly", "quarterly", "semi_annual", "annual"])
    .nullable()
    .describe("How often rebates are paid"),

  // Contract attributes
  isGroupedContract: z.boolean().nullable().describe("Whether this is a grouped contract with other vendors"),
  isCapitalContract: z.boolean().nullable().describe("Whether this includes capital equipment purchases"),
  isServiceContract: z.boolean().nullable().describe("Whether this is a standalone service contract"),
  isPricingOnly: z.boolean().nullable().describe("Whether this contract is just a pricing file with no rebates"),

  // Facilities
  facilities: z
    .array(
      z.object({
        name: z.string(),
        city: z.string().nullable(),
        state: z.string().nullable(),
      })
    )
    .nullable()
    .describe("List of facilities covered by this contract"),

  // Terms extracted
  terms: z
    .array(
      z.object({
        termName: z.string().describe("Name of the term/agreement"),
        termType: z
          .enum([
            "spend_rebate",
            "volume_rebate",
            "price_reduction",
            "po_rebate",
            "carve_out",
            "market_share",
            "market_share_price_reduction",
            "capitated_price_reduction",
            "capitated_pricing_rebate",
            "periodic_maintenance",
            "payment_rebate",
            "growth_rebate",
            "compliance_rebate",
            "fixed_fee",
            "locked_pricing",
          ])
          .nullable()
          .describe("Type of rebate/discount term"),
        effectiveFrom: z.string().nullable().describe("Term start date"),
        effectiveTo: z.string().nullable().describe("Term end date"),
        performancePeriod: z.enum(["monthly", "quarterly", "semi_annual", "annual"]).nullable(),
        volumeType: z.enum(["product_category", "catalog_cap_based", "procedure_code"]).nullable(),

        // Tier structure
        tiers: z
          .array(
            z.object({
              tierNumber: z.number(),
              marketShareMin: z.number().nullable().describe("Minimum market share percentage"),
              marketShareMax: z.number().nullable().describe("Maximum market share percentage"),
              spendMin: z.number().nullable().describe("Minimum spend threshold"),
              spendMax: z.number().nullable().describe("Maximum spend threshold"),
              volumeMin: z.number().nullable().describe("Minimum volume/units"),
              volumeMax: z.number().nullable().describe("Maximum volume/units"),
              rebateType: z
                .enum(["percent_of_spend", "fixed_rebate", "fixed_rebate_per_unit", "per_procedure_rebate"])
                .nullable(),
              rebateValue: z.number().nullable().describe("Rebate percentage or fixed amount"),
              spendBaseline: z.number().nullable(),
              growthBaseline: z.number().nullable(),
            })
          )
          .nullable(),

        // Products/Procedures
        products: z
          .array(
            z.object({
              catalogNumber: z.string().nullable(),
              description: z.string().nullable(),
              procedureCode: z.string().nullable(),
            })
          )
          .nullable(),
      })
    )
    .nullable()
    .describe("Contract terms and rebate structures"),

  // Tie-In specific
  tieInDetails: z
    .object({
      capitalEquipmentValue: z.number().nullable().describe("Value of capital equipment to pay off"),
      payoffPeriodMonths: z.number().nullable().describe("Expected payoff period in months"),
      linkedProductCategories: z.array(z.string()).nullable(),
    })
    .nullable()
    .describe("Details for tie-in contracts"),

  // Additional notes
  specialConditions: z.array(z.string()).nullable().describe("Any special conditions or notes"),
  contactInfo: z
    .object({
      name: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
    })
    .nullable(),
})

export type RichContractExtractData = z.infer<typeof richContractExtractSchema>

// ─── Deal Score Schema ───────────────────────────────────────────

export const dealScoreSchema = z.object({
  financialValue: z
    .number()
    .describe("Financial value score. Return a number from 0 to 100 inclusive."),
  rebateEfficiency: z
    .number()
    .describe("Rebate efficiency score. Return a number from 0 to 100 inclusive."),
  pricingCompetitiveness: z
    .number()
    .describe("Pricing competitiveness score. Return a number from 0 to 100 inclusive."),
  marketShareAlignment: z
    .number()
    .describe("Market share alignment score. Return a number from 0 to 100 inclusive."),
  complianceLikelihood: z
    .number()
    .describe("Compliance likelihood score. Return a number from 0 to 100 inclusive."),
  overallScore: z
    .number()
    .describe("Overall deal score. Return a number from 0 to 100 inclusive."),
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

// ─── Payor Contract Extraction Schema ───────────────────────────

export const extractedPayorContractSchema = z.object({
  payorName: z.string().describe("The insurance payor/carrier name"),
  facilityName: z.string().nullable().describe("The healthcare facility name if mentioned"),
  contractNumber: z.string().nullable().describe("Contract or agreement number"),
  effectiveDate: z.string().nullable().describe("Effective date in YYYY-MM-DD format"),
  expirationDate: z.string().nullable().describe("Expiration/termination date in YYYY-MM-DD format"),
  cptRates: z.array(
    z.object({
      cptCode: z.string().describe("5-digit CPT code"),
      description: z.string().nullable().describe("Procedure description"),
      rate: z.number().describe("Reimbursement rate in dollars"),
      modifier: z.string().nullable().describe("CPT modifier if applicable"),
    })
  ).describe("All CPT code reimbursement rates found"),
  grouperRates: z.array(
    z.object({
      groupNumber: z.number().describe("Grouper number"),
      description: z.string().nullable().describe("Grouper description"),
      rate: z.number().describe("Grouper rate in dollars"),
    })
  ).describe("Case rate / grouper rates if present"),
  implantPolicy: z.object({
    passthrough: z.boolean().describe("Whether implants are passed through at cost"),
    discountPercent: z.number().nullable().describe("Discount percentage if not passthrough"),
    maxAmount: z.number().nullable().describe("Maximum implant reimbursement amount"),
  }).nullable().describe("Implant reimbursement policy"),
  multiProcedureRules: z.object({
    primaryPercent: z.number().describe("Primary procedure reimbursement percentage (usually 100)"),
    secondaryPercent: z.number().describe("Secondary procedure percentage (usually 50)"),
    additionalPercent: z.number().nullable().describe("Additional procedures percentage"),
  }).nullable().describe("Multi-procedure payment reduction rules"),
  otherTerms: z.array(z.string()).describe("Other notable contract terms as text"),
})

export type ExtractedPayorContractData = z.infer<typeof extractedPayorContractSchema>
