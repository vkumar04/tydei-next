import { describe, it, expect } from "vitest"
import {
  rebateInsightActionSchema,
  rebateInsightConfidenceSchema,
  rebateInsightSchema,
  rebateInsightsInputSchema,
  rebateInsightsResponseSchema,
} from "@/lib/ai/rebate-optimizer-schemas"

describe("rebateInsightActionSchema", () => {
  it("accepts every defined action", () => {
    for (const a of [
      "redirect_spend",
      "accelerate_purchase",
      "negotiate_tier",
      "log_collection",
      "review_compliance",
    ] as const) {
      expect(rebateInsightActionSchema.safeParse(a).success).toBe(true)
    }
  })

  it("rejects an unknown action", () => {
    expect(rebateInsightActionSchema.safeParse("yolo").success).toBe(false)
  })
})

describe("rebateInsightConfidenceSchema", () => {
  it("accepts low/medium/high", () => {
    expect(rebateInsightConfidenceSchema.safeParse("low").success).toBe(true)
    expect(rebateInsightConfidenceSchema.safeParse("medium").success).toBe(true)
    expect(rebateInsightConfidenceSchema.safeParse("high").success).toBe(true)
  })

  it("rejects other values", () => {
    expect(rebateInsightConfidenceSchema.safeParse("certain").success).toBe(false)
  })
})

const validInsight = {
  id: "redirect-stryker-to-depuy-q4",
  rank: 1,
  title: "Stryker Joint Replacement — $180K to Tier 3 with 47 days left",
  summary:
    "Redirect 30% of DePuy discretionary hip spend to Stryker to clear Tier 3.",
  rationale:
    "Averaging $62K/week toward Stryker tier-3 threshold. DePuy has $210K of uncontracted hip spend. Redirect $63K to clear threshold; unlock $22,400 rebate with no source-side penalty. Flag for Nov purchasing review.",
  impactDollars: 22400,
  confidence: "high" as const,
  actionType: "redirect_spend" as const,
  citedContractIds: ["ctr_stryker_1", "ctr_depuy_1"],
}

describe("rebateInsightSchema", () => {
  it("accepts a valid insight", () => {
    expect(rebateInsightSchema.safeParse(validInsight).success).toBe(true)
  })

  it("accepts null impactDollars", () => {
    const parsed = rebateInsightSchema.safeParse({
      ...validInsight,
      impactDollars: null,
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts numeric rank (integer semantics are documented, not enforced — Anthropic rejects the min/max bounds Zod 4's `.int()` emits, so W1.U-D dropped `.int()`)", () => {
    expect(
      rebateInsightSchema.safeParse({ ...validInsight, rank: 1 }).success,
    ).toBe(true)
    expect(
      rebateInsightSchema.safeParse({ ...validInsight, rank: 1.5 }).success,
    ).toBe(true)
  })

  it("rejects a missing citation list", () => {
    const { citedContractIds: _unused, ...rest } = validInsight
    const parsed = rebateInsightSchema.safeParse(rest)
    expect(parsed.success).toBe(false)
  })
})

describe("rebateInsightsResponseSchema", () => {
  it("accepts an empty insights array", () => {
    const parsed = rebateInsightsResponseSchema.safeParse({
      facilityId: "fac_1",
      generatedAt: new Date().toISOString(),
      insights: [],
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts optional observations", () => {
    const parsed = rebateInsightsResponseSchema.safeParse({
      facilityId: "fac_1",
      generatedAt: new Date().toISOString(),
      insights: [validInsight],
      observations: ["Medtronic exceeded top tier by $340K this quarter."],
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects a missing generatedAt", () => {
    const parsed = rebateInsightsResponseSchema.safeParse({
      facilityId: "fac_1",
      insights: [validInsight],
    })
    expect(parsed.success).toBe(false)
  })
})

describe("rebateInsightsInputSchema", () => {
  it("accepts a minimal valid input", () => {
    const parsed = rebateInsightsInputSchema.safeParse({
      facilityId: "fac_1",
      opportunities: [],
      alerts: [],
      recentSpend: [],
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts a full input with all optional fields populated", () => {
    const parsed = rebateInsightsInputSchema.safeParse({
      facilityId: "fac_1",
      opportunities: [
        {
          contractId: "ctr_1",
          contractName: "Stryker",
          vendorId: "v_1",
          vendorName: "Stryker",
          currentSpend: 1_000_000,
          currentTierNumber: 2,
          nextTierNumber: 3,
          nextTierThreshold: 1_200_000,
          additionalRebate: 22_400,
          daysRemaining: 47,
        },
      ],
      alerts: [
        {
          id: "a_1",
          kind: "approaching_tier",
          title: "Approaching tier 3",
          message: "…",
          contractId: "ctr_1",
          impactDollars: 22400,
        },
      ],
      recentSpend: [
        { vendorId: "v_1", vendorName: "Stryker", last90DaysSpend: 540_000 },
      ],
    })
    expect(parsed.success).toBe(true)
  })
})
