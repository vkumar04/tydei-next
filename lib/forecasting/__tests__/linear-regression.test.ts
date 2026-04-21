import { describe, it, expect } from "vitest"
import { linearRegression } from "@/lib/forecasting/linear-regression"

describe("linearRegression", () => {
  it("zero points → zeros", () => {
    const r = linearRegression([])
    expect(r.slope).toBe(0)
    expect(r.intercept).toBe(0)
    expect(r.r2).toBe(0)
  })

  it("one point → intercept = y, zero slope", () => {
    const r = linearRegression([{ x: 0, y: 100 }])
    expect(r.slope).toBe(0)
    expect(r.intercept).toBe(100)
    expect(r.r2).toBe(0)
  })

  it("perfect line fits r² = 1", () => {
    const data = [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 6 },
    ]
    const r = linearRegression(data)
    expect(r.slope).toBeCloseTo(2, 6)
    expect(r.intercept).toBeCloseTo(0, 6)
    expect(r.r2).toBeCloseTo(1, 6)
  })

  it("noisy data gives fractional r²", () => {
    const data = [
      { x: 0, y: 100 },
      { x: 1, y: 150 }, // up
      { x: 2, y: 120 }, // down (noise)
      { x: 3, y: 200 }, // up
      { x: 4, y: 180 }, // slight down
      { x: 5, y: 250 }, // up
    ]
    const r = linearRegression(data)
    expect(r.slope).toBeGreaterThan(0) // overall trend is up
    expect(r.r2).toBeGreaterThan(0.5) // moderate fit
    expect(r.r2).toBeLessThan(1) // not perfect
  })

  it("clamps r² into [0, 1]", () => {
    // With only 2 distinct points, r² is technically 1 on the line through them.
    const r = linearRegression([
      { x: 0, y: 10 },
      { x: 1, y: 20 },
    ])
    expect(r.r2).toBe(1)
    expect(r.r2).toBeGreaterThanOrEqual(0)
    expect(r.r2).toBeLessThanOrEqual(1)
  })

  it("all-same-x returns intercept = mean, zero slope", () => {
    const r = linearRegression([
      { x: 5, y: 10 },
      { x: 5, y: 20 },
      { x: 5, y: 30 },
    ])
    expect(r.slope).toBe(0)
    expect(r.intercept).toBe(20)
  })
})
