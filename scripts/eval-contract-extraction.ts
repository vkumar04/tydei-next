import { writeFileSync } from "node:fs"
import { anthropic } from "@ai-sdk/anthropic"
import { extractContractSingle } from "@/lib/ai/contract-extract-single"
import { compareContractSelection, selectContractFieldsWithJev } from "@/lib/ai/jev-contract-check"
import { ocrPdfBuffer } from "@/lib/ai/ocr-pdf"
import type { ExtractedContractData } from "@/lib/ai/schemas"
import {
  buildTextPdf,
  contractPdfLines,
  rasterizeToScannedPdf,
  vendorContractPdfLines,
} from "@/tests/support/upload-fixtures"

const MODELS = (process.env.MODELS ?? "claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5").split(",")
const RUNS = Number(process.env.RUNS ?? 2)

type Tier = { min: number; type: "percent" | "fixed"; value: number }

type Truth = {
  vendor: string
  contractNumber?: string | null
  contractType: string
  effectiveDate: string | null
  expirationDate: string | null
  totalValue?: number | null
  capitalCost?: number | null
  interestRatePercent?: number | null
  termMonths?: number | null
  tiers: Tier[]
}

type Doc = { name: string; pages: string[][]; scanned?: boolean; truth: Truth }

const ZIMMER_FIXED: string[][] = [
  [
    "REBATE AGREEMENT",
    "Agreement No. ZB-FR-8812",
    "Between Zimmer Biomet (\"Supplier\") and Lighthouse Surgical Center (\"Facility\")",
    "Term: 03/15/2026 through 03/14/2028",
    "",
    "1. Covered Products. Knee and hip arthroplasty implants listed in Schedule A.",
    "",
    "2. Annual Performance Rebate. For each contract year, Supplier pays Facility",
    "   a lump-sum rebate based on eligible purchases during that year:",
    "   Level 1: purchases of $250,000 to $499,999 - flat rebate of $10,000",
    "   Level 2: purchases of $500,000 or more - flat rebate of $30,000",
    "   Purchases under $250,000 earn no rebate. Rebates are paid by check",
    "   within 45 days after the end of each contract year.",
    "",
    "3. No equipment, capital, or financing is provided under this Agreement.",
  ],
]

const SMITH_EVERGREEN: string[][] = [
  [
    "PRODUCT SUPPLY AGREEMENT",
    "This Agreement is made effective as of the 1st day of July, 2026 by and between",
    "Smith & Nephew, Inc. and Lighthouse Surgical Center.",
    "Reference: SN-LSC-0726",
    "",
    "1. Products. Sports medicine anchors and arthroscopy blades.",
    "",
    "2. Volume Rebate. Facility earns a quarterly rebate on total units purchased:",
    "   Tier 1: 200 to 399 units in the quarter - 2% of eligible spend",
    "   Tier 2: 400 or more units in the quarter - 3.5% of eligible spend",
    "",
    "3. Term. This Agreement continues in effect until terminated by either",
    "   party upon ninety (90) days written notice. There is no fixed end date.",
  ],
]

const GE_CAPITAL: string[][] = [
  [
    "EQUIPMENT PURCHASE AND FINANCING AGREEMENT",
    "Contract #: GEHC-MR-55120",
    "Seller: GE HealthCare",
    "Buyer: Lighthouse Surgical Center",
    "Effective Date: September 1, 2026",
    "",
    "1. Equipment. One (1) SIGNA 1.5T MRI system, installed.",
    "   Purchase Price: $1,840,000",
    "   Down Payment due at signing: $184,000",
    "",
    "2. Financing. The balance is financed over sixty (60) equal monthly",
    "   payments at a fixed interest rate of 4.5% per annum. Final payment",
    "   due August 1, 2031, which is the end of this Agreement.",
    "",
    "3. This Agreement contains no rebate, volume, or consumable purchase terms.",
  ],
]

const CARDINAL_PRICING: string[][] = [
  [
    "PRICING AGREEMENT",
    "Cardinal Health - Lighthouse Surgical Center",
    "Price Agreement Number: CAH-PA-2026-311",
    "Prices effective January 1, 2027 through December 31, 2027.",
    "",
    "Item       Description                         UOM    Price",
    "CH-8812M   Exam glove nitrile, medium          BX     $9.40",
    "CH-8812L   Exam glove nitrile, large           BX     $9.40",
    "CH-2210    Surgical drape, universal           EA     $4.15",
    "CH-5502    Gauze sponge 4x4, sterile           CS     $38.00",
    "",
    "Prices are fixed for the term. This agreement provides no rebates,",
    "incentives, or volume commitments.",
  ],
]

const ORTHOMEDIX: Truth = {
  vendor: "Orthomedix",
  contractNumber: "OMX-2026-0417",
  contractType: "tie_in",
  effectiveDate: "2026-01-01",
  expirationDate: "2028-12-31",
  totalValue: 1_250_000,
  capitalCost: 785_195,
  interestRatePercent: 0,
  termMonths: 36,
  tiers: [
    { min: 0, type: "percent", value: 2 },
    { min: 500_000, type: "percent", value: 3 },
    { min: 1_000_000, type: "percent", value: 4 },
  ],
}

const ZIMMER: Truth = {
  vendor: "Zimmer",
  contractNumber: "ZB-FR-8812",
  contractType: "usage",
  effectiveDate: "2026-03-15",
  expirationDate: "2028-03-14",
  tiers: [
    { min: 250_000, type: "fixed", value: 10_000 },
    { min: 500_000, type: "fixed", value: 30_000 },
  ],
}

const DOCS: Doc[] = [
  { name: "orthomedix-tie-in", pages: contractPdfLines(), truth: ORTHOMEDIX },
  { name: "orthomedix-tie-in (scanned)", pages: contractPdfLines(), scanned: true, truth: ORTHOMEDIX },
  {
    name: "stryker-usage",
    pages: vendorContractPdfLines(),
    truth: {
      vendor: "Stryker",
      contractNumber: "VND-E2E-2026-0815",
      contractType: "usage",
      effectiveDate: "2026-03-01",
      expirationDate: "2029-02-28",
      totalValue: 2_400_000,
      tiers: [
        { min: 0, type: "percent", value: 1.5 },
        { min: 750_000, type: "percent", value: 2.5 },
        { min: 1_500_000, type: "percent", value: 3.5 },
      ],
    },
  },
  { name: "zimmer-fixed-rebate", pages: ZIMMER_FIXED, truth: ZIMMER },
  { name: "zimmer-fixed-rebate (scanned)", pages: ZIMMER_FIXED, scanned: true, truth: ZIMMER },
  {
    name: "smith-evergreen-volume",
    pages: SMITH_EVERGREEN,
    truth: {
      vendor: "Smith & Nephew",
      contractNumber: "SN-LSC-0726",
      contractType: "usage",
      effectiveDate: "2026-07-01",
      expirationDate: null,
      tiers: [
        { min: 200, type: "percent", value: 2 },
        { min: 400, type: "percent", value: 3.5 },
      ],
    },
  },
  {
    name: "ge-capital-purchase",
    pages: GE_CAPITAL,
    truth: {
      vendor: "GE",
      contractNumber: "GEHC-MR-55120",
      contractType: "capital",
      effectiveDate: "2026-09-01",
      expirationDate: "2031-08-01",
      capitalCost: 1_840_000,
      interestRatePercent: 4.5,
      termMonths: 60,
      tiers: [],
    },
  },
  {
    name: "cardinal-pricing-only",
    pages: CARDINAL_PRICING,
    truth: {
      vendor: "Cardinal",
      contractNumber: "CAH-PA-2026-311",
      contractType: "pricing_only",
      effectiveDate: "2027-01-01",
      expirationDate: "2027-12-31",
      tiers: [],
    },
  },
]

const MEDTRONIC_PROSE: string[][] = [
  [
    "SPINE PRODUCTS PURCHASE AGREEMENT",
    "Agreement #MDT-SP-4471",
    "This Agreement between Medtronic USA, Inc. and Lighthouse Surgical Center",
    "commences on April 1, 2026 and ends on March 31, 2029, with an estimated",
    "aggregate value of $3.2 million over the term.",
    "",
    "Section 4. Rebates. Facility shall receive a rebate equal to three percent (3%)",
    "of Net Purchases exceeding $400,000 and five percent (5%) of Net Purchases",
    "exceeding $900,000 during each Agreement Year, paid within 90 days of year end.",
    "",
    "Section 5. No equipment is placed or financed under this Agreement.",
  ],
]

const MEDTRONIC_TRUTH: Truth = {
  vendor: "Medtronic",
  contractNumber: "MDT-SP-4471",
  contractType: "usage",
  effectiveDate: "2026-04-01",
  expirationDate: "2029-03-31",
  totalValue: 3_200_000,
  tiers: [
    { min: 400_000, type: "percent", value: 3 },
    { min: 900_000, type: "percent", value: 5 },
  ],
}

const INTUITIVE_TIE_IN: string[][] = [
  [
    "CAPITAL PLACEMENT AND INSTRUMENT COMMITMENT AGREEMENT",
    "Intuitive Surgical, Inc. | Lighthouse Surgical Center | Ref. IS-TI-2026-09",
    "Effective: 2026-05-01        Expires: 2030-04-30",
    "",
    "A. Capital. One da Vinci Xi system, valued at $1,950,000, is placed at the",
    "   Facility at no upfront cost and is paid down through instrument purchases",
    "   over a term of 4 years. No interest is charged.",
    "",
    "B. Commitment. Facility commits to $650,000 of instruments per year.",
    "   Total commitment: $2,600,000.",
    "",
    "C. Rebate Schedule",
    "   Annual Instrument Spend        Rebate",
    "   $650,000 - $799,999            1.0%",
    "   $800,000 and above             2.0%",
  ],
]

const HOLDOUT: Doc[] = [
  { name: "holdout-medtronic-prose", pages: MEDTRONIC_PROSE, truth: MEDTRONIC_TRUTH },
  { name: "holdout-medtronic-prose (scanned)", pages: MEDTRONIC_PROSE, scanned: true, truth: MEDTRONIC_TRUTH },
  {
    name: "holdout-intuitive-tie-in",
    pages: INTUITIVE_TIE_IN,
    truth: {
      vendor: "Intuitive",
      contractNumber: "IS-TI-2026-09",
      contractType: "tie_in",
      effectiveDate: "2026-05-01",
      expirationDate: "2030-04-30",
      totalValue: 2_600_000,
      capitalCost: 1_950_000,
      interestRatePercent: null,
      termMonths: 48,
      tiers: [
        { min: 650_000, type: "percent", value: 1 },
        { min: 800_000, type: "percent", value: 2 },
      ],
    },
  },
]

type Extracted = {
  vendorName?: string | null
  contractNumber?: string | null
  contractType?: string | null
  effectiveDate?: string | null
  expirationDate?: string | null
  totalValue?: number | null
  capitalCost?: number | null
  interestRatePercent?: number | null
  termMonths?: number | null
  terms?: Array<{
    tiers?: Array<{
      spendMin?: number | null
      volumeMin?: number | null
      rebateType?: string | null
      rebateValue?: number | null
    }>
  }>
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
const numEq = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? a == b : Math.abs(a - b) < 0.5

function extractedTiers(x: Extracted): Tier[] {
  return (x.terms ?? [])
    .flatMap((t) => t.tiers ?? [])
    .map((t) => ({
      min: t.spendMin ?? t.volumeMin ?? 0,
      type: /fixed|flat|dollar/i.test(t.rebateType ?? "") ? ("fixed" as const) : ("percent" as const),
      value: t.rebateValue ?? Number.NaN,
    }))
    .sort((a, b) => a.min - b.min)
}

function grade(truth: Truth, x: Extracted): Record<string, boolean> {
  const out: Record<string, boolean> = {
    vendor: norm(x.vendorName).includes(norm(truth.vendor)),
    contractType: x.contractType === truth.contractType,
    effectiveDate: (x.effectiveDate ?? null) === truth.effectiveDate,
    expirationDate: (x.expirationDate ?? null) === truth.expirationDate,
  }
  if (truth.contractNumber !== undefined) out.contractNumber = norm(x.contractNumber) === norm(truth.contractNumber)
  for (const k of ["totalValue", "capitalCost", "interestRatePercent", "termMonths"] as const) {
    if (truth[k] === undefined) continue
    out[k] = k === "interestRatePercent" ? numEq(x[k] || null, truth[k] || null) : numEq(x[k], truth[k])
  }
  const got = extractedTiers(x).filter((t, i, all) => !(i === 0 && all.length > truth.tiers.length && t.value === 0))
  out.tiers =
    got.length === truth.tiers.length &&
    truth.tiers.every((t, i) => Math.abs(got[i].min - t.min) <= 1 && got[i].type === t.type && numEq(got[i].value, t.value))
  return out
}

async function extract(model: string, pdf: Uint8Array, hint: string) {
  const t0 = performance.now()
  const { extracted } = await extractContractSingle({
    fileData: pdf,
    fileName: "contract.pdf",
    textHint: hint,
    actionName: `eval:${model}`,
    primary: anthropic(model),
    fallback: anthropic(model),
  })
  return { object: extracted as Extracted, ms: performance.now() - t0, inTok: 0, outTok: 0 }
}

async function main() {
  const set = process.env.SET === "holdout" ? HOLDOUT : process.env.SET === "all" ? [...DOCS, ...HOLDOUT] : DOCS
  const pdfs = await Promise.all(
    set.map(async (d) => {
      const text = await buildTextPdf(d.pages)
      const pdf = d.scanned ? await rasterizeToScannedPdf(text) : text
      const hint = d.scanned
        ? ""
        : `\n\nFor reference, here is the extracted text layer of the PDF (may help with tabular data):\n\n${d.pages.flat().join("\n")}`
      return { doc: d, pdf, hint }
    }),
  )

  type Row = { model: string; run: number; doc: string; field: string; ok: boolean }
  const rows: Row[] = []
  const perf: Record<string, { ms: number[]; inTok: number; outTok: number; errors: string[] }> = {}
  for (const m of MODELS) perf[m] = { ms: [], inTok: 0, outTok: 0, errors: [] }
  const samples: Record<string, unknown> = {}

  for (let run = 1; run <= RUNS; run++) {
    await Promise.all(
      MODELS.flatMap((model) =>
        pdfs.map(async ({ doc, pdf, hint }) => {
          try {
            const r = await extract(model, pdf, hint)
            perf[model].ms.push(r.ms)
            perf[model].inTok += r.inTok
            perf[model].outTok += r.outTok
            samples[`${model}|${doc.name}|${run}`] = r.object
            for (const [field, ok] of Object.entries(grade(doc.truth, r.object))) {
              rows.push({ model, run, doc: doc.name, field, ok })
            }
          } catch (err) {
            perf[model].errors.push(`${doc.name} r${run}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`)
          }
        }),
      ),
    )
  }

  if (process.env.CHECK === "1") await runJevCheck(pdfs, samples)

  writeFileSync(process.env.OUT ?? "contract-extraction-eval.json", JSON.stringify({ rows, perf, samples }, null, 2))

  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length ? s[Math.floor(s.length / 2)] : 0
  }
  for (const m of MODELS) {
    const rs = rows.filter((r) => r.model === m)
    const ok = rs.filter((r) => r.ok).length
    const p = perf[m]
    console.log(
      `${m.padEnd(18)} fields=${rs.length} correct=${rs.length ? ((100 * ok) / rs.length).toFixed(1) : "n/a"}% median_s=${(median(p.ms) / 1000).toFixed(1)} in_tok=${p.inTok} out_tok=${p.outTok} errors=${p.errors.length}`,
    )
    for (const e of p.errors) console.log(`   error: ${e}`)
  }
  console.log("\nmisses:")
  for (const r of rows.filter((x) => !x.ok)) console.log(`  ${r.model} r${r.run} ${r.doc}.${r.field}`)
}

type Corruption = { field: string; apply: (x: ExtractedContractData) => ExtractedContractData }

const CORRUPTIONS: Corruption[] = [
  { field: "effectiveDate", apply: (x) => ({ ...x, effectiveDate: "2025-09-09" }) },
  { field: "expirationDate", apply: (x) => ({ ...x, expirationDate: x.expirationDate ? "2031-01-15" : "2030-12-31" }) },
  { field: "contractNumber", apply: (x) => ({ ...x, contractNumber: undefined }) },
  { field: "contractType", apply: (x) => ({ ...x, contractType: x.contractType === "usage" ? "service" : "usage" }) },
  { field: "vendorName", apply: (x) => ({ ...x, vendorName: "Lighthouse Surgical Center" }) },
]

async function runJevCheck(pdfs: { doc: Doc; pdf: Uint8Array }[], samples: Record<string, unknown>) {
  const key = process.env.TYPESAFE_API_KEY
  if (!key) throw new Error("TYPESAFE_API_KEY is not set")
  let falsePositives = 0
  let checkedCorrect = 0
  const caught: Record<string, [number, number]> = {}
  const fpDetail: string[] = []
  const missDetail: string[] = []
  for (const { doc, pdf } of pdfs) {
    const text = doc.scanned ? await ocrPdfBuffer(pdf) : doc.pages.flat().join("\n")
    const t0 = performance.now()
    const selection = await selectContractFieldsWithJev(text, key)
    const ms = performance.now() - t0
    const correct = Object.entries(samples)
      .filter(([k]) => k.endsWith(`|${doc.name}|1`) && !k.startsWith("jev|"))
      .map(([, v]) => v as ExtractedContractData)
    for (const extracted of correct) {
      checkedCorrect += 1
      const w = compareContractSelection(extracted, selection)
      if (w.length) {
        falsePositives += 1
        fpDetail.push(`${doc.name}: ${w.map((x) => x.path[0]).join(",")} — ${w[0]!.message.slice(0, 120)}`)
      }
    }
    const base = correct[0]
    if (!base) continue
    for (const c of CORRUPTIONS) {
      const applies =
        c.field === "contractNumber" ? doc.truth.contractNumber : c.field === "expirationDate" ? true : c.field === "contractType" ? true : true
      if (!applies) continue
      const w = compareContractSelection(c.apply(base), selection)
      const hit = w.some((x) => x.path[0] === c.field)
      caught[c.field] ??= [0, 0]
      caught[c.field]![1] += 1
      if (hit) caught[c.field]![0] += 1
      else missDetail.push(`${doc.name}.${c.field}`)
    }
    console.log(`jev-check ${doc.name.padEnd(36)} ${ms.toFixed(0)}ms`)
  }
  console.log(`\njev-check false positives: ${falsePositives}/${checkedCorrect} correct extractions flagged`)
  for (const d of fpDetail) console.log(`  fp ${d}`)
  console.log("jev-check planted errors caught:")
  for (const [f, [hit, total]] of Object.entries(caught)) console.log(`  ${f.padEnd(16)} ${hit}/${total}`)
  for (const d of missDetail) console.log(`  missed ${d}`)
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[eval-contract-extraction]", err)
    process.exit(1)
  },
)
