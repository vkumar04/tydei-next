import { describe, it, expect } from "vitest"
import {
  buildMonthlySpendRebateTrend,
  type SpendRecord,
  type RebateRecord,
} from "../monthly-trend"

const ref = new Date("2026-04-15T00:00:00Z")

describe("buildMonthlySpendRebateTrend", () => {
  it("returns 12 zero-filled months for empty input", () => {
    const trend = buildMonthlySpendRebateTrend([], [], { referenceDate: ref })
    expect(trend).toHaveLength(12)
    // Oldest first: May 2025 → Apr 2026
    expect(trend[0].month).toBe("2025-05")
    expect(trend[11].month).toBe("2026-04")
    for (const p of trend) {
      expect(p.spend).toBe(0)
      expect(p.rebate).toBe(0)
    }
  })

  it("respects custom window size", () => {
    const trend = buildMonthlySpendRebateTrend([], [], {
      months: 3,
      referenceDate: ref,
    })
    expect(trend).toHaveLength(3)
    expect(trend.map((p) => p.month)).toEqual(["2026-02", "2026-03", "2026-04"])
  })

  it("buckets spend transactions by month", () => {
    const spend: SpendRecord[] = [
      {
        transactionDate: new Date("2026-03-05T00:00:00Z"),
        extendedPrice: 1000,
      },
      {
        transactionDate: new Date("2026-03-20T00:00:00Z"),
        extendedPrice: 500,
      },
      {
        transactionDate: new Date("2026-04-01T00:00:00Z"),
        extendedPrice: 250,
      },
    ]
    const trend = buildMonthlySpendRebateTrend(spend, [], {
      months: 3,
      referenceDate: ref,
    })
    expect(trend.find((p) => p.month === "2026-03")?.spend).toBe(1500)
    expect(trend.find((p) => p.month === "2026-04")?.spend).toBe(250)
    expect(trend.find((p) => p.month === "2026-02")?.spend).toBe(0)
  })

  it("buckets rebate rows by month", () => {
    const rebates: RebateRecord[] = [
      {
        periodEndDate: new Date("2026-03-31T00:00:00Z"),
        rebateEarned: 250,
      },
      {
        periodEndDate: new Date("2026-03-31T23:59:00Z"),
        rebateEarned: 100,
      },
    ]
    const trend = buildMonthlySpendRebateTrend([], rebates, {
      months: 3,
      referenceDate: ref,
    })
    expect(trend.find((p) => p.month === "2026-03")?.rebate).toBe(350)
  })

  it("drops rows outside the window silently", () => {
    const spend: SpendRecord[] = [
      {
        transactionDate: new Date("2023-01-01T00:00:00Z"),
        extendedPrice: 99_999,
      },
    ]
    const trend = buildMonthlySpendRebateTrend(spend, [], {
      months: 3,
      referenceDate: ref,
    })
    for (const p of trend) {
      expect(p.spend).toBe(0)
    }
  })

  it("handles mixed spend + rebate with overlapping month", () => {
    const spend: SpendRecord[] = [
      { transactionDate: new Date("2026-04-10T00:00:00Z"), extendedPrice: 500 },
    ]
    const rebates: RebateRecord[] = [
      {
        periodEndDate: new Date("2026-04-30T00:00:00Z"),
        rebateEarned: 20,
      },
    ]
    const trend = buildMonthlySpendRebateTrend(spend, rebates, {
      months: 2,
      referenceDate: ref,
    })
    const apr = trend.find((p) => p.month === "2026-04")!
    expect(apr.spend).toBe(500)
    expect(apr.rebate).toBe(20)
  })
})
