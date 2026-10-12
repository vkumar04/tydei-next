import { test, expect } from "../../support/test"
import type { Locator, Page } from "@playwright/test"
import { facilityIdByName, withDb } from "../../support/db"
import {
  buildTextPdf,
  payorContractPdfLines,
  payorRatesCsv,
  type PayorContractFixture,
  type PayorRateFixture,
} from "../../support/upload-fixtures"

test.use({ storageState: "tests/e2e/.auth/facility.json" })
test.describe.configure({ mode: "serial" })

const RUN = Date.now().toString(36).toUpperCase()
const PAYOR: PayorContractFixture = {
  payorName: "Harborview Health Plan",
  contractNumber: `HHP-ASC-${RUN}`,
  effective: "2026-07-01",
  expiration: "2029-06-30",
  rates: [
    { cpt: "27447", description: "Total knee arthroplasty", rate: 18250 },
    { cpt: "29881", description: "Knee arthroscopy with meniscectomy", rate: 3415.5 },
    { cpt: "22551", description: "Anterior cervical discectomy and fusion", rate: 14980 },
    { cpt: "64483", description: "Transforaminal epidural injection", rate: 912.75 },
  ],
}
const CSV_RATES: PayorRateFixture[] = [
  { cpt: "29882", description: "Knee arthroscopy with meniscus repair", rate: 3620 },
  { cpt: "23412", description: "Open rotator cuff repair", rate: 6875.25 },
  { cpt: "27447", description: "Total knee arthroplasty", rate: 18900 },
]

interface SavedPayorContract {
  id: string
  payorName: string
  facilityId: string
  contractNumber: string
  eff: string
  exp: string
  status: string
  fileName: string | null
  s3Key: string | null
  cptRates: { cptCode: string; rate: number; description?: string }[]
}

async function savedContract(): Promise<SavedPayorContract[]> {
  return withDb(async (c) => {
    const { rows } = await c.query(
      `select id, "payorName", "facilityId", "contractNumber", "effectiveDate"::date::text as eff,
              "expirationDate"::date::text as exp, status, "fileName", "s3Key", "cptRates"
         from payor_contract where "contractNumber" = $1`,
      [PAYOR.contractNumber],
    )
    return rows as SavedPayorContract[]
  })
}

function rateMap(rates: { cptCode: string; rate: number }[]): Record<string, number> {
  return Object.fromEntries([...rates].sort((a, b) => a.cptCode.localeCompare(b.cptCode)).map((r) => [r.cptCode, r.rate]))
}

async function cleanup() {
  await withDb((c) => c.query(`delete from payor_contract where "contractNumber" like $1`, [`HHP-ASC-${RUN}%`]))
}

async function openAddContract(page: Page): Promise<Locator> {
  await page.goto("/dashboard/case-costing?tab=payor-contracts")
  await expect(page.getByText("Payor Reimbursement Rates")).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "Add Contract" }).click()
  const dialog = page.getByRole("dialog").filter({ hasText: "Add Payor Contract" })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe("Payor contracts: AI extraction from a PDF, then rates appended from a CSV", () => {
  test.beforeAll(cleanup)
  test.afterAll(cleanup)

  test("new payor contract from a PDF → prefilled form → Save Contract → payor_contract with every CPT rate", async ({ page }) => {
    test.setTimeout(300_000)
    const dialog = await openAddContract(page)
    await dialog.locator("#payor-contract-file").setInputFiles({
      name: `harborview-asc-${RUN}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(await buildTextPdf(payorContractPdfLines(PAYOR))),
    })
    await dialog.getByRole("button", { name: "Extract Rates with AI" }).click()
    await expect(dialog.getByText(`Extracted ${PAYOR.rates.length} CPT rates`, { exact: true })).toBeVisible({ timeout: 240_000 })
    await expect(dialog.getByPlaceholder("e.g., Blue Cross Blue Shield")).toHaveValue(PAYOR.payorName)
    await expect(dialog.getByPlaceholder("Auto-generated if left blank")).toHaveValue(PAYOR.contractNumber)
    await expect(dialog.locator('input[type="date"]').nth(0)).toHaveValue(PAYOR.effective)
    await expect(dialog.locator('input[type="date"]').nth(1)).toHaveValue(PAYOR.expiration)
    await dialog.getByRole("button", { name: "Save Contract" }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
    await expect(page.getByText(`${PAYOR.rates.length} CPT rates`, { exact: true })).toBeVisible({ timeout: 15_000 })

    const rows = await savedContract()
    expect(rows, "one payor_contract row").toHaveLength(1)
    const saved = rows[0]!
    expect(saved.facilityId).toBe(await facilityIdByName())
    expect(saved.payorName).toBe(PAYOR.payorName)
    expect(saved.eff).toBe(PAYOR.effective)
    expect(saved.exp).toBe(PAYOR.expiration)
    expect(saved.status).toBe("active")
    expect(saved.fileName).toBe(`harborview-asc-${RUN}.pdf`)
    expect(saved.s3Key).toMatch(/^payor-contracts\//)
    expect(rateMap(saved.cptRates)).toEqual(rateMap(PAYOR.rates.map((r) => ({ cptCode: r.cpt, rate: r.rate }))))
  })

  test("Add to Existing: rate-schedule CSV → Extract Rates → Import Rates merges into the contract's cptRates", async ({ page }) => {
    test.setTimeout(300_000)
    const dialog = await openAddContract(page)
    await dialog.getByRole("tab", { name: "Add to Existing" }).click()
    await dialog.getByRole("combobox").filter({ hasText: "Choose a contract" }).click()
    await page.getByRole("option", { name: `${PAYOR.payorName} — ${PAYOR.contractNumber}` }).click()
    await dialog.locator("#payor-rates-file").setInputFiles({
      name: `harborview-rates-${RUN}.csv`,
      mimeType: "text/csv",
      buffer: payorRatesCsv(CSV_RATES),
    })
    await dialog.getByRole("button", { name: "Extract Rates", exact: true }).click()
    await expect(page.getByText(new RegExp(`Extracted ${CSV_RATES.length} CPT rates`))).toBeVisible({ timeout: 240_000 })
    await dialog.getByRole("button", { name: "Import Rates" }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
    await expect(page.getByText(`Imported ${CSV_RATES.length} CPT rates (6 total)`)).toBeVisible({ timeout: 15_000 })

    const rows = await savedContract()
    expect(rows).toHaveLength(1)
    const expected = new Map(PAYOR.rates.map((r) => [r.cpt, r.rate]))
    for (const r of CSV_RATES) expected.set(r.cpt, r.rate)
    expect(rateMap(rows[0]!.cptRates)).toEqual(rateMap([...expected].map(([cptCode, rate]) => ({ cptCode, rate }))))
  })
})
