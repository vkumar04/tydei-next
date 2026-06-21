import { describe, it, expect } from "vitest"
import {
  computeConversionTargets,
  type ConversionCategoryInput,
} from "../conversion-targets"

const CATEGORIES: ConversionCategoryInput[] = [
  {
    category: "Sports Medicine",
    savingsOpportunity: 680_000,
    volumeSharePct: 0.35,
    aboveBenchmarkAsp: true,
  },
  { category: "Total Joints", savingsOpportunity: 220_000, volumeSharePct: 0.4 },
  { category: "Trauma", savingsOpportunity: 100_000, volumeSharePct: 0.25 },
]

describe("computeConversionTargets — empty / zero input", () => {
  it("empty input → headline null, no targets", () => {
    const r = computeConversionTargets([])
    expect(r.headline).toBeNull()
    expect(r.targets).toEqual([])
    expect(r.totalBenefit).toBe(0)
  })

  it("all-zero savings → headline null, no targets", () => {
    const r = computeConversionTargets([
      { category: "A", savingsOpportunity: 0, volumeSharePct: 0.5 },
      { category: "B", savingsOpportunity: 0, volumeSharePct: 0.5 },
    ])
    expect(r.headline).toBeNull()
    expect(r.targets).toEqual([])
    expect(r.totalBenefit).toBe(0)
  })
})

describe("computeConversionTargets — ranking + shares", () => {
  const r = computeConversionTargets(CATEGORIES)

  it("headline is a non-empty string", () => {
    expect(typeof r.headline).toBe("string")
    expect(r.headline!.length).toBeGreaterThan(0)
  })

  it("targets sorted descending by savingsOpportunity", () => {
    const vals = r.targets.map((t) => t.savingsOpportunity)
    const sorted = [...vals].sort((a, b) => b - a)
    expect(vals).toEqual(sorted)
  })

  it("pctOfTotalBenefit sums to ~1", () => {
    const sum = r.targets.reduce((s, t) => s + t.pctOfTotalBenefit, 0)
    expect(sum).toBeCloseTo(1, 6)
  })

  it("cumulativeBenefitPct is monotonic up to ~1", () => {
    for (let i = 1; i < r.targets.length; i++) {
      expect(r.targets[i]!.cumulativeBenefitPct).toBeGreaterThanOrEqual(
        r.targets[i - 1]!.cumulativeBenefitPct,
      )
    }
    expect(r.targets[r.targets.length - 1]!.cumulativeBenefitPct).toBeCloseTo(
      1,
      6,
    )
  })

  it("totalBenefit is the sum of positive savings", () => {
    expect(r.totalBenefit).toBeCloseTo(1_000_000, 2)
  })

  it("excludes non-positive savings from targets but keeps them out of totalBenefit too", () => {
    const r2 = computeConversionTargets([
      { category: "A", savingsOpportunity: 500, volumeSharePct: 0.5 },
      { category: "B", savingsOpportunity: -100, volumeSharePct: 0.5 },
    ])
    expect(r2.targets.map((t) => t.category)).toEqual(["A"])
    expect(r2.totalBenefit).toBeCloseTo(500, 5)
  })
})
