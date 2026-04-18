import { describe, it, expect } from "vitest"
import {
  aggregatePurchasesByPeriod,
  type PeriodDefinition,
  type PurchaseForAggregation,
} from "../period-aggregator"

const d = (s: string): Date => new Date(s)

const Q1: PeriodDefinition = {
  id: "p-q1",
  periodNumber: 1,
  periodStart: d("2026-01-01T00:00:00.000Z"),
  periodEnd: d("2026-03-31T23:59:59.999Z"),
}

const Q2: PeriodDefinition = {
  id: "p-q2",
  periodNumber: 2,
  periodStart: d("2026-04-01T00:00:00.000Z"),
  periodEnd: d("2026-06-30T23:59:59.999Z"),
}

describe("aggregatePurchasesByPeriod", () => {
  it("returns an empty array when no periods are supplied", () => {
    const result = aggregatePurchasesByPeriod({
      periods: [],
      purchases: [
        {
          transactionDate: d("2026-02-01T00:00:00.000Z"),
          extendedPrice: 100,
          quantity: 1,
        },
      ],
    })
    expect(result).toEqual([])
  })

  it("returns zeroed aggregates when there are periods but no purchases", () => {
    const result = aggregatePurchasesByPeriod({
      periods: [Q1, Q2],
      purchases: [],
    })
    expect(result).toHaveLength(2)
    for (const p of result) {
      expect(p.totalSpend).toBe(0)
      expect(p.totalQuantity).toBe(0)
      expect(p.uniqueCptOccurrences).toBe(0)
      expect(p.purchaseCount).toBe(0)
    }
    expect(result[0]?.periodId).toBe("p-q1")
    expect(result[1]?.periodId).toBe("p-q2")
  })

  it("aggregates a single period's matching purchases", () => {
    const purchases: PurchaseForAggregation[] = [
      {
        transactionDate: d("2026-01-15T00:00:00.000Z"),
        extendedPrice: 100,
        quantity: 2,
      },
      {
        transactionDate: d("2026-02-20T00:00:00.000Z"),
        extendedPrice: 250,
        quantity: 5,
      },
    ]
    const [p] = aggregatePurchasesByPeriod({ periods: [Q1], purchases })
    expect(p).toBeDefined()
    expect(p?.totalSpend).toBe(350)
    expect(p?.totalQuantity).toBe(7)
    expect(p?.purchaseCount).toBe(2)
    expect(p?.uniqueCptOccurrences).toBe(0) // no cptCode set
  })

  it("drops purchases that fall outside every period", () => {
    const purchases: PurchaseForAggregation[] = [
      {
        transactionDate: d("2025-12-31T00:00:00.000Z"),
        extendedPrice: 999,
        quantity: 9,
      },
      {
        transactionDate: d("2026-07-01T00:00:00.000Z"),
        extendedPrice: 888,
        quantity: 8,
      },
      {
        transactionDate: d("2026-02-01T00:00:00.000Z"),
        extendedPrice: 50,
        quantity: 1,
      },
    ]
    const result = aggregatePurchasesByPeriod({
      periods: [Q1, Q2],
      purchases,
    })
    expect(result[0]?.totalSpend).toBe(50)
    expect(result[0]?.purchaseCount).toBe(1)
    expect(result[1]?.totalSpend).toBe(0)
    expect(result[1]?.purchaseCount).toBe(0)
  })

  it("deduplicates uniqueCptOccurrences by caseId+cpt when caseId is present", () => {
    const purchases: PurchaseForAggregation[] = [
      {
        transactionDate: d("2026-01-10T00:00:00.000Z"),
        extendedPrice: 10,
        quantity: 1,
        cptCode: "27447",
        caseId: "case-1",
      },
      // Same case+cpt → should collapse
      {
        transactionDate: d("2026-01-10T00:00:00.000Z"),
        extendedPrice: 10,
        quantity: 1,
        cptCode: "27447",
        caseId: "case-1",
      },
      // Different case, same cpt → counts
      {
        transactionDate: d("2026-01-11T00:00:00.000Z"),
        extendedPrice: 10,
        quantity: 1,
        cptCode: "27447",
        caseId: "case-2",
      },
      // Same case, different cpt → counts
      {
        transactionDate: d("2026-01-12T00:00:00.000Z"),
        extendedPrice: 10,
        quantity: 1,
        cptCode: "27130",
        caseId: "case-1",
      },
    ]
    const [p] = aggregatePurchasesByPeriod({ periods: [Q1], purchases })
    expect(p?.uniqueCptOccurrences).toBe(3)
    expect(p?.purchaseCount).toBe(4)
  })

  it("falls back to date+cpt dedup when caseId is missing", () => {
    const purchases: PurchaseForAggregation[] = [
      {
        transactionDate: d("2026-01-15T00:00:00.000Z"),
        extendedPrice: 10,
        quantity: 1,
        cptCode: "27447",
      },
      // Same day + same cpt + no case → collapses
      {
        transactionDate: d("2026-01-15T12:00:00.000Z"),
        extendedPrice: 10,
        quantity: 1,
        cptCode: "27447",
      },
      // Next day → distinct
      {
        transactionDate: d("2026-01-16T00:00:00.000Z"),
        extendedPrice: 10,
        quantity: 1,
        cptCode: "27447",
      },
    ]
    const [p] = aggregatePurchasesByPeriod({ periods: [Q1], purchases })
    expect(p?.uniqueCptOccurrences).toBe(2)
    expect(p?.purchaseCount).toBe(3)
  })

  it("ignores purchases with no cptCode for uniqueCptOccurrences", () => {
    const purchases: PurchaseForAggregation[] = [
      {
        transactionDate: d("2026-01-10T00:00:00.000Z"),
        extendedPrice: 10,
        quantity: 1,
        cptCode: null,
        caseId: "case-1",
      },
      {
        transactionDate: d("2026-01-11T00:00:00.000Z"),
        extendedPrice: 10,
        quantity: 1,
        cptCode: "",
        caseId: "case-2",
      },
      {
        transactionDate: d("2026-01-12T00:00:00.000Z"),
        extendedPrice: 10,
        quantity: 1,
        cptCode: "27447",
        caseId: "case-3",
      },
    ]
    const [p] = aggregatePurchasesByPeriod({ periods: [Q1], purchases })
    expect(p?.uniqueCptOccurrences).toBe(1)
    expect(p?.purchaseCount).toBe(3)
  })

  it("buckets across multiple periods and preserves period order", () => {
    const purchases: PurchaseForAggregation[] = [
      {
        transactionDate: d("2026-01-15T00:00:00.000Z"),
        extendedPrice: 100,
        quantity: 1,
      },
      {
        transactionDate: d("2026-05-01T00:00:00.000Z"),
        extendedPrice: 300,
        quantity: 2,
      },
      {
        transactionDate: d("2026-06-29T00:00:00.000Z"),
        extendedPrice: 50,
        quantity: 1,
      },
    ]
    const result = aggregatePurchasesByPeriod({
      periods: [Q1, Q2],
      purchases,
    })
    expect(result[0]?.periodId).toBe("p-q1")
    expect(result[0]?.totalSpend).toBe(100)
    expect(result[0]?.purchaseCount).toBe(1)
    expect(result[1]?.periodId).toBe("p-q2")
    expect(result[1]?.totalSpend).toBe(350)
    expect(result[1]?.purchaseCount).toBe(2)
  })

  it("treats period boundaries as inclusive on both ends", () => {
    const purchases: PurchaseForAggregation[] = [
      {
        transactionDate: Q1.periodStart,
        extendedPrice: 10,
        quantity: 1,
      },
      {
        transactionDate: Q1.periodEnd,
        extendedPrice: 20,
        quantity: 2,
      },
    ]
    const [p] = aggregatePurchasesByPeriod({ periods: [Q1], purchases })
    expect(p?.totalSpend).toBe(30)
    expect(p?.totalQuantity).toBe(3)
    expect(p?.purchaseCount).toBe(2)
  })
})
