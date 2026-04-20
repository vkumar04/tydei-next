import { describe, it, expect } from "vitest"
import {
  renewalBriefAskSchema,
  renewalBriefConcessionSchema,
  renewalBriefMissedTierSchema,
  renewalBriefPerformanceSchema,
  renewalBriefSchema,
  renewalBriefInputSchema,
} from "@/lib/ai/renewal-brief-schemas"

const validAsk = {
  rank: 1,
  ask: "Lower Tier 3 threshold by 10%",
  rationale:
    "Would have captured Tier 3 in 8/8 historical quarters; shortfalls trended under 12% for 2 consecutive quarters.",
  quantifiedImpact: "+$62K retroactive",
}

const validConcession = {
  concession: "Extend term to 3 years",
  estimatedCost: "~$32K escalator over 3 years",
}

const validMissedTier = {
  quarter: "2025-Q2",
  tierMissed: 3,
  shortfallDollars: 58_000,
  estimatedLostRebate: 14_500,
}

const validBrief = {
  contractId: "ctr-1",
  generatedAt: new Date().toISOString(),
  executiveSummary:
    "The contract has captured 60% of its available rebate over 18 months, missing Tier 3 once. A tier recalibration plus limited price lock is the highest-leverage renewal posture.",
  performanceSummary: {
    termMonths: 24,
    totalSpend: 3_200_000,
    projectedFullSpend: 3_800_000,
    captureRate: 0.6,
    missedTiers: [validMissedTier],
  },
  primaryAsks: [validAsk],
  concessionsOnTable: [validConcession],
}

describe("renewalBriefAskSchema", () => {
  it("accepts a valid ask", () => {
    expect(renewalBriefAskSchema.safeParse(validAsk).success).toBe(true)
  })

  it("accepts null quantifiedImpact", () => {
    expect(
      renewalBriefAskSchema.safeParse({
        ...validAsk,
        quantifiedImpact: null,
      }).success,
    ).toBe(true)
  })

  it("accepts numeric rank (integer semantics are carried in the description, not runtime checks — Anthropic's JSON Schema validator rejects the `minimum`/`maximum` bounds Zod 4's `.int()` emits, so W1.U-D dropped `.int()` and documents the contract instead)", () => {
    // Still parses even if the model ever returns 1.5 — the UI treats rank
    // as a sort key, so a decimal doesn't break anything.
    expect(
      renewalBriefAskSchema.safeParse({ ...validAsk, rank: 1 }).success,
    ).toBe(true)
    expect(
      renewalBriefAskSchema.safeParse({ ...validAsk, rank: 1.5 }).success,
    ).toBe(true)
  })

  it("rejects a missing ask headline", () => {
    const { ask: _unused, ...rest } = validAsk
    expect(renewalBriefAskSchema.safeParse(rest).success).toBe(false)
  })
})

describe("renewalBriefConcessionSchema", () => {
  it("accepts a valid concession", () => {
    expect(
      renewalBriefConcessionSchema.safeParse(validConcession).success,
    ).toBe(true)
  })

  it("accepts null estimatedCost", () => {
    expect(
      renewalBriefConcessionSchema.safeParse({
        ...validConcession,
        estimatedCost: null,
      }).success,
    ).toBe(true)
  })
})

describe("renewalBriefMissedTierSchema", () => {
  it("accepts a valid row", () => {
    expect(
      renewalBriefMissedTierSchema.safeParse(validMissedTier).success,
    ).toBe(true)
  })

  it("accepts a numeric tier number (integer semantics carried in the description; see W1.U-D)", () => {
    expect(
      renewalBriefMissedTierSchema.safeParse({
        ...validMissedTier,
        tierMissed: 2,
      }).success,
    ).toBe(true)
    expect(
      renewalBriefMissedTierSchema.safeParse({
        ...validMissedTier,
        tierMissed: 2.5,
      }).success,
    ).toBe(true)
  })
})

describe("renewalBriefPerformanceSchema", () => {
  it("accepts zero missedTiers", () => {
    expect(
      renewalBriefPerformanceSchema.safeParse({
        termMonths: 12,
        totalSpend: 1_000_000,
        projectedFullSpend: 1_000_000,
        captureRate: 1,
        missedTiers: [],
      }).success,
    ).toBe(true)
  })

  it("rejects a missing termMonths field", () => {
    const parsed = renewalBriefPerformanceSchema.safeParse({
      totalSpend: 1,
      projectedFullSpend: 1,
      captureRate: 0,
      missedTiers: [],
    })
    expect(parsed.success).toBe(false)
  })
})

describe("renewalBriefSchema", () => {
  it("accepts a full valid brief", () => {
    expect(renewalBriefSchema.safeParse(validBrief).success).toBe(true)
  })

  it("accepts an empty primaryAsks array", () => {
    const parsed = renewalBriefSchema.safeParse({
      ...validBrief,
      primaryAsks: [],
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects a missing executiveSummary", () => {
    const { executiveSummary: _unused, ...rest } = validBrief
    expect(renewalBriefSchema.safeParse(rest).success).toBe(false)
  })

  it("rejects a missing performanceSummary", () => {
    const { performanceSummary: _unused, ...rest } = validBrief
    expect(renewalBriefSchema.safeParse(rest).success).toBe(false)
  })
})

describe("renewalBriefInputSchema", () => {
  it("accepts a minimal valid input", () => {
    const parsed = renewalBriefInputSchema.safeParse({
      contract: {
        id: "c-1",
        name: "Test",
        vendorName: "Vendor",
        effectiveDate: "2024-01-01T00:00:00.000Z",
        expirationDate: "2026-01-01T00:00:00.000Z",
        totalValue: 1_000_000,
        annualValue: 500_000,
        performancePeriod: "monthly",
        rebatePayPeriod: "quarterly",
        autoRenewal: false,
      },
      terms: [],
      rebateHistory: [],
      periodHistory: [],
      amendmentHistory: [],
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts a full input with tiers + rebates + amendments", () => {
    const parsed = renewalBriefInputSchema.safeParse({
      contract: {
        id: "c-1",
        name: "Arthrex Arthroscopy",
        contractNumber: "ARX-2024",
        vendorId: "v-1",
        vendorName: "Arthrex",
        effectiveDate: "2024-07-01T00:00:00.000Z",
        expirationDate: "2026-07-01T00:00:00.000Z",
        totalValue: 3_800_000,
        annualValue: 1_900_000,
        performancePeriod: "quarterly",
        rebatePayPeriod: "quarterly",
        autoRenewal: true,
      },
      terms: [
        {
          id: "t-1",
          termName: "Spend rebate",
          termType: "spend_rebate",
          baselineType: "spend_based",
          rebateMethod: "cumulative",
          effectiveStart: "2024-07-01T00:00:00.000Z",
          effectiveEnd: "2026-07-01T00:00:00.000Z",
          spendBaseline: 0,
          tiers: [
            {
              tierNumber: 1,
              tierName: "Base",
              spendMin: 0,
              spendMax: 500_000,
              rebateType: "percent_of_spend",
              rebateValue: 0.01,
            },
          ],
        },
      ],
      rebateHistory: [
        {
          id: "r-1",
          rebateEarned: 22_000,
          rebateCollected: 22_000,
          payPeriodStart: "2025-01-01T00:00:00.000Z",
          payPeriodEnd: "2025-03-31T00:00:00.000Z",
          collectionDate: "2025-04-30T00:00:00.000Z",
        },
      ],
      periodHistory: [
        {
          id: "p-1",
          periodStart: "2025-01-01T00:00:00.000Z",
          periodEnd: "2025-03-31T00:00:00.000Z",
          totalSpend: 440_000,
          rebateEarned: 22_000,
          rebateCollected: 22_000,
          tierAchieved: 2,
        },
      ],
      amendmentHistory: [
        {
          id: "a-1",
          proposalType: "term_change",
          status: "approved",
          submittedAt: "2025-02-15T00:00:00.000Z",
          reviewedAt: "2025-02-20T00:00:00.000Z",
          vendorMessage: "Adjust Tier 3",
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })
})
