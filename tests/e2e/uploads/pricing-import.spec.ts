import { test, expect } from "../../support/test"
import { createScratchContract, deleteContract, facilityIdByName, vendorIdByName, withDb } from "../../support/db"
import { buildCsv, buildXlsx, pricingFixtureRows, pricingMatrix } from "../../support/upload-fixtures"

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

test.use({ storageState: "tests/e2e/.auth/facility.json" })
test.describe.configure({ mode: "serial" })

async function deletePricingSeed(seed: number) {
  await withDb((c) => c.query(`delete from pricing_file where "vendorItemNo" like $1`, [`PX-${String(seed).padStart(2, "0")}-%`]))
}

test("COG page Pricing Import: vendor-style .xlsx headers map and persist every item", async ({ page }) => {
  test.setTimeout(240_000)
  const seed = 21
  await deletePricingSeed(seed)
  const rows = pricingFixtureRows(40, seed)
  await page.goto("/dashboard/cog-data")
  await page.getByRole("tab", { name: "Pricing Files" }).click()
  await page.getByRole("tabpanel").getByRole("button", { name: /import|upload/i }).first().click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Import Pricing File")).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole("combobox").first().click()
  await page.getByRole("option", { name: "Stryker", exact: true }).click()
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "stryker-pricing.xlsx",
    mimeType: XLSX,
    buffer: await buildXlsx(pricingMatrix(rows), { titleRows: ["Stryker Price Agreement 2026"] }),
  })
  await dialog.getByRole("button", { name: "Preview" }).click({ timeout: 60_000 })
  const toPreview = dialog.getByRole("button", { name: /continue|preview|next/i }).last()
  if (await toPreview.isVisible().catch(() => false)) await toPreview.click()
  await dialog.getByRole("button", { name: new RegExp(`Import ${rows.length} Entries`) }).click({ timeout: 30_000 })
  await expect(dialog.getByText("Import Complete")).toBeVisible({ timeout: 120_000 })

  const facilityId = await facilityIdByName()
  const vendorId = await vendorIdByName("Stryker")
  const saved = await withDb(async (c) => {
    const { rows: r } = await c.query(
      `select "vendorItemNo", "productDescription", "contractPrice"::float as price, "listPrice"::float as list,
              "vendorId", "facilityId", "effectiveDate"::text as eff, category
         from pricing_file where "vendorItemNo" like $1 order by "vendorItemNo"`,
      [`PX-${seed}-%`],
    )
    return r as { vendorItemNo: string; productDescription: string; price: number; list: number; vendorId: string; facilityId: string; eff: string; category: string }[]
  })
  expect(saved).toHaveLength(rows.length)
  expect(saved.every((r) => r.vendorId === vendorId && r.facilityId === facilityId)).toBe(true)
  rows.forEach((row, i) => {
    expect(saved[i]!.vendorItemNo).toBe(row.vendorItemNo)
    expect(saved[i]!.productDescription).toBe(row.description)
    expect(saved[i]!.price).toBeCloseTo(row.contractPrice, 2)
    expect(saved[i]!.list).toBeCloseTo(row.listPrice, 2)
    expect(saved[i]!.eff.slice(0, 10)).toBe("2026-01-01")
  })
  await deletePricingSeed(seed)
})

for (const format of ["xlsx", "csv"] as const) {
  test(`contract Pricing tab: ${format} upload replaces the contract's pricing with the file's items`, async ({ page }) => {
    test.setTimeout(240_000)
    const seed = format === "xlsx" ? 22 : 23
    const contractId = await createScratchContract(`Pricing Tab ${format}`)
    try {
      const rows = pricingFixtureRows(30, seed)
      const buffer = format === "xlsx" ? await buildXlsx(pricingMatrix(rows)) : buildCsv(pricingMatrix(rows))
      await page.goto(`/dashboard/contracts/${contractId}`)
      await page.getByRole("tab", { name: /pricing/i }).click({ timeout: 30_000 })
      await page.locator('input[type="file"][accept=".csv,.xlsx,.xls"]').first().setInputFiles({
        name: `contract-pricing.${format}`,
        mimeType: format === "xlsx" ? XLSX : "text/csv",
        buffer,
      })
      const remap = page.getByRole("dialog")
      for (let i = 0; i < 3; i++) {
        const done = page.getByText(/Imported \d+ pricing records/)
        if (await done.isVisible().catch(() => false)) break
        const confirm = remap.getByRole("button", { name: /import|confirm|continue|apply|save/i }).last()
        if (await confirm.isVisible({ timeout: 5_000 }).catch(() => false)) await confirm.click()
      }
      await expect(page.getByText(`Imported ${rows.length} pricing records`)).toBeVisible({ timeout: 120_000 })

      const saved = await withDb(async (c) => {
        const { rows: r } = await c.query(
          `select "vendorItemNo", description, "unitPrice"::float as price, "listPrice"::float as list, uom
             from contract_pricing where "contractId" = $1 order by "vendorItemNo"`,
          [contractId],
        )
        return r as { vendorItemNo: string; description: string; price: number; list: number; uom: string }[]
      })
      expect(saved).toHaveLength(rows.length)
      rows.forEach((row, i) => {
        expect(saved[i]!.vendorItemNo).toBe(row.vendorItemNo)
        expect(saved[i]!.description).toBe(row.description)
        expect(saved[i]!.price).toBeCloseTo(row.contractPrice, 2)
        expect(saved[i]!.list).toBeCloseTo(row.listPrice, 2)
      })
      await expect(page.getByRole("cell", { name: rows[0]!.vendorItemNo })).toBeVisible()
    } finally {
      await deleteContract(contractId)
    }
  })
}
