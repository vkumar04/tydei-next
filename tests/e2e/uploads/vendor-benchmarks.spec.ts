import { test, expect } from "../../support/test"
import type { Page, Request } from "@playwright/test"
import { vendorIdForUser, withDb } from "../../support/db"
import {
  buildXlsx,
  vendorBenchmarkMatrix,
  vendorBenchmarkRows,
  type VendorBenchmarkRow,
} from "../../support/upload-fixtures"

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const SEED = 71
const ROW_COUNT = 2_350

test.use({ storageState: "tests/e2e/.auth/vendor.json" })
test.describe.configure({ mode: "serial" })

async function deleteSeed() {
  await withDb((c) => c.query(`delete from product_benchmark where "vendorItemNo" like $1`, [`VBM-${SEED}-%`]))
}

interface PersistedBenchmark {
  vendorItemNo: string
  description: string
  category: string
  currentPrice: number
  annualUnits: number
  nationalAvgPrice: number
  percentile25: number
  percentile50: number
  percentile75: number
  minPrice: number
  maxPrice: number
  sampleSize: number
  source: string
  vendorId: string
}

async function persisted(): Promise<PersistedBenchmark[]> {
  return withDb(async (c) => {
    const { rows } = await c.query(
      `select "vendorItemNo", description, category, "currentPrice"::float as "currentPrice", "annualUnits",
              "nationalAvgPrice"::float as "nationalAvgPrice", percentile25::float as percentile25,
              percentile50::float as percentile50, percentile75::float as percentile75,
              "minPrice"::float as "minPrice", "maxPrice"::float as "maxPrice", "sampleSize", source, "vendorId"
         from product_benchmark where "vendorItemNo" like $1 order by "vendorItemNo"`,
      [`VBM-${SEED}-%`],
    )
    return rows as PersistedBenchmark[]
  })
}

async function importBenchmarks(page: Page, rows: VendorBenchmarkRow[], fileName: string, expectedToast: RegExp) {
  await page.goto("/vendor/prospective")
  await page.getByRole("tab", { name: "Benchmarks" }).click()
  await expect(page.getByText("Product Pricing Benchmarks")).toBeVisible({ timeout: 15_000 })
  const buffer = await buildXlsx(vendorBenchmarkMatrix(rows), { titleRows: ["Stryker Benchmark Workbook — VNDE2E"] })
  await page.locator('input[type="file"][accept=".csv,.xlsx,.xls"]').first().setInputFiles({ name: fileName, mimeType: XLSX, buffer })
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: `Map columns — ${fileName}` })).toBeVisible({ timeout: 60_000 })
  await expect(dialog.getByText(`Preview — first 5 of ${ROW_COUNT.toLocaleString()} rows`)).toBeVisible()
  await expect(dialog.getByText(`${ROW_COUNT} rows parsed, ${ROW_COUNT} with a national average price.`, { exact: false })).toBeVisible()
  const chunkPayloads: number[] = []
  const onRequest = (req: Request) => {
    const body = req.postData()
    if (req.method() === "POST" && req.headers()["next-action"] && body && body.includes(rows[0]!.itemNumber.slice(0, 7))) {
      chunkPayloads.push((body.match(/VBM-\d+-\d{5}/g) ?? []).length)
    }
  }
  page.on("request", onRequest)
  await dialog.getByRole("button", { name: "Import", exact: true }).click()
  await expect(page.getByText(expectedToast)).toBeVisible({ timeout: 180_000 })
  await expect(dialog).toBeHidden()
  page.off("request", onRequest)
  expect(chunkPayloads, "server-action calls carrying benchmark rows").toEqual([2_000, ROW_COUNT - 2_000])
}

function expectMatches(saved: PersistedBenchmark[], rows: VendorBenchmarkRow[], vendorId: string) {
  expect(saved).toHaveLength(rows.length)
  expect(saved.every((s) => s.vendorId === vendorId && s.source !== "national_benchmark")).toBe(true)
  expect(new Set(saved.map((s) => s.source)).size).toBe(1)
  for (const i of [0, 1, 1_999, 2_000, 2_001, rows.length - 1]) {
    const r = rows[i]!
    const s = saved[i]!
    expect(s.vendorItemNo).toBe(r.itemNumber)
    expect(s.description).toBe(r.description)
    expect(s.category).toBe(r.category)
    expect(s.currentPrice).toBeCloseTo(r.currentPrice, 2)
    expect(s.annualUnits).toBe(r.annualUnits)
    expect(s.nationalAvgPrice).toBeCloseTo(r.nationalAvg, 2)
    expect(s.percentile25).toBeCloseTo(r.p25, 2)
    expect(s.percentile50).toBeCloseTo(r.p50, 2)
    expect(s.percentile75).toBeCloseTo(r.p75, 2)
    expect(s.minPrice).toBeCloseTo(r.min, 2)
    expect(s.maxPrice).toBeCloseTo(r.max, 2)
    expect(s.sampleSize).toBe(r.sampleSize)
  }
  const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100
  expect(sum(saved.map((s) => s.nationalAvgPrice))).toBeCloseTo(sum(rows.map((r) => r.nationalAvg)), 2)
  expect(saved.reduce((a, s) => a + s.annualUnits, 0)).toBe(rows.reduce((a, r) => a + r.annualUnits, 0))
}

test("benchmarks: a 2,350-row .xlsx imports through the chunked path, and re-import replaces instead of duplicating", async ({ page }) => {
  test.setTimeout(420_000)
  await deleteSeed()
  try {
    const vendorId = await vendorIdForUser()
    const first = vendorBenchmarkRows(ROW_COUNT, SEED)
    await importBenchmarks(page, first, "vendor-benchmarks.xlsx", /^Imported 2350 benchmark rows$/)
    expectMatches(await persisted(), first, vendorId)
    await expect(page.getByText(first[0]!.itemNumber, { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(first[0]!.description, { exact: true })).toBeVisible()

    const second = vendorBenchmarkRows(ROW_COUNT, SEED, 15)
    await importBenchmarks(page, second, "vendor-benchmarks-v2.xlsx", /^Imported 2350 benchmark rows \(replaced 2350 prior upload rows\)$/)
    const after = await persisted()
    expectMatches(after, second, vendorId)
    expect(new Set(after.map((s) => s.vendorItemNo)).size).toBe(ROW_COUNT)
  } finally {
    await deleteSeed()
  }
})
