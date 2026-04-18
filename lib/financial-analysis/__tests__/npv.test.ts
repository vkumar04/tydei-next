import { describe, expect, it } from "vitest"

import { computeIRR, computeNPV } from "@/lib/financial-analysis/npv"

describe("computeNPV", () => {
  it("classic textbook example: [-1000, 300, 400, 500, 600] @ 10% ≈ $388.77", () => {
    const npv = computeNPV([-1000, 300, 400, 500, 600], 0.1)
    expect(npv).toBeCloseTo(388.77, 2)
  })

  it("zero discount rate → NPV equals the simple sum of cashflows", () => {
    const cf = [-1000, 300, 400, 500, 600]
    const sum = cf.reduce((a, b) => a + b, 0)
    expect(computeNPV(cf, 0)).toBe(sum)
  })

  it("all-positive cashflows with no initial outlay → positive NPV", () => {
    const npv = computeNPV([0, 100, 200, 300], 0.1)
    expect(npv).toBeGreaterThan(0)
  })

  it("empty cashflow array → NPV = 0", () => {
    expect(computeNPV([], 0.1)).toBe(0)
    expect(computeNPV([], 0)).toBe(0)
  })

  it("single negative outlay with no inflows → NPV = outlay", () => {
    expect(computeNPV([-1000], 0.1)).toBe(-1000)
  })

  it("high discount rate drives NPV of distant inflows toward zero", () => {
    const low = computeNPV([-100, 0, 0, 0, 100], 0.01)
    const high = computeNPV([-100, 0, 0, 0, 100], 0.5)
    expect(Math.abs(high)).toBeGreaterThan(Math.abs(low))
  })
})

describe("computeIRR", () => {
  it("returns a rate that drives NPV ≈ 0 for [-1000, 300, 400, 500]", () => {
    const cf = [-1000, 300, 400, 500]
    const irr = computeIRR(cf)
    expect(irr).not.toBeNull()
    expect(computeNPV(cf, irr as number)).toBeCloseTo(0, 4)
  })

  it("returns ~8.90% for [-1000, 300, 400, 500] (0.1% tolerance)", () => {
    const irr = computeIRR([-1000, 300, 400, 500])
    expect(irr).not.toBeNull()
    // Mathematically the root is ~0.08896. 0.1% tolerance → ±0.001.
    expect(Math.abs((irr as number) - 0.08896)).toBeLessThan(0.001)
  })

  it("returns ~24.89% for [-1000, 300, 400, 500, 600]", () => {
    const irr = computeIRR([-1000, 300, 400, 500, 600])
    expect(irr).not.toBeNull()
    expect(Math.abs((irr as number) - 0.24889)).toBeLessThan(0.001)
  })

  it("returns null for all-positive cashflows (no sign change, no real IRR)", () => {
    expect(computeIRR([100, 200, 300])).toBeNull()
  })

  it("returns null for all-negative cashflows (no sign change)", () => {
    expect(computeIRR([-100, -200, -300])).toBeNull()
  })

  it("converges within the requested tolerance", () => {
    const cf = [-5000, 1000, 2000, 2000, 2000]
    const irr = computeIRR(cf, { tolerance: 1e-8 })
    expect(irr).not.toBeNull()
    expect(Math.abs(computeNPV(cf, irr as number))).toBeLessThan(1e-4)
  })

  it("respects maxIterations option", () => {
    // With only 2 iterations we cannot fully converge on a precise root,
    // but the call should still return a finite number inside the bracket.
    const irr = computeIRR([-1000, 300, 400, 500], { maxIterations: 2 })
    expect(irr).not.toBeNull()
    expect(Number.isFinite(irr as number)).toBe(true)
  })
})
