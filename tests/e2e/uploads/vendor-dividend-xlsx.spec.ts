import { test, expect } from "../../support/test"
import type { Locator, Page } from "@playwright/test"
import { vendorIdForUser, withDb } from "../../support/db"
import { buildXlsx, type Cell } from "../../support/upload-fixtures"

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const LABEL_PREFIX = "VNDE2E"

test.use({ storageState: "tests/e2e/.auth/vendor.json" })
test.describe.configure({ mode: "serial" })

const PAYOR_QUARTERS: [number, number][] = [
  [2025, 2],
  [2025, 3],
  [2025, 4],
  [2026, 1],
]
const PAYOR_GROUPS: { group: string; volumes: number[] }[] = [
  { group: "Total Knee Replacement", volumes: [101, 102, 103, 104] },
  { group: "Total Hip Replacement", volumes: [51, 52, 53, 54] },
  { group: "Shoulder", volumes: [21, 22, 23, 24] },
]

const PNL_LINES: [string, number][] = [
  ["Revenue - standard billing rate", 320_000_000],
  ["Revenue - contractual adjustment", -275_000_000],
  ["Salary and benefits", 3_600_000],
  ["Medical supplies and services", 14_500_000],
  ["Small equipment purchases", 9_000],
  ["Office expenses", 16_000],
  ["Legal", 8_000],
  ["Computer services", 41_000],
  ["Management fees", 1_100_000],
  ["Billing and collection", 1_050_000],
  ["Other outside services", 170_000],
  ["Insurance", 72_000],
  ["Administrative expenses", 61_000],
  ["Rent / TI amortization / utilities", 1_250_000],
  ["Other facility expenses", 66_000],
  ["Repairs & maintenance", 42_000],
  ["Property tax", 71_000],
  ["State taxes", 0],
  ["Software maintenance", 72_000],
  ["Equip rent / interest / other", 820_000],
]
const CASE_VOLUME = 6_000

function money(n: number): string {
  return `$${n.toLocaleString("en-US")}`
}

async function cleanup() {
  const vendorId = await vendorIdForUser()
  await withDb(async (c) => {
    await c.query(`delete from payor_volume_dataset where "vendorId" = $1 and "facilityLabel" like $2`, [vendorId, `${LABEL_PREFIX}%`])
    await c.query(`delete from proforma_statement where "vendorId" = $1 and "facilityLabel" like $2`, [vendorId, `${LABEL_PREFIX}%`])
    await c.query(`delete from medicare_rate_set where "vendorId" = $1 and name like $2`, [vendorId, `${LABEL_PREFIX}%`])
  })
}

async function openDividendTab(page: Page) {
  await page.goto("/vendor/prospective")
  await page.getByRole("tab", { name: /dividend \/ dcf/i }).click()
  await expect(page.getByRole("heading", { name: /dividend & dcf impact report/i })).toBeVisible({ timeout: 15_000 })
}

async function chooseUnconnected(dialog: Locator, name: string) {
  await dialog.getByRole("button", { name: /unconnected facility/i }).click()
  await dialog.getByPlaceholder("e.g. Coastal Surgery Center").fill(name)
}

function payorMatrix(): Cell[][] {
  return [
    ["Procedure Group", "Year", "Quarter", "Volume"],
    ...PAYOR_GROUPS.flatMap((g) => PAYOR_QUARTERS.map(([y, q], i) => [g.group, y, q, g.volumes[i]!] as Cell[])),
  ]
}

async function uploadPayorXlsx(page: Page, facilityLabel: string, fileName: string) {
  await page.getByRole("button", { name: /upload payor data/i }).click()
  const dialog = page.getByRole("dialog")
  await chooseUnconnected(dialog, facilityLabel)
  const buffer = await buildXlsx(payorMatrix(), { titleRows: ["Payor-Reported Procedure Volume — Commercial + Medicare"] })
  await dialog.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: XLSX, buffer })
  await dialog.getByRole("button", { name: /save payor data/i }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

async function uploadPnl(page: Page, facilityLabel: string, fileName: string, matrix: Cell[][], titleRows: string[]) {
  await page.getByRole("button", { name: /upload p&l/i }).click()
  const dialog = page.getByRole("dialog")
  await chooseUnconnected(dialog, facilityLabel)
  await dialog.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: XLSX, buffer: await buildXlsx(matrix, { titleRows }) })
  await dialog.getByRole("button", { name: "Import", exact: true }).click()
  return dialog
}

test.beforeAll(cleanup)
test.afterAll(cleanup)

test("payor volume .xlsx with a report title row persists the dataset and drives the model", async ({ page }) => {
  test.setTimeout(120_000)
  const facilityLabel = `${LABEL_PREFIX} Payor Xlsx ${Date.now()}`
  const fileName = "vendor-payor-volume.xlsx"
  await openDividendTab(page)
  await uploadPayorXlsx(page, facilityLabel, fileName)

  const total = PAYOR_GROUPS.reduce((a, g) => a + g.volumes.reduce((x, y) => x + y, 0), 0)
  await expect(
    page.getByText(`3 groups · ${total} cases/yr · 2025-Q2, 2025-Q3, 2025-Q4, 2026-Q1 · ${fileName}`),
  ).toBeVisible({ timeout: 15_000 })

  const vendorId = await vendorIdForUser()
  const saved = await withDb(async (c) => {
    const { rows } = await c.query(
      `select "facilityKey", "facilityId", "fileName", periods, groups, "totalAnnualizedVolume"
         from payor_volume_dataset where "vendorId" = $1 and "facilityLabel" = $2`,
      [vendorId, facilityLabel],
    )
    return rows as {
      facilityKey: string
      facilityId: string | null
      fileName: string
      periods: string[]
      groups: { group: string; quarters: { year: number; quarter: number; volume: number }[]; totalVolume: number; annualizedVolume: number }[]
      totalAnnualizedVolume: number
    }[]
  })
  expect(saved).toHaveLength(1)
  const row = saved[0]!
  expect(row.facilityKey).toBe(`adhoc:${facilityLabel.toLowerCase()}`)
  expect(row.facilityId).toBeNull()
  expect(row.fileName).toBe(fileName)
  expect(row.periods).toEqual(["2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1"])
  expect(row.totalAnnualizedVolume).toBe(total)
  expect(row.groups.map((g) => g.group)).toEqual(PAYOR_GROUPS.map((g) => g.group))
  PAYOR_GROUPS.forEach((g, i) => {
    const s = row.groups[i]!
    expect(s.quarters.map((q) => [q.year, q.quarter, q.volume])).toEqual(PAYOR_QUARTERS.map(([y, q], qi) => [y, q, g.volumes[qi]]))
    expect(s.totalVolume).toBe(g.volumes.reduce((a, b) => a + b, 0))
    expect(s.annualizedVolume).toBe(g.volumes.reduce((a, b) => a + b, 0))
  })

  await page.getByRole("button", { name: "Total Knee Replacement", exact: true }).click()
  await expect(page.getByText("1 selected · 410 cases/yr")).toBeVisible()
  await expect(page.getByLabel("Total Knee Replacement 2026 Q1 case volume")).toHaveValue("104")
})

test("Medicare rate table .xlsx with a title row persists and shadows the built-in rate", async ({ page }) => {
  test.setTimeout(120_000)
  await openDividendTab(page)
  await uploadPayorXlsx(page, `${LABEL_PREFIX} Rates Xlsx ${Date.now()}`, "vendor-payor-for-rates.xlsx")
  await expect(page.getByText(/3 groups · 710 cases\/yr/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole("button", { name: "Total Knee Replacement", exact: true }).click()
  await expect(page.getByLabel("Medicare rate ($/case)")).toHaveValue("9450")

  const setName = `${LABEL_PREFIX} CY2026 Xlsx ${Date.now()}`
  const rates: [string, string, number][] = [
    ["Total Knee Replacement", "CPT 27447", 9_876],
    ["Total Hip Replacement", "CPT 27130", 9_912],
    ["Shoulder", "CPT 29826", 4_111],
  ]
  await page.getByRole("button", { name: /upload rates/i }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Rate set name").fill(setName)
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "vendor-medicare-rates.xlsx",
    mimeType: XLSX,
    buffer: await buildXlsx([["Procedure Group", "CPT Code", "Rate"], ...rates], { titleRows: ["CMS ASC Payment Rates — CY2026 (VNDE2E)"] }),
  })
  await dialog.getByRole("button", { name: "Import", exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await expect(page.getByLabel("Medicare rate ($/case)")).toHaveValue("9876", { timeout: 15_000 })
  await expect(page.getByText(money(Math.round(9_876 * 1.2))).first()).toBeVisible()

  const vendorId = await vendorIdForUser()
  const saved = await withDb(async (c) => {
    const { rows } = await c.query(`select "fileName", rates from medicare_rate_set where "vendorId" = $1 and name = $2`, [vendorId, setName])
    return rows as { fileName: string; rates: { group: string; code: string; medicareRate: number }[] }[]
  })
  expect(saved).toHaveLength(1)
  expect(saved[0]!.fileName).toBe("vendor-medicare-rates.xlsx")
  expect(saved[0]!.rates.map((r) => [r.group, r.code, r.medicareRate])).toEqual(rates)
})

test("P&L .xlsx with a title row imports the annual column and drives the before/after P&L", async ({ page }) => {
  test.setTimeout(120_000)
  const facilityLabel = `${LABEL_PREFIX} PnL Xlsx ${Date.now()}`
  await openDividendTab(page)
  const matrix: Cell[][] = [
    ["Line item", "Annual", "Per case"],
    ...PNL_LINES.map(([label, amount]) => [label, amount, Math.round(amount / CASE_VOLUME)] as Cell[]),
    ["Case volume", CASE_VOLUME, null],
  ]
  const dialog = await uploadPnl(page, facilityLabel, "vendor-pnl.xlsx", matrix, ["Steady State Proforma — FY2026"])
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await expect(page.getByText(new RegExp(`Loaded from the uploaded statement for ${facilityLabel}`))).toBeVisible({ timeout: 15_000 })

  const revenue = 320_000_000 - 275_000_000
  const expenses = PNL_LINES.slice(2).reduce((a, [, n]) => a + n, 0)
  await expect(page.getByText(money(revenue)).first()).toBeVisible()
  await expect(page.getByText(money(revenue - expenses)).first()).toBeVisible()

  const vendorId = await vendorIdForUser()
  const saved = await withDb(async (c) => {
    const { rows } = await c.query(
      `select "fileName", "lineItems", "matchedFields" from proforma_statement where "vendorId" = $1 and "facilityLabel" = $2`,
      [vendorId, facilityLabel],
    )
    return rows as { fileName: string; lineItems: Record<string, number>; matchedFields: string[] }[]
  })
  expect(saved).toHaveLength(1)
  const { lineItems, matchedFields } = saved[0]!
  expect(matchedFields).toHaveLength(21)
  expect(lineItems.standardBillingRevenue).toBe(320_000_000)
  expect(lineItems.contractualAdjustment).toBe(275_000_000)
  expect(lineItems.salaryBenefits).toBe(3_600_000)
  expect(lineItems.medicalSupplies).toBe(14_500_000)
  expect(lineItems.equipRentInterestOther).toBe(820_000)
  expect(lineItems.stateTaxes).toBe(0)
  expect(lineItems.caseVolume).toBe(CASE_VOLUME)
  const expenseKeys = Object.keys(lineItems).filter((k) => !["standardBillingRevenue", "contractualAdjustment", "caseVolume"].includes(k))
  expect(expenseKeys.reduce((a, k) => a + lineItems[k]!, 0)).toBe(expenses)
})

test("P&L .xlsx with too few recognizable lines is rejected with a clear message and nothing is saved", async ({ page }) => {
  test.setTimeout(120_000)
  const facilityLabel = `${LABEL_PREFIX} PnL Sparse ${Date.now()}`
  await openDividendTab(page)
  const dialog = await uploadPnl(
    page,
    facilityLabel,
    "vendor-pnl-sparse.xlsx",
    [
      ["Line item", "Annual"],
      ["Revenue - standard billing rate", 320_000_000],
      ["Medical supplies and services", 14_500_000],
      ["Legal", 8_000],
      ["Widget amortization reserve", 12_345],
      ["Miscellaneous accruals", 6_789],
    ],
    ["Partial P&L"],
  )
  await expect(dialog.getByText(/Only 3 P&L lines were recognized\. The file should have one row per line item/)).toBeVisible({ timeout: 15_000 })
  await expect(dialog.getByRole("button", { name: "Import", exact: true })).toBeEnabled()
  await expect(page.getByText(new RegExp(`Loaded from the uploaded statement for ${facilityLabel}`))).toHaveCount(0)
  const vendorId = await vendorIdForUser()
  const count = await withDb(async (c) => {
    const { rows } = await c.query(`select count(*)::int as n from proforma_statement where "vendorId" = $1 and "facilityLabel" = $2`, [vendorId, facilityLabel])
    return (rows[0] as { n: number }).n
  })
  expect(count).toBe(0)
})

test("P&L missing a required line names it in plain words", async ({ page }) => {
  test.setTimeout(120_000)
  await openDividendTab(page)
  const dialog = await uploadPnl(
    page,
    `${LABEL_PREFIX} PnL Missing ${Date.now()}`,
    "vendor-pnl-no-supplies.xlsx",
    [["Line item", "Annual"], ...PNL_LINES.filter(([label]) => label !== "Medical supplies and services")],
    [],
  )
  const error = dialog.getByText(/P&L lines? were recognized/)
  await expect(error).toBeVisible({ timeout: 15_000 })
  await expect(error).toContainText(/medical supplies/i)
  await expect(error).not.toContainText("medicalSupplies")
})
