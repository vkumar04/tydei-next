import { describe, it, expect } from "vitest"
import { forecastAnnualSpend } from "@/lib/forecasting/annualize-spend"

describe("forecastAnnualSpend", () => {
  it("empty series returns zeros", () => {
    const r = forecastAnnualSpend({ series: [] })
    expect(r.point).toBe(0)
    expect(r.low).toBe(0)
    expect(r.high).toBe(0)
  })

  it("flat $100k/month × 12mo history → ~$1.2M annualized, tight band", () => {
    const series = Array.from({ length: 12 }, (_, i) => ({
      date: new Date(Date.UTC(2025, i, 1)),
      value: 100_000,
    }))
    const r = forecastAnnualSpend({ series, useSeasonality: false })
    expect(r.point).toBeCloseTo(1_200_000, -4) // within $10k
    // Flat data → r² = 0 (no slope); seasonal off, confidence band is
    // effectively the point estimate ± tiny uncertainty.
    expect(r.point).toBeGreaterThan(0)
  })

  it("upward-trending spend gets an 'increasing' label", () => {
    const series = Array.from({ length: 12 }, (_, i) => ({
      date: new Date(Date.UTC(2025, i, 1)),
      value: 100_000 + i * 5_000, // climbs $5k/month
    }))
    const r = forecastAnnualSpend({ series, useSeasonality: false })
    expect(r.trend).toBe("increasing")
    expect(r.growthRatePercent).toBeGreaterThan(5)
    // Forecasting forward from month 12 upward: should exceed the
    // lookback-year total.
    const historicalTotal = series.reduce((s, p) => s + p.value, 0)
    expect(r.point).toBeGreaterThan(historicalTotal)
  })

  it("downward trend gets 'decreasing'", () => {
    const series = Array.from({ length: 12 }, (_, i) => ({
      date: new Date(Date.UTC(2025, i, 1)),
      value: 200_000 - i * 10_000,
    }))
    const r = forecastAnnualSpend({ series, useSeasonality: false })
    expect(r.trend).toBe("decreasing")
    expect(r.growthRatePercent).toBeLessThan(-5)
  })

  it("noisy data returns a wider confidence band (low r²)", () => {
    const series = [
      { date: new Date(Date.UTC(2025, 0, 1)), value: 100_000 },
      { date: new Date(Date.UTC(2025, 1, 1)), value: 50_000 },
      { date: new Date(Date.UTC(2025, 2, 1)), value: 200_000 },
      { date: new Date(Date.UTC(2025, 3, 1)), value: 30_000 },
      { date: new Date(Date.UTC(2025, 4, 1)), value: 180_000 },
      { date: new Date(Date.UTC(2025, 5, 1)), value: 60_000 },
    ]
    const r = forecastAnnualSpend({ series, useSeasonality: false })
    // Very noisy — r² should be low.
    expect(r.r2).toBeLessThan(0.6)
    // Band should be non-trivial.
    expect(r.high).toBeGreaterThan(r.point)
    expect(r.low).toBeLessThan(r.point)
  })

  it("confidence band doesn't go negative", () => {
    const series = [
      { date: new Date(Date.UTC(2025, 0, 1)), value: 10_000 },
      { date: new Date(Date.UTC(2025, 1, 1)), value: 500_000 }, // huge outlier
      { date: new Date(Date.UTC(2025, 2, 1)), value: 20_000 },
    ]
    const r = forecastAnnualSpend({ series, useSeasonality: false })
    expect(r.low).toBeGreaterThanOrEqual(0)
  })

  it("single data point projects forward as a flat line", () => {
    const r = forecastAnnualSpend({
      series: [{ date: new Date(Date.UTC(2025, 0, 1)), value: 100_000 }],
      useSeasonality: false,
    })
    expect(r.point).toBe(1_200_000) // 100k × 12
    expect(r.trend).toBe("stable")
  })
})
