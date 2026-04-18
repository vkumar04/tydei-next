import { describe, expect, it } from "vitest"

import {
  MACRS_5Y_HALF_YEAR,
  buildMacrsSchedule,
} from "@/lib/financial-analysis/macrs"

describe("buildMacrsSchedule", () => {
  it("returns 6 entries for any capital cost", () => {
    const schedule = buildMacrsSchedule({ capitalCost: 100_000, taxRate: 0.21 })
    expect(schedule).toHaveLength(6)
    expect(schedule.map((s) => s.year)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it("uses IRS Table A-1 percentages (5-year property, half-year convention)", () => {
    const schedule = buildMacrsSchedule({ capitalCost: 100_000, taxRate: 0.21 })
    const pcts = schedule.map((s) => s.depreciationPercent)
    expect(pcts).toEqual([0.2, 0.32, 0.192, 0.1152, 0.1152, 0.0576])
  })

  it("percentages sum to 1.0 (full depreciation by end of year 6)", () => {
    const sum = MACRS_5Y_HALF_YEAR.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0, 10)
  })

  it("$100K, 21% tax → year 1 depreciation = $20K and tax savings = $4,200", () => {
    const schedule = buildMacrsSchedule({ capitalCost: 100_000, taxRate: 0.21 })
    const y1 = schedule[0]
    expect(y1).toBeDefined()
    expect(y1!.depreciationAmount).toBeCloseTo(20_000, 6)
    expect(y1!.taxSavings).toBeCloseTo(4_200, 6)
  })

  it("cumulative depreciation reaches capital cost at year 6 and book value is 0", () => {
    const schedule = buildMacrsSchedule({ capitalCost: 100_000, taxRate: 0.21 })
    const y6 = schedule[5]
    expect(y6).toBeDefined()
    expect(y6!.cumulativeDepreciation).toBeCloseTo(100_000, 6)
    expect(y6!.bookValue).toBeCloseTo(0, 6)
  })

  it("cumulative depreciation is monotonic non-decreasing", () => {
    const schedule = buildMacrsSchedule({ capitalCost: 250_000, taxRate: 0.25 })
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]!.cumulativeDepreciation).toBeGreaterThanOrEqual(
        schedule[i - 1]!.cumulativeDepreciation,
      )
    }
  })

  it("zero capital cost → all zero amounts", () => {
    const schedule = buildMacrsSchedule({ capitalCost: 0, taxRate: 0.21 })
    expect(schedule).toHaveLength(6)
    for (const entry of schedule) {
      expect(entry.depreciationAmount).toBe(0)
      expect(entry.cumulativeDepreciation).toBe(0)
      expect(entry.bookValue).toBe(0)
      expect(entry.taxSavings).toBe(0)
    }
  })

  it("zero tax rate → zero tax savings regardless of depreciation", () => {
    const schedule = buildMacrsSchedule({ capitalCost: 100_000, taxRate: 0 })
    for (const entry of schedule) {
      expect(entry.taxSavings).toBe(0)
    }
    expect(schedule[0]!.depreciationAmount).toBeCloseTo(20_000, 6)
  })
})
