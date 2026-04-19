import { describe, it, expect } from "vitest"
import {
  buildDimensions,
  buildRecommendations,
  buildRecommendationsCSV,
  RECOMMENDATIONS_CSV_HEADERS,
} from "@/lib/contracts/score-recommendations"
import type { DealScoreResult } from "@/lib/ai/schemas"

const baseAI: DealScoreResult = {
  financialValue: 70,
  rebateEfficiency: 50,
  pricingCompetitiveness: 55,
  marketShareAlignment: 55,
  complianceLikelihood: 50,
  overallScore: 58,
  recommendation: "Renegotiate on price and shore up rebate capture.",
  negotiationAdvice: ["Push for a 3% price cut", "Add a stretch tier"],
}

describe("score-recommendations", () => {
  it("maps 5 AI dimensions into the 6 display dimensions", () => {
    const dims = buildDimensions(baseAI)
    expect(dims.pricingCompetitiveness).toBe(55)
    expect(dims.rebateStructure).toBe(50)
    expect(dims.marketComparison).toBe(70)
    expect(dims.contractFlexibility).toBe(Math.round((70 + 50) / 2))
  })

  it("emits AI assessment + dimension-triggered recs + negotiation advice", () => {
    const dims = buildDimensions(baseAI)
    const recs = buildRecommendations(
      dims,
      baseAI.recommendation,
      baseAI.negotiationAdvice
    )
    // AI Assessment, Pricing Below Market, Improve Rebate Capture,
    // Volume Misalignment, Elevated Risk Profile, 2x Negotiation Tip = 7.
    expect(recs).toHaveLength(7)
    expect(recs[0]!.severity).toBe("success")
    expect(recs[0]!.category).toBe("AI Assessment")
    expect(recs.some((r) => r.title === "Pricing Below Market")).toBe(true)
    expect(recs.some((r) => r.title === "Improve Rebate Capture")).toBe(true)
    expect(recs.filter((r) => r.category === "Negotiation Tip")).toHaveLength(2)
  })

  it("builds a CSV with the documented header + one row per rec", () => {
    const recs = buildRecommendations(buildDimensions(baseAI), "Negotiate.", [
      "tip 1",
    ])
    const csv = buildRecommendationsCSV(recs)
    const lines = csv.split("\n")
    expect(lines[0]).toBe(RECOMMENDATIONS_CSV_HEADERS.join(","))
    expect(lines).toHaveLength(recs.length + 1)
    // first data row is the AI assessment
    expect(lines[1]).toContain("AI Assessment")
  })

  it("RFC 4180 escapes commas, quotes, and newlines in rationale", () => {
    const csv = buildRecommendationsCSV([
      {
        severity: "warning",
        category: "Negotiation Tip",
        title: 'Trim "list"',
        description: "Cut price, lock tiers\nand add stretch.",
      },
    ])
    const dataLine = csv.split("\n").slice(1).join("\n")
    // title field has embedded quotes → doubled + wrapped
    expect(dataLine).toContain('"Trim ""list"""')
    // description has comma + newline → wrapped in quotes
    expect(dataLine).toContain('"Cut price, lock tiers\nand add stretch."')
  })
})
