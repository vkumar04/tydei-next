/**
 * Tests for the real performance-history pure helper.
 *
 * Spec: docs/superpowers/specs/2026-04-18-renewals-rewrite.md §4.2.
 *
 * Guard rail: NO SYNTHESIS. Empty input → empty output; every compliance
 * null must remain null end-to-end.
 */

import { describe, it, expect } from "vitest"
import {
  buildRealPerformanceHistory,
  type ContractPeriodRow,
  type RebateAccrualRow,
} from "../performance-history"

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function period(
  start: string,
  end: string,
  totalSpend: number,
  compliance: number | null,
): ContractPeriodRow {
  return {
    periodStart: new Date(start),
    periodEnd: new Date(end),
    totalSpend,
    compliance,
  }
}

function accrual(
  start: string,
  end: string,
  rebateEarned: number,
): RebateAccrualRow {
  return {
    periodStart: new Date(start),
    periodEnd: new Date(end),
    rebateEarned,
  }
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("buildRealPerformanceHistory", () => {
  it("returns an empty array for empty input (no synthesis)", () => {
    expect(buildRealPerformanceHistory({ periods: [], accruals: [] })).toEqual(
      [],
    )
  })

  it("produces one row from a single period + matching accrual", () => {
    const rows = buildRealPerformanceHistory({
      periods: [
        period("2024-01-01T00:00:00Z", "2024-12-31T00:00:00Z", 1_000_000, 92),
      ],
      accruals: [
        accrual("2024-01-01T00:00:00Z", "2024-12-31T00:00:00Z", 40_000),
      ],
    })

    expect(rows).toEqual([
      { year: 2024, spend: 1_000_000, rebate: 40_000, compliance: 92 },
    ])
  })

  it("emits multiple rows sorted ascending by year", () => {
    const rows = buildRealPerformanceHistory({
      periods: [
        period("2023-01-01T00:00:00Z", "2023-12-31T00:00:00Z", 800_000, 85),
        period("2025-01-01T00:00:00Z", "2025-12-31T00:00:00Z", 1_100_000, 95),
        period("2024-01-01T00:00:00Z", "2024-12-31T00:00:00Z", 1_000_000, 90),
      ],
      accruals: [
        accrual("2024-01-01T00:00:00Z", "2024-12-31T00:00:00Z", 40_000),
        accrual("2023-01-01T00:00:00Z", "2023-12-31T00:00:00Z", 30_000),
        accrual("2025-01-01T00:00:00Z", "2025-12-31T00:00:00Z", 50_000),
      ],
    })

    expect(rows.map((r) => r.year)).toEqual([2023, 2024, 2025])
    expect(rows[0]).toEqual({
      year: 2023,
      spend: 800_000,
      rebate: 30_000,
      compliance: 85,
    })
    expect(rows[2]).toEqual({
      year: 2025,
      spend: 1_100_000,
      rebate: 50_000,
      compliance: 95,
    })
  })

  it("emits compliance=null when every period in the year is null", () => {
    const rows = buildRealPerformanceHistory({
      periods: [
        period("2024-01-01T00:00:00Z", "2024-06-30T00:00:00Z", 500_000, null),
        period("2024-07-01T00:00:00Z", "2024-12-31T00:00:00Z", 600_000, null),
      ],
      accruals: [],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].year).toBe(2024)
    expect(rows[0].spend).toBe(1_100_000)
    expect(rows[0].rebate).toBe(0)
    expect(rows[0].compliance).toBeNull()
  })

  it("averages compliance across non-null values, skipping nulls", () => {
    const rows = buildRealPerformanceHistory({
      periods: [
        period("2024-01-01T00:00:00Z", "2024-04-30T00:00:00Z", 300_000, 80),
        period("2024-05-01T00:00:00Z", "2024-08-31T00:00:00Z", 300_000, null),
        period("2024-09-01T00:00:00Z", "2024-12-31T00:00:00Z", 300_000, 100),
      ],
      accruals: [],
    })

    expect(rows).toHaveLength(1)
    // (80 + 100) / 2 = 90 — the null row is skipped, not counted as 0.
    expect(rows[0].compliance).toBe(90)
    expect(rows[0].spend).toBe(900_000)
  })

  it("emits a row with spend=0 when an accrual has no matching period", () => {
    const rows = buildRealPerformanceHistory({
      periods: [],
      accruals: [
        accrual("2024-01-01T00:00:00Z", "2024-12-31T00:00:00Z", 12_345),
      ],
    })

    expect(rows).toEqual([
      { year: 2024, spend: 0, rebate: 12_345, compliance: null },
    ])
  })

  it("emits a row with rebate=0 when a period has no matching accrual", () => {
    const rows = buildRealPerformanceHistory({
      periods: [
        period("2024-01-01T00:00:00Z", "2024-12-31T00:00:00Z", 750_000, 88),
      ],
      accruals: [],
    })

    expect(rows).toEqual([
      { year: 2024, spend: 750_000, rebate: 0, compliance: 88 },
    ])
  })

  it("buckets a year-spanning period by its periodStart year", () => {
    const rows = buildRealPerformanceHistory({
      // Period starts 2023-07-01 and ends 2024-06-30 — goes in 2023.
      periods: [
        period("2023-07-01T00:00:00Z", "2024-06-30T00:00:00Z", 2_000_000, 93),
      ],
      // Accrual that spans the same boundary is bucketed by its start too.
      accruals: [
        accrual("2023-12-15T00:00:00Z", "2024-01-15T00:00:00Z", 80_000),
      ],
    })

    expect(rows).toEqual([
      { year: 2023, spend: 2_000_000, rebate: 80_000, compliance: 93 },
    ])
  })

  it("sums totalSpend (does not average) across multiple periods in a year", () => {
    const rows = buildRealPerformanceHistory({
      periods: [
        period("2024-01-01T00:00:00Z", "2024-03-31T00:00:00Z", 250_000, 90),
        period("2024-04-01T00:00:00Z", "2024-06-30T00:00:00Z", 250_000, 90),
        period("2024-07-01T00:00:00Z", "2024-09-30T00:00:00Z", 250_000, 90),
        period("2024-10-01T00:00:00Z", "2024-12-31T00:00:00Z", 250_000, 90),
      ],
      accruals: [],
    })

    expect(rows).toHaveLength(1)
    // Sum, not average — 4 × 250k = 1M, not 250k.
    expect(rows[0].spend).toBe(1_000_000)
    expect(rows[0].compliance).toBe(90)
  })

  it("groups periods and accruals independently, then merges by year", () => {
    // Year 2023 has ONLY an accrual; year 2024 has ONLY periods;
    // year 2025 has both.
    const rows = buildRealPerformanceHistory({
      periods: [
        period("2024-01-01T00:00:00Z", "2024-12-31T00:00:00Z", 500_000, 80),
        period("2025-01-01T00:00:00Z", "2025-12-31T00:00:00Z", 600_000, 85),
      ],
      accruals: [
        accrual("2023-01-01T00:00:00Z", "2023-12-31T00:00:00Z", 10_000),
        accrual("2025-01-01T00:00:00Z", "2025-12-31T00:00:00Z", 20_000),
      ],
    })

    expect(rows).toEqual([
      { year: 2023, spend: 0, rebate: 10_000, compliance: null },
      { year: 2024, spend: 500_000, rebate: 0, compliance: 80 },
      { year: 2025, spend: 600_000, rebate: 20_000, compliance: 85 },
    ])
  })
})
