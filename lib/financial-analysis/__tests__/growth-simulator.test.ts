import { describe, it, expect } from "vitest"
import {
  computeGrowthSimulation,
  ZERO_GROWTH_LEVERS,
  type GrowthLevers,
} from "../growth-simulator"
import { DEFAULT_FACILITY_ASSUMPTIONS } from "../prospective-impact-model"

describe("computeGrowthSimulation — zero levers", () => {
  const r = computeGrowthSimulation(
    DEFAULT_FACILITY_ASSUMPTIONS,
    ZERO_GROWTH_LEVERS,
  )

  it("simulated ≈ base for every output", () => {
    expect(r.simulated.netRevenue).toBeCloseTo(r.base.netRevenue, 2)
    expect(r.simulated.ebitda).toBeCloseTo(r.base.ebitda, 2)
    expect(r.simulated.ebitdaMarginPct).toBeCloseTo(r.base.ebitdaMarginPct, 6)
    expect(r.simulated.dcf).toBeCloseTo(r.base.dcf, 2)
    expect(r.simulated.ev).toBeCloseTo(r.base.ev, 2)
  })

  it("all deltas are ~0", () => {
    expect(r.delta.netRevenue).toBeCloseTo(0, 2)
    expect(r.delta.ebitda).toBeCloseTo(0, 2)
    expect(r.delta.ebitdaMarginPoints).toBeCloseTo(0, 6)
    expect(r.delta.dcf).toBeCloseTo(0, 2)
    expect(r.delta.ev).toBeCloseTo(0, 2)
  })

  it("all delta fields are finite", () => {
    for (const v of Object.values(r.delta)) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe("computeGrowthSimulation — volume growth", () => {
  it("positive volumeGrowthPct raises netRevenue and ebitda", () => {
    const levers: GrowthLevers = {
      ...ZERO_GROWTH_LEVERS,
      volumeGrowthPct: 0.1,
    }
    const r = computeGrowthSimulation(DEFAULT_FACILITY_ASSUMPTIONS, levers)
    expect(r.simulated.netRevenue).toBeGreaterThan(r.base.netRevenue)
    expect(r.simulated.ebitda).toBeGreaterThan(r.base.ebitda)
    expect(r.delta.netRevenue).toBeGreaterThan(0)
    expect(r.delta.ebitda).toBeGreaterThan(0)
  })
})

describe("computeGrowthSimulation — vendor share consolidation", () => {
  it("raises ebitda via supply savings without raising revenue", () => {
    const levers: GrowthLevers = {
      ...ZERO_GROWTH_LEVERS,
      vendorShareConsolidationPct: 0.05,
    }
    const r = computeGrowthSimulation(DEFAULT_FACILITY_ASSUMPTIONS, levers)
    expect(r.simulated.ebitda).toBeGreaterThan(r.base.ebitda)
    expect(r.delta.ebitda).toBeGreaterThan(0)
    // Savings don't touch revenue.
    expect(r.simulated.netRevenue).toBeCloseTo(r.base.netRevenue, 2)
  })
})

describe("computeGrowthSimulation — combined finiteness", () => {
  it("all delta fields finite with every lever engaged", () => {
    const levers: GrowthLevers = {
      volumeGrowthPct: 0.12,
      payerMixLiftPct: 0.04,
      vendorShareConsolidationPct: 0.06,
      roboticsThroughputPct: 0.08,
      newSurgeonRevenuePct: 0.05,
    }
    const r = computeGrowthSimulation(DEFAULT_FACILITY_ASSUMPTIONS, levers)
    for (const v of Object.values(r.delta)) {
      expect(Number.isFinite(v)).toBe(true)
    }
    expect(Number.isFinite(r.simulated.dcf)).toBe(true)
    expect(Number.isFinite(r.simulated.ev)).toBe(true)
  })
})
