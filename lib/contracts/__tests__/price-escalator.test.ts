import { describe, it, expect } from "vitest"
import {
  escalatePrice,
  escalatePriceStep,
} from "@/lib/contracts/price-escalator"

describe("escalatePrice (roadmap track 10)", () => {
  it("no escalator → returns basePrice unchanged", () => {
    const r = escalatePrice({
      basePrice: 100,
      escalatorPercent: null,
      effectiveDate: new Date("2025-01-01"),
      asOf: new Date("2027-01-01"),
    })
    expect(r.escalatedPrice).toBe(100)
    expect(r.appliedRate).toBe(0)
  })

  it("no effectiveDate → returns basePrice unchanged", () => {
    const r = escalatePrice({
      basePrice: 100,
      escalatorPercent: 0.05,
      effectiveDate: null,
    })
    expect(r.escalatedPrice).toBe(100)
  })

  it("3% annual, 1 year elapsed → basePrice × 1.03", () => {
    const r = escalatePrice({
      basePrice: 100,
      escalatorPercent: 0.03,
      effectiveDate: new Date("2025-01-01T00:00:00Z"),
      asOf: new Date("2026-01-01T00:00:00Z"),
    })
    expect(r.yearsElapsed).toBeCloseTo(1, 2)
    expect(r.escalatedPrice).toBeCloseTo(103, 0)
  })

  it("3% annual, 5 years elapsed → compounds to ~115.93", () => {
    const r = escalatePrice({
      basePrice: 100,
      escalatorPercent: 0.03,
      effectiveDate: new Date("2020-01-01T00:00:00Z"),
      asOf: new Date("2025-01-01T00:00:00Z"),
    })
    expect(r.yearsElapsed).toBeCloseTo(5, 2)
    // 1.03^5 = 1.15927
    expect(r.escalatedPrice).toBeCloseTo(115.93, 1)
  })

  it("fractional years compound smoothly", () => {
    const r = escalatePrice({
      basePrice: 100,
      escalatorPercent: 0.03,
      effectiveDate: new Date("2025-01-01T00:00:00Z"),
      asOf: new Date("2025-07-01T00:00:00Z"),
    })
    // Half year → ~1.015
    expect(r.escalatedPrice).toBeGreaterThan(100)
    expect(r.escalatedPrice).toBeLessThan(103)
  })

  it("negative elapsed (asOf before effective) → basePrice", () => {
    const r = escalatePrice({
      basePrice: 100,
      escalatorPercent: 0.03,
      effectiveDate: new Date("2026-01-01"),
      asOf: new Date("2025-01-01"),
    })
    expect(r.yearsElapsed).toBe(0)
    expect(r.escalatedPrice).toBe(100)
  })

  it("zero / negative rate treated as no escalator", () => {
    expect(
      escalatePrice({
        basePrice: 100,
        escalatorPercent: 0,
        effectiveDate: new Date("2020-01-01"),
      }).escalatedPrice,
    ).toBe(100)
    expect(
      escalatePrice({
        basePrice: 100,
        escalatorPercent: -0.05,
        effectiveDate: new Date("2020-01-01"),
      }).escalatedPrice,
    ).toBe(100)
  })
})

describe("escalatePriceStep", () => {
  it("steps only on anniversary", () => {
    const r = escalatePriceStep({
      basePrice: 100,
      escalatorPercent: 0.03,
      effectiveDate: new Date("2025-01-01T00:00:00Z"),
      asOf: new Date("2025-07-01T00:00:00Z"), // half year
    })
    // No anniversary yet → no step.
    expect(r.escalatedPrice).toBe(100)
    expect(r.yearsElapsed).toBe(0)
  })

  it("steps up at each anniversary", () => {
    const after2y = escalatePriceStep({
      basePrice: 100,
      escalatorPercent: 0.03,
      effectiveDate: new Date("2023-01-01T00:00:00Z"),
      asOf: new Date("2025-06-01T00:00:00Z"), // 2.4 years
    })
    expect(after2y.yearsElapsed).toBe(2)
    // 1.03^2 = 1.0609
    expect(after2y.escalatedPrice).toBeCloseTo(106.09, 1)
  })
})
