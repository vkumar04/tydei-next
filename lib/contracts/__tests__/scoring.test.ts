import { describe, it, expect } from "vitest"
import {
  calculateContractScore,
  type ContractScoringInput,
} from "../scoring"

// Baseline "perfect" contract — every component maxed.
const perfect: ContractScoringInput = {
  commitmentMet: 100,
  complianceRate: 100,
  rebatesEarned: 100_000, // 10% of contract value => rebateEfficiency = 100
  totalContractValue: 1_000_000,
  daysUntilExpiration: 365,
  majorVarianceCount: 0,
  totalVarianceCount: 0,
}

describe("calculateContractScore — perfect contract", () => {
  it("scores ~100 with band A when every component is maxed", () => {
    const result = calculateContractScore(perfect)
    expect(result.overallScore).toBe(100)
    expect(result.band).toBe("A")
    expect(result.components).toEqual({
      commitmentScore: 100,
      complianceScore: 100,
      rebateEfficiencyScore: 100,
      timelinessScore: 100,
      varianceScore: 100,
      priceCompetitivenessScore: 100,
    })
  })
})

describe("calculateContractScore — timeliness tiers", () => {
  it("expired contract (negative days) has timelinessScore 0", () => {
    const result = calculateContractScore({
      ...perfect,
      daysUntilExpiration: -10,
    })
    expect(result.components.timelinessScore).toBe(0)
    // 100*0.20 + 100*0.20 + 100*0.20 + 0*0.15 + 100*0.15 + 100*0.10 = 85
    expect(result.overallScore).toBeCloseTo(85, 10)
    expect(result.band).toBe("B")
  })

  it("0-29 days remaining => timelinessScore 30", () => {
    const result = calculateContractScore({ ...perfect, daysUntilExpiration: 5 })
    expect(result.components.timelinessScore).toBe(30)
  })

  it("30-89 days => timelinessScore 60", () => {
    const result = calculateContractScore({ ...perfect, daysUntilExpiration: 45 })
    expect(result.components.timelinessScore).toBe(60)
  })

  it("90-179 days => timelinessScore 85", () => {
    const result = calculateContractScore({ ...perfect, daysUntilExpiration: 120 })
    expect(result.components.timelinessScore).toBe(85)
  })

  it(">=180 days => timelinessScore 100", () => {
    const result = calculateContractScore({ ...perfect, daysUntilExpiration: 180 })
    expect(result.components.timelinessScore).toBe(100)
  })
})

describe("calculateContractScore — component clamping", () => {
  it("zero commitment => commitmentScore 0", () => {
    const result = calculateContractScore({ ...perfect, commitmentMet: 0 })
    expect(result.components.commitmentScore).toBe(0)
  })

  it("commitmentMet above 100 clamps to 100", () => {
    const result = calculateContractScore({ ...perfect, commitmentMet: 150 })
    expect(result.components.commitmentScore).toBe(100)
  })

  it("negative complianceRate clamps to 0", () => {
    const result = calculateContractScore({ ...perfect, complianceRate: -20 })
    expect(result.components.complianceScore).toBe(0)
  })
})

describe("calculateContractScore — rebate efficiency", () => {
  it("10% rebate ratio => rebateEfficiencyScore 100", () => {
    const result = calculateContractScore({
      ...perfect,
      rebatesEarned: 100,
      totalContractValue: 1_000,
    })
    expect(result.components.rebateEfficiencyScore).toBe(100)
  })

  it("1% rebate ratio => rebateEfficiencyScore 10", () => {
    const result = calculateContractScore({
      ...perfect,
      rebatesEarned: 10,
      totalContractValue: 1_000,
    })
    expect(result.components.rebateEfficiencyScore).toBeCloseTo(10, 10)
  })

  it("rebate beyond 10% still clamps to 100", () => {
    const result = calculateContractScore({
      ...perfect,
      rebatesEarned: 500_000, // 50%
      totalContractValue: 1_000_000,
    })
    expect(result.components.rebateEfficiencyScore).toBe(100)
  })

  it("zero totalContractValue => rebateEfficiencyScore 0 (safe division)", () => {
    const result = calculateContractScore({
      ...perfect,
      rebatesEarned: 10_000,
      totalContractValue: 0,
    })
    expect(result.components.rebateEfficiencyScore).toBe(0)
  })
})

describe("calculateContractScore — variance scoring", () => {
  it("null variance counts => varianceScore 100", () => {
    const result = calculateContractScore({
      ...perfect,
      majorVarianceCount: null,
      totalVarianceCount: null,
    })
    expect(result.components.varianceScore).toBe(100)
  })

  it("undefined variance counts => varianceScore 100", () => {
    const input: ContractScoringInput = {
      commitmentMet: 100,
      complianceRate: 100,
      rebatesEarned: 100_000,
      totalContractValue: 1_000_000,
      daysUntilExpiration: 365,
    }
    const result = calculateContractScore(input)
    expect(result.components.varianceScore).toBe(100)
  })

  it("half of variances major => varianceScore 50", () => {
    const result = calculateContractScore({
      ...perfect,
      majorVarianceCount: 5,
      totalVarianceCount: 10,
    })
    expect(result.components.varianceScore).toBeCloseTo(50, 10)
  })

  it("majorVarianceCount > totalVarianceCount clamps to 0", () => {
    const result = calculateContractScore({
      ...perfect,
      majorVarianceCount: 20,
      totalVarianceCount: 5,
    })
    expect(result.components.varianceScore).toBe(0)
  })

  it("zero total variances => perfect varianceScore", () => {
    const result = calculateContractScore({
      ...perfect,
      majorVarianceCount: 0,
      totalVarianceCount: 0,
    })
    expect(result.components.varianceScore).toBe(100)
  })
})

describe("calculateContractScore — price competitiveness (6th dim)", () => {
  it("returns 100 priceCompetitivenessScore when no variance data", () => {
    const r = calculateContractScore({
      commitmentMet: 80,
      complianceRate: 80,
      rebatesEarned: 1000,
      totalContractValue: 10000,
      daysUntilExpiration: 365,
      majorVarianceCount: 0,
      totalVarianceCount: 0,
    })
    expect(r.components.priceCompetitivenessScore).toBe(100)
  })

  it("clamps priceCompetitivenessScore to 0-100 even on heavy overcharge", () => {
    const r = calculateContractScore({
      commitmentMet: 80,
      complianceRate: 80,
      rebatesEarned: 1000,
      totalContractValue: 10000,
      daysUntilExpiration: 365,
      majorVarianceCount: 5,
      totalVarianceCount: 5,
      averageVariancePercent: 200,
    })
    expect(r.components.priceCompetitivenessScore).toBe(0)
  })

  it("penalizes proportionally for variance", () => {
    const r = calculateContractScore({
      commitmentMet: 80,
      complianceRate: 80,
      rebatesEarned: 1000,
      totalContractValue: 10000,
      daysUntilExpiration: 365,
      majorVarianceCount: 1,
      totalVarianceCount: 3,
      averageVariancePercent: 25,
    })
    expect(r.components.priceCompetitivenessScore).toBe(75)
  })
})

describe("calculateContractScore — weighted overall + clamping", () => {
  it("weighted overall equals exact sum of weighted components", () => {
    const input: ContractScoringInput = {
      commitmentMet: 80,
      complianceRate: 70,
      rebatesEarned: 20,
      totalContractValue: 1_000, // 2% => rebateEff 20
      daysUntilExpiration: 100, // timeliness 85
      majorVarianceCount: 2,
      totalVarianceCount: 10, // variance 80
    }
    const result = calculateContractScore(input)
    // 80*.20 + 70*.20 + 20*.20 + 85*.15 + 80*.15 + 100*.10
    // = 16 + 14 + 4 + 12.75 + 12 + 10 = 68.75
    expect(result.overallScore).toBeCloseTo(68.75, 10)
    expect(result.band).toBe("D")
  })

  it("overall score clamps to 0-100 even when inputs are wild", () => {
    const result = calculateContractScore({
      commitmentMet: 500,
      complianceRate: 500,
      rebatesEarned: 1_000_000,
      totalContractValue: 1_000_000,
      daysUntilExpiration: 1000,
      majorVarianceCount: 0,
      totalVarianceCount: 0,
    })
    expect(result.overallScore).toBeLessThanOrEqual(100)
    expect(result.overallScore).toBeGreaterThanOrEqual(0)
    expect(result.overallScore).toBe(100)
  })

  it("wholly negative / zero inputs bottom out at 0", () => {
    const result = calculateContractScore({
      commitmentMet: 0,
      complianceRate: 0,
      rebatesEarned: 0,
      totalContractValue: 0,
      daysUntilExpiration: -100,
      majorVarianceCount: 10,
      totalVarianceCount: 10, // varianceScore 0
      averageVariancePercent: 200, // priceCompetitivenessScore 0
    })
    expect(result.overallScore).toBe(0)
    expect(result.band).toBe("F")
  })
})

describe("calculateContractScore — band boundaries", () => {
  // Band is driven by overallScore alone — we construct inputs to land on
  // exact targets. Hold rebate/timeliness/variance at 100 (contribution =
  // 20 + 15 + 15 = 50) and fill the remaining (target - 50) from three
  // arbitrary-precision levers in capacity order: commitment (0.20),
  // compliance (0.20), priceComp (0.10). Total capacity = 50, so the
  // helper supports any target in [50, 100]. priceCompetitivenessScore
  // is derived from averageVariancePercent with full precision, making
  // it a clean fine-tuner.
  function inputForOverall(target: number): ContractScoringInput {
    let remaining = target - 50 // from commit + comp + priceComp

    const commitmentContrib = Math.min(20, Math.max(0, remaining))
    remaining -= commitmentContrib
    const complianceContrib = Math.min(20, Math.max(0, remaining))
    remaining -= complianceContrib
    const priceCompContrib = Math.min(10, Math.max(0, remaining))

    const commitmentMet = commitmentContrib / 0.2
    const complianceRate = complianceContrib / 0.2
    const priceCompScore = priceCompContrib / 0.1 // 0-100 target
    const averageVariancePercent = 100 - priceCompScore

    return {
      commitmentMet,
      complianceRate,
      rebatesEarned: 100_000,
      totalContractValue: 1_000_000,
      daysUntilExpiration: 365,
      majorVarianceCount: 0,
      totalVarianceCount: 0,
      averageVariancePercent,
    }
  }

  it("exactly 90 => A", () => {
    const r = calculateContractScore(inputForOverall(90))
    expect(r.overallScore).toBeCloseTo(90, 10)
    expect(r.band).toBe("A")
  })

  it("89.9 => B", () => {
    const r = calculateContractScore(inputForOverall(89.9))
    expect(r.overallScore).toBeCloseTo(89.9, 10)
    expect(r.band).toBe("B")
  })

  it("exactly 80 => B", () => {
    const r = calculateContractScore(inputForOverall(80))
    expect(r.band).toBe("B")
  })

  it("79.999 => C", () => {
    const r = calculateContractScore(inputForOverall(79.999))
    expect(r.band).toBe("C")
  })

  it("exactly 70 => C", () => {
    const r = calculateContractScore(inputForOverall(70))
    expect(r.band).toBe("C")
  })

  it("exactly 60 => D", () => {
    const r = calculateContractScore(inputForOverall(60))
    expect(r.band).toBe("D")
  })

  it("59.9 => F", () => {
    const r = calculateContractScore(inputForOverall(59.9))
    expect(r.band).toBe("F")
  })
})
