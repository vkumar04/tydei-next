import ExcelJS from "exceljs"
import * as XLSX from "xlsx"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

export type Cell = string | number | Date | null

export interface XlsxOptions {
  sheetName?: string
  titleRows?: string[]
  phantomTailRows?: number
  phantomTailColumn?: number
  richTextColumn?: number
  formulaColumn?: { index: number; sourceA: number; sourceB: number }
  hyperlinkColumn?: number
}

export async function buildXlsx(rows: Cell[][], opts: XlsxOptions = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(opts.sheetName ?? "Sheet1")
  for (const title of opts.titleRows ?? []) ws.addRow([title])
  rows.forEach((row, r) => {
    const added = ws.addRow(row.map((v) => (v === null ? undefined : v)))
    if (r === 0) return
    if (opts.richTextColumn !== undefined) {
      const cell = added.getCell(opts.richTextColumn + 1)
      const text = String(cell.value ?? "")
      const mid = Math.ceil(text.length / 2)
      cell.value = { richText: [{ text: text.slice(0, mid), font: { bold: true } }, { text: text.slice(mid) }] }
    }
    if (opts.hyperlinkColumn !== undefined) {
      const cell = added.getCell(opts.hyperlinkColumn + 1)
      cell.value = { text: String(cell.value ?? ""), hyperlink: "https://example.com/item" }
    }
    if (opts.formulaColumn) {
      const { index, sourceA, sourceB } = opts.formulaColumn
      const a = Number(row[sourceA] ?? 0)
      const b = Number(row[sourceB] ?? 0)
      const colA = ws.getColumn(sourceA + 1).letter
      const colB = ws.getColumn(sourceB + 1).letter
      added.getCell(index + 1).value = {
        formula: `${colA}${added.number}*${colB}${added.number}`,
        result: a * b,
      }
    }
  })
  if (opts.phantomTailRows) {
    const col = (opts.phantomTailColumn ?? 0) + 1
    const start = ws.rowCount + 1
    for (let i = 0; i < opts.phantomTailRows; i++) ws.getRow(start + i).getCell(col).value = "X"
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export function buildLegacyXls(rows: Cell[][], titleRows: string[] = []): Buffer {
  const aoa = [...titleRows.map((t) => [t]), ...rows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  return XLSX.write(wb, { type: "buffer", bookType: "biff8" }) as Buffer
}

export function buildCsv(rows: Cell[][]): Buffer {
  const esc = (v: Cell): string => {
    if (v === null) return ""
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return Buffer.from(rows.map((r) => r.map(esc).join(",")).join("\n") + "\n")
}

export async function buildTextPdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const lines of pages) {
    const page = doc.addPage([612, 792])
    let y = 740
    for (const line of lines) {
      page.drawText(line, { x: 56, y, size: 12, font, color: rgb(0, 0, 0) })
      y -= 18
    }
  }
  return doc.save()
}

export async function rasterizeToScannedPdf(textPdf: Uint8Array, dpi = 150): Promise<Uint8Array> {
  const mupdf = await import("mupdf")
  const src = mupdf.Document.openDocument(textPdf, "application/pdf")
  const out = await PDFDocument.create()
  try {
    const scale = mupdf.Matrix.scale(dpi / 72, dpi / 72)
    for (let i = 0; i < src.countPages(); i++) {
      const page = src.loadPage(i)
      const pixmap = page.toPixmap(scale, mupdf.ColorSpace.DeviceGray, false, true)
      try {
        const png = await out.embedPng(pixmap.asPNG())
        const p = out.addPage([612, 792])
        p.drawImage(png, { x: 0, y: 0, width: 612, height: 792 })
      } finally {
        pixmap.destroy()
        page.destroy()
      }
    }
  } finally {
    src.destroy()
  }
  return out.save()
}

export const CONTRACT_FIXTURE = {
  vendor: "Orthomedix Surgical",
  contractNumber: "OMX-2026-0417",
  effective: "January 1, 2026",
  expiration: "December 31, 2028",
  totalValue: "$1,250,000",
  capitalValue: "$785,195",
  tiers: [
    { min: "$0", max: "$499,999", rate: "2%" },
    { min: "$500,000", max: "$999,999", rate: "3%" },
    { min: "$1,000,000", max: "and above", rate: "4%" },
  ],
}

export function contractPdfLines(): string[][] {
  const c = CONTRACT_FIXTURE
  return [
    [
      "SUPPLY AND REBATE AGREEMENT",
      `Contract Number: ${c.contractNumber}`,
      `Vendor: ${c.vendor}`,
      "Facility: Lighthouse Surgical Center",
      `Effective Date: ${c.effective}`,
      `Expiration Date: ${c.expiration}`,
      `Total Contract Value: ${c.totalValue}`,
      "",
      "1. Products. Vendor shall supply orthopedic implants and instruments",
      "   in the Joint Replacement and Spine categories.",
      "",
      "2. Spend Rebate. Facility earns a rebate on annual eligible spend:",
      ...c.tiers.map((t, i) => `   Tier ${i + 1}: ${t.min} to ${t.max} - ${t.rate} of spend`),
      "   Rebates are calculated annually and paid within 60 days.",
    ],
    [
      "3. Capital Equipment. Vendor provides one surgical robot under a",
      `   tie-in arrangement. Amount Financed: ${c.capitalValue}`,
      "   Payment Term: 36 months. Interest Rate: 0%.",
      "",
      "4. Term. This Agreement remains in effect until the Expiration Date.",
      "",
      "Signed: ______________________  Date: ____________",
    ],
  ]
}

export interface CogFixtureRow {
  po: string
  date: Date
  vendorItemNo: string
  description: string
  vendor: string
  category: string
  quantity: number
  unitCost: number
}

export function cogFixtureRows(count: number, seed = 1): CogFixtureRow[] {
  const vendors = ["Stryker", "Medtronic", "Arthrex", "Smith & Nephew"]
  const categories = ["Joint Replacement", "Spine", "Sports Medicine", "Arthroscopy"]
  let s = seed
  const rand = () => {
    s = (s * 48271) % 2147483647
    return s / 2147483647
  }
  const rows: CogFixtureRow[] = []
  for (let i = 0; i < count; i++) {
    const v = i % vendors.length
    const day = 1 + (i % 28)
    rows.push({
      po: `PO-FX-${String(seed).padStart(2, "0")}-${String(i).padStart(6, "0")}`,
      date: new Date(Date.UTC(2026, (i % 9), day)),
      vendorItemNo: `FX-${v}-${String(i % 500).padStart(4, "0")}`,
      description: `Fixture Implant ${i % 500} (${categories[v]})`,
      vendor: vendors[v]!,
      category: categories[v]!,
      quantity: 1 + Math.floor(rand() * 5),
      unitCost: Math.round((50 + rand() * 4950) * 100) / 100,
    })
  }
  return rows
}

export const COG_HEADER: Cell[] = [
  "PO Number",
  "Transaction Date",
  "Vendor Item No",
  "Description",
  "Vendor",
  "Category",
  "Quantity",
  "Unit Cost",
  "Extended Price",
]

export function cogMatrix(rows: CogFixtureRow[]): Cell[][] {
  return [
    COG_HEADER,
    ...rows.map((r) => [
      r.po,
      r.date,
      r.vendorItemNo,
      r.description,
      r.vendor,
      r.category,
      r.quantity,
      r.unitCost,
      Math.round(r.quantity * r.unitCost * 100) / 100,
    ]),
  ]
}

export function cogTotal(rows: CogFixtureRow[]): number {
  return Math.round(rows.reduce((a, r) => a + Math.round(r.quantity * r.unitCost * 100) / 100, 0) * 100) / 100
}
