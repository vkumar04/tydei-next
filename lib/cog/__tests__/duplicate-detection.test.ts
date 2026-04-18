import { describe, it, expect } from "vitest"
import {
  detectDuplicates,
  type COGRecordForDedup,
} from "../duplicate-detection"

/** Build a record with sensible defaults so each test only spells out the fields it cares about. */
function makeRecord(
  overrides: Partial<COGRecordForDedup> & Pick<COGRecordForDedup, "inventoryNumber">,
): COGRecordForDedup {
  return {
    vendorItemNo: "V-1",
    transactionDate: new Date("2026-01-15T00:00:00.000Z"),
    unitCost: 10,
    quantity: 1,
    ...overrides,
  }
}

describe("detectDuplicates", () => {
  it("returns empty groups for an empty input", () => {
    const report = detectDuplicates([])
    expect(report.groups).toEqual([])
    expect(report.exactMatchCount).toBe(0)
    expect(report.partialMatchCount).toBe(0)
  })

  it("returns empty groups for a single record (not a duplicate by itself)", () => {
    const report = detectDuplicates([makeRecord({ inventoryNumber: "INV-1" })])
    expect(report.groups).toEqual([])
    expect(report.exactMatchCount).toBe(0)
    expect(report.partialMatchCount).toBe(0)
  })

  it("groups 2 records sharing (invNo, vendorItemNo, date) as an exact 'both' match", () => {
    const date = new Date("2026-02-03T12:00:00.000Z")
    const records: COGRecordForDedup[] = [
      makeRecord({ inventoryNumber: "INV-1", vendorItemNo: "V-9", transactionDate: date }),
      makeRecord({
        inventoryNumber: "INV-1",
        vendorItemNo: "V-9",
        transactionDate: date,
        unitCost: 99, // unitCost/qty do NOT affect grouping
        quantity: 7,
      }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].matchKey).toBe("both")
    expect(report.groups[0].isExactMatch).toBe(true)
    expect(report.groups[0].records).toHaveLength(2)
    expect(report.exactMatchCount).toBe(2)
    expect(report.partialMatchCount).toBe(0)
  })

  it("groups 2 records with same invNo+date but different vendorItemNo as an 'inventory_number' partial", () => {
    const date = new Date("2026-02-04T00:00:00.000Z")
    const records: COGRecordForDedup[] = [
      makeRecord({ inventoryNumber: "INV-2", vendorItemNo: "A", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-2", vendorItemNo: "B", transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].matchKey).toBe("inventory_number")
    expect(report.groups[0].isExactMatch).toBe(false)
    expect(report.groups[0].records).toHaveLength(2)
    expect(report.exactMatchCount).toBe(0)
    expect(report.partialMatchCount).toBe(2)
  })

  it("groups 2 records with same vendorItemNo+date but different invNo as a 'vendor_item_no' partial", () => {
    const date = new Date("2026-02-05T00:00:00.000Z")
    const records: COGRecordForDedup[] = [
      makeRecord({ inventoryNumber: "INV-A", vendorItemNo: "VX", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-B", vendorItemNo: "VX", transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].matchKey).toBe("vendor_item_no")
    expect(report.groups[0].isExactMatch).toBe(false)
    expect(report.groups[0].records).toHaveLength(2)
    expect(report.partialMatchCount).toBe(2)
  })

  it("records with null vendorItemNo can only be grouped via inventoryNumber", () => {
    const date = new Date("2026-02-06T00:00:00.000Z")
    const records: COGRecordForDedup[] = [
      // These two match ONLY on invNo + date (vendorItemNo is null for one).
      makeRecord({ inventoryNumber: "INV-N", vendorItemNo: null, transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-N", vendorItemNo: "SOMETHING", transactionDate: date }),
      // This pair of null-vendorItemNo records sharing date must not match via vendor_item_no.
      makeRecord({ inventoryNumber: "INV-Q", vendorItemNo: null, transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-R", vendorItemNo: null, transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].matchKey).toBe("inventory_number")
    expect(report.groups[0].records).toHaveLength(2)
    expect(report.partialMatchCount).toBe(2)
  })

  it("does NOT group records across different transaction dates", () => {
    const records: COGRecordForDedup[] = [
      makeRecord({
        inventoryNumber: "INV-D",
        vendorItemNo: "V",
        transactionDate: new Date("2026-03-01T00:00:00.000Z"),
      }),
      makeRecord({
        inventoryNumber: "INV-D",
        vendorItemNo: "V",
        transactionDate: new Date("2026-03-02T00:00:00.000Z"),
      }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toEqual([])
    expect(report.exactMatchCount).toBe(0)
    expect(report.partialMatchCount).toBe(0)
  })

  it("treats identical calendar-day Dates (different times) as the same day", () => {
    const records: COGRecordForDedup[] = [
      makeRecord({
        inventoryNumber: "INV-T",
        vendorItemNo: "VT",
        transactionDate: new Date("2026-04-01T00:00:00.000Z"),
      }),
      makeRecord({
        inventoryNumber: "INV-T",
        vendorItemNo: "VT",
        transactionDate: new Date("2026-04-01T23:59:59.000Z"),
      }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].matchKey).toBe("both")
    expect(report.exactMatchCount).toBe(2)
  })

  it("returns multiple groups sorted by record count desc, then by groupKey alphabetical", () => {
    const date = new Date("2026-05-01T00:00:00.000Z")
    // Group A (inventory_number partial): 3 records, key starts with "INV-A".
    // Group B (vendor_item_no partial): 2 records, key starts with "V-B".
    // Group C (vendor_item_no partial): 2 records, key starts with "V-C".
    const records: COGRecordForDedup[] = [
      makeRecord({ inventoryNumber: "INV-A", vendorItemNo: "a1", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-A", vendorItemNo: "a2", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-A", vendorItemNo: "a3", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-X", vendorItemNo: "V-B", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-Y", vendorItemNo: "V-B", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-P", vendorItemNo: "V-C", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-Q", vendorItemNo: "V-C", transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(3)
    // Largest group first.
    expect(report.groups[0].matchKey).toBe("inventory_number")
    expect(report.groups[0].records).toHaveLength(3)
    // The two size-2 groups tie → alphabetical by groupKey.
    const [second, third] = [report.groups[1], report.groups[2]]
    expect(second.records).toHaveLength(2)
    expect(third.records).toHaveLength(2)
    expect(second.groupKey < third.groupKey).toBe(true)
    expect(report.exactMatchCount).toBe(0)
    expect(report.partialMatchCount).toBe(7)
  })

  it("'both' wins when a record could match multiple dimensions", () => {
    const date = new Date("2026-06-01T00:00:00.000Z")
    // r1 + r2: exact duplicates (both invNo + vendorItemNo match).
    // r3: same vendorItemNo but different invNo → would also be a partial.
    const records: COGRecordForDedup[] = [
      makeRecord({ id: "r1", inventoryNumber: "INV-Z", vendorItemNo: "VZ", transactionDate: date }),
      makeRecord({ id: "r2", inventoryNumber: "INV-Z", vendorItemNo: "VZ", transactionDate: date }),
      makeRecord({ id: "r3", inventoryNumber: "INV-OTHER", vendorItemNo: "VZ", transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    // One "both" group (r1 + r2). r3 has no remaining partner for a partial group
    // because r1/r2 were claimed by "both" and r3 alone cannot form a group.
    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].matchKey).toBe("both")
    expect(report.groups[0].records.map((r) => r.id)).toEqual(["r1", "r2"])
    expect(report.exactMatchCount).toBe(2)
    expect(report.partialMatchCount).toBe(0)
  })

  it("handles a mixed scenario with exact + partial groups together", () => {
    const date = new Date("2026-07-15T00:00:00.000Z")
    const records: COGRecordForDedup[] = [
      // Exact pair.
      makeRecord({ id: "e1", inventoryNumber: "INV-1", vendorItemNo: "V-1", transactionDate: date }),
      makeRecord({ id: "e2", inventoryNumber: "INV-1", vendorItemNo: "V-1", transactionDate: date }),
      // inventory_number partial pair.
      makeRecord({ id: "p1", inventoryNumber: "INV-2", vendorItemNo: "A", transactionDate: date }),
      makeRecord({ id: "p2", inventoryNumber: "INV-2", vendorItemNo: "B", transactionDate: date }),
      // vendor_item_no partial pair.
      makeRecord({ id: "p3", inventoryNumber: "INV-3", vendorItemNo: "VV", transactionDate: date }),
      makeRecord({ id: "p4", inventoryNumber: "INV-4", vendorItemNo: "VV", transactionDate: date }),
      // Lone record, no duplicates.
      makeRecord({ id: "solo", inventoryNumber: "INV-SOLO", vendorItemNo: "SOLO", transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(3)
    expect(report.exactMatchCount).toBe(2)
    expect(report.partialMatchCount).toBe(4)

    const byMatchKey = Object.fromEntries(
      report.groups.map((g) => [g.matchKey, g]),
    )
    expect(byMatchKey.both.records.map((r) => r.id).sort()).toEqual(["e1", "e2"])
    expect(byMatchKey.inventory_number.records.map((r) => r.id).sort()).toEqual(["p1", "p2"])
    expect(byMatchKey.vendor_item_no.records.map((r) => r.id).sort()).toEqual(["p3", "p4"])
  })

  it("creates a group of 3+ when three or more records share an exact key", () => {
    const date = new Date("2026-08-01T00:00:00.000Z")
    const records: COGRecordForDedup[] = [
      makeRecord({ inventoryNumber: "INV-Big", vendorItemNo: "VB", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-Big", vendorItemNo: "VB", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-Big", vendorItemNo: "VB", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-Big", vendorItemNo: "VB", transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].matchKey).toBe("both")
    expect(report.groups[0].records).toHaveLength(4)
    expect(report.exactMatchCount).toBe(4)
    expect(report.partialMatchCount).toBe(0)
  })

  it("inventory_number partial wins over vendor_item_no when a record could claim both", () => {
    const date = new Date("2026-09-01T00:00:00.000Z")
    // r1 + r2 share invNo (different vendorItemNo) → inventory_number partial.
    // r3 shares vendorItemNo with r2 → would form a vendor_item_no partial with r2,
    // but r2 is already claimed by the inventory_number group so r3 is orphaned.
    const records: COGRecordForDedup[] = [
      makeRecord({ id: "r1", inventoryNumber: "INV-9", vendorItemNo: "X", transactionDate: date }),
      makeRecord({ id: "r2", inventoryNumber: "INV-9", vendorItemNo: "Y", transactionDate: date }),
      makeRecord({ id: "r3", inventoryNumber: "INV-OTHER", vendorItemNo: "Y", transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].matchKey).toBe("inventory_number")
    expect(report.groups[0].records.map((r) => r.id).sort()).toEqual(["r1", "r2"])
    expect(report.partialMatchCount).toBe(2)
  })
})
