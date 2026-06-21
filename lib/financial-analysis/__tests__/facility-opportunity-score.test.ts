import { describe, it, expect } from "vitest"
import { computeFacilityOpportunityScore } from "../facility-opportunity-score"
import {
  computeFacilityProspectiveModel,
  type FacilityModelAssumptions,
} from "../prospective-impact-model"

const SCREENSHOT: FacilityModelAssumptions = {
  netRevenue: 41_700_000,
  currentVendorSpend: 12_500_000,
  annualCaseVolume: 5,
  supplyCostPctOfRevenue: 0.3,
  ebitdaMarginPct: 0.3,
  dcfPctOfEbitda: 0.8,
  discountRatePct: 0.1,
  cashFlowGrowthPct: 0.03,
  dcfProjectionYears: 5,
}

describe("computeFacilityOpportunityScore — structure", () => {
  const model = computeFacilityProspectiveModel(SCREENSHOT, 625_879)
  const result = computeFacilityOpportunityScore({
    model,
    vendorConcentrationPct: 0.4,
    cashFlowTimingScore: 70,
    growthAlignmentScore: 80,
    technologyEnablementScore: 60,
  })

  it("components array has 7 entries", () => {
    expect(result.components).toHaveLength(7)
  })

  it("weights are 30/20/15/10/10/10/5 in order", () => {
    expect(result.components.map((c) => c.weight)).toEqual([
      30, 20, 15, 10, 10, 10, 5,
    ])
  })

  it("weights sum to 100", () => {
    expect(result.components.reduce((s, c) => s + c.weight, 0)).toBe(100)
  })

  it("overall is 0–100", () => {
    expect(result.overall).toBeGreaterThanOrEqual(0)
    expect(result.overall).toBeLessThanOrEqual(100)
  })

  it("topPercentile is 1–99", () => {
    expect(result.topPercentile).toBeGreaterThanOrEqual(1)
    expect(result.topPercentile).toBeLessThanOrEqual(99)
  })

  it("headline is a non-empty string mentioning the overall", () => {
    expect(typeof result.headline).toBe("string")
    expect(result.headline.length).toBeGreaterThan(0)
    expect(result.headline).toContain(String(result.overall))
  })

  it("each component sub-score is 0–100", () => {
    for (const c of result.components) {
      expect(c.score).toBeGreaterThanOrEqual(0)
      expect(c.score).toBeLessThanOrEqual(100)
    }
  })
})

describe("computeFacilityOpportunityScore — full marks → ~100", () => {
  // Build a model whose impact maxes out the EBITDA / margin / DCF targets,
  // and supply full-marks values for the manual sub-scores.
  const model = computeFacilityProspectiveModel(SCREENSHOT, 625_879)

  const result = computeFacilityOpportunityScore({
    model,
    // Set tiny targets so the ratio-based sub-scores saturate at 100.
    targetEbitdaImpactPct: 0.0001,
    targetMarginPoints: 0.0001,
    vendorConcentrationPct: 0, // no concentration risk → full marks
    cashFlowTimingScore: 100,
    growthAlignmentScore: 100,
    technologyEnablementScore: 100,
  })

  it("overall is ~100", () => {
    expect(result.overall).toBe(100)
  })

  it("topPercentile clamps to its floor of 1 at a perfect score", () => {
    expect(result.topPercentile).toBe(1)
  })
})

describe("computeFacilityOpportunityScore — vendor concentration risk", () => {
  const model = computeFacilityProspectiveModel(SCREENSHOT, 625_879)

  const base = {
    model,
    cashFlowTimingScore: 70,
    growthAlignmentScore: 80,
    technologyEnablementScore: 60,
  }

  it("high concentration pct lowers the concentration sub-score vs low", () => {
    const low = computeFacilityOpportunityScore({
      ...base,
      vendorConcentrationPct: 0.1,
    })
    const high = computeFacilityOpportunityScore({
      ...base,
      vendorConcentrationPct: 0.9,
    })

    const lowConc = low.components.find(
      (c) => c.key === "vendorConcentration",
    )!
    const highConc = high.components.find(
      (c) => c.key === "vendorConcentration",
    )!

    expect(highConc.score).toBeLessThan(lowConc.score)
    expect(high.overall).toBeLessThan(low.overall)
  })

  it("concentration score = (1 - pct) × 100", () => {
    const r = computeFacilityOpportunityScore({
      ...base,
      vendorConcentrationPct: 0.25,
    })
    const conc = r.components.find((c) => c.key === "vendorConcentration")!
    expect(conc.score).toBeCloseTo(75, 5)
  })
})
