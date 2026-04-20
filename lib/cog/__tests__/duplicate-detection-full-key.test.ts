/**
 * Full-key rule — focused 3-case spec per Charles W1.W-A2 plan.
 *
 * Complements the broader `duplicate-detection.test.ts` suite. These
 * three assertions are the canonical behavior:
 *
 *   1. All compared columns identical → duplicate
 *   2. One column different → NOT a duplicate
 *   3. Null fields treated as their own bucket (two nulls match, a
 *      null does not match a non-null)
 */
import { describe, it, expect } from "vitest"
import { detectDuplicates, type COGRecordForDedup } from "../duplicate-detection"

const BASE_DATE = new Date("2026-04-20T00:00:00.000Z")

function record(overrides: Partial<COGRecordForDedup>): COGRecordForDedup {
  return {
    inventoryNumber: "INV-FULL",
    vendorItemNo: "VIN-FULL",
    transactionDate: BASE_DATE,
    quantity: 3,
    unitCost: 12.5,
    extendedPrice: 37.5,
    ...overrides,
  }
}

describe("detectDuplicates — full-key rule (Charles W1.W-A2)", () => {
  it("marks two rows as duplicates when ALL compared columns match", () => {
    const report = detectDuplicates([record({}), record({})])
    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].matchKey).toBe("both")
    expect(report.groups[0].isExactMatch).toBe(true)
    expect(report.groups[0].records).toHaveLength(2)
    expect(report.exactMatchCount).toBe(2)
    expect(report.partialMatchCount).toBe(0)
  })

  it("does NOT mark rows as duplicates when even one column differs", () => {
    const cases: Array<[COGRecordForDedup, COGRecordForDedup]> = [
      [record({}), record({ inventoryNumber: "INV-OTHER" })],
      [record({}), record({ vendorItemNo: "VIN-OTHER" })],
      [
        record({}),
        record({ transactionDate: new Date("2026-04-21T00:00:00.000Z") }),
      ],
      [record({}), record({ quantity: 4 })],
      [record({}), record({ unitCost: 12.51 })],
      [record({}), record({ extendedPrice: 37.49 })],
    ]

    for (const [a, b] of cases) {
      const report = detectDuplicates([a, b])
      expect(
        report.groups,
        `expected no dupes for pair differing; got ${JSON.stringify(report.groups)}`,
      ).toHaveLength(0)
      expect(report.exactMatchCount).toBe(0)
      expect(report.partialMatchCount).toBe(0)
    }
  })

  it("treats null fields as their own bucket", () => {
    const bothNull = detectDuplicates([
      record({ vendorItemNo: null }),
      record({ vendorItemNo: null }),
    ])
    expect(bothNull.groups).toHaveLength(1)
    expect(bothNull.exactMatchCount).toBe(2)

    const oneNull = detectDuplicates([
      record({ vendorItemNo: null }),
      record({ vendorItemNo: "VIN-SOMETHING" }),
    ])
    expect(oneNull.groups).toHaveLength(0)

    const bothExtNull = detectDuplicates([
      record({ extendedPrice: null }),
      record({ extendedPrice: null }),
    ])
    expect(bothExtNull.groups).toHaveLength(1)
    expect(bothExtNull.exactMatchCount).toBe(2)

    const oneExtNull = detectDuplicates([
      record({ extendedPrice: null }),
      record({ extendedPrice: 37.5 }),
    ])
    expect(oneExtNull.groups).toHaveLength(0)
  })
})
