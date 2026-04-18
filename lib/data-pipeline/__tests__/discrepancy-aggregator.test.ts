import { describe, it, expect } from "vitest"
import {
  aggregateDiscrepancies,
  type DiscrepancyRecord,
} from "../discrepancy-aggregator"

const rec = (overrides: Partial<DiscrepancyRecord> = {}): DiscrepancyRecord => ({
  direction: "overcharge",
  amount: 100,
  vendorId: "v-1",
  vendorName: "Acme",
  vendorItemNo: "SKU-1",
  itemDescription: "Widget",
  facilityId: "f-1",
  facilityName: "Main",
  disputeStatus: "none",
  ...overrides,
})

describe("aggregateDiscrepancies — overall totals", () => {
  it("returns zeros for empty input", () => {
    const r = aggregateDiscrepancies([])
    expect(r.overall).toEqual({
      overchargeTotal: 0,
      underchargeTotal: 0,
      recoveryPotential: 0,
      netTotal: 0,
      count: 0,
      disputeRollup: { none: 0, disputed: 0, resolved: 0, rejected: 0 },
    })
    expect(r.topVendors).toEqual([])
    expect(r.topItems).toEqual([])
    expect(r.byFacility).toEqual([])
  })

  it("sums overcharges and undercharges separately", () => {
    const records = [
      rec({ direction: "overcharge", amount: 500 }),
      rec({ direction: "overcharge", amount: 250 }),
      rec({ direction: "undercharge", amount: 100 }),
    ]
    const r = aggregateDiscrepancies(records)
    expect(r.overall.overchargeTotal).toBe(750)
    expect(r.overall.underchargeTotal).toBe(100)
    expect(r.overall.netTotal).toBe(650)
    expect(r.overall.recoveryPotential).toBe(750)
    expect(r.overall.count).toBe(3)
  })

  it("aliases recoveryPotential to overchargeTotal", () => {
    const r = aggregateDiscrepancies([rec({ amount: 999 })])
    expect(r.overall.recoveryPotential).toBe(r.overall.overchargeTotal)
  })
})

describe("aggregateDiscrepancies — vendor grouping", () => {
  it("groups by vendorId and sorts by overchargeTotal desc", () => {
    const records = [
      rec({ vendorId: "v-a", vendorName: "Alpha", amount: 500 }),
      rec({ vendorId: "v-a", vendorName: "Alpha", amount: 100 }),
      rec({ vendorId: "v-b", vendorName: "Bravo", amount: 300 }),
    ]
    const r = aggregateDiscrepancies(records)
    expect(r.topVendors).toHaveLength(2)
    expect(r.topVendors[0]).toMatchObject({
      key: "v-a",
      label: "Alpha",
      overchargeTotal: 600,
      count: 2,
    })
    expect(r.topVendors[1]).toMatchObject({
      key: "v-b",
      label: "Bravo",
      overchargeTotal: 300,
    })
  })

  it("caps top vendors at configurable limit (default 20)", () => {
    const records = Array.from({ length: 30 }, (_, i) =>
      rec({ vendorId: `v-${i}`, vendorName: `Vendor ${i}`, amount: 100 - i }),
    )
    expect(aggregateDiscrepancies(records).topVendors).toHaveLength(20)
    expect(
      aggregateDiscrepancies(records, { topVendors: 5 }).topVendors,
    ).toHaveLength(5)
  })
})

describe("aggregateDiscrepancies — item grouping", () => {
  it("groups by vendorItemNo", () => {
    const records = [
      rec({ vendorItemNo: "SKU-A", itemDescription: "A", amount: 100 }),
      rec({ vendorItemNo: "SKU-A", itemDescription: "A", amount: 50 }),
      rec({ vendorItemNo: "SKU-B", itemDescription: "B", amount: 200 }),
    ]
    const r = aggregateDiscrepancies(records)
    const aItem = r.topItems.find((g) => g.key === "SKU-A")!
    expect(aItem.overchargeTotal).toBe(150)
    expect(aItem.count).toBe(2)
  })

  it("skips records with null vendorItemNo", () => {
    const records = [
      rec({ vendorItemNo: null, amount: 500 }),
      rec({ vendorItemNo: "SKU-X", amount: 100 }),
    ]
    const r = aggregateDiscrepancies(records)
    expect(r.topItems).toHaveLength(1)
    expect(r.topItems[0].key).toBe("SKU-X")
  })

  it("caps top items at configurable limit (default 50)", () => {
    const records = Array.from({ length: 75 }, (_, i) =>
      rec({ vendorItemNo: `SKU-${i}`, amount: 100 }),
    )
    expect(aggregateDiscrepancies(records).topItems).toHaveLength(50)
  })
})

describe("aggregateDiscrepancies — facility grouping", () => {
  it("returns ALL facilities (no cap) sorted by overcharge", () => {
    const records = [
      rec({ facilityId: "f-1", facilityName: "Main", amount: 100 }),
      rec({ facilityId: "f-2", facilityName: "North", amount: 500 }),
      rec({ facilityId: "f-3", facilityName: "South", amount: 300 }),
    ]
    const r = aggregateDiscrepancies(records)
    expect(r.byFacility).toHaveLength(3)
    expect(r.byFacility.map((g) => g.label)).toEqual(["North", "South", "Main"])
  })
})

describe("aggregateDiscrepancies — dispute rollup", () => {
  it("counts records by disputeStatus bucket", () => {
    const records = [
      rec({ disputeStatus: "none" }),
      rec({ disputeStatus: "disputed" }),
      rec({ disputeStatus: "disputed" }),
      rec({ disputeStatus: "resolved" }),
      rec({ disputeStatus: null }), // treated as "none"
    ]
    const r = aggregateDiscrepancies(records)
    expect(r.overall.disputeRollup).toEqual({
      none: 2,
      disputed: 2,
      resolved: 1,
      rejected: 0,
    })
  })
})
