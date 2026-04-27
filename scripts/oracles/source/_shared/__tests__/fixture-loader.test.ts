// scripts/oracles/source/_shared/__tests__/fixture-loader.test.ts
import { describe, it, expect } from "vitest"
import { parsePricingCsv, parseCogCsv } from "../fixture-loader"

describe("parsePricingCsv", () => {
  it("parses standard headers", () => {
    const csv = `vendorItemNo,unitCost,category,manufacturer
ARC-1,100.00,Spine,Stryker
ARC-2,200.50,Joint Replacement,
`
    const rows = parsePricingCsv(csv)
    expect(rows).toEqual([
      { vendorItemNo: "ARC-1", unitCost: 100.0, category: "Spine", manufacturer: "Stryker" },
      { vendorItemNo: "ARC-2", unitCost: 200.5, category: "Joint Replacement", manufacturer: undefined },
    ])
  })

  it("ignores blank lines and surrounding whitespace", () => {
    const csv = `vendorItemNo,unitCost
   ARC-1  ,  100.00

ARC-2,200.00
`
    const rows = parsePricingCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0].vendorItemNo).toBe("ARC-1")
    expect(rows[0].unitCost).toBe(100)
  })

  it("throws if vendorItemNo or unitCost columns missing", () => {
    expect(() => parsePricingCsv(`foo,bar\n1,2\n`)).toThrow(
      /vendorItemNo|unitCost/i,
    )
  })

  it("throws if a unitCost cell is not parseable", () => {
    expect(() =>
      parsePricingCsv(`vendorItemNo,unitCost\nARC-1,abc\n`),
    ).toThrow(/unitCost/)
  })
})

describe("parseCogCsv", () => {
  it("parses standard headers", () => {
    const csv = `vendorItemNo,quantity,unitCost,extendedPrice,transactionDate,category
ARC-1,5,100.00,500.00,2024-03-15,Spine
ARC-2,2,250.00,500.00,2024-04-01,
`
    const rows = parseCogCsv(csv)
    expect(rows).toEqual([
      { vendorItemNo: "ARC-1", quantity: 5, unitCost: 100, extendedPrice: 500, transactionDate: "2024-03-15", category: "Spine", inventoryNumber: undefined, inventoryDescription: undefined },
      { vendorItemNo: "ARC-2", quantity: 2, unitCost: 250, extendedPrice: 500, transactionDate: "2024-04-01", category: undefined, inventoryNumber: undefined, inventoryDescription: undefined },
    ])
  })

  it("derives extendedPrice = quantity × unitCost when blank", () => {
    const csv = `vendorItemNo,quantity,unitCost,extendedPrice,transactionDate
ARC-1,5,100.00,,2024-03-15
`
    const rows = parseCogCsv(csv)
    expect(rows[0].extendedPrice).toBe(500)
  })

  it("throws if required columns missing", () => {
    expect(() => parseCogCsv(`foo\n1\n`)).toThrow(
      /vendorItemNo|quantity|unitCost|transactionDate/i,
    )
  })
})
