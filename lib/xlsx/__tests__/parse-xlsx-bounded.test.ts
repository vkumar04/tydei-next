import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import {
  parseXlsxMatrixBounded,
  XlsxLimitError,
} from "@/lib/xlsx/parse-xlsx-bounded"

/** Build a real .xlsx buffer with the given 2D cell data. */
async function buildXlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Sheet1")
  for (const r of rows) ws.addRow(r)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

const identity = (v: unknown): string => (v == null ? "" : String(v))
const trimmed = (v: unknown): string => (v == null ? "" : String(v).trim())

describe("parseXlsxMatrixBounded", () => {
  it("parses a normal workbook into a string matrix (first sheet)", async () => {
    const buf = await buildXlsx([
      ["SKU", "Description", "Price"],
      ["A-1", "Titanium screw", 12.5],
      ["B-2", "Bone cement", 40],
    ])

    const matrix = await parseXlsxMatrixBounded(buf, identity)

    expect(matrix).toEqual([
      ["SKU", "Description", "Price"],
      ["A-1", "Titanium screw", "12.5"],
      ["B-2", "Bone cement", "40"],
    ])
  })

  it("applies the caller's cellToString (e.g. trimming)", async () => {
    const buf = await buildXlsx([["  padded  "]])
    const matrix = await parseXlsxMatrixBounded(buf, trimmed)
    expect(matrix[0]).toEqual(["padded"])
  })

  it("rejects when the zip declares an oversized uncompressed payload (bomb guard)", async () => {
    // Gate 1: any real workbook's XML decompresses to far more than 1 byte,
    // so a 1-byte cap proves the pre-decompression size guard fires BEFORE
    // we ever materialize the sheet — this is the decompression-bomb defense.
    const buf = await buildXlsx([["SKU", "Description"], ["A-1", "x"]])

    await expect(
      parseXlsxMatrixBounded(buf, identity, { maxUncompressedBytes: 1 }),
    ).rejects.toBeInstanceOf(XlsxLimitError)
  })

  it("rejects a workbook that exceeds the row cap", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => [`row-${i}`])
    const buf = await buildXlsx(rows)

    await expect(
      parseXlsxMatrixBounded(buf, identity, { maxRows: 10 }),
    ).rejects.toBeInstanceOf(XlsxLimitError)
  })

  it("rejects a workbook that exceeds the cell cap", async () => {
    const wide = Array.from({ length: 5 }, () =>
      Array.from({ length: 20 }, (_, c) => `c${c}`),
    )
    const buf = await buildXlsx(wide)

    await expect(
      parseXlsxMatrixBounded(buf, identity, { maxCells: 30 }),
    ).rejects.toBeInstanceOf(XlsxLimitError)
  })

  it("allows a legitimately large-but-bounded workbook", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => [`r${i}`, i])
    const buf = await buildXlsx(rows)

    const matrix = await parseXlsxMatrixBounded(buf, identity, {
      maxRows: 10_000,
      maxCells: 1_000_000,
    })
    expect(matrix).toHaveLength(500)
    expect(matrix[499]).toEqual(["r499", "499"])
  })
})
