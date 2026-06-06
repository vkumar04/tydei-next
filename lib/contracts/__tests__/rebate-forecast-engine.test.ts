import { describe, it, expect } from "vitest"
import { computeRebateForecast } from "@/lib/contracts/rebate-forecast-engine"

const months = (n: number): Map<string, number> => {
  const m = new Map<string, number>()
  for (let i = 1; i <= n; i++) {
    m.set(`2026-${String(i).padStart(2, "0")}`, 10_000)
  }
  return m
}

describe("computeRebateForecast — carve-out flat rate", () => {
  it("projects rebate at the flat effective rate for a carve-out contract", () => {
    const result = computeRebateForecast({
      monthlySpend: months(6),
      terms: [{ termType: "carve_out", tiers: [] }],
      carveOutEffectiveRate: 0.03,
      forecastMonths: 3,
    })

    expect(result.history.length).toBe(6)
    expect(result.forecast.length).toBe(3)
    for (const p of result.history) {
      expect(p.achievedTier).toBe(0)
      expect(p.achievedRatePct).toBe(3)
      expect(p.rebateForPeriod).toBeCloseTo(p.spend * 0.03, 2)
    }
    for (const p of result.forecast) {
      expect(p.rebateForPeriod).toBeGreaterThan(0)
      expect(p.achievedRatePct).toBe(3)
    }
  })

  it("ignores the flat rate and uses tiers when carveOutEffectiveRate is absent", () => {
    const result = computeRebateForecast({
      monthlySpend: months(6),
      terms: [
        {
          termType: "spend_rebate",
          tiers: [{ tierNumber: 1, spendMin: 0, rebateValue: 0.02 }],
        },
      ],
      forecastMonths: 3,
    })
    expect(result.history[0].achievedTier).toBe(1)
    expect(result.history[0].achievedRatePct).toBe(2)
  })
})
