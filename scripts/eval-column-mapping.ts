import { readFileSync, writeFileSync } from "node:fs"
import { generateText, Output } from "ai"
import { z } from "zod"
import { claudeSonnet } from "@/lib/ai/config"
import { columnMappingPrompt } from "@/lib/ai/prompts"
import { mapColumnsWithJev } from "@/lib/ai/jev-column-mapping"
import {
  localFallbackMap,
  parseCSV,
  redactPhiSampleValues,
  type TargetField,
} from "@/lib/actions/imports/shared"

const COG_FIELDS: TargetField[] = [
  { key: "vendorName", label: "Vendor / Supplier Name", required: true },
  { key: "transactionDate", label: "Date Ordered / Transaction Date", required: true },
  { key: "description", label: "Product Name / Item Description", required: false },
  { key: "refNumber", label: "Catalog / Product Reference / Vendor Item Number", required: false },
  { key: "quantity", label: "Quantity Ordered", required: false },
  { key: "unitCost", label: "Unit Cost / Unit Price", required: false },
  { key: "extended", label: "Extended Cost / Total Line Cost", required: false },
  { key: "poNumber", label: "Purchase Order Number", required: false },
  {
    key: "multiplier",
    label: "Multiplier / Case Pack / Units per Line / Conversion Factor / Conversion Factor Ordered",
    required: false,
  },
  {
    key: "category",
    label:
      "Category / Product Category / Item Category / Class / Commodity / Commodity Code / Department / Product Group / Product Line / Segment / Classification / Spend Category / UNSPSC",
    required: false,
  },
]

const PRICING_FIELDS: TargetField[] = [
  {
    key: "vendorItemNo",
    label:
      "Vendor Item Number / Catalog Number / Reference / Reference Number / Reference Numer / Ref No / SKU / Item No / Part No",
    required: true,
  },
  { key: "productDescription", label: "Product Description / Item Name", required: false },
  { key: "contractPrice", label: "Contract Price / Unit Price / Net Cost", required: false },
  { key: "listPrice", label: "List Price / MSRP", required: false },
  { key: "manufacturerNo", label: "Manufacturer Item Number", required: false },
  { key: "uom", label: "Unit of Measure / UOM", required: false },
  { key: "category", label: "Category / Product Category", required: false },
  { key: "effectiveDate", label: "Effective Date / Start Date / Price Effective", required: false },
  { key: "expirationDate", label: "Expiration Date / End Date / Price Expires", required: false },
  { key: "carveOutPercent", label: "Carve-Out % / Carveout Percent / Carve Out Rate", required: false },
]

const CASE_FIELDS: TargetField[] = [
  { key: "caseNumber", label: "Case ID / Case Number", required: true },
  { key: "surgeryDate", label: "Date of Surgery", required: true },
  {
    key: "surgeonName",
    label: "Surgeon — accept any column whose header contains 'surgeon' or 'physician' or 'doctor' or 'provider'",
    required: false,
  },
  { key: "patientDob", label: "Patient Date of Birth", required: false },
  { key: "timeIn", label: "Time wheeled into OR / Incision Time", required: false },
  { key: "timeOut", label: "Time wheeled out of OR / Closure Time", required: false },
]

const PROCEDURE_FIELDS: TargetField[] = [
  { key: "caseNumber", label: "Case ID / Case Number", required: true },
  { key: "cptCode", label: "CPT Code / Procedure Code", required: true },
  { key: "isPrimary", label: "CPT Is Primary YN / Primary Procedure Flag", required: false },
  { key: "surgeryDate", label: "Date of Surgery", required: false },
]

const SUPPLY_FIELDS: TargetField[] = [
  { key: "caseNumber", label: "Case ID / Case Number", required: true },
  { key: "materialName", label: "Material Name / Product Description", required: true },
  { key: "vendorItemNo", label: "Catalog Number / Vendor Item Number", required: false },
  { key: "unitCost", label: "Unit Cost / Per-Unit Price", required: false },
  { key: "usedCost", label: "Used Cost / Total Line Cost", required: false },
  { key: "quantity", label: "Quantity Used / Count", required: false },
  { key: "manufacturer", label: "Manufacturer", required: false },
]

const COG_DIALOG_FIELDS: TargetField[] = [
  { key: "inventoryNumber", label: "Inventory Number", required: true },
  { key: "inventoryDescription", label: "Description", required: true },
  { key: "vendorName", label: "Vendor Name", required: false },
  { key: "vendorItemNo", label: "Vendor Item No", required: false },
  { key: "manufacturerNo", label: "Manufacturer No", required: false },
  { key: "unitCost", label: "Unit Cost", required: true },
  { key: "extendedPrice", label: "Extended Price", required: false },
  { key: "quantity", label: "Quantity", required: false },
  { key: "multiplier", label: "Multiplier (case pack / units per line)", required: false },
  { key: "transactionDate", label: "Transaction Date", required: true },
  { key: "category", label: "Category", required: false },
  { key: "poNumber", label: "Purchase Order Number", required: false },
]

const PRICING_DIALOG_FIELDS: TargetField[] = [
  { key: "vendorItemNo", label: "Vendor Item No", required: true },
  { key: "productDescription", label: "Description", required: true },
  { key: "manufacturerNo", label: "Manufacturer No", required: false },
  { key: "listPrice", label: "List Price", required: false },
  { key: "contractPrice", label: "Contract Price", required: false },
  { key: "effectiveDate", label: "Effective Date", required: true },
  { key: "expirationDate", label: "Expiration Date", required: false },
  { key: "category", label: "Category", required: false },
  { key: "uom", label: "UOM", required: false },
  { key: "carveOut", label: "Carve-Out", required: false },
]

type Case = {
  name: string
  fields: TargetField[]
  headers: string[]
  rows: Record<string, string>[]
  truth: Record<string, string>
}

function fromFile(name: string, path: string, fields: TargetField[], truth: Record<string, string>): Case {
  const rows = parseCSV(readFileSync(path, "utf8"))
  return { name, fields, headers: Object.keys(rows[0]), rows: rows.slice(0, 3), truth }
}

function synthetic(
  name: string,
  fields: TargetField[],
  table: string[][],
  truth: Record<string, string>,
): Case {
  const [headers, ...data] = table
  const rows = data.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])))
  return { name, fields, headers, rows, truth }
}

const CASES: Case[] = [
  fromFile("dialog-golden-cog", "test-fixtures/golden/golden-cog.csv", COG_DIALOG_FIELDS, {
    inventoryNumber: "Vendor Item Number",
    vendorItemNo: "Vendor Item Number",
    inventoryDescription: "Item Description",
    vendorName: "Vendor / Supplier Name",
    unitCost: "Unit Price",
    extendedPrice: "Extended Cost",
    quantity: "Quantity Ordered",
    multiplier: "Conversion Factor Ordered",
    transactionDate: "Transaction Date",
  }),
  synthetic(
    "dialog-pricing-vendor-style",
    PRICING_DIALOG_FIELDS,
    [
      ["CATALOG NO", "MFG PART #", "ITEM DESCRIPTION", "LIST PRICE", "NET PRICE", "PRODUCT LINE", "UOM", "EFFECTIVE DATE"],
      ["PX-21-001", "MFG-9001", "Hip stem", "500.00", "400.00", "Ortho", "EA", "2026-01-01"],
      ["PX-21-002", "MFG-9002", "Acetabular cup", "300.00", "240.00", "Ortho", "EA", "2026-01-01"],
    ],
    {
      vendorItemNo: "CATALOG NO",
      manufacturerNo: "MFG PART #",
      productDescription: "ITEM DESCRIPTION",
      listPrice: "LIST PRICE",
      contractPrice: "NET PRICE",
      category: "PRODUCT LINE",
      uom: "UOM",
      effectiveDate: "EFFECTIVE DATE",
    },
  ),
  fromFile("dialog-golden-pricing", "test-fixtures/golden/golden-pricing.csv", PRICING_DIALOG_FIELDS, {
    vendorItemNo: "Supplier Part #",
    manufacturerNo: "Mfg Catalog No",
    productDescription: "Material Desc",
    listPrice: "MSRP",
    contractPrice: "Negotiated Unit Price",
    effectiveDate: "Contract Start",
    expirationDate: "Contract End",
    category: "Product Line",
    uom: "Pkg",
  }),
  fromFile("dialog-medtronic-pricing", "test-fixtures/medtronic-pricing-nonstandard.csv", PRICING_DIALOG_FIELDS, {
    vendorItemNo: "Part Number",
    manufacturerNo: "Mfr Part ID",
    productDescription: "Item Name",
    listPrice: "Base Price",
    contractPrice: "Net Price",
    effectiveDate: "Valid From",
    expirationDate: "Valid Until",
    category: "Segment",
    uom: "Unit",
  }),
  fromFile("golden-cog", "test-fixtures/golden/golden-cog.csv", COG_FIELDS, {
    vendorName: "Vendor / Supplier Name",
    transactionDate: "Transaction Date",
    refNumber: "Vendor Item Number",
    description: "Item Description",
    quantity: "Quantity Ordered",
    unitCost: "Unit Price",
    multiplier: "Conversion Factor Ordered",
    extended: "Extended Cost",
  }),
  fromFile("cog-dirty-headers", "tests/imports/fixtures/cog-dirty-headers.csv", COG_FIELDS, {
    vendorName: "Supplier Name",
    poNumber: "PO#",
    transactionDate: "Transaction Date",
    description: "Item Description",
    refNumber: "Catalog",
    quantity: "Qty",
    unitCost: "Unit Price",
    extended: "Total",
  }),
  fromFile("cog-standard", "tests/imports/fixtures/cog-standard.csv", COG_FIELDS, {
    vendorName: "Vendor",
    poNumber: "Purchase Order Number",
    transactionDate: "Date Ordered",
    description: "product name",
    refNumber: "Product ref number",
    quantity: "Quantity Ordered",
    unitCost: "Unit Cost",
    extended: "Extended Cost",
  }),
  fromFile("golden-pricing", "test-fixtures/golden/golden-pricing.csv", PRICING_FIELDS, {
    vendorItemNo: "Supplier Part #",
    productDescription: "Material Desc",
    manufacturerNo: "Mfg Catalog No",
    listPrice: "MSRP",
    contractPrice: "Negotiated Unit Price",
    effectiveDate: "Contract Start",
    expirationDate: "Contract End",
    category: "Product Line",
    uom: "Pkg",
  }),
  fromFile("medtronic-pricing", "test-fixtures/medtronic-pricing-nonstandard.csv", PRICING_FIELDS, {
    vendorItemNo: "Part Number",
    productDescription: "Item Name",
    manufacturerNo: "Mfr Part ID",
    listPrice: "Base Price",
    contractPrice: "Net Price",
    effectiveDate: "Valid From",
    expirationDate: "Valid Until",
    category: "Segment",
    uom: "Unit",
  }),
  fromFile("pricing-file", "tests/imports/fixtures/pricing-file.csv", PRICING_FIELDS, {
    vendorItemNo: "Vendor Item Number",
    productDescription: "Product Description",
    contractPrice: "Contract Price",
    listPrice: "List Price",
    category: "Category",
    uom: "UOM",
  }),
  fromFile("case-data", "tests/imports/fixtures/case-data.csv", CASE_FIELDS, {
    caseNumber: "Case ID",
    surgeryDate: "Date of Surgery",
    surgeonName: "Surgeon",
    patientDob: "Date of birth",
    timeIn: "Time wheeled into OR",
    timeOut: "Time wheeled out of OR",
  }),
  fromFile("case-procedures", "tests/imports/fixtures/case-procedures.csv", PROCEDURE_FIELDS, {
    caseNumber: "Case ID",
    cptCode: "CPT Code",
    isPrimary: "CPT Is Primary YN",
    surgeryDate: "Date of Surgery",
  }),
  fromFile("case-supplies", "tests/imports/fixtures/case-supplies.csv", SUPPLY_FIELDS, {
    caseNumber: "Case ID",
    materialName: "Material Name",
    vendorItemNo: "Catalog number",
    unitCost: "Unit Cost",
    usedCost: "Used Cost",
    quantity: "Quantity Used",
    manufacturer: "Manufacturer",
  }),
  synthetic(
    "hard-cog-spanish",
    COG_FIELDS,
    [
      ["Proveedor", "Fecha de Pedido", "Descripcion del Articulo", "No. Catalogo", "Cantidad", "Precio Unitario", "Costo Total", "Orden de Compra", "Unidades por Caja", "Categoria"],
      ["Stryker", "2026-03-04", "Tornillo cortical 3.5mm", "SYK-204-35", "4", "12.50", "500.00", "OC-88123", "10", "Trauma"],
      ["Medtronic", "2026-03-05", "Sutura absorbible", "MDT-SA-01", "2", "8.00", "16.00", "OC-88124", "1", "Cierre de heridas"],
    ],
    {
      vendorName: "Proveedor",
      transactionDate: "Fecha de Pedido",
      description: "Descripcion del Articulo",
      refNumber: "No. Catalogo",
      quantity: "Cantidad",
      unitCost: "Precio Unitario",
      extended: "Costo Total",
      poNumber: "Orden de Compra",
      multiplier: "Unidades por Caja",
      category: "Categoria",
    },
  ),
  synthetic(
    "hard-cog-erp-codes",
    COG_FIELDS,
    [
      ["FACILITY_ID", "SUPP_NM", "TRX_DT", "ITEM_DESC", "MFG_CAT_NO", "ORD_QTY", "UNIT_PRC", "EXT_AMT", "PO_NUM", "PKG_QTY", "GL_ACCT"],
      ["F-001", "Zimmer Biomet", "03/04/2026", "Knee femoral comp sz 5", "ZB-42-5115-05", "1", "2450.00", "2450.00", "450021", "1", "6100-200"],
      ["F-001", "Cardinal Health", "03/05/2026", "Exam glove nitrile M", "CH-8812M", "5", "9.40", "470.00", "450022", "10", "6100-310"],
    ],
    {
      vendorName: "SUPP_NM",
      transactionDate: "TRX_DT",
      description: "ITEM_DESC",
      refNumber: "MFG_CAT_NO",
      quantity: "ORD_QTY",
      unitCost: "UNIT_PRC",
      extended: "EXT_AMT",
      poNumber: "PO_NUM",
      multiplier: "PKG_QTY",
    },
  ),
  synthetic(
    "hard-pricing-decoys",
    PRICING_FIELDS,
    [
      ["Vendor SKU", "Mfr Part No.", "Desc", "Contract $", "List $", "GPO Admin Fee %", "Each/Box", "Eff. Dt", "Exp. Dt", "Tier", "Carve-out Pct"],
      ["ART-1120", "AR-1120-01", "Suture anchor 5.5mm", "310.00", "425.00", "3", "EA", "01/01/2026", "12/31/2026", "2", "15"],
      ["ART-2210", "AR-2210-02", "Shaver blade 4.0", "95.00", "140.00", "3", "BX", "01/01/2026", "12/31/2026", "1", "0"],
    ],
    {
      vendorItemNo: "Vendor SKU",
      manufacturerNo: "Mfr Part No.",
      productDescription: "Desc",
      contractPrice: "Contract $",
      listPrice: "List $",
      uom: "Each/Box",
      effectiveDate: "Eff. Dt",
      expirationDate: "Exp. Dt",
      carveOutPercent: "Carve-out Pct",
    },
  ),
  synthetic(
    "hard-case-shorthand",
    CASE_FIELDS,
    [
      ["Encounter #", "Procedure Dt", "Attending Physician", "Pt DOB", "In Room", "Out of Room", "Room", "Anesthesia Type"],
      ["E-55102", "2026-02-11", "Dr. Patel", "1961-04-02", "07:42", "09:15", "OR 3", "General"],
      ["E-55103", "2026-02-11", "Dr. Nguyen", "1978-11-19", "09:40", "10:52", "OR 1", "MAC"],
    ],
    {
      caseNumber: "Encounter #",
      surgeryDate: "Procedure Dt",
      surgeonName: "Attending Physician",
      patientDob: "Pt DOB",
      timeIn: "In Room",
      timeOut: "Out of Room",
    },
  ),
  synthetic(
    "hard-no-matches",
    PRICING_FIELDS,
    [
      ["Name", "Address", "City", "Phone", "Email", "Notes"],
      ["Jane Roe", "12 Elm St", "Dayton", "555-0100", "jane@example.com", "Prefers mornings"],
      ["Sam Poe", "40 Oak Ave", "Akron", "555-0101", "sam@example.com", ""],
    ],
    {},
  ),
]

type RunResult = {
  mapping: Record<string, string>
  confidence?: Record<string, number>
  ms: number
  inputTokens: number
  outputTokens: number
}

async function runSonnet(c: Case, sample: Record<string, string>[]): Promise<RunResult> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of c.fields) {
    shape[field.key] = z
      .string()
      .describe(`The source column header that best maps to "${field.label}". Return "" if no source column matches.`)
  }
  const { system, user } = columnMappingPrompt(c.headers, c.fields, sample)
  const t0 = performance.now()
  const result = await generateText({
    model: claudeSonnet,
    output: Output.object({ schema: z.object(shape) }),
    system,
    prompt: user,
    maxOutputTokens: 2000,
  })
  const ms = performance.now() - t0
  const mapping: Record<string, string> = {}
  for (const [k, v] of Object.entries(result.output as Record<string, string>)) {
    if (v && c.headers.includes(v)) mapping[k] = v
  }
  return {
    mapping,
    ms,
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
  }
}

async function runJev(c: Case, sample: Record<string, string>[]): Promise<RunResult> {
  const t0 = performance.now()
  const mapping = await mapColumnsWithJev(c.headers, c.fields, sample)
  return { mapping, ms: performance.now() - t0, inputTokens: 0, outputTokens: 0 }
}

function runLocal(c: Case): RunResult {
  const t0 = performance.now()
  const mapping = localFallbackMap(c.headers, c.fields)
  return { mapping, ms: performance.now() - t0, inputTokens: 0, outputTokens: 0 }
}

type Outcome = "correct" | "wrong" | "false_positive" | "miss"

function grade(c: Case, mapping: Record<string, string>) {
  return c.fields.map((f) => {
    const want = c.truth[f.key] ?? ""
    const got = mapping[f.key] ?? ""
    let outcome: Outcome
    if (got === want) outcome = "correct"
    else if (!got) outcome = "miss"
    else if (!want) outcome = "false_positive"
    else outcome = "wrong"
    return { field: f.key, want, got, outcome }
  })
}

const RUNS = Number(process.env.RUNS ?? 3)

type Row = {
  arm: string
  run: number
  case: string
  field: string
  want: string
  got: string
  outcome: Outcome
  confidence?: number
}

async function main() {
  const rows: Row[] = []
  const perf: Record<string, { ms: number[]; inTok: number; outTok: number; errors: string[] }> = {
    sonnet: { ms: [], inTok: 0, outTok: 0, errors: [] },
    jev: { ms: [], inTok: 0, outTok: 0, errors: [] },
    local: { ms: [], inTok: 0, outTok: 0, errors: [] },
  }
  for (let run = 1; run <= RUNS; run++) {
    await Promise.all(
      CASES.map(async (c) => {
        const sample = redactPhiSampleValues(c.headers, c.rows)
        const arms: Array<[string, () => Promise<RunResult> | RunResult]> = [
          ["sonnet", () => runSonnet(c, sample)],
          ["jev", () => runJev(c, sample)],
        ]
        if (run === 1) arms.push(["local", () => runLocal(c)])
        for (const [arm, fn] of arms) {
          try {
            const r = await fn()
            perf[arm].ms.push(r.ms)
            perf[arm].inTok += r.inputTokens
            perf[arm].outTok += r.outputTokens
            for (const g of grade(c, r.mapping)) {
              rows.push({ arm, run, case: c.name, ...g, confidence: r.confidence?.[g.field] })
            }
          } catch (err) {
            perf[arm].errors.push(`${c.name} run ${run}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }),
    )
  }

  const out = process.env.OUT ?? "column-mapping-eval.json"
  writeFileSync(out, JSON.stringify({ rows, perf, runs: RUNS }, null, 2))

  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a")
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length ? s[Math.floor(s.length / 2)] : 0
  }
  for (const arm of ["sonnet", "jev", "local"]) {
    const rs = rows.filter((r) => r.arm === arm)
    const count = (o: Outcome) => rs.filter((r) => r.outcome === o).length
    const p = perf[arm]
    console.log(
      `${arm.padEnd(7)} fields=${rs.length} correct=${pct(count("correct"), rs.length)} wrong=${count("wrong")} false_pos=${count("false_positive")} miss=${count("miss")} median_ms=${median(p.ms).toFixed(0)} in_tok=${p.inTok} out_tok=${p.outTok} errors=${p.errors.length}`,
    )
    for (const e of p.errors) console.log(`   error: ${e}`)
  }
  console.log("\nmistakes:")
  for (const r of rows.filter((x) => x.outcome !== "correct")) {
    const conf = r.confidence === undefined ? "" : ` conf=${r.confidence.toFixed(2)}`
    console.log(`  ${r.arm} r${r.run} ${r.case}.${r.field}: want "${r.want}" got "${r.got}" [${r.outcome}]${conf}`)
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[eval-column-mapping]", err)
    process.exit(1)
  },
)
