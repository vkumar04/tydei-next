import { describe, it, expect } from "vitest"
import {
  computeManagedCarePrediction,
  type ManagedCareInput,
} from "../managed-care-predictor"

const STRONG: ManagedCareInput = {
  caseMixAcuity: 1,
  outcomesScore: 1,
  annualCaseVolume: 6000,
  marketStrength: 1,
}

const WEAK: ManagedCareInput = {
  caseMixAcuity: 0,
  outcomesScore: 0,
  annualCaseVolume: 0,
  marketStrength: 0,
}

describe("computeManagedCarePrediction — band ordering", () => {
  const r = computeManagedCarePrediction({
    caseMixAcuity: 0.6,
    outcomesScore: 0.7,
    annualCaseVolume: 3000,
    marketStrength: 0.5,
  })

  it("lowPct < midpointPct < highPct", () => {
    expect(r.lowPct).toBeLessThan(r.midpointPct)
    expect(r.midpointPct).toBeLessThan(r.highPct)
  })

  it("insight is a non-empty string with the band", () => {
    expect(typeof r.insight).toBe("string")
    expect(r.insight.length).toBeGreaterThan(0)
    expect(r.insight).toContain(`${r.lowPct}%`)
    expect(r.insight).toContain(`${r.highPct}%`)
  })
})

describe("computeManagedCarePrediction — strength drives midpoint", () => {
  it("stronger inputs → higher midpoint than weak inputs", () => {
    const strong = computeManagedCarePrediction(STRONG)
    const weak = computeManagedCarePrediction(WEAK)
    expect(strong.midpointPct).toBeGreaterThan(weak.midpointPct)
  })

  it("strongest facility approaches ~145% of Medicare", () => {
    const strong = computeManagedCarePrediction(STRONG)
    // BASE 100 + full 45 lift = 145.
    expect(strong.midpointPct).toBeCloseTo(145, 0)
  })

  it("weakest facility anchors at the 100 base", () => {
    const weak = computeManagedCarePrediction(WEAK)
    expect(weak.midpointPct).toBe(100)
  })

  it("band stays within ~100–145 across the strength range", () => {
    for (const r of [
      computeManagedCarePrediction(STRONG),
      computeManagedCarePrediction(WEAK),
      computeManagedCarePrediction({
        caseMixAcuity: 0.5,
        outcomesScore: 0.5,
        annualCaseVolume: 2500,
        marketStrength: 0.5,
      }),
    ]) {
      expect(r.midpointPct).toBeGreaterThanOrEqual(100)
      expect(r.midpointPct).toBeLessThanOrEqual(145)
    }
  })
})

describe("computeManagedCarePrediction — clamping bad inputs", () => {
  it("NaN inputs clamp to the base (no NaN output)", () => {
    const r = computeManagedCarePrediction({
      caseMixAcuity: Number.NaN,
      outcomesScore: Number.NaN,
      annualCaseVolume: Number.NaN,
      marketStrength: Number.NaN,
    })
    expect(Number.isNaN(r.midpointPct)).toBe(false)
    expect(r.midpointPct).toBe(100)
  })

  it("negative inputs clamp to 0 → base anchor", () => {
    const r = computeManagedCarePrediction({
      caseMixAcuity: -5,
      outcomesScore: -1,
      annualCaseVolume: -1000,
      marketStrength: -2,
    })
    expect(r.midpointPct).toBe(100)
  })

  it("over-strong inputs (>1) clamp and don't exceed 145", () => {
    const r = computeManagedCarePrediction({
      caseMixAcuity: 5,
      outcomesScore: 5,
      annualCaseVolume: 1_000_000,
      marketStrength: 5,
    })
    expect(r.midpointPct).toBeCloseTo(145, 0)
  })
})
