import { describe, it, expect } from "vitest"
import {
  buildOpportunityNarrative,
  buildFacilityProposalNarrative,
  facilityProposedPrice,
  type OpportunityNarrativeInput,
} from "@/lib/prospective-analysis/opportunity-narrative"

// The Opportunity Engine export must "tell the story of the data" the same way
// the facility Analysis export does (Vick, item 5): who/where → the facility
// today → the proposed deal → what winning it is worth → the recommended
// offer, honest about assumptions when data is missing.

const scenario: OpportunityNarrativeInput["scenario"] = {
  division: "Ortho",
  facility: "Lighthouse Surgical Center",
  priceChangePct: -0.05,
  targetShare: 0.5,
  expectedVolumeGrowthPct: 0.1,
}

const engine: OpportunityNarrativeInput["engine"] = {
  winProbability: 0.62,
  currentRevenue: 3_000_000,
  targetRevenue: 4_200_000,
  incrementalRevenue: 1_200_000,
  blendedMarketShare: 0.41,
  territoryRecurringRevenue: 4_200_000,
  capitalRoboticRevenue: 750_000,
}

const score: OpportunityNarrativeInput["score"] = {
  overall: 71,
  winProbability: {
    probability: 0.58,
    riskLevel: "Medium",
    recommendedAction: "Add SPD financing",
  },
  recommendedOffer: {
    targetConversionPct: 90,
    items: ["80% TJA commitment", "10% growth rebate"],
  },
}

const facility: OpportunityNarrativeInput["facility"] = {
  facilityName: "Lighthouse Surgical Center",
  currentVendorSpend: 23_700_000,
  netRevenue: 9_900_000,
  ebitda: 2_970_000,
  ebitdaMarginPct: 0.3,
  dcf: 34_000_000,
  revenueMode: "actuals",
}

const constructs: OpportunityNarrativeInput["constructs"] = [
  {
    productName: "Total Knee System",
    current: 3200,
    target: 2950,
    annualVolume: 120,
    rebatePercent: 3,
  },
  {
    productName: "Hip Stem",
    current: 2000,
    target: 1900,
    annualVolume: 80,
    rebatePercent: 2,
  },
]

describe("buildOpportunityNarrative", () => {
  describe("full-data deal (facility + constructs + capital)", () => {
    const paragraphs = buildOpportunityNarrative({
      scenario,
      engine,
      score,
      facility,
      constructs,
    })
    const text = paragraphs.join(" ")

    it("tells the story in order: who/where → facility → deal → win → offer", () => {
      expect(paragraphs).toHaveLength(5)
      expect(paragraphs[0]).toMatch(/Ortho is pitching Lighthouse Surgical Center/)
      expect(paragraphs[1]).toMatch(/runs .* of net revenue/)
      expect(paragraphs[2]).toMatch(/proposed deal covers 2 products/)
      expect(paragraphs[3]).toMatch(/win probability/i)
      expect(paragraphs[4]).toMatch(/scores 71\/100/)
    })

    it("states the scenario levers with repo formatting", () => {
      expect(paragraphs[0]).toContain("5.0% price cut")
      expect(paragraphs[0]).toContain("50.0% market share")
      expect(paragraphs[0]).toContain("10.0% expected volume growth")
    })

    it("walks the facility's financial chain with the revenue basis", () => {
      expect(paragraphs[1]).toContain("$9.9M of net revenue")
      expect(paragraphs[1]).toContain("from case-costing actuals")
      expect(paragraphs[1]).toContain("$23.7M of current vendor spend")
      expect(paragraphs[1]).toContain("$3.0M of EBITDA at a 30.0% margin")
      expect(paragraphs[1]).toContain("$34.0M DCF enterprise value")
    })

    it("summarizes the constructs: count, volume, target-vs-current, blended rebate", () => {
      expect(paragraphs[2]).toContain("200 units/yr")
      // Current spend 3200×120 + 2000×80 = 544,000; target 2950×120 + 1900×80
      // = 506,000 → 7.0% below current.
      expect(paragraphs[2]).toContain("7.0% below current pricing")
      // Spend-weighted rebate at Target: (3×354,000 + 2×152,000)/506,000 = 2.7%.
      expect(paragraphs[2]).toContain("2.7% blended rebate")
    })

    it("attributes win probability to the deterministic model and includes the capital sentence", () => {
      expect(paragraphs[3]).toContain("deterministic model")
      expect(paragraphs[3]).toContain("62.0%")
      expect(paragraphs[3]).toContain("$3.0M to $4.2M (+$1.2M)")
      expect(paragraphs[3]).toContain("41.0%")
      expect(paragraphs[3]).toContain(
        "$750.0K of capital / robotic revenue, which does not hit the territory number",
      )
    })

    it("closes with score, risk, action, and the recommended offer", () => {
      expect(paragraphs[4]).toContain("(medium risk)")
      expect(paragraphs[4]).toContain("Recommended action: Add SPD financing.")
      expect(paragraphs[4]).toContain(
        "reach 90% conversion, the recommended offer includes 80% TJA commitment, 10% growth rebate",
      )
      expect(text).not.toContain("undefined")
      expect(text).not.toContain("NaN")
    })
  })

  it("omits the capital sentence when the deal carries no capital revenue", () => {
    const paragraphs = buildOpportunityNarrative({
      scenario,
      engine: { ...engine, capitalRoboticRevenue: 0 },
      score,
      facility,
      constructs,
    })
    const winParagraph = paragraphs[3]
    expect(winParagraph).toContain("win probability")
    expect(winParagraph).not.toMatch(/capital \/ robotic/)
  })

  it("omits the deal paragraph when there are no constructs", () => {
    const empties: OpportunityNarrativeInput["constructs"][] = [undefined, [], null]
    for (const empty of empties) {
      const paragraphs = buildOpportunityNarrative({
        scenario,
        engine,
        score,
        facility,
        constructs: empty,
      })
      expect(paragraphs).toHaveLength(4)
      expect(paragraphs.join(" ")).not.toMatch(/proposed deal covers/)
    }
  })

  it("says the figures are modeled from defaults when no facility snapshot was loaded", () => {
    const paragraphs = buildOpportunityNarrative({
      scenario,
      engine,
      score,
      facility: null,
      constructs,
    })
    expect(paragraphs[1]).toMatch(/modeled from default assumptions/)
    expect(paragraphs[1]).not.toMatch(/net revenue/)
  })

  it("handles a price increase, a manual revenue basis, and a revenue decline honestly", () => {
    const paragraphs = buildOpportunityNarrative({
      scenario: { ...scenario, priceChangePct: 0.03 },
      engine: {
        ...engine,
        targetRevenue: 2_500_000,
        incrementalRevenue: -500_000,
        capitalRoboticRevenue: 0,
      },
      score,
      facility: { ...facility, revenueMode: "manual" },
    })
    expect(paragraphs[0]).toContain("3.0% price increase")
    expect(paragraphs[1]).toContain("a manual assumption")
    // Negative incremental keeps its sign — never a bogus "+-$500.0K".
    expect(paragraphs[2]).toContain("(-$500.0K)")
    expect(paragraphs[2]).not.toContain("+-")
  })
})

// John's two-format ask (bugs.rtfd 2026-07-07): the facility-facing report
// must carry NONE of the vendor-internal levers — no win probability, no
// opportunity score, no recommended offer, no Floor/Target ladder.
describe("buildFacilityProposalNarrative", () => {
  it("tells the facility the offer story without any vendor-internal levers", () => {
    const paragraphs = buildFacilityProposalNarrative({
      scenario,
      constructs,
    })
    const all = paragraphs.join(" ")
    expect(all).toContain("Lighthouse Surgical Center")
    expect(all).toContain("5.0% below current levels")
    expect(all).toMatch(/annual savings/)
    // Vendor-internal levers must never leak into the facility version.
    expect(all).not.toMatch(/win probability/i)
    expect(all).not.toMatch(/score/i)
    expect(all).not.toMatch(/recommended (action|offer)/i)
    expect(all).not.toMatch(/floor/i)
    expect(all).not.toMatch(/margin/i)
    expect(all).not.toMatch(/territory/i)
  })

  it("names the share commitment and handles a no-construct scenario", () => {
    const paragraphs = buildFacilityProposalNarrative({
      scenario,
      constructs: [],
    })
    expect(paragraphs.join(" ")).toContain("50.0% category commitment")
    // No constructs → no per-product paragraph, but the story still opens.
    expect(paragraphs.length).toBe(2)
  })
})

describe("facilityProposedPrice", () => {
  it("presents the Ask (opening position) and falls back to Target", () => {
    expect(facilityProposedPrice({ target: 2950, ask: 3100 })).toBe(3100)
    expect(facilityProposedPrice({ target: 2950, ask: 0 })).toBe(2950)
    expect(facilityProposedPrice({ target: 2950 })).toBe(2950)
  })
})
