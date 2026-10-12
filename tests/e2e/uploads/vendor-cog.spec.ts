import { test, expect } from "../../support/test"
import type { Page } from "@playwright/test"
import { vendorIdForUser, withDb } from "../../support/db"
import {
  buildCsv,
  buildXlsx,
  vendorCogExtended,
  vendorCogMatrix,
  vendorCogRows,
  type VendorCogRow,
} from "../../support/upload-fixtures"

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

test.use({ storageState: "tests/e2e/.auth/vendor.json" })
test.describe.configure({ mode: "serial" })

function poPrefix(seed: number): string {
  return `VPO-${String(seed).padStart(2, "0")}-%`
}

async function deleteSeed(seed: number) {
  await withDb((c) => c.query(`delete from vendor_cog_record where "poNumber" like $1`, [poPrefix(seed)]))
}

interface PersistedCog {
  inventoryNumber: string
  inventoryDescription: string
  manufacturerNo: string | null
  poNumber: string
  unitCost: number
  extendedPrice: number
  quantity: number
  date: string
  category: string | null
  vendorId: string
  vendorDivisionId: string | null
  facilityId: string | null
}

async function persisted(seed: number): Promise<PersistedCog[]> {
  return withDb(async (c) => {
    const { rows } = await c.query(
      `select "inventoryNumber", "inventoryDescription", "manufacturerNo", "poNumber",
              "unitCost"::float as "unitCost", "extendedPrice"::float as "extendedPrice", quantity,
              "transactionDate"::text as date, category, "vendorId", "vendorDivisionId", "facilityId"
         from vendor_cog_record where "poNumber" like $1 order by "poNumber", "createdAt"`,
      [poPrefix(seed)],
    )
    return rows as PersistedCog[]
  })
}

function sumExtended(rows: VendorCogRow[]): number {
  return Math.round(rows.reduce((a, r) => a + vendorCogExtended(r), 0) * 100) / 100
}

async function importCogs(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, expectedRows: number) {
  await page.goto("/vendor/settings")
  await page.getByRole("tab", { name: "COGS" }).click()
  await expect(page.getByText("Cost of Goods (COGS)").first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("button", { name: /Import COGS/ }).first()).toBeEnabled()
  await page.locator('input[type="file"][accept=".csv,.xlsx,.xls"]').first().setInputFiles(file)
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: `Map columns — ${file.name}` })).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByText(/All (required )?columns detected/)).toBeVisible()
  await expect(dialog.getByText(new RegExp(`Preview — first ${Math.min(5, expectedRows)} of ${expectedRows.toLocaleString()} rows`))).toBeVisible()
  await dialog.getByRole("button", { name: "Import", exact: true }).click()
  await expect(page.getByText(`Imported ${expectedRows.toLocaleString()} COG rows`)).toBeVisible({ timeout: 120_000 })
  await expect(dialog).toBeHidden()
}

function expectRowsMatch(saved: PersistedCog[], rows: VendorCogRow[], vendorId: string) {
  expect(saved).toHaveLength(rows.length)
  rows.forEach((r, i) => {
    const s = saved[i]!
    expect(s.poNumber).toBe(r.po)
    expect(s.inventoryNumber).toBe(r.itemNumber)
    expect(s.inventoryDescription).toBe(r.description)
    expect(s.manufacturerNo).toBe(r.mfrNo)
    expect(s.quantity).toBe(r.quantity)
    expect(s.unitCost).toBeCloseTo(r.unitPrice, 2)
    expect(s.extendedPrice).toBeCloseTo(vendorCogExtended(r), 2)
    expect(s.date).toBe(r.date.toISOString().slice(0, 10))
    expect(s.category, "category is set").toBeTruthy()
    expect(s.vendorId).toBe(vendorId)
    expect(s.vendorDivisionId).toBeNull()
    expect(s.facilityId).toBeNull()
  })
}

test("vendor COGS: styled .xlsx with a report title row persists every row", async ({ page }) => {
  test.setTimeout(180_000)
  const seed = 61
  await deleteSeed(seed)
  try {
    const rows = vendorCogRows(40, seed)
    const buffer = await buildXlsx(vendorCogMatrix(rows), { titleRows: ["Stryker — Cost of Goods Export Q1-Q2 2026"] })
    await importCogs(page, { name: "vendor-cogs.xlsx", mimeType: XLSX, buffer }, rows.length)
    const vendorId = await vendorIdForUser()
    const saved = await persisted(seed)
    expectRowsMatch(saved, rows, vendorId)
    const total = Math.round(saved.reduce((a, s) => a + s.extendedPrice, 0) * 100) / 100
    expect(total).toBeCloseTo(sumExtended(rows), 2)
    await expect(page.getByRole("cell", { name: new RegExp(rows[0]!.itemNumber) }).first()).toBeVisible()
  } finally {
    await deleteSeed(seed)
  }
})

test("vendor COGS: .csv import, and re-uploading the same file appends a second copy", async ({ page }) => {
  test.setTimeout(180_000)
  const seed = 62
  await deleteSeed(seed)
  try {
    const rows = vendorCogRows(25, seed)
    const file = { name: "vendor-cogs.csv", mimeType: "text/csv", buffer: buildCsv(vendorCogMatrix(rows, true)) }
    const vendorId = await vendorIdForUser()

    await importCogs(page, file, rows.length)
    expectRowsMatch(await persisted(seed), rows, vendorId)

    await importCogs(page, file, rows.length)
    const twice = await persisted(seed)
    expect(twice).toHaveLength(rows.length * 2)
    const total = Math.round(twice.reduce((a, s) => a + s.extendedPrice, 0) * 100) / 100
    expect(total).toBeCloseTo(sumExtended(rows) * 2, 2)
    const perPo = new Map<string, number>()
    for (const s of twice) perPo.set(s.poNumber, (perPo.get(s.poNumber) ?? 0) + 1)
    expect([...perPo.values()].every((n) => n === 2)).toBe(true)
  } finally {
    await deleteSeed(seed)
  }
})

test("vendor COGS: category is stored as uploaded", async ({ page }) => {
  test.setTimeout(120_000)
  const seed = 63
  await deleteSeed(seed)
  try {
    const rows = vendorCogRows(3, seed)
    const file = { name: "vendor-cogs-categories.csv", mimeType: "text/csv", buffer: buildCsv(vendorCogMatrix(rows, true)) }
    await importCogs(page, file, rows.length)
    const saved = await persisted(seed)
    expect(saved).toHaveLength(rows.length)
    expect(saved.map((s) => s.category)).toEqual(rows.map((r) => r.category))
    await expect(page.getByText("Sports Medicine", { exact: true }).first()).toBeVisible()
  } finally {
    await deleteSeed(seed)
  }
})
