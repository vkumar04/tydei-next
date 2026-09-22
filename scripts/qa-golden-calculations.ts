import { readFileSync } from "node:fs"
import path from "node:path"
import ExcelJS from "exceljs"
import { prisma } from "../lib/db"
import {
  calculateCumulative,
  calculateMarginal,
  scaleRebateValueForEngine,
  type TierLike,
} from "../lib/rebates/calculate"

/**
 * Golden-fixture calculation check.
 *
 * Pushes documents with hand-computed answers through the real import
 * routes of a running server, then reads back every derived number and
 * compares it to arithmetic done independently of the code under test:
 *
 *   - COG importer: extendedPrice = unitCost × quantity × multiplier, unless
 *     the file supplies an explicit extended value, which wins.
 *   - COG recompute (pricing-file fallback): variance% = (unitCost −
 *     contractPrice) / contractPrice × 100; strictly > 2 flips a row to
 *     price_variance; on_contract rows carry savings = (contractPrice −
 *     unitCost) × quantity; variance and off-contract rows carry none.
 *   - Rebate engine on the seeded Medtronic Spine tiers (marginal, stored
 *     as fractions that scaleRebateValueForEngine turns into percents).
 *
 * CSV and XLSX renderings of the same document must produce identical rows.
 *
 * Requires a server on QA_BASE_URL (default http://localhost:3000) and the
 * seeded demo facility. Creates only rows whose SKUs start with GLD- and
 * removes them afterwards unless QA_GOLDEN_KEEP=1.
 *
 * Run: bun run qa:golden
 */

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000"
const EMAIL = process.env.QA_FACILITY_EMAIL ?? "demo-facility@tydei.com"
const PASSWORD = process.env.QA_FACILITY_PASSWORD ?? "demo-facility-2024"
const FACILITY_NAME = "Lighthouse Surgical Center"
const VENDOR_HINT = "Stryker"
const FIXTURES = path.resolve(import.meta.dirname, "..", "test-fixtures", "golden")

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const DIM = "\x1b[2m"
const RESET = "\x1b[0m"

const PRICE_VARIANCE_THRESHOLD = 2 // mirrors lib/contracts/match.ts

const EXPECTED_PRICING: Record<string, number> = {
  "GLD-001": 100,
  "GLD-002": 250,
  "GLD-003": 40,
  "GLD-004": 62,
  "GLD-005": 10,
}

/**
 * extendedPrice is the importer's own arithmetic and does not depend on the
 * match cascade or any seeded contract: unitCost × quantity × multiplier,
 * unless the file supplies an explicit extended value (then that wins).
 * GLD-005 carries multiplier 12 (10 × 3 × 12 = 360); GLD-006 supplies an
 * explicit 999.
 */
const EXPECTED_EXTENDED: Record<string, { quantity: number; unitCost: number; extendedPrice: number }> = {
  "GLD-001": { quantity: 10, unitCost: 100, extendedPrice: 1000 },
  "GLD-002": { quantity: 4, unitCost: 245, extendedPrice: 980 },
  "GLD-003": { quantity: 20, unitCost: 50, extendedPrice: 1000 },
  "GLD-004": { quantity: 5, unitCost: 60, extendedPrice: 300 },
  "GLD-005": { quantity: 3, unitCost: 10, extendedPrice: 360 },
  "GLD-006": { quantity: 2, unitCost: 5, extendedPrice: 999 },
  "GLD-999": { quantity: 2, unitCost: 75, extendedPrice: 150 },
}

const EXPECTED_TOTAL_EXTENDED = 4789 // Σ of the above — deterministic

const ENGINE_CASES: { spend: number; marginal: number; cumulative: number }[] = [
  { spend: 150_000, marginal: 3_000, cumulative: 3_000 },
  { spend: 238_630, marginal: 5_352.05, cumulative: 8_352.05 },
  { spend: 400_000, marginal: 11_000, cumulative: 20_000 },
  { spend: 500_000, marginal: 16_000, cumulative: 25_000 },
]

const results: { name: string; ok: boolean; detail: string }[] = []
function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? GREEN + "✓" : RED + "✗"}${RESET} ${name} ${DIM}— ${detail}${RESET}`)
}
function near(a: number | null, b: number | null, tol = 0.005): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(a - b) <= tol
}
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  return Number(v)
}

let cookie = ""
async function signIn() {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (res.status !== 200) throw new Error(`sign-in failed: HTTP ${res.status}`)
  cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ")
}

async function post(route: string, form: FormData): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/${route}`, { method: "POST", headers: { cookie }, body: form })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = { raw: text.slice(0, 200) }
  }
  return { status: res.status, body }
}

function csvBlob(file: string): Blob {
  return new Blob([readFileSync(path.join(FIXTURES, file))], { type: "text/csv" })
}

async function xlsxBlob(file: string): Promise<Blob> {
  const rows = readFileSync(path.join(FIXTURES, file), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(","))
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Sheet1")
  for (const row of rows) ws.addRow(row.map((cell) => (cell === "" ? null : cell)))
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

async function importPricing(blob: Blob, name: string) {
  const form = new FormData()
  form.set("file", blob, name)
  form.set("vendorHint", VENDOR_HINT)
  return post("import-pricing", form)
}

async function importCog(blob: Blob, name: string) {
  const form = new FormData()
  form.set("file", blob, name)
  return post("import-cog", form)
}

interface CogSnapshot {
  sku: string
  quantity: number
  unitCost: number | null
  extendedPrice: number | null
  matchStatus: string
  isOnContract: boolean
  contractPrice: number | null
  variancePercent: number | null
  savingsAmount: number | null
}

async function readCog(facilityId: string): Promise<CogSnapshot[]> {
  const rows = await prisma.cOGRecord.findMany({
    where: { facilityId, vendorItemNo: { startsWith: "GLD-" } },
    orderBy: { vendorItemNo: "asc" },
  })
  return rows.map((r) => ({
    sku: r.vendorItemNo ?? "",
    quantity: r.quantity,
    unitCost: num(r.unitCost),
    extendedPrice: num(r.extendedPrice),
    matchStatus: r.matchStatus,
    isOnContract: r.isOnContract,
    contractPrice: num(r.contractPrice),
    variancePercent: num(r.variancePercent),
    savingsAmount: num(r.savingsAmount),
  }))
}

async function cleanup(facilityId: string) {
  await prisma.cOGRecord.deleteMany({ where: { facilityId, vendorItemNo: { startsWith: "GLD-" } } })
  await prisma.pricingFile.deleteMany({ where: { facilityId, vendorItemNo: { startsWith: "GLD-" } } })
}

function checkCogRows(label: string, actual: CogSnapshot[]) {
  const expectedCount = Object.keys(EXPECTED_EXTENDED).length
  check(`${label}: row count`, actual.length === expectedCount, `${actual.length} rows (expected ${expectedCount})`)

  // (A) Deterministic: extendedPrice arithmetic + quantity/unitCost passthrough.
  // Independent of the match cascade or any seeded contract.
  for (const [sku, exp] of Object.entries(EXPECTED_EXTENDED)) {
    const row = actual.find((r) => r.sku === sku)
    if (!row) {
      check(`${label}: ${sku} present`, false, "missing")
      continue
    }
    check(`${label}: ${sku} quantity`, row.quantity === exp.quantity, `${row.quantity} (expected ${exp.quantity})`)
    check(`${label}: ${sku} unitCost`, near(row.unitCost, exp.unitCost), `${row.unitCost} (expected ${exp.unitCost})`)
    check(`${label}: ${sku} extendedPrice`, near(row.extendedPrice, exp.extendedPrice), `${row.extendedPrice} (expected ${exp.extendedPrice})`)
  }
  const totalExtended = actual.reduce((s, r) => s + (r.extendedPrice ?? 0), 0)
  check(`${label}: Σ extendedPrice`, near(totalExtended, EXPECTED_TOTAL_EXTENDED), `${totalExtended.toFixed(2)} (expected ${EXPECTED_TOTAL_EXTENDED})`)

  // (B) Formula-consistency: verify the enrichment MATH the cascade applied,
  // recomputed independently from the stored inputs, without predicting which
  // path fired (that depends on seeded catalog state this fixture does not own).
  for (const row of actual) {
    const cp = row.contractPrice
    if (row.matchStatus === "price_variance") {
      const okCp = cp !== null && cp !== 0
      check(`${label}: ${row.sku} variance has contractPrice`, okCp, `contractPrice=${cp}`)
      if (okCp) {
        const expVar = ((row.unitCost! - cp!) / cp!) * 100
        check(`${label}: ${row.sku} variance% formula`, near(row.variancePercent, expVar, 0.01), `${row.variancePercent} (recomputed ${expVar.toFixed(4)})`)
        check(`${label}: ${row.sku} variance exceeds ${PRICE_VARIANCE_THRESHOLD}%`, Math.abs(expVar) > PRICE_VARIANCE_THRESHOLD, `|${expVar.toFixed(2)}| > ${PRICE_VARIANCE_THRESHOLD}`)
      }
      check(`${label}: ${row.sku} variance not on-contract`, row.isOnContract === false, `isOnContract=${row.isOnContract}`)
    } else if (row.matchStatus === "on_contract") {
      check(`${label}: ${row.sku} on_contract flagged`, row.isOnContract === true, `isOnContract=${row.isOnContract}`)
      // savings, when the row carries a contractPrice, follows (cp - unitCost) × qty
      if (cp !== null && cp !== 0 && row.savingsAmount !== null) {
        const expSav = (cp - row.unitCost!) * row.quantity
        check(`${label}: ${row.sku} savings formula`, near(row.savingsAmount, expSav), `${row.savingsAmount} (recomputed ${expSav})`)
      }
    } else {
      // off_contract_item / out_of_scope / unknown_vendor: never on contract,
      // never a savings or variance claim.
      check(`${label}: ${row.sku} off-contract clean`, row.isOnContract === false && (row.savingsAmount === null || row.savingsAmount === 0) && (row.variancePercent === null || row.variancePercent === 0), `onContract=${row.isOnContract} savings=${row.savingsAmount} variance=${row.variancePercent}`)
    }
  }
}

async function checkPricing(label: string, facilityId: string) {
  const rows = await prisma.pricingFile.findMany({
    where: { facilityId, vendorItemNo: { startsWith: "GLD-" } },
    select: { vendorItemNo: true, contractPrice: true },
  })
  check(`${label}: pricing row count`, rows.length === Object.keys(EXPECTED_PRICING).length, `${rows.length} (expected ${Object.keys(EXPECTED_PRICING).length})`)
  for (const [sku, price] of Object.entries(EXPECTED_PRICING)) {
    const row = rows.find((r) => r.vendorItemNo === sku)
    check(`${label}: ${sku} contractPrice`, row !== undefined && near(num(row.contractPrice), price), `${row ? num(row.contractPrice) : "missing"} (expected ${price})`)
  }
}

async function checkEngine(facilityId: string) {
  const contract = await prisma.contract.findFirst({
    where: { facilityId, name: { startsWith: "Medtronic Spine" } },
    select: { name: true, terms: { select: { rebateMethod: true, tiers: { orderBy: { tierNumber: "asc" } } } } },
  })
  const term = contract?.terms.find((t) => t.tiers.length > 0)
  if (!contract || !term) {
    check("engine: seeded Medtronic Spine tiers", false, "contract or tiers not found — run bun run db:seed")
    return
  }
  const tiers: TierLike[] = term.tiers.map((t) => ({
    tierNumber: t.tierNumber,
    spendMin: Number(t.spendMin),
    spendMax: t.spendMax === null ? null : Number(t.spendMax),
    rebateValue: scaleRebateValueForEngine(t.rebateValue, t.rebateType),
    fixedRebateAmount: t.fixedRebateAmount === null ? null : Number(t.fixedRebateAmount),
  }))
  const rv = tiers.map((t) => Number(t.rebateValue))
  check("engine: tier ladder", tiers.length === 3 && near(rv[0]!, 2) && near(rv[1]!, 3.5) && near(rv[2]!, 5), tiers.map((t) => `${t.tierNumber}:[${Number(t.spendMin)},${t.spendMax ?? "∞"})@${Number(t.rebateValue).toFixed(2)}%`).join(" "))
  check("engine: seeded method", term.rebateMethod === "marginal", String(term.rebateMethod))
  for (const c of ENGINE_CASES) {
    const m = calculateMarginal(c.spend, tiers)
    const cu = calculateCumulative(c.spend, tiers)
    check(`engine: marginal(${c.spend.toLocaleString()})`, near(m.rebateEarned, c.marginal), `${m.rebateEarned.toFixed(2)} at tier ${m.tierAchieved} (expected ${c.marginal})`)
    check(`engine: cumulative(${c.spend.toLocaleString()})`, near(cu.rebateEarned, c.cumulative), `${cu.rebateEarned.toFixed(2)} at tier ${cu.tierAchieved} (expected ${c.cumulative})`)
  }
}

async function main() {
  const facility = await prisma.facility.findFirst({ where: { name: FACILITY_NAME }, select: { id: true } })
  if (!facility) throw new Error(`facility "${FACILITY_NAME}" not found — run bun run db:seed`)
  const facilityId = facility.id

  console.log(`${DIM}golden calculation check against ${BASE} · facility ${FACILITY_NAME}${RESET}\n`)
  await signIn()
  await cleanup(facilityId)

  const pricingCsv = await importPricing(csvBlob("golden-pricing.csv"), "golden-pricing.csv")
  check("import-pricing (csv)", pricingCsv.status === 200 && pricingCsv.body.imported === 5, `HTTP ${pricingCsv.status} ${JSON.stringify(pricingCsv.body).slice(0, 80)}`)
  await checkPricing("pricing csv", facilityId)

  const cogCsv = await importCog(csvBlob("golden-cog.csv"), "golden-cog.csv")
  check("import-cog (csv)", cogCsv.status === 200 && cogCsv.body.imported === 7 && cogCsv.body.errors === 0, `HTTP ${cogCsv.status} ${JSON.stringify(cogCsv.body).slice(0, 110)}`)
  const csvRows = await readCog(facilityId)
  checkCogRows("cog csv", csvRows)

  await prisma.cOGRecord.deleteMany({ where: { facilityId, vendorItemNo: { startsWith: "GLD-" } } })
  const cogXlsx = await importCog(await xlsxBlob("golden-cog.csv"), "golden-cog.xlsx")
  check("import-cog (xlsx)", cogXlsx.status === 200 && cogXlsx.body.imported === 7 && cogXlsx.body.errors === 0, `HTTP ${cogXlsx.status} ${JSON.stringify(cogXlsx.body).slice(0, 110)}`)
  const xlsxRows = await readCog(facilityId)
  checkCogRows("cog xlsx", xlsxRows)
  check("cog csv ≡ xlsx", JSON.stringify(csvRows) === JSON.stringify(xlsxRows), "every derived field identical across renderings")

  await prisma.pricingFile.deleteMany({ where: { facilityId, vendorItemNo: { startsWith: "GLD-" } } })
  const pricingXlsx = await importPricing(await xlsxBlob("golden-pricing.csv"), "golden-pricing.xlsx")
  check("import-pricing (xlsx)", pricingXlsx.status === 200 && pricingXlsx.body.imported === 5, `HTTP ${pricingXlsx.status} ${JSON.stringify(pricingXlsx.body).slice(0, 80)}`)
  await checkPricing("pricing xlsx", facilityId)

  await checkEngine(facilityId)

  if (process.env.QA_GOLDEN_KEEP !== "1") await cleanup(facilityId)

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${failed.length === 0 ? GREEN : RED}${results.length - failed.length}/${results.length} checks passing${RESET}`)
  if (failed.length > 0) {
    console.log(`${RED}failing:${RESET}`)
    for (const f of failed) console.log(`  ${f.name} — ${f.detail}`)
  }
  await prisma.$disconnect()
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
