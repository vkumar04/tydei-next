import { describe, it, expect } from "vitest"
import { computeMinAnnualShortfall } from "@/lib/contracts/min-annual-shortfall"

describe("computeMinAnnualShortfall", () => {
  it("null floor → met", () => {
    const r = computeMinAnnualShortfall(100_000, null)
    expect(r).toEqual({ floor: null, spend: 100_000, gap: 0, met: true })
  })
  it("floor met", () => {
    const r = computeMinAnnualShortfall(500_000, 250_000)
    expect(r.gap).toBe(0)
    expect(r.met).toBe(true)
  })
  it("floor unmet", () => {
    const r = computeMinAnnualShortfall(150_000, 250_000)
    expect(r.gap).toBe(100_000)
    expect(r.met).toBe(false)
  })
})
