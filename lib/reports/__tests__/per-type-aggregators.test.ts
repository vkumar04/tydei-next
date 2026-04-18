import { describe, it, expect } from "vitest"
import {
  buildUsageReport,
  buildServiceReport,
  buildTieInReport,
  buildCapitalReport,
  buildGroupedReport,
  buildPricingOnlyReport,
  type UsagePeriodInput,
  type ServicePeriodInput,
  type TieInPeriodInput,
  type CapitalPeriodInput,
  type GroupedPeriodInput,
  type PricingOnlyItem,
} from "../per-type-aggregators"

// ---------------------------------------------------------------------------
// Usage Report
// ---------------------------------------------------------------------------

describe("buildUsageReport", () => {
  it("computes rebateRate and collectionRate on happy path", () => {
    const input: UsagePeriodInput[] = [
      {
        period: "2026-01",
        spend: 10_000,
        volume: 200,
        rebateEarned: 500,
        rebateCollected: 250,
      },
    ]
    const [row] = buildUsageReport(input)
    expect(row.rebateRate).toBeCloseTo(5)
    expect(row.collectionRate).toBeCloseTo(50)
    expect(row.period).toBe("2026-01")
    expect(row.volume).toBe(200)
  })

  it("returns 0 rates when spend and rebateEarned are zero", () => {
    const input: UsagePeriodInput[] = [
      {
        period: "2026-02",
        spend: 0,
        volume: 0,
        rebateEarned: 0,
        rebateCollected: 0,
      },
    ]
    const [row] = buildUsageReport(input)
    expect(row.rebateRate).toBe(0)
    expect(row.collectionRate).toBe(0)
  })

  it("handles zero rebateEarned with positive rebateCollected safely", () => {
    const input: UsagePeriodInput[] = [
      {
        period: "2026-03",
        spend: 5_000,
        volume: 10,
        rebateEarned: 0,
        rebateCollected: 42,
      },
    ]
    const [row] = buildUsageReport(input)
    expect(row.rebateRate).toBe(0)
    expect(row.collectionRate).toBe(0)
  })

  it("preserves input order across many periods", () => {
    const input: UsagePeriodInput[] = [
      { period: "2026-01", spend: 100, volume: 1, rebateEarned: 10, rebateCollected: 5 },
      { period: "2026-02", spend: 200, volume: 2, rebateEarned: 20, rebateCollected: 10 },
      { period: "2026-03", spend: 400, volume: 4, rebateEarned: 40, rebateCollected: 20 },
    ]
    const rows = buildUsageReport(input)
    expect(rows.map((r) => r.period)).toEqual(["2026-01", "2026-02", "2026-03"])
    for (const r of rows) {
      expect(r.rebateRate).toBeCloseTo(10)
      expect(r.collectionRate).toBeCloseTo(50)
    }
  })
})

// ---------------------------------------------------------------------------
// Service Report
// ---------------------------------------------------------------------------

describe("buildServiceReport", () => {
  it("computes signed variances on happy path", () => {
    const input: ServicePeriodInput[] = [
      {
        period: "2026-01",
        paymentExpected: 1_000,
        balanceExpected: 500,
        paymentActual: 1_250,
        balanceActual: 450,
      },
    ]
    const [row] = buildServiceReport(input)
    expect(row.paymentVariance).toBe(250)
    expect(row.balanceVariance).toBe(-50)
  })

  it("returns zeros when expected and actual match", () => {
    const input: ServicePeriodInput[] = [
      {
        period: "2026-02",
        paymentExpected: 0,
        balanceExpected: 0,
        paymentActual: 0,
        balanceActual: 0,
      },
    ]
    const [row] = buildServiceReport(input)
    expect(row.paymentVariance).toBe(0)
    expect(row.balanceVariance).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Tie-In Report
// ---------------------------------------------------------------------------

describe("buildTieInReport", () => {
  it("computes spend and volume attainment percentages", () => {
    const input: TieInPeriodInput[] = [
      {
        period: "2026-Q1",
        spendTarget: 100_000,
        spendActual: 75_000,
        volumeTarget: 1_000,
        volumeActual: 1_250,
        rebateEarned: 5_000,
        rebateCollected: 2_500,
        paymentActual: 95_000,
        balanceExpected: 5_000,
      },
    ]
    const [row] = buildTieInReport(input)
    expect(row.spendAttainmentPct).toBeCloseTo(75)
    expect(row.volumeAttainmentPct).toBeCloseTo(125)
  })

  it("handles zero targets without dividing by zero", () => {
    const input: TieInPeriodInput[] = [
      {
        period: "2026-Q2",
        spendTarget: 0,
        spendActual: 10_000,
        volumeTarget: 0,
        volumeActual: 0,
        rebateEarned: 0,
        rebateCollected: 0,
        paymentActual: 0,
        balanceExpected: 0,
      },
    ]
    const [row] = buildTieInReport(input)
    expect(row.spendAttainmentPct).toBe(0)
    expect(row.volumeAttainmentPct).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Capital Report
// ---------------------------------------------------------------------------

describe("buildCapitalReport", () => {
  it("computes payment variance per row", () => {
    const input: CapitalPeriodInput[] = [
      {
        period: "2026-01",
        scheduledPayment: 1_000,
        actualPayment: 1_100,
        depreciationAmount: 500,
        bookValue: 10_000,
      },
    ]
    const [row] = buildCapitalReport(input)
    expect(row.paymentVariance).toBe(100)
    expect(row.cumulativeDepreciation).toBe(500)
  })

  it("accumulates depreciation as a running sum in input order", () => {
    const input: CapitalPeriodInput[] = [
      {
        period: "2026-01",
        scheduledPayment: 1_000,
        actualPayment: 1_000,
        depreciationAmount: 250,
        bookValue: 10_000,
      },
      {
        period: "2026-02",
        scheduledPayment: 1_000,
        actualPayment: 900,
        depreciationAmount: 250,
        bookValue: 9_750,
      },
      {
        period: "2026-03",
        scheduledPayment: 1_000,
        actualPayment: 1_000,
        depreciationAmount: 250,
        bookValue: 9_500,
      },
    ]
    const rows = buildCapitalReport(input)
    expect(rows.map((r) => r.cumulativeDepreciation)).toEqual([250, 500, 750])
    expect(rows.map((r) => r.paymentVariance)).toEqual([0, -100, 0])
  })

  it("returns empty output for empty input", () => {
    expect(buildCapitalReport([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Grouped Report
// ---------------------------------------------------------------------------

describe("buildGroupedReport", () => {
  it("computes share-of-group spend per period independently", () => {
    const input: GroupedPeriodInput[] = [
      {
        period: "2026-01",
        facilityId: "f1",
        facilityName: "Alpha",
        spend: 600,
        volume: 10,
        rebateEarned: 60,
      },
      {
        period: "2026-01",
        facilityId: "f2",
        facilityName: "Beta",
        spend: 400,
        volume: 5,
        rebateEarned: 40,
      },
      {
        period: "2026-02",
        facilityId: "f1",
        facilityName: "Alpha",
        spend: 100,
        volume: 2,
        rebateEarned: 10,
      },
      {
        period: "2026-02",
        facilityId: "f2",
        facilityName: "Beta",
        spend: 300,
        volume: 6,
        rebateEarned: 30,
      },
    ]
    const rows = buildGroupedReport(input)

    const jan = rows.filter((r) => r.period === "2026-01")
    expect(jan.find((r) => r.facilityId === "f1")?.shareOfGroupSpend).toBeCloseTo(60)
    expect(jan.find((r) => r.facilityId === "f2")?.shareOfGroupSpend).toBeCloseTo(40)

    const feb = rows.filter((r) => r.period === "2026-02")
    expect(feb.find((r) => r.facilityId === "f1")?.shareOfGroupSpend).toBeCloseTo(25)
    expect(feb.find((r) => r.facilityId === "f2")?.shareOfGroupSpend).toBeCloseTo(75)
  })

  it("returns 0 share when the period's total group spend is zero", () => {
    const input: GroupedPeriodInput[] = [
      {
        period: "2026-03",
        facilityId: "f1",
        facilityName: "Alpha",
        spend: 0,
        volume: 0,
        rebateEarned: 0,
      },
      {
        period: "2026-03",
        facilityId: "f2",
        facilityName: "Beta",
        spend: 0,
        volume: 0,
        rebateEarned: 0,
      },
    ]
    const rows = buildGroupedReport(input)
    for (const r of rows) {
      expect(r.shareOfGroupSpend).toBe(0)
    }
  })

  it("gives a sole-facility period 100% share", () => {
    const input: GroupedPeriodInput[] = [
      {
        period: "2026-04",
        facilityId: "only",
        facilityName: "Solo",
        spend: 1_234,
        volume: 1,
        rebateEarned: 10,
      },
    ]
    const [row] = buildGroupedReport(input)
    expect(row.shareOfGroupSpend).toBeCloseTo(100)
  })
})

// ---------------------------------------------------------------------------
// Pricing-Only Report
// ---------------------------------------------------------------------------

describe("buildPricingOnlyReport", () => {
  it("computes signed per-unit + total + percent variances", () => {
    const input: PricingOnlyItem[] = [
      {
        vendorItemNo: "V-1",
        itemDescription: "Widget",
        contractPrice: 10,
        actualPaidPrice: 12,
        quantity: 5,
      },
    ]
    const [row] = buildPricingOnlyReport(input)
    expect(row.priceVariance).toBe(2)
    expect(row.totalVariance).toBe(10)
    expect(row.variancePercent).toBeCloseTo(20)
  })

  it("handles negative variance (paid below contract) and preserves sign", () => {
    const input: PricingOnlyItem[] = [
      {
        vendorItemNo: "V-2",
        itemDescription: "Gizmo",
        contractPrice: 100,
        actualPaidPrice: 80,
        quantity: 3,
      },
    ]
    const [row] = buildPricingOnlyReport(input)
    expect(row.priceVariance).toBe(-20)
    expect(row.totalVariance).toBe(-60)
    expect(row.variancePercent).toBeCloseTo(-20)
  })

  it("returns 0 variancePercent when contractPrice is zero", () => {
    const input: PricingOnlyItem[] = [
      {
        vendorItemNo: "V-3",
        itemDescription: "Freebie",
        contractPrice: 0,
        actualPaidPrice: 5,
        quantity: 2,
      },
    ]
    const [row] = buildPricingOnlyReport(input)
    expect(row.priceVariance).toBe(5)
    expect(row.totalVariance).toBe(10)
    expect(row.variancePercent).toBe(0)
  })
})
