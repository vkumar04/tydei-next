import { describe, it, expect } from "vitest"
import { computeContractYears } from "@/lib/contracts/term-years"

describe("computeContractYears — calendar-month math", () => {
  it("Jan 1 → Dec 31 of same year → 1.0 years", () => {
    expect(computeContractYears("2024-01-01", "2024-12-31")).toBe(1)
  })

  it("Jan 1 → Dec 31 three years later → 3.0 years", () => {
    expect(computeContractYears("2024-01-01", "2026-12-31")).toBe(3)
  })

  it("Jan 1 → Nov 25 almost three years later → 2.917 years", () => {
    const y = computeContractYears("2024-01-01", "2026-11-25")
    expect(y).toBeCloseTo(35 / 12, 4)
  })

  it("Jan 1 → Jan 15 next year → 1.083 years (inclusive months)", () => {
    const y = computeContractYears("2024-01-01", "2025-01-15")
    expect(y).toBeCloseTo(13 / 12, 4)
  })

  it("floors at 1 for invalid / inverted ranges", () => {
    expect(computeContractYears("2024-12-31", "2024-01-01")).toBe(1)
    expect(computeContractYears("2024-01-01", "2024-01-01")).toBe(1)
  })

  it("returns 1 when either date is null / undefined / empty", () => {
    expect(computeContractYears(null, "2024-12-31")).toBe(1)
    expect(computeContractYears("2024-01-01", null)).toBe(1)
    expect(computeContractYears("", "2024-12-31")).toBe(1)
    expect(computeContractYears(undefined, undefined)).toBe(1)
  })

  it("accepts Date objects as well as ISO strings", () => {
    const eff = new Date(Date.UTC(2024, 0, 1))
    const exp = new Date(Date.UTC(2024, 11, 31))
    expect(computeContractYears(eff, exp)).toBe(1)
  })

  it("Charles's reported scenario: $5.3M / 1.0y = $5.3M clean (not $3.85M from ms math)", () => {
    const years = computeContractYears("2024-01-01", "2024-12-31")
    const annual = 5_300_000 / years
    expect(annual).toBe(5_300_000)
  })
})
