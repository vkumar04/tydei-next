import { describe, it, expect } from "vitest"
import { computePaybackAnalysis } from "../payback-analysis"

describe("computePaybackAnalysis — Charles example", () => {
  const r = computePaybackAnalysis({
    investmentCost: 1_800_000,
    expectedAnnualBenefit: 650_000,
  })

  const byName = (name: string) =>
    r.scenarios.find((s) => s.scenario === name)!

  it("expected payback = cost / benefit rounded to 0.1 (≈ 2.8)", () => {
    expect(byName("expected").paybackYears).toBeCloseTo(2.8, 5)
  })

  it("conservative > expected > aggressive", () => {
    const cons = byName("conservative").paybackYears!
    const exp = byName("expected").paybackYears!
    const agg = byName("aggressive").paybackYears!
    expect(cons).toBeGreaterThan(exp)
    expect(exp).toBeGreaterThan(agg)
  })

  it("investmentCost is echoed back", () => {
    expect(r.investmentCost).toBe(1_800_000)
  })

  it("has three named scenarios", () => {
    expect(r.scenarios.map((s) => s.scenario)).toEqual([
      "conservative",
      "expected",
      "aggressive",
    ])
  })
})

describe("computePaybackAnalysis — rounding", () => {
  it("expected payback rounds to one decimal place", () => {
    const r = computePaybackAnalysis({
      investmentCost: 1_000_000,
      expectedAnnualBenefit: 300_000,
    })
    // 3.333... → 3.3
    expect(
      r.scenarios.find((s) => s.scenario === "expected")!.paybackYears,
    ).toBeCloseTo(3.3, 5)
  })
})

describe("computePaybackAnalysis — zero / negative benefit", () => {
  it("zero annual benefit → all paybackYears null", () => {
    const r = computePaybackAnalysis({
      investmentCost: 1_800_000,
      expectedAnnualBenefit: 0,
    })
    for (const s of r.scenarios) {
      expect(s.paybackYears).toBeNull()
    }
  })

  it("negative annual benefit → all paybackYears null", () => {
    const r = computePaybackAnalysis({
      investmentCost: 1_800_000,
      expectedAnnualBenefit: -100_000,
    })
    for (const s of r.scenarios) {
      expect(s.paybackYears).toBeNull()
    }
  })
})
