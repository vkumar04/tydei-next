import { test, expect } from "../../support/test"
import { createScratchContract, deleteContract, withDb } from "../../support/db"
import { amendmentPdfLines, buildTextPdf, type AmendmentFixture } from "../../support/upload-fixtures"

test.use({ storageState: "tests/e2e/.auth/facility.json" })

test("amendment PDF extending the term and raising the value → review diff → Apply Changes updates the contract", async ({ page }) => {
  test.setTimeout(300_000)
  const contractName = `Amendment Scratch ${Date.now().toString(36)}`
  const contractId = await createScratchContract(contractName)
  try {
    await withDb((c) => c.query(`update contract set "totalValue" = 500000, "contractNumber" = $2 where id = $1`, [contractId, `AMD-${contractId.slice(-6)}`]))
    const amendment: AmendmentFixture = {
      contractName,
      vendor: "Stryker",
      originalExpiration: "December 31, 2028",
      newExpiration: "December 31, 2030",
      newTotalValue: "$750,000",
      amendmentEffective: "October 1, 2026",
    }

    await page.goto(`/dashboard/contracts/${contractId}`)
    await page.getByRole("button", { name: "Add Amendment" }).click()
    const dialog = page.getByRole("dialog").filter({ hasText: "Amendment Extractor" })
    await expect(dialog.getByRole("button", { name: "Upload Amendment PDF" })).toBeVisible({ timeout: 15_000 })
    await dialog.locator('input[type="file"][accept=".pdf,.txt"]').setInputFiles({
      name: "first-amendment.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await buildTextPdf(amendmentPdfLines(amendment))),
    })
    await expect(dialog.getByRole("button", { name: "Apply Changes" })).toBeVisible({ timeout: 240_000 })

    const expirationRow = dialog.getByRole("row").filter({ hasText: /Expiration/i })
    await expect(expirationRow).toHaveCount(1)
    await expect(expirationRow).toContainText("2028")
    await expect(expirationRow).toContainText("2030")
    const valueRow = dialog.getByRole("row").filter({ hasText: /Total (Contract )?Value/i })
    await expect(valueRow).toHaveCount(1)
    await expect(valueRow).toContainText(/750,?000/)

    await dialog.getByRole("button", { name: "Apply Changes" }).click()
    await expect(dialog).toBeHidden({ timeout: 60_000 })
    await expect(page.getByText("Dec 31, 2030").first()).toBeVisible({ timeout: 30_000 })

    const saved = await withDb(async (c) => {
      const { rows } = await c.query(
        `select "expirationDate"::date::text as exp, "effectiveDate"::date::text as eff, "totalValue"::float as total, name, "vendorId"
           from contract where id = $1`,
        [contractId],
      )
      return rows[0] as { exp: string; eff: string; total: number; name: string; vendorId: string }
    })
    expect(saved.exp).toBe("2030-12-31")
    expect(saved.total).toBe(750_000)
    expect(saved.eff).toBe("2026-01-01")
    expect(saved.name).toBe(contractName)
  } finally {
    await deleteContract(contractId)
  }
})
