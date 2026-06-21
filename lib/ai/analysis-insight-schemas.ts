import { z } from "zod"

/**
 * Zod schemas for the on-demand AI insight layer on the facility Analysis
 * dashboard and the vendor Opportunity Engine.
 *
 * Anthropic's JSON-schema validator rejects `.int()/.min()/.max()` on numeric
 * leaves, so numerics are plain `z.number().describe(...)` and enums are
 * `z.string().describe(...)`. Runtime bounds are enforced at parse time.
 */

// ─── Facility ───────────────────────────────────────────────────

/** The deterministic model snapshot the client sends for grounding. */
export interface FacilityInsightSnapshot {
  currentVendorSpend: number
  netRevenue: number
  revenueIsImplied: boolean
  ebitda: number
  dcf: number
  annualSupplySavings: number
  impactToEbitda: number
  impactToMarginPoints: number
  impactToDistributableCashFlow: number
  opportunityScoreOverall: number
  opportunityComponents: { label: string; weight: number; score: number }[]
  evScenarios: {
    scenario: string
    multiple: number
    currentEv: number
    futureEv: number
    incrementalEv: number
  }[]
  topCategories: {
    category: string
    spend: number
    savingsOpportunity: number
  }[]
  topVendors: { vendor: string; spend: number; share: number }[]
  managedCareLowPct: number
  managedCareHighPct: number
}

export const facilityAnalysisInsightsSchema = z.object({
  executiveSummary: z
    .string()
    .describe("2-3 sentence CFO-level summary of the opportunity."),
  opportunityScoreRead: z
    .string()
    .describe(
      "A short read on what is driving the Contract Opportunity Score and where the weak dimensions are.",
    ),
  conversionTargets: z.object({
    narrative: z.string(),
    recommendations: z
      .array(z.string())
      .describe("3-5 concrete conversion recommendations."),
  }),
  managedCare: z.object({
    narrative: z.string(),
    recommendedReimbursementLowPct: z
      .number()
      .describe("Lower bound, % of Medicare equivalent (e.g. 118)."),
    recommendedReimbursementHighPct: z
      .number()
      .describe("Upper bound, % of Medicare equivalent (e.g. 132)."),
  }),
  enterpriseValueNarrative: z
    .string()
    .describe("Plain-language read on the enterprise-value impact."),
})

export type FacilityAnalysisInsights = z.infer<
  typeof facilityAnalysisInsightsSchema
>

// ─── Vendor ─────────────────────────────────────────────────────

export interface VendorInsightSnapshot {
  currentAsp: number
  priceChangePct: number
  currentShare: number
  targetShare: number
  expectedVolumeGrowthPct: number
  addressableSpend: number
  currentRevenue: number
  targetRevenue: number
  incrementalRevenue: number
  netUnitImpact: number
  blendedMarketShare: number
  territoryRecurringRevenue: number
  capitalRoboticRevenue: number
  deterministicWinProbabilityPct: number
  opportunityScoreOverall: number
  competitiveThreat: string
}

export const vendorOpportunityInsightsSchema = z.object({
  opportunityScoreRead: z
    .string()
    .describe("Short read on the Vendor Opportunity Score drivers."),
  winProbability: z.object({
    probabilityPct: z
      .number()
      .describe("AI win-probability estimate, 0-100."),
    riskLevel: z.string().describe("Low | Medium | High"),
    competitiveThreat: z
      .string()
      .describe("The most likely incumbent / competitive threat."),
    recommendedAction: z
      .string()
      .describe("The single highest-leverage next action."),
    rationale: z.string(),
  }),
  recommendedOffer: z.object({
    targetConversionPct: z
      .number()
      .describe("Conversion likelihood the offer targets, e.g. 90."),
    items: z
      .array(z.string())
      .describe("Concrete offer levers, e.g. '80% TJA commitment'."),
    rationale: z.string(),
  }),
})

export type VendorOpportunityInsights = z.infer<
  typeof vendorOpportunityInsightsSchema
>
