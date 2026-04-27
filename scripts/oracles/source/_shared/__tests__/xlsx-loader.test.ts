// scripts/oracles/source/_shared/__tests__/xlsx-loader.test.ts
import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { parsePricingXlsx } from "../xlsx-loader"

async function buildXlsx(
  rows: Array<(string | number | null)[]>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Sheet1")
  rows.forEach((r) => ws.addRow(r))
  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out as ArrayBuffer)
}

describe("parsePricingXlsx", () => {
  it("parses header-named columns", async () => {
    const buf = await buildXlsx([
      ["vendorItemNo", "unitCost", "category"],
      ["AR-1", 100, "Spine"],
      ["AR-2", 200.5, "Joint Replacement"],
    ])
    const rows = await parsePricingXlsx(buf)
    expect(rows).toEqual([
      { vendorItemNo: "AR-1", unitCost: 100, category: "Spine" },
      { vendorItemNo: "AR-2", unitCost: 200.5, category: "Joint Replacement" },
    ])
  })

  it("falls back to alternate header names (Item/Price)", async () => {
    const buf = await buildXlsx([
      ["Item", "Description", "Price"],
      ["AR-1", "thing", 49.99],
    ])
    const rows = await parsePricingXlsx(buf)
    expect(rows).toEqual([
      { vendorItemNo: "AR-1", unitCost: 49.99, category: undefined },
    ])
  })

  it("respects explicit column-index map (no headers)", async () => {
    const buf = await buildXlsx([
      ["A", "B", "AR-1", "D", "E", "F", 99, "H"],
      ["A", "B", "AR-2", "D", "E", "F", 1499.5, "H"],
    ])
    const rows = await parsePricingXlsx(buf, {
      hasHeader: false,
      columns: { vendorItemNo: 3, unitCost: 7 },
    })
    expect(rows).toEqual([
      { vendorItemNo: "AR-1", unitCost: 99, category: undefined },
      { vendorItemNo: "AR-2", unitCost: 1499.5, category: undefined },
    ])
  })

  it("throws when required columns can't be resolved", async () => {
    const buf = await buildXlsx([
      ["foo", "bar"],
      ["1", "2"],
    ])
    await expect(parsePricingXlsx(buf)).rejects.toThrow(/required columns/i)
  })

  it("skips blank rows", async () => {
    const buf = await buildXlsx([
      ["vendorItemNo", "unitCost"],
      ["AR-1", 100],
      [null, null],
      ["AR-2", 200],
    ])
    const rows = await parsePricingXlsx(buf)
    expect(rows.map((r) => r.vendorItemNo)).toEqual(["AR-1", "AR-2"])
  })
})
