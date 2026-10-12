import { test, expect } from "../../support/test"
import type { Page } from "@playwright/test"
import { facilityIdByName, withDb } from "../../support/db"
import {
  buildCsv,
  buildLegacyXls,
  buildXlsx,
  cogFixtureRows,
  cogMatrix,
  cogTotal,
  type CogFixtureRow,
} from "../../support/upload-fixtures"

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

test.use({ storageState: "tests/e2e/.auth/facility.json" })
test.describe.configure({ mode: "serial" })

async function deleteSeed(seed: number) {
  await withDb((c) => c.query(`delete from cog_record where "poNumber" like $1`, [`PO-FX-${String(seed).padStart(2, "0")}-%`]))
}

async function persisted(seed: number) {
  const facilityId = await facilityIdByName()
  return withDb(async (c) => {
    const { rows } = await c.query(
      `select count(*)::int as n,
              coalesce(round(sum("extendedPrice")::numeric, 2), 0)::float as total,
              count(*) filter (where "inventoryDescription" like '%[object Object]%')::int as garbled,
              count(distinct "vendorId")::int as vendors,
              count(*) filter (where "transactionDate" is null)::int as undated
         from cog_record
        where "facilityId" = $1 and "poNumber" like $2`,
      [facilityId, `PO-FX-${String(seed).padStart(2, "0")}-%`],
    )
    return rows[0] as { n: number; total: number; garbled: number; vendors: number; undated: number }
  })
}

async function importThroughWizard(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
  expectedRows: number,
) {
  await page.goto("/dashboard/cog-data")
  await page.getByRole("button", { name: "Import", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText(/Drop a CSV or Excel file/i)).toBeVisible({ timeout: 15_000 })
  await dialog.locator('input[type="file"]').setInputFiles(file)
  await dialog.getByRole("button", { name: "Next" }).click({ timeout: 60_000 })
  await dialog.getByRole("button", { name: "Next" }).click({ timeout: 30_000 })
  await dialog.getByRole("button", { name: /Continue to Preview/ }).click({ timeout: 60_000 })
  const importButton = dialog.getByRole("button", { name: /^Import [\d,]+ Records?$/ })
  await expect(importButton).toHaveText(new RegExp(`^Import ${String(expectedRows).replace(/\B(?=(\d{3})+$)/g, ",?")} Records?$`))
  await importButton.click()
  await expect(dialog.getByText("Import Complete")).toBeVisible({ timeout: 240_000 })
  return dialog
}

async function expectPersisted(seed: number, rows: CogFixtureRow[]) {
  const got = await persisted(seed)
  expect(got.n, "rows persisted").toBe(rows.length)
  expect(got.total, "sum of extendedPrice").toBeCloseTo(cogTotal(rows), 2)
  expect(got.garbled, "descriptions stored as [object Object]").toBe(0)
  expect(got.undated, "rows missing a transaction date").toBe(0)
  expect(got.vendors, "resolved vendors").toBe(Math.min(4, rows.length))
}

test.describe("COG import wizard persists exactly what the file contains", () => {
  test("styled .xlsx with report title rows, rich-text and formula cells", async ({ page }) => {
    const seed = 11
    await deleteSeed(seed)
    const rows = cogFixtureRows(60, seed)
    const buffer = await buildXlsx(cogMatrix(rows), {
      titleRows: ["Lighthouse Surgical Center", "Cost of Goods — Q3 2026"],
      richTextColumn: 3,
      hyperlinkColumn: 2,
      formulaColumn: { index: 8, sourceA: 6, sourceB: 7 },
    })
    await importThroughWizard(page, { name: "cog-styled.xlsx", mimeType: XLSX, buffer }, rows.length)
    await expectPersisted(seed, rows)
    await deleteSeed(seed)
  })

  test("legacy .xls export", async ({ page }) => {
    const seed = 12
    await deleteSeed(seed)
    const rows = cogFixtureRows(25, seed)
    const buffer = buildLegacyXls(cogMatrix(rows), ["Legacy ERP export"])
    await importThroughWizard(page, { name: "cog-legacy.xls", mimeType: "application/vnd.ms-excel", buffer }, rows.length)
    await expectPersisted(seed, rows)
    await deleteSeed(seed)
  })

  test("CSV, then the same file again imports nothing new", async ({ page }) => {
    const seed = 13
    await deleteSeed(seed)
    const rows = cogFixtureRows(30, seed)
    const file = { name: "cog.csv", mimeType: "text/csv", buffer: buildCsv(cogMatrix(rows)) }
    await importThroughWizard(page, file, rows.length)
    await expectPersisted(seed, rows)
    await importThroughWizard(page, file, rows.length)
    await expectPersisted(seed, rows)
    await deleteSeed(seed)
  })

  test("multi-megabyte 15,000-row workbook imports completely", async ({ page }) => {
    test.setTimeout(420_000)
    const seed = 14
    await deleteSeed(seed)
    const rows = cogFixtureRows(15_000, seed)
    const buffer = await buildXlsx(cogMatrix(rows), { phantomTailRows: 3_000, phantomTailColumn: 0 })
    expect(buffer.byteLength).toBeGreaterThan(600_000)
    await importThroughWizard(page, { name: "cog-large.xlsx", mimeType: XLSX, buffer }, rows.length)
    await expectPersisted(seed, rows)
    await deleteSeed(seed)
  })
})
