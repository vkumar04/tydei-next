import { describe, it, expect } from "vitest"
import {
  blendConstructsToScenarios,
  type DealConstruct,
} from "../blend-constructs"

const c = (p: Partial<DealConstruct>): DealConstruct => ({
  current: 0,
  floor: 0,
  target: 0,
  ask: 0,
  annualVolume: 0,
  rebatePercent: 0,
  ...p,
})

describe("blendConstructsToScenarios", () => {
  it("spend-weights unit price + sums volume across constructs per tier", () => {
    const { scenarios, currentAnnualSpend } = blendConstructsToScenarios([
      c({ current: 100, floor: 80, target: 90, ask: 95, annualVolume: 100, rebatePercent: 2 }),
      c({ current: 200, floor: 180, target: 190, ask: 195, annualVolume: 300, rebatePercent: 4 }),
    ])
    const target = scenarios.find((s) => s.scenarioName === "Target")!
    // Σ(target×vol)=90*100+190*300=66000 ; totalVol=400 → 165
    expect(target.unitPrice).toBe(165)
    expect(target.estimatedAnnualVolume).toBe(400)
    // rebate spend-weighted: (2*90*100 + 4*190*300)/(90*100+190*300)=(18000+228000)/66000≈3.727
    expect(target.rebatePercent).toBeCloseTo(3.727, 2)
    // current baseline = 100*100 + 200*300 = 70000
    expect(currentAnnualSpend).toBe(70000)
  })

  it("produces Floor / Target / Ask (no Ceiling)", () => {
    const { scenarios } = blendConstructsToScenarios([
      c({ floor: 80, target: 90, ask: 95, annualVolume: 10 }),
    ])
    expect(scenarios.map((s) => s.scenarioName)).toEqual(["Floor", "Target", "Ask"])
  })

  it("ignores constructs with no volume and drops zero-price tiers", () => {
    const { scenarios, currentAnnualSpend } = blendConstructsToScenarios([
      c({ current: 50, floor: 0, target: 0, ask: 0, annualVolume: 0 }), // no volume → ignored
    ])
    expect(scenarios).toEqual([])
    expect(currentAnnualSpend).toBe(0)
  })

  it("a priced tier with zero on one construct still blends the others", () => {
    const { scenarios } = blendConstructsToScenarios([
      c({ floor: 0, target: 100, ask: 100, annualVolume: 50 }),
    ])
    // Floor tier blends to 0 → dropped; Target/Ask survive
    expect(scenarios.map((s) => s.scenarioName)).toEqual(["Target", "Ask"])
  })
})
