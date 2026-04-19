import { describe, it, expect } from "vitest"
import {
  aggregateRebatesByQuarter,
  type RebateRowForQuarterly,
} from "@/lib/contracts/rebate-quarterly"

describe("aggregateRebatesByQuarter", () => {
  const now = new Date("2026-04-19T00:00:00Z")

  it("returns [] when there are no rebate rows", () => {
    expect(aggregateRebatesByQuarter([], now)).toEqual([])
  })

  it("buckets earned by payPeriodEnd quarter and only counts closed periods", () => {
    const rows: RebateRowForQuarterly[] = [
      // Closed Q2 2025
      {
        payPeriodEnd: new Date("2025-06-30T00:00:00Z"),
        rebateEarned: 100,
        rebateCollected: 0,
        collectionDate: null,
      },
      // Closed Q2 2025 — same quarter, should sum
      {
        payPeriodEnd: new Date("2025-05-15T00:00:00Z"),
        rebateEarned: 50,
        rebateCollected: 0,
        collectionDate: null,
      },
      // Future quarter — must be excluded
      {
        payPeriodEnd: new Date("2026-12-31T00:00:00Z"),
        rebateEarned: 999,
        rebateCollected: 0,
        collectionDate: null,
      },
    ]
    expect(aggregateRebatesByQuarter(rows, now)).toEqual([
      { quarter: "2025 Q2", rebateEarned: 150, rebateCollected: 0 },
    ])
  })

  it("buckets collected by collectionDate and only counts rows with a collectionDate", () => {
    const rows: RebateRowForQuarterly[] = [
      {
        payPeriodEnd: new Date("2025-06-30T00:00:00Z"),
        rebateEarned: 100,
        rebateCollected: 80,
        collectionDate: new Date("2025-08-10T00:00:00Z"), // Q3 2025
      },
      {
        payPeriodEnd: new Date("2025-09-30T00:00:00Z"),
        rebateEarned: 120,
        rebateCollected: 200,
        collectionDate: null, // excluded from collected
      },
    ]
    const out = aggregateRebatesByQuarter(rows, now)
    // Earned in Q2+Q3 2025; collected only in Q3 2025
    expect(out).toEqual([
      { quarter: "2025 Q2", rebateEarned: 100, rebateCollected: 0 },
      { quarter: "2025 Q3", rebateEarned: 120, rebateCollected: 80 },
    ])
  })

  it("fills quarters that appear in only one series with 0 on the other", () => {
    const rows: RebateRowForQuarterly[] = [
      {
        payPeriodEnd: new Date("2025-03-31T00:00:00Z"),
        rebateEarned: 10,
        rebateCollected: 10,
        collectionDate: new Date("2026-01-15T00:00:00Z"), // Q1 2026
      },
    ]
    expect(aggregateRebatesByQuarter(rows, now)).toEqual([
      { quarter: "2025 Q1", rebateEarned: 10, rebateCollected: 0 },
      { quarter: "2026 Q1", rebateEarned: 0, rebateCollected: 10 },
    ])
  })

  it("sorts quarters chronologically across year boundaries", () => {
    const rows: RebateRowForQuarterly[] = [
      {
        payPeriodEnd: new Date("2026-03-31T00:00:00Z"),
        rebateEarned: 1,
        rebateCollected: 0,
        collectionDate: null,
      },
      {
        payPeriodEnd: new Date("2025-12-31T00:00:00Z"),
        rebateEarned: 2,
        rebateCollected: 0,
        collectionDate: null,
      },
      {
        payPeriodEnd: new Date("2025-03-31T00:00:00Z"),
        rebateEarned: 3,
        rebateCollected: 0,
        collectionDate: null,
      },
    ]
    const out = aggregateRebatesByQuarter(rows, now).map((r) => r.quarter)
    expect(out).toEqual(["2025 Q1", "2025 Q4", "2026 Q1"])
  })
})
