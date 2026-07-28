/**
 * Pure-logic tests for the Price Discrepancy report's DEFAULT tab
 * (repo convention: component logic is tested as exported pure
 * functions — vitest runs in a node environment, so there is no render
 * testing).
 *
 * The tab used to reduce over `getPriceDiscrepancies()` (capped at 1,500
 * rows, ordered by variance % DESC) and print the result as the
 * facility's totals. It now reads `getPriceVarianceSeverityBreakdown`,
 * and everything it still truncates for display — the vendor table's
 * top 20, the major-line top 25 — has to SAY what it left out. These
 * tests pin the captions and the slice arithmetic.
 */
import { describe, it, expect } from "vitest"
import {
  VENDOR_ROW_LIMIT,
  buildBandCoverageNotice,
  buildMajorLineEmptyMessage,
  buildMajorLineNotice,
  buildSeverityCardScopeLine,
  buildSeverityCardSubtitle,
  buildVendorSampleNotice,
  splitVendorRows,
  type VendorVarianceRow,
} from "@/components/facility/reports/price-variance-dashboard"

function vendorRow(
  name: string,
  overchargeTotal: number,
  underchargeTotal = 0,
  lines = 10,
  majorLines = 1,
): VendorVarianceRow {
  return {
    vendorId: `id-${name}`,
    vendorName: name,
    overchargeTotal,
    overchargeLines: 1,
    underchargeTotal,
    underchargeLines: 1,
    lines,
    majorLines,
  }
}

describe("buildSeverityCardSubtitle", () => {
  it("names both directions instead of one netted impact", () => {
    // Production snapshot, major band: netting these gives −$2.28M and
    // erases the $1.9M that is actually recoverable.
    const subtitle = buildSeverityCardSubtitle({
      overchargeTotal: 1_901_306.94,
      underchargeTotal: 4_176_877.37,
    })
    expect(subtitle).toContain("$1.9M over contract")
    expect(subtitle).toContain("$4.2M under")
    expect(subtitle).not.toContain("-$2.3M")
  })

  it("still shows both sides when one is empty", () => {
    expect(
      buildSeverityCardSubtitle({ overchargeTotal: 472_173, underchargeTotal: 0 }),
    ).toBe("$472K over contract · $0 under")
  })
})

describe("buildBandCoverageNotice", () => {
  it("names the off-contract lines the three bands cannot cover", () => {
    // 44,812 discrepancy lines, only 5,781 of them banded: three cards
    // adding to 5,781 must not read as the facility's whole set.
    const notice = buildBandCoverageNotice({
      totalLines: 44_812,
      bandedLines: 5_781,
      unbandedLines: 39_031,
    })
    expect(notice).toContain("5,781 of 44,812")
    expect(notice).toContain("39,031")
    expect(notice).toContain("off-contract")
  })

  it("stays silent when every line is banded", () => {
    expect(
      buildBandCoverageNotice({
        totalLines: 973,
        bandedLines: 973,
        unbandedLines: 0,
      }),
    ).toBeNull()
  })
})

describe("splitVendorRows", () => {
  const vendors = [
    vendorRow("A", 100, 10, 5, 2),
    vendorRow("B", 50, 5, 4, 1),
    vendorRow("C", 25, 2, 3, 0),
    vendorRow("D", 10, 1, 2, 0),
  ]

  it("accounts for every vendor the slice leaves out, exactly", () => {
    const split = splitVendorRows(vendors, 2)

    expect(split.shown.map((v) => v.vendorName)).toEqual(["A", "B"])
    expect(split.hidden.vendors).toBe(2)
    // The remainder is computed, never estimated or elided as "…more".
    expect(split.hidden.overchargeTotal).toBe(35)
    expect(split.hidden.underchargeTotal).toBe(3)
    expect(split.hidden.lines).toBe(5)
    expect(split.hidden.majorLines).toBe(0)
  })

  it("footer totals cover ALL vendors, shown or not", () => {
    const split = splitVendorRows(vendors, 2)

    expect(split.facilityTotals.overchargeTotal).toBe(185)
    expect(split.facilityTotals.underchargeTotal).toBe(18)
    expect(split.facilityTotals.lines).toBe(14)
    expect(split.facilityTotals.majorLines).toBe(3)
    // shown + hidden must reconstitute the whole, or the footer is lying.
    const shownOver = split.shown.reduce((s, v) => s + v.overchargeTotal, 0)
    expect(shownOver + split.hidden.overchargeTotal).toBe(
      split.facilityTotals.overchargeTotal,
    )
  })

  it("hides nothing when the list is shorter than the limit", () => {
    const split = splitVendorRows(vendors, VENDOR_ROW_LIMIT)
    expect(split.shown).toHaveLength(4)
    expect(split.hidden.vendors).toBe(0)
    expect(split.hidden.overchargeTotal).toBe(0)
  })

  it("handles an empty vendor list without producing NaN totals", () => {
    const split = splitVendorRows([], VENDOR_ROW_LIMIT)
    expect(split.shown).toEqual([])
    expect(split.facilityTotals).toEqual({
      overchargeTotal: 0,
      underchargeTotal: 0,
      lines: 0,
      majorLines: 0,
    })
  })
})

describe("buildVendorSampleNotice", () => {
  it("quotes the money sitting outside the visible rows", () => {
    const notice = buildVendorSampleNotice({
      shown: 20,
      total: 193,
      hidden: { overchargeTotal: 240_000, underchargeTotal: 88_000, lines: 30_112 },
    })
    expect(notice).toContain("Top 20 of 193 vendors")
    expect(notice).toContain("173 not shown")
    expect(notice).toContain("$240K over contract")
    expect(notice).toContain("$88K under")
    expect(notice).toContain("30,112 lines")
  })

  it("stays silent when the table already shows every vendor", () => {
    expect(
      buildVendorSampleNotice({
        shown: 6,
        total: 6,
        hidden: { overchargeTotal: 0, underchargeTotal: 0, lines: 0 },
      }),
    ).toBeNull()
  })
})

describe("buildMajorLineNotice", () => {
  it("labels the top-N and the ranking it used", () => {
    const notice = buildMajorLineNotice({ shown: 25, total: 3_346 })
    expect(notice).toContain("Top 25 of 3,346")
    // Ranked on magnitude across BOTH directions, so a reader does not
    // assume every row is an overcharge.
    expect(notice).toContain("absolute dollar impact")
    expect(notice).toContain("discounts")
    // ...and the cards above are not truncated the same way.
    expect(notice).toContain("cover all 3,346")
  })

  it("stays silent when the drill-down is the whole band", () => {
    expect(buildMajorLineNotice({ shown: 12, total: 12 })).toBeNull()
    expect(buildMajorLineNotice({ shown: 25, total: 0 })).toBeNull()
  })

  it("stays silent when there is nothing to rank at all", () => {
    // Otherwise the card printed "Top 0 of 199 major-severity lines…"
    // straight above "No major-severity lines detected. Good news!".
    expect(buildMajorLineNotice({ shown: 0, total: 199 })).toBeNull()
  })
})

describe("buildMajorLineEmptyMessage", () => {
  it("does not claim an empty band when the band is not empty", () => {
    // The drill-down reads the two `savingsAmount` extremes, and
    // enrichment nulls that column when its kit-vs-component sanity
    // check fires — so an empty list can sit beside a Major card
    // reading 199. Saying "Good news!" there is a lie.
    const message = buildMajorLineEmptyMessage({ majorLines: 199 })
    expect(message).not.toContain("Good news")
    expect(message).toContain("199")
    expect(message).toContain("no dollar figure")
  })

  it("says the band really is empty when it really is", () => {
    expect(buildMajorLineEmptyMessage({ majorLines: 0 })).toBe(
      "No major-severity lines detected. Good news!",
    )
  })
})

describe("buildSeverityCardScopeLine", () => {
  it("names the banded lines that carry no dollar figure", () => {
    expect(
      buildSeverityCardScopeLine({
        severity: "major",
        lines: 3_346,
        withoutDollarImpact: 199,
      }),
    ).toBe("facility-wide · 199 with no dollar figure")
  })

  it("stays a bare scope word when every line has a dollar figure", () => {
    expect(
      buildSeverityCardScopeLine({
        severity: "major",
        lines: 973,
        withoutDollarImpact: 0,
      }),
    ).toBe("facility-wide")
  })

  it("explains why the Minor band reads zero instead of implying none exist", () => {
    // PRICE_VARIANCE_THRESHOLD is 2%, so anything inside ±2% is matched
    // `on_contract` and never enters the price_variance /
    // off_contract_item set this report aggregates. Both the dev seed
    // and the production snapshot have exactly 0 minor lines, forever.
    const line = buildSeverityCardScopeLine({
      severity: "minor",
      lines: 0,
      withoutDollarImpact: 0,
    })
    expect(line).toContain("facility-wide")
    expect(line).toContain("on-contract")
    expect(line).toContain("±2%")
  })

  it("does not blame on-contract matching for an empty major band", () => {
    const line = buildSeverityCardScopeLine({
      severity: "major",
      lines: 0,
      withoutDollarImpact: 0,
    })
    expect(line).toBe("facility-wide")
  })

  it("drops the note the moment a minor line does exist", () => {
    const line = buildSeverityCardScopeLine({
      severity: "minor",
      lines: 4,
      withoutDollarImpact: 0,
    })
    expect(line).toBe("facility-wide")
  })
})
