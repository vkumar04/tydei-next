import { describe, it, expect } from "vitest"
import { computeCapitalRetirementNeeded } from "@/lib/contracts/capital-retirement-needed"

describe("computeCapitalRetirementNeeded", () => {
  it("computes monthly + annual spend needed at current tier rate", () => {
    // Remaining capital: $100_000. 20 months left. Current tier rate: 5%.
    // Monthly needed = 100_000 / 20 = 5_000 rebate per month.
    // To earn $5_000 rebate at 5% → need $100_000 monthly spend. Annual: $1_200_000.
    const r = computeCapitalRetirementNeeded({
      capitalAmount: 200_000,
      rebatesApplied: 100_000,
      monthsRemaining: 20,
      rebatePercent: 5,
    })
    expect(r.remainingCapital).toBe(100_000)
    expect(r.monthlySpendNeeded).toBe(100_000)
    expect(r.annualSpendNeeded).toBe(1_200_000)
  })
  it("returns zero spend needed when capital fully retired", () => {
    const r = computeCapitalRetirementNeeded({
      capitalAmount: 100_000,
      rebatesApplied: 100_000,
      monthsRemaining: 12,
      rebatePercent: 5,
    })
    expect(r.annualSpendNeeded).toBe(0)
  })
  it("returns null when tier rate is zero (avoid /0)", () => {
    const r = computeCapitalRetirementNeeded({
      capitalAmount: 100_000,
      rebatesApplied: 0,
      monthsRemaining: 12,
      rebatePercent: 0,
    })
    expect(r.annualSpendNeeded).toBeNull()
  })
})
