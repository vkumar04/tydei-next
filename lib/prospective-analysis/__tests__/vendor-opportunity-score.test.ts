import { describe, it, expect } from "vitest"
import { computeVendorOpportunityScore } from "../vendor-opportunity-score"
import {
  computeOpportunityEngine,
  DEFAULT_OPPORTUNITY_SCENARIO,
} from "../opportunity-engine"

const engine = computeOpportunityEngine(DEFAULT_OPPORTUNITY_SCENARIO)

const baseInput = {
  engine,
  rebateCostPct: 0.08,
  shareOfWalletGainPct: 0.4,
  competitiveDisplacementScore: 60,
  multiBuPenetrationScore: 50,
  technologyAdoptionScore: 70,
  competitiveThreat: "Stryker",
  hasCapital: true,
}

describe("computeVendorOpportunityScore — structure", () => {
  const r = computeVendorOpportunityScore(baseInput)

  it("overall is 0–100", () => {
    expect(r.overall).toBeGreaterThanOrEqual(0)
    expect(r.overall).toBeLessThanOrEqual(100)
  })

  it("financial has 5 entries", () => {
    expect(r.financial).toHaveLength(5)
  })

  it("strategic has 5 entries", () => {
    expect(r.strategic).toHaveLength(5)
  })

  it("financial + strategic weights sum to 100", () => {
    const sum = [...r.financial, ...r.strategic].reduce(
      (s, d) => s + d.weight,
      0,
    )
    expect(sum).toBe(100)
  })

  it("every dimension sub-score is 0–100", () => {
    for (const d of [...r.financial, ...r.strategic]) {
      expect(d.score).toBeGreaterThanOrEqual(0)
      expect(d.score).toBeLessThanOrEqual(100)
    }
  })
})

describe("computeVendorOpportunityScore — win probability", () => {
  const r = computeVendorOpportunityScore(baseInput)

  it("riskLevel is one of Low / Medium / High", () => {
    expect(["Low", "Medium", "High"]).toContain(r.winProbability.riskLevel)
  })

  it("probability echoes the engine win probability", () => {
    expect(r.winProbability.probability).toBeCloseTo(engine.winProbability, 6)
  })

  it("competitiveThreat is surfaced", () => {
    expect(r.winProbability.competitiveThreat).toBe("Stryker")
  })

  it("recommendedAction is a non-empty string", () => {
    expect(typeof r.winProbability.recommendedAction).toBe("string")
    expect(r.winProbability.recommendedAction.length).toBeGreaterThan(0)
  })

  it("higher engine win probability → lower (or equal) risk", () => {
    const rank: Record<string, number> = { Low: 0, Medium: 1, High: 2 }

    const highWin = computeVendorOpportunityScore({
      ...baseInput,
      engine: { ...engine, winProbability: 0.9 },
    })
    const lowWin = computeVendorOpportunityScore({
      ...baseInput,
      engine: { ...engine, winProbability: 0.1 },
    })

    expect(highWin.winProbability.riskLevel).toBe("Low")
    expect(lowWin.winProbability.riskLevel).toBe("High")
    expect(rank[highWin.winProbability.riskLevel]).toBeLessThan(
      rank[lowWin.winProbability.riskLevel]!,
    )
  })
})

describe("computeVendorOpportunityScore — recommended offer", () => {
  const r = computeVendorOpportunityScore(baseInput)

  it("items is non-empty", () => {
    expect(r.recommendedOffer.items.length).toBeGreaterThan(0)
  })

  it("targetConversionPct is present", () => {
    expect(typeof r.recommendedOffer.targetConversionPct).toBe("number")
    expect(r.recommendedOffer.targetConversionPct).toBeGreaterThan(0)
  })

  it("adds SPD financing when the deal has no capital", () => {
    const noCapital = computeVendorOpportunityScore({
      ...baseInput,
      hasCapital: false,
    })
    expect(noCapital.recommendedOffer.items).toContain("SPD financing")
  })
})
