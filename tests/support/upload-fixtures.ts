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

export interface PricingFixtureRow {
  vendorItemNo: string
  manufacturerNo: string
  description: string
  listPrice: number
  contractPrice: number
  category: string
  uom: string
}

export function pricingFixtureRows(count: number, seed = 1): PricingFixtureRow[] {
  const categories = ["Joint Replacement", "Spine", "Sports Medicine", "Arthroscopy"]
  return Array.from({ length: count }, (_, i) => {
    const list = 100 + ((i * 37 + seed * 11) % 4900)
    return {
      vendorItemNo: `PX-${String(seed).padStart(2, "0")}-${String(i).padStart(5, "0")}`,
      manufacturerNo: `MFG-${seed}-${i}`,
      description: `Pricing Fixture Item ${i}`,
      listPrice: list,
      contractPrice: Math.round(list * 0.82 * 100) / 100,
      category: categories[i % categories.length]!,
      uom: i % 3 === 0 ? "BX" : "EA",
    }
  })
}

export const PRICING_HEADER_VENDOR_STYLE: Cell[] = [
  "CATALOG NO",
  "MFG PART #",
  "ITEM DESCRIPTION",
  "LIST PRICE",
  "NET PRICE",
  "PRODUCT LINE",
  "UOM",
  "EFFECTIVE DATE",
]

export function pricingMatrix(rows: PricingFixtureRow[], effective = new Date(Date.UTC(2026, 0, 1))): Cell[][] {
  return [
    PRICING_HEADER_VENDOR_STYLE,
    ...rows.map((r) => [r.vendorItemNo, r.manufacturerNo, r.description, r.listPrice, r.contractPrice, r.category, r.uom, effective]),
  ]
}

export const VENDOR_CONTRACT_FIXTURE = {
  contractName: "VNDE2E Stryker Joint Implant Agreement",
  contractNumber: "VND-E2E-2026-0815",
  vendor: "Stryker",
  facility: "Lighthouse Surgical Center",
  effective: "March 1, 2026",
  effectiveIso: "2026-03-01",
  expiration: "February 28, 2029",
  expirationIso: "2029-02-28",
  totalValue: "$2,400,000",
  totalValueNumber: 2_400_000,
  tiers: [
    { min: "$0", max: "$749,999", rate: "1.5%", minNumber: 0, fraction: 0.015 },
    { min: "$750,000", max: "$1,499,999", rate: "2.5%", minNumber: 750_000, fraction: 0.025 },
    { min: "$1,500,000", max: "and above", rate: "3.5%", minNumber: 1_500_000, fraction: 0.035 },
  ],
}

export function vendorContractPdfLines(): string[][] {
  const c = VENDOR_CONTRACT_FIXTURE
  return [
    [
      "SUPPLY AND REBATE AGREEMENT",
      `Contract Name: ${c.contractName}`,
      `Contract Number: ${c.contractNumber}`,
      `Vendor: ${c.vendor}`,
      `Facility: ${c.facility}`,
      `Effective Date: ${c.effective}`,
      `Expiration Date: ${c.expiration}`,
      `Total Contract Value: ${c.totalValue}`,
      "",
      "1. Products. Vendor shall supply knee and hip joint replacement",
      "   implants at the contract prices in Exhibit A.",
      "",
      "2. Spend Rebate. Facility earns a rebate on annual eligible spend:",
      ...c.tiers.map((t, i) => `   Tier ${i + 1}: ${t.min} to ${t.max} - ${t.rate} of spend`),
      "   Rebates are calculated annually and paid within 60 days.",
    ],
    [
      "3. Term. This Agreement remains in effect until the Expiration Date.",
      "   No capital equipment is provided under this Agreement.",
      "",
      "Signed: ______________________  Date: ____________",
    ],
  ]
}

export interface VendorCogRow {
  itemNumber: string
  description: string
  mfrNo: string
  po: string
  date: Date
  category: string
  quantity: number
  unitPrice: number
}

export function vendorCogRows(count: number, seed: number): VendorCogRow[] {
  const categories = ["Joint Replacement", "Spine", "Sports Medicine"]
  return Array.from({ length: count }, (_, i) => {
    const s = String(seed).padStart(2, "0")
    return {
      itemNumber: `VCG-${s}-${String(i).padStart(4, "0")}`,
      description: `Vendor COG Implant ${seed}-${i}`,
      mfrNo: `VMFR-${s}-${i}`,
      po: `VPO-${s}-${String(i).padStart(5, "0")}`,
      date: new Date(Date.UTC(2026, i % 6, 1 + (i % 27))),
      category: categories[i % categories.length]!,
      quantity: 1 + (i % 4),
      unitPrice: Math.round((125 + ((i * 97 + seed * 13) % 3875) + (i % 100) / 100) * 100) / 100,
    }
  })
}

export function vendorCogExtended(r: VendorCogRow): number {
  return Math.round(r.quantity * r.unitPrice * 100) / 100
}

export function vendorCogMatrix(rows: VendorCogRow[], dateAsIso = false): Cell[][] {
  return [
    ["Item Number", "Description", "Mfr No", "PO Number", "Transaction Date", "Category", "Quantity", "Unit Price", "Extended Price"],
    ...rows.map((r) => [
      r.itemNumber,
      r.description,
      r.mfrNo,
      r.po,
      dateAsIso ? r.date.toISOString().slice(0, 10) : r.date,
      r.category,
      r.quantity,
      r.unitPrice,
      vendorCogExtended(r),
    ]),
  ]
}

export interface VendorBenchmarkRow {
  itemNumber: string
  description: string
  category: string
  currentPrice: number
  annualUnits: number
  nationalAvg: number
  p25: number
  p50: number
  p75: number
  min: number
  max: number
  sampleSize: number
}

export function vendorBenchmarkRows(count: number, seed: number, priceShift = 0): VendorBenchmarkRow[] {
  const categories = ["Ortho-Spine", "Biologics", "Instruments"]
  return Array.from({ length: count }, (_, i) => {
    const base = 200 + ((i * 53 + seed * 7) % 4800) + priceShift
    return {
      itemNumber: `VBM-${String(seed).padStart(2, "0")}-${String(i).padStart(5, "0")}`,
      description: `Benchmark Construct ${seed}-${i}`,
      category: categories[i % categories.length]!,
      currentPrice: base + 40,
      annualUnits: 10 + (i % 90),
      nationalAvg: base,
      p25: base - 30,
      p50: base - 5,
      p75: base + 25,
      min: base - 80,
      max: base + 120,
      sampleSize: 5 + (i % 50),
    }
  })
}

export function vendorBenchmarkMatrix(rows: VendorBenchmarkRow[]): Cell[][] {
  return [
    ["Item Number", "Description", "Category", "Current Price", "TRL 12 Units", "National Avg Price", "P25", "Median", "P75", "Min Price", "Max Price", "Sample Size"],
    ...rows.map((r) => [r.itemNumber, r.description, r.category, r.currentPrice, r.annualUnits, r.nationalAvg, r.p25, r.p50, r.p75, r.min, r.max, r.sampleSize]),
  ]
}

export interface VendorUsageLine {
  ref: string
  name: string
  date: string
  quantity: number
  unitCost: number
  category: string
}

export function vendorUsageLines(): VendorUsageLine[] {
  const products = [
    { ref: "VPR-0001", name: "VNDE2E Knee Femoral Component", unitCost: 1200 },
    { ref: "VPR-0002", name: "VNDE2E Knee Tibial Tray", unitCost: 850 },
    { ref: "VPR-0003", name: "VNDE2E Hip Acetabular Shell", unitCost: 990 },
    { ref: "VPR-0004", name: "VNDE2E Hip Femoral Stem", unitCost: 1410 },
  ]
  const months = ["2026-01-15", "2026-02-15", "2026-03-15"]
  const lines: VendorUsageLine[] = []
  products.forEach((p, pi) => {
    months.forEach((m, mi) => {
      lines.push({ ref: p.ref, name: p.name, date: m, quantity: 2 + pi + mi, unitCost: p.unitCost, category: "Ortho-Joints" })
    })
  })
  return lines
}

export function vendorUsageMatrix(lines: VendorUsageLine[]): Cell[][] {
  return [
    ["Product Name", "Ref Number", "Transaction Date", "Quantity", "Unit Cost", "Extended Cost", "Category"],
    ...lines.map((l) => [l.name, l.ref, l.date, l.quantity, l.unitCost, Math.round(l.quantity * l.unitCost * 100) / 100, l.category]),
  ]
}

export interface VendorProposedPrice {
  ref: string
  name: string
  currentPrice: number
  proposedPrice: number
}

export function vendorProposedPrices(): VendorProposedPrice[] {
  return [
    { ref: "VPR-0001", name: "VNDE2E Knee Femoral Component", currentPrice: 1200, proposedPrice: 1100 },
    { ref: "VPR-0002", name: "VNDE2E Knee Tibial Tray", currentPrice: 850, proposedPrice: 790 },
    { ref: "VPR-0003", name: "VNDE2E Hip Acetabular Shell", currentPrice: 990, proposedPrice: 940 },
  ]
}

export function vendorProposedPriceMatrix(rows: VendorProposedPrice[]): Cell[][] {
  return [
    ["Ref Number", "Product Name", "Current Price", "Proposed Price", "Category"],
    ...rows.map((r) => [r.ref, r.name, r.currentPrice, r.proposedPrice, "Ortho-Joints"]),
  ]
}

export type ContractFixture = typeof CONTRACT_FIXTURE

export function contractPdfLinesFor(c: ContractFixture, title = "SUPPLY AND REBATE AGREEMENT"): string[][] {
  return [
    [
      title,
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

export interface InvoiceFixtureLine {
  sku: string
  description: string
  quantity: number
  unitPrice: number
}

export interface InvoiceFixture {
  invoiceNumber: string
  invoiceDate: string
  vendor: string
  lines: InvoiceFixtureLine[]
  tax: number
  shipping: number
}

export function invoiceLineTotal(l: InvoiceFixtureLine): number {
  return Math.round(l.quantity * l.unitPrice * 100) / 100
}

export function invoiceSubtotal(inv: InvoiceFixture): number {
  return Math.round(inv.lines.reduce((a, l) => a + invoiceLineTotal(l), 0) * 100) / 100
}

export function invoiceTotal(inv: InvoiceFixture): number {
  return Math.round((invoiceSubtotal(inv) + inv.tax + inv.shipping) * 100) / 100
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function invoicePdfLines(inv: InvoiceFixture): string[][] {
  const [y, m, d] = inv.invoiceDate.split("-")
  return [
    [
      `${inv.vendor.toUpperCase()} - INVOICE`,
      `Vendor: ${inv.vendor}`,
      `Invoice Number: ${inv.invoiceNumber}`,
      `Invoice Date: ${m}/${d}/${y}`,
      "Bill To: Lighthouse Surgical Center",
      "Payment Terms: Net 30",
      "",
      "Line  Item No       Description                      Qty   Unit Price   Amount",
      ...inv.lines.map(
        (l, i) =>
          `${i + 1}     ${l.sku.padEnd(14)}  ${l.description.padEnd(32)} ${String(l.quantity).padStart(3)}   ${money(l.unitPrice).padStart(10)}   ${money(invoiceLineTotal(l))}`,
      ),
      "",
      `Subtotal: ${money(invoiceSubtotal(inv))}`,
      `Tax: ${money(inv.tax)}`,
      `Shipping: ${money(inv.shipping)}`,
      `Invoice Total: ${money(invoiceTotal(inv))}`,
    ],
  ]
}

export interface Edi810Invoice {
  invoiceNumber: string
  invoiceDate: string
  vendor: string
  poNumber?: string
  lines: InvoiceFixtureLine[]
}

export function buildEdi810(invoices: Edi810Invoice[]): Buffer {
  const segs: string[] = [
    "ISA*00*          *00*          *ZZ*SENDERID       *ZZ*RECEIVERID     *261007*1200*U*00401*000000101*0*P*>",
    "GS*IN*SENDERID*RECEIVERID*20261007*1200*101*X*004010",
  ]
  invoices.forEach((inv, n) => {
    const control = String(n + 1).padStart(4, "0")
    const body: string[] = [
      `ST*810*${control}`,
      `BIG*${inv.invoiceDate.replace(/-/g, "")}*${inv.invoiceNumber}${inv.poNumber ? `**${inv.poNumber}` : ""}`,
      `N1*VN*${inv.vendor.toUpperCase()}`,
      "N1*BT*LIGHTHOUSE SURGICAL CENTER",
    ]
    inv.lines.forEach((l, i) => {
      body.push(`IT1*${i + 1}*${l.quantity}*EA*${l.unitPrice}**VP*${l.sku}`)
      body.push(`PID*F****${l.description}`)
    })
    const cents = Math.round(inv.lines.reduce((a, l) => a + invoiceLineTotal(l), 0) * 100)
    body.push(`TDS*${cents}`, `CTT*${inv.lines.length}`)
    body.push(`SE*${body.length + 1}*${control}`)
    segs.push(...body)
  })
  segs.push(`GE*${invoices.length}*101`, "IEA*1*000000101")
  return Buffer.from(segs.join("~\n") + "~\n")
}

export interface CaseCostingFixture {
  cases: {
    caseNumber: string
    mrn: string
    surgeon: string
    date: string
    payor: string
    procedures: { cpt: string; description: string }[]
    supplies: { manufacturer: string; material: string; catalog: string; unitCost: number; quantity: number }[]
  }[]
}

export function caseCostingFixture(prefix: string): CaseCostingFixture {
  return {
    cases: [
      {
        caseNumber: `${prefix}-100`,
        mrn: `${prefix}-MRN1`,
        surgeon: "Dr. Alicia Moreno",
        date: "2026-08-04",
        payor: "Aetna",
        procedures: [
          { cpt: "29881", description: "Knee arthroscopy meniscectomy" },
          { cpt: "29882", description: "Knee arthroscopy meniscus repair" },
        ],
        supplies: [
          { manufacturer: "Arthrex", material: "Disposable Knee Jig", catalog: `${prefix}-AR9000`, unitCost: 125, quantity: 1 },
          { manufacturer: "Arthrex", material: "Suture Anchor", catalog: `${prefix}-AR9002`, unitCost: 22, quantity: 4 },
        ],
      },
      {
        caseNumber: `${prefix}-101`,
        mrn: `${prefix}-MRN2`,
        surgeon: "Dr. Samuel O'Brien",
        date: "2026-08-11",
        payor: "Medicare",
        procedures: [{ cpt: "27447", description: "Total knee arthroplasty" }],
        supplies: [
          { manufacturer: "Stryker", material: "Bone Cement Kit", catalog: `${prefix}-STR5500`, unitCost: 450, quantity: 2 },
        ],
      },
      {
        caseNumber: `${prefix}-102`,
        mrn: `${prefix}-MRN3`,
        surgeon: "Dr. Alicia Moreno",
        date: "2026-09-02",
        payor: "Blue Cross",
        procedures: [{ cpt: "22551", description: "Anterior cervical fusion" }],
        supplies: [
          { manufacturer: "Medtronic", material: "Spinal Screw", catalog: `${prefix}-MDT1200`, unitCost: 89.5, quantity: 6 },
          { manufacturer: "Medtronic", material: "Interbody Cage", catalog: `${prefix}-MDT1300`, unitCost: 1180.25, quantity: 1 },
        ],
      },
    ],
  }
}

function usDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  return `${m}/${d}/${y}`
}

export function casePatientFieldsCsv(f: CaseCostingFixture): Buffer {
  return buildCsv([
    ["Patient MRN", "Case ID", "Facility Name", "Surgeon Name", "Date of Surgery", "Primary Payor", "OR Name"],
    ...f.cases.map((c) => [c.mrn, c.caseNumber, "Lighthouse Surgical Center", c.surgeon, usDate(c.date), c.payor, "OR-1"]),
  ])
}

export function caseProceduresCsv(f: CaseCostingFixture): Buffer {
  return buildCsv([
    ["Case ID", "Date of Surgery", "CPT Code", "Procedure Description", "CPT Is Primary YN", "Procedure Sequence"],
    ...f.cases.flatMap((c) =>
      c.procedures.map((p, i) => [c.caseNumber, usDate(c.date), p.cpt, p.description, i === 0 ? "Y" : "N", i + 1]),
    ),
  ])
}

export function caseSuppliesCsv(f: CaseCostingFixture): Buffer {
  return buildCsv([
    ["Patient MRN", "Case ID", "Manufacturer", "Material Name", "Unit Cost", "Catalog number", "Quantity Used", "Used Cost"],
    ...f.cases.flatMap((c) =>
      c.supplies.map((s) => [
        c.mrn,
        c.caseNumber,
        s.manufacturer,
        s.material,
        s.unitCost.toFixed(2),
        s.catalog,
        s.quantity,
        (Math.round(s.unitCost * s.quantity * 100) / 100).toFixed(2),
      ]),
    ),
  ])
}

export interface PayorRateFixture {
  cpt: string
  description: string
  rate: number
}

export interface PayorContractFixture {
  payorName: string
  contractNumber: string
  effective: string
  expiration: string
  rates: PayorRateFixture[]
}

export function payorContractPdfLines(p: PayorContractFixture): string[][] {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-")
    return `${m}/${d}/${y}`
  }
  return [
    [
      "AMBULATORY SURGERY CENTER PARTICIPATION AGREEMENT",
      `Payor: ${p.payorName}`,
      "Facility: Lighthouse Surgical Center",
      `Agreement Number: ${p.contractNumber}`,
      `Effective Date: ${fmt(p.effective)}`,
      `Termination Date: ${fmt(p.expiration)}`,
      "",
      "Exhibit A - Reimbursement Schedule (per procedure, USD)",
      "CPT Code   Description                          Rate",
      ...p.rates.map((r) => `${r.cpt}      ${r.description.padEnd(36)} ${money(r.rate)}`),
      "",
      "Implants are reimbursed at invoice cost (pass-through).",
      "Multiple procedures: 100% primary, 50% secondary.",
    ],
  ]
}

export function payorRatesCsv(rates: PayorRateFixture[]): Buffer {
  return buildCsv([["CPT Code", "Description", "Rate"], ...rates.map((r) => [r.cpt, r.description, r.rate.toFixed(2)])])
}

export interface AmendmentFixture {
  contractName: string
  vendor: string
  originalExpiration: string
  newExpiration: string
  newTotalValue: string
  amendmentEffective: string
}

export function amendmentPdfLines(a: AmendmentFixture): string[][] {
  return [
    [
      "FIRST AMENDMENT TO SUPPLY AGREEMENT",
      `Agreement: ${a.contractName}`,
      `Vendor: ${a.vendor}`,
      "Facility: Lighthouse Surgical Center",
      `Amendment Effective Date: ${a.amendmentEffective}`,
      "",
      "The parties agree to amend the Agreement as follows:",
      "",
      `1. Term Extension. The Expiration Date of the Agreement is changed from`,
      `   ${a.originalExpiration} to ${a.newExpiration}.`,
      "",
      `2. Contract Value. The Total Contract Value is amended to ${a.newTotalValue}.`,
      "",
      "3. All other terms and conditions of the Agreement remain unchanged.",
      "",
      "Signed: ______________________  Date: ____________",
    ],
  ]
}
