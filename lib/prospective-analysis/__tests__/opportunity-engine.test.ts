import { describe, it, expect } from "vitest"
import {
  computeOpportunityEngine,
  DEFAULT_OPPORTUNITY_SCENARIO,
  type OpportunityScenarioInput,
} from "../opportunity-engine"

describe("computeOpportunityEngine", () => {
  it("incremental revenue = target − current vendor revenue", () => {
    const r = computeOpportunityEngine({
      ...DEFAULT_OPPORTUNITY_SCENARIO,
      addressableSpend: 10_000_000,
      currentShare: 0.1,
      targetShare: 0.5,
      priceChangePct: 0,
      expectedVolumeGrowthPct: 0,
    })
    expect(r.currentRevenue).toBeCloseTo(1_000_000, 0)
    expect(r.targetRevenue).toBeCloseTo(5_000_000, 0)
    expect(r.incrementalRevenue).toBeCloseTo(4_000_000, 0)
  })

  it("blended market share rises toward the target share", () => {
    const r = computeOpportunityEngine({
      ...DEFAULT_OPPORTUNITY_SCENARIO,
      currentShare: 0.08,
      targetShare: 0.6,
      priceChangePct: 0,
      expectedVolumeGrowthPct: 0,
    })
    // No price/volume change → blended share ≈ target share.
    expect(r.blendedMarketShare).toBeCloseTo(0.6, 2)
  })

  it("a price cut yields more units per revenue dollar (net unit impact up)", () => {
    const base: OpportunityScenarioInput = {
      ...DEFAULT_OPPORTUNITY_SCENARIO,
      currentShare: 0.1,
      targetShare: 0.3,
      expectedVolumeGrowthPct: 0,
    }
    const flat = computeOpportunityEngine({ ...base, priceChangePct: 0 })
    const cut = computeOpportunityEngine({ ...base, priceChangePct: -0.1 })
    expect(cut.netUnitImpact).toBeGreaterThan(flat.netUnitImpact)
  })

  it("capital/robotic revenue is reported separately from territory recurring", () => {
    const r = computeOpportunityEngine({
      ...DEFAULT_OPPORTUNITY_SCENARIO,
      capitalRoboticRevenue: 1_300_000,
      recurringServiceRevenue: 5_600_000,
    })
    expect(r.capitalRoboticRevenue).toBe(1_300_000)
    expect(r.territoryRecurringRevenue).toBe(5_600_000)
  })

  it("win probability: aggressive deal is likely, soft ambitious deal is a long shot", () => {
    const aggressive = computeOpportunityEngine({
      ...DEFAULT_OPPORTUNITY_SCENARIO,
      priceChangePct: -0.12,
      currentShare: 0.4,
      targetShare: 0.55,
      expectedVolumeGrowthPct: 0.1,
      incumbentStrength: 0.3,
    })
    const softAmbitious = computeOpportunityEngine({
      ...DEFAULT_OPPORTUNITY_SCENARIO,
      priceChangePct: 0,
      currentShare: 0.05,
      targetShare: 0.6,
      expectedVolumeGrowthPct: 0.02,
      incumbentStrength: 0.7,
    })
    expect(aggressive.winProbability).toBeGreaterThan(0.6)
    expect(aggressive.winProbabilityBand).toBe("likely")
    expect(softAmbitious.winProbability).toBeLessThan(0.4)
  })

  it("a stronger incumbent lowers win probability, all else equal", () => {
    const weak = computeOpportunityEngine({
      ...DEFAULT_OPPORTUNITY_SCENARIO,
      incumbentStrength: 0.2,
    })
    const strong = computeOpportunityEngine({
      ...DEFAULT_OPPORTUNITY_SCENARIO,
      incumbentStrength: 0.9,
    })
    expect(strong.winProbability).toBeLessThan(weak.winProbability)
  })

  it("capital/robotic revenue is 0 when the deal carries none", () => {
    const r = computeOpportunityEngine({
      ...DEFAULT_OPPORTUNITY_SCENARIO,
      capitalRoboticRevenue: 0,
    })
    expect(r.capitalRoboticRevenue).toBe(0)
  })

  it("win probability stays within [0,1]", () => {
    const extreme = computeOpportunityEngine({
      ...DEFAULT_OPPORTUNITY_SCENARIO,
      priceChangePct: -0.9,
      targetShare: 1,
      currentShare: 0,
      expectedVolumeGrowthPct: 2,
    })
    expect(extreme.winProbability).toBeGreaterThanOrEqual(0)
    expect(extreme.winProbability).toBeLessThanOrEqual(1)
  })

  it("no divide-by-zero when ASP or addressable spend is 0", () => {
    const r = computeOpportunityEngine({
      ...DEFAULT_OPPORTUNITY_SCENARIO,
      currentAsp: 0,
      addressableSpend: 0,
    })
    expect(Number.isFinite(r.netUnitImpact)).toBe(true)
    expect(Number.isFinite(r.blendedMarketShare)).toBe(true)
  })
})
