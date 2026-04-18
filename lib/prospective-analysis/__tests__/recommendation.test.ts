/**
 * Tests for generateRecommendation (spec §subsystem-0, §4.3).
 *
 * Covers verdict thresholds, always-include points, dimension-specific
 * negotiation points, and lock-in risk surface rules.
 */

import { describe, it, expect } from "vitest"
import {
  generateRecommendation,
  ALWAYS_INCLUDE_POINTS,
  type RecommendationCommitments,
} from "../recommendation"
import type { ProposalScores } from "../scoring"

function baseScores(partial: Partial<ProposalScores> = {}): ProposalScores {
  return {
    costSavings: 5,
    priceCompetitiveness: 5,
    rebateAttainability: 5,
    lockInRisk: 10,
    tco: 7,
    overall: 5.9,
    ...partial,
  }
}

function baseCommitments(
  partial: Partial<RecommendationCommitments> = {},
): RecommendationCommitments {
  return {
    termYears: 1,
    exclusivity: false,
    marketShareCommitment: null,
    minimumSpendIsHighPct: false,
    ...partial,
  }
}

describe("generateRecommendation — verdict thresholds", () => {
  it("overall ≥ 7.5 → accept (all scores high; only always-include points)", () => {
    const rec = generateRecommendation(
      baseScores({
        costSavings: 9,
        priceCompetitiveness: 9,
        rebateAttainability: 9,
        lockInRisk: 10,
        tco: 10,
        overall: 9.3,
      }),
      baseCommitments(),
    )
    expect(rec.verdict).toBe("accept")
    expect(rec.negotiationPoints).toEqual([...ALWAYS_INCLUDE_POINTS])
    expect(rec.risks).toEqual([])
  })

  it("overall = 7.5 exactly → accept (boundary)", () => {
    const rec = generateRecommendation(
      baseScores({ overall: 7.5 }),
      baseCommitments(),
    )
    expect(rec.verdict).toBe("accept")
  })

  it("5 ≤ overall < 7.5 → negotiate with multiple points", () => {
    const rec = generateRecommendation(
      baseScores({
        costSavings: 4, // low → triggers a negotiation point
        rebateAttainability: 4, // low → triggers a negotiation point
        tco: 6, // below 7 → triggers TCO point
        overall: 6,
      }),
      baseCommitments(),
    )
    expect(rec.verdict).toBe("negotiate")
    // Always-include (2) + costSavings + rebate + tco = 5 points.
    expect(rec.negotiationPoints).toHaveLength(5)
    for (const base of ALWAYS_INCLUDE_POINTS) {
      expect(rec.negotiationPoints).toContain(base)
    }
    expect(rec.negotiationPoints).toContain(
      "Target 5-10% better pricing on high-volume items",
    )
    expect(rec.negotiationPoints).toContain(
      "Reduce minimum spend threshold to match historic spend",
    )
    expect(rec.negotiationPoints).toContain(
      "Request net-60 payment terms + price protection clause",
    )
  })

  it("overall = 5 exactly → negotiate (boundary)", () => {
    const rec = generateRecommendation(
      baseScores({ overall: 5 }),
      baseCommitments(),
    )
    expect(rec.verdict).toBe("negotiate")
  })

  it("overall < 5 → decline", () => {
    const rec = generateRecommendation(
      baseScores({ overall: 3 }),
      baseCommitments(),
    )
    expect(rec.verdict).toBe("decline")
  })
})

describe("generateRecommendation — dimension-specific points", () => {
  it("low costSavings adds the pricing-target point", () => {
    const rec = generateRecommendation(
      baseScores({ costSavings: 3 }),
      baseCommitments(),
    )
    expect(rec.negotiationPoints).toContain(
      "Target 5-10% better pricing on high-volume items",
    )
  })

  it("costSavings at threshold (5) does NOT add the point", () => {
    const rec = generateRecommendation(
      baseScores({ costSavings: 5 }),
      baseCommitments(),
    )
    expect(rec.negotiationPoints).not.toContain(
      "Target 5-10% better pricing on high-volume items",
    )
  })

  it("low rebateAttainability adds the minimum-spend point", () => {
    const rec = generateRecommendation(
      baseScores({ rebateAttainability: 2 }),
      baseCommitments(),
    )
    expect(rec.negotiationPoints).toContain(
      "Reduce minimum spend threshold to match historic spend",
    )
  })

  it("tco < 7 adds the payment-terms point", () => {
    const rec = generateRecommendation(
      baseScores({ tco: 6 }),
      baseCommitments(),
    )
    expect(rec.negotiationPoints).toContain(
      "Request net-60 payment terms + price protection clause",
    )
  })

  it("tco = 7 exactly does NOT add the payment-terms point", () => {
    const rec = generateRecommendation(
      baseScores({ tco: 7 }),
      baseCommitments(),
    )
    expect(rec.negotiationPoints).not.toContain(
      "Request net-60 payment terms + price protection clause",
    )
  })
})

describe("generateRecommendation — lock-in risks", () => {
  it("exclusivity risk appears when lockInRisk < 5 and exclusivity=true", () => {
    const rec = generateRecommendation(
      baseScores({ lockInRisk: 3 }),
      baseCommitments({ exclusivity: true }),
    )
    expect(rec.risks).toContain(
      "Exclusivity clause limits future vendor flexibility",
    )
  })

  it("exclusivity risk does NOT appear when lockInRisk ≥ 5", () => {
    const rec = generateRecommendation(
      baseScores({ lockInRisk: 7 }),
      baseCommitments({ exclusivity: true }),
    )
    expect(rec.risks).not.toContain(
      "Exclusivity clause limits future vendor flexibility",
    )
  })

  it("multi-year risk embeds the actual year count in the message", () => {
    const rec = generateRecommendation(
      baseScores({ lockInRisk: 2 }),
      baseCommitments({ termYears: 5 }),
    )
    expect(rec.risks).toContain(
      "Multi-year term (5y) — pricing may become uncompetitive",
    )
  })

  it("multi-year risk does not fire for termYears = 3 exactly", () => {
    // Rule is `> 3` in the penalty formula; use 3 but ensure low lockIn.
    const rec = generateRecommendation(
      baseScores({ lockInRisk: 1 }),
      baseCommitments({ termYears: 3 }),
    )
    expect(
      rec.risks.some((r) => r.startsWith("Multi-year term")),
    ).toBe(false)
  })

  it("market-share risk embeds the actual % in the message", () => {
    const rec = generateRecommendation(
      baseScores({ lockInRisk: 2 }),
      baseCommitments({ marketShareCommitment: 85 }),
    )
    expect(rec.risks).toContain(
      "High market-share commitment (85%) reduces vendor diversity",
    )
  })

  it("market-share risk does not fire for MSC = 70 exactly", () => {
    const rec = generateRecommendation(
      baseScores({ lockInRisk: 2 }),
      baseCommitments({ marketShareCommitment: 70 }),
    )
    expect(
      rec.risks.some((r) => r.startsWith("High market-share commitment")),
    ).toBe(false)
  })

  it("high-minimum risk fires when minimumSpendIsHighPct and lockIn < 5", () => {
    const rec = generateRecommendation(
      baseScores({ lockInRisk: 1 }),
      baseCommitments({ minimumSpendIsHighPct: true }),
    )
    expect(rec.risks).toContain(
      "Minimum spend threshold above 80% of current — hard to exit",
    )
  })

  it("all lock-in risks fire together when applicable", () => {
    const rec = generateRecommendation(
      baseScores({ lockInRisk: 0 }),
      baseCommitments({
        termYears: 6,
        exclusivity: true,
        marketShareCommitment: 90,
        minimumSpendIsHighPct: true,
      }),
    )
    expect(rec.risks).toHaveLength(4)
  })
})

describe("generateRecommendation — always-include points", () => {
  it("accept verdict still includes the 2 always-include points", () => {
    const rec = generateRecommendation(
      baseScores({
        costSavings: 10,
        priceCompetitiveness: 10,
        rebateAttainability: 10,
        lockInRisk: 10,
        tco: 10,
        overall: 10,
      }),
      baseCommitments(),
    )
    expect(rec.negotiationPoints).toEqual([...ALWAYS_INCLUDE_POINTS])
    expect(rec.negotiationPoints).toContain(
      "Review top 10 SKUs for price alignment",
    )
    expect(rec.negotiationPoints).toContain(
      "Consider multi-year commitment only for rate lock",
    )
  })
})
