import { describe, it, expect } from "vitest"
import {
  detectDuplicates,
  type COGRecordForDedup,
} from "../duplicate-detection"

/**
 * Full-key dedupe rule (Charles W1.W-A2).
 *
 * Under the new rule, two rows are duplicates only when EVERY compared
 * column matches. The compared columns are:
 *   inventoryNumber, vendorItemNo, transactionDate (day),
 *   quantity, unitCost, extendedPrice
 *
 * Tests below lock that behavior in.
 */

function makeRecord(
  overrides: Partial<COGRecordForDedup> & Pick<COGRecordForDedup, "inventoryNumber">,
): COGRecordForDedup {
  return {
    vendorItemNo: "V-1",
    transactionDate: new Date("2026-01-15T00:00:00.000Z"),
    unitCost: 10,
    quantity: 1,
    extendedPrice: 10,
    ...overrides,
  }
}

describe("detectDuplicates (full-key rule)", () => {
  it("returns empty groups for an empty input", () => {
    const report = detectDuplicates([])
    expect(report.groups).toEqual([])
    expect(report.exactMatchCount).toBe(0)
    expect(report.partialMatchCount).toBe(0)
  })

  it("returns empty groups for a single record", () => {
    const report = detectDuplicates([makeRecord({ inventoryNumber: "INV-1" })])
    expect(report.groups).toEqual([])
    expect(report.exactMatchCount).toBe(0)
    expect(report.partialMatchCount).toBe(0)
  })

  it("groups two rows when EVERY compared column is identical", () => {
    const date = new Date("2026-02-03T00:00:00.000Z")
    const records: COGRecordForDedup[] = [
      makeRecord({ inventoryNumber: "INV-1", vendorItemNo: "V-9", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-1", vendorItemNo: "V-9", transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].matchKey).toBe("both")
    expect(report.groups[0].isExactMatch).toBe(true)
    expect(report.exactMatchCount).toBe(2)
    expect(report.partialMatchCount).toBe(0)
  })

  it("does NOT group rows that differ on quantity", () => {
    const date = new Date("2026-02-04T00:00:00.000Z")
    const records: COGRecordForDedup[] = [
      makeRecord({ inventoryNumber: "INV-2", quantity: 1, extendedPrice: 10, transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-2", quantity: 2, extendedPrice: 20, transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(0)
  })

  it("does NOT group rows that differ on unitCost", () => {
    const date = new Date("2026-02-05T00:00:00.000Z")
    const records: COGRecordForDedup[] = [
      makeRecord({ inventoryNumber: "INV-3", unitCost: 10, transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-3", unitCost: 11, transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(0)
  })

  it("does NOT group rows that differ on extendedPrice", () => {
    const date = new Date("2026-02-06T00:00:00.000Z")
    const records: COGRecordForDedup[] = [
      makeRecord({ inventoryNumber: "INV-4", extendedPrice: 10, transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-4", extendedPrice: 11, transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(0)
  })

  it("does NOT group rows that differ on vendorItemNo (was a partial match pre-W1.W)", () => {
    const date = new Date("2026-02-07T00:00:00.000Z")
    const records: COGRecordForDedup[] = [
      makeRecord({ inventoryNumber: "INV-5", vendorItemNo: "A", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-5", vendorItemNo: "B", transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(0)
    expect(report.partialMatchCount).toBe(0)
  })

  it("does NOT group rows that differ only on inventoryNumber", () => {
    const date = new Date("2026-02-08T00:00:00.000Z")
    const records: COGRecordForDedup[] = [
      makeRecord({ inventoryNumber: "INV-A", vendorItemNo: "VX", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-B", vendorItemNo: "VX", transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(0)
  })

  it("does NOT group rows across different transaction dates", () => {
    const records: COGRecordForDedup[] = [
      makeRecord({
        inventoryNumber: "INV-D",
        transactionDate: new Date("2026-03-01T00:00:00.000Z"),
      }),
      makeRecord({
        inventoryNumber: "INV-D",
        transactionDate: new Date("2026-03-02T00:00:00.000Z"),
      }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toEqual([])
  })

  it("treats same-day Dates with different times as the same day", () => {
    const records: COGRecordForDedup[] = [
      makeRecord({
        inventoryNumber: "INV-T",
        transactionDate: new Date("2026-04-01T00:00:00.000Z"),
      }),
      makeRecord({
        inventoryNumber: "INV-T",
        transactionDate: new Date("2026-04-01T23:59:59.000Z"),
      }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(1)
    expect(report.exactMatchCount).toBe(2)
  })

  it("groups 3+ identical rows together", () => {
    const date = new Date("2026-08-01T00:00:00.000Z")
    const records: COGRecordForDedup[] = [
      makeRecord({ inventoryNumber: "INV-Big", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-Big", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-Big", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-Big", transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].records).toHaveLength(4)
    expect(report.exactMatchCount).toBe(4)
  })

  it("sorts groups by record count desc, then groupKey alphabetical", () => {
    const date = new Date("2026-05-01T00:00:00.000Z")
    const records: COGRecordForDedup[] = [
      // Group A (3 identical)
      makeRecord({ inventoryNumber: "INV-A", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-A", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-A", transactionDate: date }),
      // Group B (2 identical)
      makeRecord({ inventoryNumber: "INV-B", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-B", transactionDate: date }),
      // Group C (2 identical)
      makeRecord({ inventoryNumber: "INV-C", transactionDate: date }),
      makeRecord({ inventoryNumber: "INV-C", transactionDate: date }),
    ]

    const report = detectDuplicates(records)

    expect(report.groups).toHaveLength(3)
    expect(report.groups[0].records).toHaveLength(3)
    expect(report.groups[1].records).toHaveLength(2)
    expect(report.groups[2].records).toHaveLength(2)
    expect(report.groups[1].groupKey < report.groups[2].groupKey).toBe(true)
  })
})
