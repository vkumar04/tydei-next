/**
 * The Price Discrepancy table's Type and Severity columns are
 * `filterVariant: "select"`. TanStack Table v8 builds that dropdown from
 * the column ACCESSOR's values (`getFacetedUniqueValues`), so an
 * accessor that returns the raw enum while the cell renders a human
 * label offers the user vocabulary they have never seen: `at_contract`,
 * `minor_overcharge`, `no_contract` in the filter, "At contract",
 * "Minor overcharge", "No Contract" in the cells.
 *
 * These tests pin the one-vocabulary invariant WITHOUT rendering: the
 * badge helpers return React elements, so the label they print can be
 * read straight off `element.props.children` in a node environment.
 */
import { describe, it, expect } from "vitest"
import {
  DISCREPANCY_TYPE_LABEL,
  DISCREPANCY_TYPE_OPTIONS,
  V0_BAND_LABEL,
  bandBadge,
  classifyDiscrepancy,
  discrepancyTypeFilterValue,
  getTypeBadge,
  varianceBandFilterValue,
  type PriceDiscrepancy,
} from "@/components/facility/reports/price-discrepancy-table"
import type { CogVarianceBand } from "@/lib/contracts/cog-variance-band"

/** The text a badge element renders, without a DOM. */
function badgeText(element: { props: unknown }): unknown {
  return (element.props as { children?: unknown }).children
}

function discrepancy(
  invoicePrice: number,
  contractPrice: number | null,
): PriceDiscrepancy {
  return {
    id: "r-1",
    invoiceId: "",
    invoiceNumber: "PO-1",
    vendorName: "Arthrex",
    vendorId: "v-1",
    itemDescription: "Screw",
    vendorItemNo: "SKU-1",
    invoicePrice,
    contractPrice,
    variancePercent: null,
    quantity: 1,
    totalLineCost: invoicePrice,
    isFlagged: false,
  }
}

const ALL_TYPES = Object.keys(DISCREPANCY_TYPE_LABEL) as Array<
  keyof typeof DISCREPANCY_TYPE_LABEL
>
const ALL_BANDS = Object.keys(V0_BAND_LABEL) as CogVarianceBand[]

describe("Type column — filter options match the cells", () => {
  it("the accessor emits exactly the string the cell prints", () => {
    for (const type of ALL_TYPES) {
      expect(discrepancyTypeFilterValue({ _type: type })).toBe(
        badgeText(getTypeBadge(type)),
      )
    }
  })

  it("never offers a raw enum as a filter option", () => {
    for (const type of ALL_TYPES) {
      const option = discrepancyTypeFilterValue({ _type: type })
      // `no_contract` / `price_increase` are storage spellings, not
      // anything a reader has seen in the table.
      expect(option).not.toBe(type)
      expect(option).not.toMatch(/_/)
    }
  })
})

describe("Severity column — filter options match the cells", () => {
  it("the accessor emits exactly the string the cell prints", () => {
    for (const band of ALL_BANDS) {
      expect(varianceBandFilterValue({ _band: band })).toBe(
        badgeText(bandBadge(band)),
      )
    }
  })

  it("never offers a raw enum as a filter option", () => {
    for (const band of ALL_BANDS) {
      const option = varianceBandFilterValue({ _band: band })
      expect(option).not.toBe(band)
      expect(option).not.toMatch(/_/)
    }
  })

  it("off-contract rows contribute no option (SelectFilter drops empties)", () => {
    // A null band must not become the literal "null" in the dropdown.
    expect(varianceBandFilterValue({ _band: null })).toBe("")
    expect(badgeText(bandBadge(null))).toBe("—")
  })
})

describe("classifyDiscrepancy", () => {
  it("gives a zero-variance row its own type, not the 'all' sentinel", () => {
    // Returning "all" — the filter bar's show-everything value — made a
    // paid-at-contract line classify AS the sentinel, and put "all" in
    // the Type column's faceted dropdown as though it were a category.
    const type = classifyDiscrepancy(discrepancy(100, 100))
    expect(type).toBe("match")
    expect(ALL_TYPES).toContain(type)
    expect(ALL_TYPES).not.toContain("all")
    expect(badgeText(getTypeBadge(type))).toBe("Match")
  })

  it("classifies the three real directions", () => {
    expect(classifyDiscrepancy(discrepancy(120, 100))).toBe("overcharge")
    expect(classifyDiscrepancy(discrepancy(80, 100))).toBe("undercharge")
    expect(classifyDiscrepancy(discrepancy(80, null))).toBe("no_contract")
  })

  it("every filter-bar option is a type some row can actually carry", () => {
    // `price_increase` sat in the union, the label map, the badge map
    // AND the filter-bar dropdown — but `classifyDiscrepancy` has only
    // ever returned four values, so choosing "Price Increase" emptied
    // the table 100% of the time and the reader concluded the facility
    // had none. Same lie as an unlabelled cap, one layer up.
    const reachable = new Set(
      [
        discrepancy(120, 100),
        discrepancy(80, 100),
        discrepancy(100, 100),
        discrepancy(80, null),
      ].map(classifyDiscrepancy),
    )
    // The four the classifier can produce, and nothing else.
    expect(reachable.size).toBe(ALL_TYPES.length)
    for (const opt of DISCREPANCY_TYPE_OPTIONS) {
      if (opt.value === "all") continue
      expect(reachable.has(opt.value)).toBe(true)
      expect(opt.label).toBe(DISCREPANCY_TYPE_LABEL[opt.value])
    }
  })

  it("every type it can return has a label and a filter option", () => {
    for (const d of [
      discrepancy(120, 100),
      discrepancy(80, 100),
      discrepancy(100, 100),
      discrepancy(80, null),
    ]) {
      const type = classifyDiscrepancy(d)
      expect(DISCREPANCY_TYPE_LABEL[type]).toBeTruthy()
      expect(discrepancyTypeFilterValue({ _type: type })).toBe(
        DISCREPANCY_TYPE_LABEL[type],
      )
    }
  })
})
