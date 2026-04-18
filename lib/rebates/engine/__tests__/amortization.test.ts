import { describe, it, expect } from "vitest"
import { buildTieInAmortizationSchedule } from "../amortization"

describe("buildTieInAmortizationSchedule — zero interest", () => {
  it("$100K, 0% interest, 12 months, monthly → 12 entries, ~$8333.33 pmt, zero interest", () => {
    const schedule = buildTieInAmortizationSchedule({
      capitalCost: 100_000,
      interestRate: 0,
      termMonths: 12,
      period: "monthly",
    })

    expect(schedule).toHaveLength(12)

    for (const entry of schedule) {
      expect(entry.interestCharge).toBe(0)
      expect(entry.amortizationDue).toBeCloseTo(8333.333333, 4)
      expect(entry.principalDue).toBeCloseTo(8333.333333, 4)
    }

    // Sum of principal ≈ capitalCost and final closing balance ≈ 0.
    const totalPrincipal = schedule.reduce((acc, e) => acc + e.principalDue, 0)
    expect(totalPrincipal).toBeCloseTo(100_000, 6)
    expect(schedule[schedule.length - 1]!.closingBalance).toBeCloseTo(0, 6)
  })
})

describe("buildTieInAmortizationSchedule — monthly with interest", () => {
  it("$100K, 5% interest, 36 months, monthly → 36 entries; final closingBalance ≈ 0", () => {
    const schedule = buildTieInAmortizationSchedule({
      capitalCost: 100_000,
      interestRate: 0.05,
      termMonths: 36,
      period: "monthly",
    })

    expect(schedule).toHaveLength(36)
    // Period 1 openingBalance must equal capitalCost exactly.
    expect(schedule[0]!.openingBalance).toBe(100_000)
    // Known PMT for 100K @ 5%/yr over 36 monthly periods ≈ $2997.09.
    expect(schedule[0]!.amortizationDue).toBeCloseTo(2997.09, 1)
    // Sum of principalDue across all periods ≈ capitalCost.
    const totalPrincipal = schedule.reduce((acc, e) => acc + e.principalDue, 0)
    expect(totalPrincipal).toBeCloseTo(100_000, 4)
    // Final closing balance ≈ 0 (floating-point tolerance).
    expect(schedule[schedule.length - 1]!.closingBalance).toBeCloseTo(0, 4)
  })
})

describe("buildTieInAmortizationSchedule — quarterly cadence", () => {
  it("$250K, 5% interest, 36 months, quarterly → 12 quarterly entries", () => {
    const schedule = buildTieInAmortizationSchedule({
      capitalCost: 250_000,
      interestRate: 0.05,
      termMonths: 36,
      period: "quarterly",
    })

    expect(schedule).toHaveLength(12)
    expect(schedule[0]!.openingBalance).toBe(250_000)
    // Each row should have consistent amortizationDue (fixed payment per PMT).
    const pmt = schedule[0]!.amortizationDue
    for (const entry of schedule) {
      expect(entry.amortizationDue).toBeCloseTo(pmt, 6)
    }
    // Sum of principal ≈ capitalCost.
    const totalPrincipal = schedule.reduce((acc, e) => acc + e.principalDue, 0)
    expect(totalPrincipal).toBeCloseTo(250_000, 4)
    expect(schedule[schedule.length - 1]!.closingBalance).toBeCloseTo(0, 4)
  })
})

describe("buildTieInAmortizationSchedule — annual cadence", () => {
  it("$500K, 6% interest, 60 months, annual → 5 annual entries", () => {
    const schedule = buildTieInAmortizationSchedule({
      capitalCost: 500_000,
      interestRate: 0.06,
      termMonths: 60,
      period: "annual",
    })

    expect(schedule).toHaveLength(5)
    expect(schedule[0]!.openingBalance).toBe(500_000)
    // First-period interest = P × r = 500000 × 0.06 = 30000.
    expect(schedule[0]!.interestCharge).toBeCloseTo(30_000, 6)
    const totalPrincipal = schedule.reduce((acc, e) => acc + e.principalDue, 0)
    expect(totalPrincipal).toBeCloseTo(500_000, 4)
    expect(schedule[schedule.length - 1]!.closingBalance).toBeCloseTo(0, 4)
  })
})

describe("buildTieInAmortizationSchedule — invariants", () => {
  it("periodNumber is 1-indexed and increments by 1", () => {
    const schedule = buildTieInAmortizationSchedule({
      capitalCost: 100_000,
      interestRate: 0.04,
      termMonths: 24,
      period: "monthly",
    })

    for (let i = 0; i < schedule.length; i += 1) {
      expect(schedule[i]!.periodNumber).toBe(i + 1)
    }
  })

  it("each period closingBalance becomes next period openingBalance", () => {
    const schedule = buildTieInAmortizationSchedule({
      capitalCost: 100_000,
      interestRate: 0.04,
      termMonths: 24,
      period: "monthly",
    })

    for (let i = 1; i < schedule.length; i += 1) {
      expect(schedule[i]!.openingBalance).toBeCloseTo(
        schedule[i - 1]!.closingBalance,
        10,
      )
    }
  })

  it("returns an empty schedule when capitalCost is 0", () => {
    const schedule = buildTieInAmortizationSchedule({
      capitalCost: 0,
      interestRate: 0.05,
      termMonths: 12,
      period: "monthly",
    })

    expect(schedule).toEqual([])
  })
})
