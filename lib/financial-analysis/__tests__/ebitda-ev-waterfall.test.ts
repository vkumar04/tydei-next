import { describe, it, expect } from "vitest"
import {
  computeEbitdaEvWaterfall,
  type EbitdaWaterfallLevers,
} from "../ebitda-ev-waterfall"

// Charles example: $5.0M EBITDA, +$0.8M improvement, 12× multiple.
const LEVERS: EbitdaWaterfallLevers = {
  currentEbitda: 5_000_000,
  implantSavings: 300_000,
  rebateValue: 200_000,
  growthImpact: 150_000,
  laborSavings: 100_000,
  throughputImpact: 50_000, // sums to +800_000
}

describe("computeEbitdaEvWaterfall — Charles example", () => {
  const result = computeEbitdaEvWaterfall(LEVERS, 12)

  it("futureEbitda = 5.8M", () => {
    expect(result.futureEbitda).toBeCloseTo(5_800_000, 2)
  })

  it("totalEbitdaImprovement = +0.8M", () => {
    expect(result.totalEbitdaImprovement).toBeCloseTo(800_000, 2)
  })

  it("currentEv = 60M", () => {
    expect(result.ev.currentEv).toBeCloseTo(60_000_000, 2)
  })

  it("futureEv = 69.6M", () => {
    expect(result.ev.futureEv).toBeCloseTo(69_600_000, 2)
  })

  it("incrementalEv = 9.6M", () => {
    expect(result.ev.incrementalEv).toBeCloseTo(9_600_000, 2)
  })

  it("insight is a non-empty string naming the incremental EV", () => {
    expect(typeof result.ev.insight).toBe("string")
    expect(result.ev.insight.length).toBeGreaterThan(0)
    expect(result.ev.insight).toContain("$9.6M")
  })
})

describe("computeEbitdaEvWaterfall — steps", () => {
  const result = computeEbitdaEvWaterfall(LEVERS, 12)

  it("first step is the base", () => {
    expect(result.steps[0]!.kind).toBe("base")
    expect(result.steps[0]!.cumulative).toBeCloseTo(5_000_000, 2)
  })

  it("last step is the total", () => {
    const last = result.steps[result.steps.length - 1]!
    expect(last.kind).toBe("total")
    expect(last.cumulative).toBeCloseTo(5_800_000, 2)
  })

  it("has 7 steps (base + 5 levers + total)", () => {
    expect(result.steps).toHaveLength(7)
  })

  it("cumulative is monotonic non-decreasing for non-negative levers", () => {
    for (let i = 1; i < result.steps.length; i++) {
      expect(result.steps[i]!.cumulative).toBeGreaterThanOrEqual(
        result.steps[i - 1]!.cumulative,
      )
    }
  })
})

describe("computeEbitdaEvWaterfall — edge cases", () => {
  it("zero levers → future equals current, zero incremental EV", () => {
    const result = computeEbitdaEvWaterfall(
      {
        currentEbitda: 5_000_000,
        implantSavings: 0,
        rebateValue: 0,
        growthImpact: 0,
        laborSavings: 0,
        throughputImpact: 0,
      },
      12,
    )
    expect(result.futureEbitda).toBeCloseTo(5_000_000, 2)
    expect(result.totalEbitdaImprovement).toBeCloseTo(0, 2)
    expect(result.ev.incrementalEv).toBeCloseTo(0, 2)
  })

  it("negative levers reduce cumulative", () => {
    const result = computeEbitdaEvWaterfall(
      {
        currentEbitda: 5_000_000,
        implantSavings: -500_000,
        rebateValue: 0,
        growthImpact: 0,
        laborSavings: 0,
        throughputImpact: 0,
      },
      10,
    )
    expect(result.futureEbitda).toBeCloseTo(4_500_000, 2)
    expect(result.ev.incrementalEv).toBeCloseTo(-5_000_000, 2)
  })
})
