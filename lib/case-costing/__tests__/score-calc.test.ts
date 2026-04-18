import { describe, it, expect } from "vitest"
import { calculateSurgeonScores, calculateMargin } from "../score-calc"

describe("calculateSurgeonScores", () => {
  it("payorMixScore = (commercial / total) × 100", () => {
    const r = calculateSurgeonScores({
      commercialOrPrivatePayors: 7,
      totalPayors: 10,
      avgSpendPerCase: 0,
    })
    expect(r.payorMixScore).toBe(70)
  })

  it("returns 0 payor mix score when totalPayors = 0", () => {
    const r = calculateSurgeonScores({
      commercialOrPrivatePayors: 0,
      totalPayors: 0,
      avgSpendPerCase: 1000,
    })
    expect(r.payorMixScore).toBe(0)
  })

  it("spendScore = clamp(100 - avg/500, 0, 100)", () => {
    // avg 20_000 → 100 - 40 = 60
    const r1 = calculateSurgeonScores({
      commercialOrPrivatePayors: 0,
      totalPayors: 1,
      avgSpendPerCase: 20_000,
    })
    expect(r1.spendScore).toBe(60)

    // avg 100_000 → 100 - 200 = clamp to 0
    const r2 = calculateSurgeonScores({
      commercialOrPrivatePayors: 0,
      totalPayors: 1,
      avgSpendPerCase: 100_000,
    })
    expect(r2.spendScore).toBe(0)

    // avg 0 → clamp to 100
    const r3 = calculateSurgeonScores({
      commercialOrPrivatePayors: 0,
      totalPayors: 1,
      avgSpendPerCase: 0,
    })
    expect(r3.spendScore).toBe(100)
  })

  it("overallScore = round((payorMix + spend) / 2)", () => {
    // payorMix=70, spend=60 → (70+60)/2 = 65
    const r = calculateSurgeonScores({
      commercialOrPrivatePayors: 7,
      totalPayors: 10,
      avgSpendPerCase: 20_000,
    })
    expect(r.overallScore).toBe(65)
  })

  it("color ≥75 → green", () => {
    const r = calculateSurgeonScores({
      commercialOrPrivatePayors: 9,
      totalPayors: 10,
      avgSpendPerCase: 10_000,
    })
    // payorMix=90, spend=80, overall=85 → green
    expect(r.color).toBe("green")
    expect(r.overallScore).toBeGreaterThanOrEqual(75)
  })

  it("color ≥50 and <75 → amber", () => {
    // payorMix=60, spend=60, overall=60 → amber
    const r = calculateSurgeonScores({
      commercialOrPrivatePayors: 6,
      totalPayors: 10,
      avgSpendPerCase: 20_000,
    })
    expect(r.color).toBe("amber")
  })

  it("color <50 → red", () => {
    // payorMix=10, spend=0, overall=5 → red
    const r = calculateSurgeonScores({
      commercialOrPrivatePayors: 1,
      totalPayors: 10,
      avgSpendPerCase: 100_000,
    })
    expect(r.color).toBe("red")
  })

  it("boundary at 75 is green (inclusive)", () => {
    // Need overall=75. payorMix=100, spend=50 → avg 50? (100+50)/2=75.
    // spend=50 requires avg = 500 × 50 = 25_000
    const r = calculateSurgeonScores({
      commercialOrPrivatePayors: 10,
      totalPayors: 10,
      avgSpendPerCase: 25_000,
    })
    expect(r.overallScore).toBe(75)
    expect(r.color).toBe("green")
  })
})

describe("calculateMargin", () => {
  it("computes gross margin + percent", () => {
    const r = calculateMargin({
      totalSpend: 6_000,
      totalReimbursement: 10_000,
    })
    expect(r.grossMargin).toBe(4_000)
    expect(r.marginPct).toBe(40)
  })

  it("trend UP when marginPct >= 30", () => {
    const r = calculateMargin({ totalSpend: 70, totalReimbursement: 100 })
    expect(r.marginPct).toBe(30)
    expect(r.trend).toBe("UP")
  })

  it("trend DOWN when marginPct < 30", () => {
    const r = calculateMargin({ totalSpend: 75, totalReimbursement: 100 })
    expect(r.marginPct).toBe(25)
    expect(r.trend).toBe("DOWN")
  })

  it("safe with zero reimbursement (no NaN)", () => {
    const r = calculateMargin({ totalSpend: 1_000, totalReimbursement: 0 })
    expect(r.grossMargin).toBe(-1_000)
    expect(r.marginPct).toBe(0)
    expect(r.trend).toBe("DOWN")
  })

  it("negative margin when spend exceeds reimbursement", () => {
    const r = calculateMargin({
      totalSpend: 5_000,
      totalReimbursement: 4_000,
    })
    expect(r.grossMargin).toBe(-1_000)
    expect(r.marginPct).toBe(-25)
    expect(r.trend).toBe("DOWN")
  })
})
