/**
 * Pure-logic tests for the Price Discrepancy table's truncation notice
 * (repo convention: component logic is tested as exported pure functions
 * — vitest runs in a node environment, so there is no render testing).
 *
 * `getPriceDiscrepancies` returns at most `rowCap` (1,500) rows. A silent
 * cap is the bug this notice exists to close: the table must say how many
 * of how many it is showing, and must say that the CSV export shares the
 * cap while the summary cards above it do not.
 */
import { describe, it, expect } from "vitest"
import {
  buildDiscrepancySampleNotice,
  buildDiscrepancyTotalSubtitle,
} from "@/components/facility/reports/price-discrepancy-table"

describe("buildDiscrepancySampleNotice", () => {
  it("names both numbers when the row list is a sample", () => {
    const notice = buildDiscrepancySampleNotice({
      loaded: 1500,
      total: 4182,
      cap: 1500,
    })
    expect(notice).toContain("1,500 of 4,182")
    expect(notice).toContain("cover all 4,182")
    expect(notice).toContain("capped at 1,500 rows")
  })

  it("says the sample is biased, not just short", () => {
    // getPriceDiscrepancies orders by variancePercent DESC (nulls last):
    // the surviving rows are the biggest OVERCHARGES, so undercharges and
    // off-contract rows are the first casualties of the cap. "1,500 of
    // 4,182" alone would read as a representative slice.
    const notice = buildDiscrepancySampleNotice({
      loaded: 1500,
      total: 4182,
      cap: 1500,
    })
    expect(notice).toContain("variance % descending")
    expect(notice).toContain("largest overcharges first")
    expect(notice).toContain("biased sample")
  })

  it("stays silent when the table already shows everything", () => {
    expect(
      buildDiscrepancySampleNotice({ loaded: 1135, total: 1135, cap: 1500 }),
    ).toBeNull()
    expect(
      buildDiscrepancySampleNotice({ loaded: 12, total: 3, cap: 1500 }),
    ).toBeNull()
  })

  it("stays silent while the facility-wide total is still unknown", () => {
    expect(
      buildDiscrepancySampleNotice({
        loaded: 1500,
        total: undefined,
        cap: undefined,
      }),
    ).toBeNull()
    expect(
      buildDiscrepancySampleNotice({ loaded: 1500, total: null, cap: 1500 }),
    ).toBeNull()
  })

  it("still labels the truncation when the cap is unknown", () => {
    const notice = buildDiscrepancySampleNotice({
      loaded: 900,
      total: 2400,
      cap: null,
    })
    expect(notice).toContain("900 of 2,400")
    expect(notice).toContain("capped")
  })
})

describe("buildDiscrepancyTotalSubtitle", () => {
  it("names the leftover bucket so the three facility-wide counts reconcile", () => {
    // 4,182 total = 973 overcharge + 209 undercharge + 3,000 with no
    // dollar impact. Without the third number the two dollar cards look
    // like they should add to the total and visibly do not.
    expect(buildDiscrepancyTotalSubtitle(3000)).toBe(
      "facility-wide · 3,000 with no dollar impact",
    )
  })

  it("stays a bare scope label when every row has a dollar impact", () => {
    expect(buildDiscrepancyTotalSubtitle(0)).toBe("facility-wide")
    expect(buildDiscrepancyTotalSubtitle(null)).toBe("facility-wide")
    expect(buildDiscrepancyTotalSubtitle(undefined)).toBe("facility-wide")
  })
})
