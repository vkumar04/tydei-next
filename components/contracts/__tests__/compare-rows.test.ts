import { describe, it, expect } from "vitest"
import {
  buildCompareRows,
  type CompareContract,
} from "@/components/contracts/compare-row-builder"

describe("buildCompareRows", () => {
  it("produces one row per metric and one column per contract", () => {
    const c: CompareContract[] = [
      {
        id: "1",
        name: "A",
        vendorName: "Stryker",
        contractType: "usage",
        status: "active",
        effectiveDate: new Date("2025-01-01"),
        expirationDate: new Date("2027-01-01"),
        totalValue: 1_000_000,
        rebateEarned: 50_000,
        spend: 800_000,
        score: 82,
        scoreBand: "B",
      },
      {
        id: "2",
        name: "B",
        vendorName: "Medtronic",
        contractType: "usage",
        status: "active",
        effectiveDate: new Date("2025-02-01"),
        expirationDate: new Date("2028-02-01"),
        totalValue: 2_000_000,
        rebateEarned: 80_000,
        spend: 1_200_000,
        score: 91,
        scoreBand: "A",
      },
    ]
    const rows = buildCompareRows(c)
    expect(rows).toHaveLength(10)
    const vendorRow = rows.find((r) => r.label === "Vendor")
    expect(vendorRow?.values).toEqual(["Stryker", "Medtronic"])
    const totalRow = rows.find((r) => r.label === "Total Value")
    expect(totalRow?.values).toEqual(["$1,000,000", "$2,000,000"])
  })
})
