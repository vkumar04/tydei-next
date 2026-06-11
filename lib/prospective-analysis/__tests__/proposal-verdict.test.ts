/**
 * Charles 2026-06-10: the analyzer must combine PDF terms + pricing file +
 * what-they-have comparison + legal language into one "is it good" verdict.
 * Locks the synthesizer's conservative rules: legal critical flags and
 * above-COG pricing only pull DOWN, never up.
 */
import { describe, it, expect } from "vitest"
import { synthesizeProposalVerdict } from "@/lib/prospective-analysis/proposal-verdict"

const GOOD_PRICING = {
  avgVariancePercent: -4.6,
  potentialSavings: 102_070,
  itemsWithCOGMatch: 5,
  totalItems: 6,
  itemsAboveCOG: 0,
}
const GOOD_LOOKBACK = {
  trailing12moSpend: 2_000_000,
  predictedAnnualRebate: 100_000,
  predictedRatePct: 5,
  bestExistingEffectiveRatePct: 3.2,
  hasExistingContracts: true,
}
const CLEAN_LEGAL = {
  overallRiskScore: 22,
  overallRiskLevel: "LOW",
  criticalFlagCount: 0,
}

describe("synthesizeProposalVerdict", () => {
  it("good deal when all four signals are favorable", () => {
    const v = synthesizeProposalVerdict({
      scoreOverall: 8.1,
      scoreVerdict: "accept",
      pricing: GOOD_PRICING,
      lookback: GOOD_LOOKBACK,
      legal: CLEAN_LEGAL,
    })
    expect(v.verdict).toBe("good_deal")
    expect(v.confidence).toBe("high")
    expect(v.missingInputs).toEqual([])
    expect(v.reasons.filter((r) => r.tone === "positive").length).toBe(4)
  })

  it("pricing >3% above COG downgrades accept to negotiate", () => {
    const v = synthesizeProposalVerdict({
      scoreOverall: 8.1,
      scoreVerdict: "accept",
      pricing: { ...GOOD_PRICING, avgVariancePercent: 5.2, itemsAboveCOG: 4 },
      lookback: GOOD_LOOKBACK,
      legal: CLEAN_LEGAL,
    })
    expect(v.verdict).toBe("negotiate")
  })

  it("worse rebate than existing contracts downgrades to negotiate", () => {
    const v = synthesizeProposalVerdict({
      scoreOverall: 7.8,
      scoreVerdict: "accept",
      pricing: GOOD_PRICING,
      lookback: {
        ...GOOD_LOOKBACK,
        predictedRatePct: 2,
        bestExistingEffectiveRatePct: 4.5,
      },
      legal: CLEAN_LEGAL,
    })
    expect(v.verdict).toBe("negotiate")
    expect(
      v.reasons.some((r) => r.tone === "negative" && /existing/.test(r.text)),
    ).toBe(true)
  })

  it("a single critical legal flag blocks good_deal; two force decline", () => {
    const one = synthesizeProposalVerdict({
      scoreOverall: 8.5,
      scoreVerdict: "accept",
      pricing: GOOD_PRICING,
      lookback: GOOD_LOOKBACK,
      legal: { ...CLEAN_LEGAL, criticalFlagCount: 1, overallRiskScore: 61, overallRiskLevel: "HIGH" },
    })
    expect(one.verdict).toBe("negotiate")
    const two = synthesizeProposalVerdict({
      scoreOverall: 8.5,
      scoreVerdict: "accept",
      pricing: GOOD_PRICING,
      lookback: GOOD_LOOKBACK,
      legal: { ...CLEAN_LEGAL, criticalFlagCount: 2, overallRiskScore: 75, overallRiskLevel: "HIGH" },
    })
    expect(two.verdict).toBe("decline")
  })

  it("scoring decline is terminal regardless of other signals", () => {
    const v = synthesizeProposalVerdict({
      scoreOverall: 3.1,
      scoreVerdict: "decline",
      pricing: GOOD_PRICING,
      lookback: GOOD_LOOKBACK,
      legal: CLEAN_LEGAL,
    })
    expect(v.verdict).toBe("decline")
  })

  it("missing inputs lower confidence and produce nudges (never inflate verdict)", () => {
    const v = synthesizeProposalVerdict({
      scoreOverall: 8.0,
      scoreVerdict: "accept",
      pricing: null,
      lookback: null,
      legal: null,
    })
    expect(v.confidence).toBe("low")
    expect(v.missingInputs).toEqual([
      "price file",
      "12-month lookback",
      "legal clause scan",
    ])
    // Score alone can still say good_deal — but with low confidence flagged.
    expect(v.verdict).toBe("good_deal")
  })

  it("unreachable tiers ($0 projection) downgrade to negotiate", () => {
    const v = synthesizeProposalVerdict({
      scoreOverall: 7.6,
      scoreVerdict: "accept",
      pricing: GOOD_PRICING,
      lookback: {
        trailing12moSpend: 100_000,
        predictedAnnualRebate: null,
        predictedRatePct: null,
        bestExistingEffectiveRatePct: null,
        hasExistingContracts: false,
      },
      legal: CLEAN_LEGAL,
    })
    expect(v.verdict).toBe("negotiate")
    expect(v.reasons.some((r) => /pay \$0/.test(r.text))).toBe(true)
  })

  it("zero COG matches in the price file is a warning, not a positive", () => {
    const v = synthesizeProposalVerdict({
      scoreOverall: 8.0,
      scoreVerdict: "accept",
      pricing: { ...GOOD_PRICING, itemsWithCOGMatch: 0, avgVariancePercent: 0 },
      lookback: GOOD_LOOKBACK,
      legal: CLEAN_LEGAL,
    })
    expect(
      v.reasons.some((r) => r.tone === "warning" && /unverified/.test(r.text)),
    ).toBe(true)
    expect(v.verdict).toBe("good_deal")
  })
})
