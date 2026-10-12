import { test, expect } from "../../support/test"
import type { Locator, Page } from "@playwright/test"
import { facilityIdByName, scalar, vendorIdForUser, withDb } from "../../support/db"
import {
  VENDOR_CONTRACT_FIXTURE,
  buildTextPdf,
  buildXlsx,
  pricingFixtureRows,
  pricingMatrix,
  rasterizeToScannedPdf,
  vendorContractPdfLines,
  type PricingFixtureRow,
} from "../../support/upload-fixtures"

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const VENDOR_EMAIL = "demo-vendor@tydei.com"
const FIXTURE = VENDOR_CONTRACT_FIXTURE

test.use({ storageState: "tests/e2e/.auth/vendor.json" })
test.describe.configure({ mode: "serial" })

interface PendingTier {
  tierNumber: number
  spendMin: number
  rebateType: string
  rebateValue: number
}

interface PendingRow {
  id: string
  status: string
  vendorId: string
  vendorName: string
  facilityId: string | null
  facilityName: string | null
  contractName: string
  contractType: string
  contractNumber: string | null
  eff: string
  exp: string
  totalValue: number
  terms: { termName: string; termType: string; tiers: PendingTier[] }[]
  documents: { name: string; url: string }[]
  pricingData: {
    fileName: string
    itemCount: number
    totalValue: number
    categories: string[]
    items: { vendorItemNo: string; description?: string; unitPrice: number; listPrice?: number; category?: string; uom?: string }[]
  } | null
}

async function vendorUserId(): Promise<string> {
  return scalar<string>(`select id from "user" where email = $1`, [VENDOR_EMAIL])
}

async function dbNow(): Promise<string> {
  return scalar<string>(`select now()::timestamp(3)::text`)
}

async function purgeExtractionCache() {
  const userId = await vendorUserId()
  await withDb((c) => c.query(`delete from contract_extraction_cache where "userId" = $1 and filename like 'vnde2e-%'`, [userId]))
}

async function pendingSince(since: string): Promise<PendingRow[]> {
  const vendorId = await vendorIdForUser()
  return withDb(async (c) => {
    const { rows } = await c.query(
      `select id, status, "vendorId", "vendorName", "facilityId", "facilityName", "contractName", "contractType",
              "contractNumber", "effectiveDate"::text as eff, "expirationDate"::text as exp,
              "totalValue"::float as "totalValue", terms, documents, "pricingData"
         from pending_contract
        where "vendorId" = $1 and "submittedAt" >= $2::timestamp and status <> 'draft'
        order by "submittedAt"`,
      [vendorId, since],
    )
    return rows as PendingRow[]
  })
}

async function deletePendingSince(since: string) {
  const vendorId = await vendorIdForUser()
  await withDb(async (c) => {
    const { rows } = await c.query(
      `select id from pending_contract where "vendorId" = $1 and "submittedAt" >= $2::timestamp and status <> 'draft'`,
      [vendorId, since],
    )
    const ids = (rows as { id: string }[]).map((r) => r.id)
    if (ids.length === 0) return
    await c.query(`delete from notification where payload->>'pendingId' = any($1)`, [ids])
    await c.query(`delete from pending_contract where id = any($1)`, [ids])
  })
}

async function contractPdf(variant: "text" | "scanned"): Promise<Buffer> {
  const text = await buildTextPdf(vendorContractPdfLines())
  return Buffer.from(variant === "text" ? text : await rasterizeToScannedPdf(text))
}

async function extractAndAccept(page: Page, variant: "text" | "scanned"): Promise<string> {
  const fileName = `vnde2e-contract-${variant}.pdf`
  await page.goto("/vendor/contracts/new")
  await page.getByRole("tab", { name: "Upload PDF" }).click()
  await page.locator("#contract-pdf").setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: await contractPdf(variant) })
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("AI Contract Extraction")).toBeVisible({ timeout: 30_000 })
  const accept = dialog.getByRole("button", { name: /Accept & Populate Form/ })
  await expect(accept).toBeVisible({ timeout: 240_000 })
  const review = await dialog.innerText()
  expect(review).toContain(FIXTURE.vendor)
  expect(review).toContain(FIXTURE.effectiveIso)
  expect(review).toContain(FIXTURE.expirationIso)
  expect(review).toContain(FIXTURE.totalValue)
  expect(review).toMatch(/3 Tiers/)
  await accept.click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText("Data extracted successfully").or(page.getByText("Fill in the contract details manually"))).toBeVisible()
  await expect(page.locator("#contractName")).toHaveValue(/joint implant/i)
  return fileName
}

function cardWith(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true }).locator("xpath=ancestor::div[contains(@class,'space-y-2')][1]")
}

async function pickFacility(page: Page) {
  await cardWith(page, "Target Facility *").getByRole("combobox").click()
  await page.getByRole("option", { name: FIXTURE.facility, exact: true }).click()
  await expect(cardWith(page, "Target Facility *").getByRole("combobox")).toHaveText(FIXTURE.facility)
}

async function submit(page: Page) {
  await page.getByRole("button", { name: "Submit for Review" }).click()
  await expect(page.getByText("Contract submitted for review")).toBeVisible({ timeout: 60_000 })
  await page.waitForURL(/\/vendor\/contracts$/, { timeout: 60_000 })
}

async function expectExtractedFields(row: PendingRow) {
  const vendorId = await vendorIdForUser()
  expect(row.status).toBe("submitted")
  expect(row.vendorId).toBe(vendorId)
  expect(row.vendorName).toBe(FIXTURE.vendor)
  expect(row.facilityId).toBe(await facilityIdByName(FIXTURE.facility))
  expect(row.facilityName).toBe(FIXTURE.facility)
  expect(row.contractName).toMatch(/joint implant/i)
  expect(row.contractType).toBe("usage")
  expect(row.eff).toBe(FIXTURE.effectiveIso)
  expect(row.exp).toBe(FIXTURE.expirationIso)
  expect(row.totalValue).toBe(FIXTURE.totalValueNumber)
  expect(row.terms).toHaveLength(1)
  const tiers = [...row.terms[0]!.tiers].sort((a, b) => a.tierNumber - b.tierNumber)
  expect(tiers.map((t) => t.spendMin)).toEqual(FIXTURE.tiers.map((t) => t.minNumber))
  expect(tiers.map((t) => t.rebateType)).toEqual(["percent_of_spend", "percent_of_spend", "percent_of_spend"])
  tiers.forEach((t, i) => expect(t.rebateValue).toBeCloseTo(FIXTURE.tiers[i]!.fraction, 6))
}

function expectContractPdfDoc(row: PendingRow, fileName: string, userId: string) {
  const doc = row.documents.find((d) => d.name === fileName)
  expect(doc, `${fileName} attached`).toBeDefined()
  expect(doc!.url).toMatch(new RegExp(`^contracts/${userId}/\\d+-[0-9a-f]{8}-${fileName.replace(/\./g, "\\.")}$`))
}

test.afterAll(purgeExtractionCache)

test("text contract PDF → AI extraction → sidebar pricing .xlsx + supporting document → submitted pending contract", async ({ page }) => {
  test.setTimeout(360_000)
  await purgeExtractionCache()
  const since = await dbNow()
  try {
    const pdfName = await extractAndAccept(page, "text")

    const pricing: PricingFixtureRow[] = pricingFixtureRows(25, 72)
    const pricingName = "vnde2e-stryker-price-file.xlsx"
    await page.locator("#pricing-file").setInputFiles({
      name: pricingName,
      mimeType: XLSX,
      buffer: await buildXlsx(pricingMatrix(pricing), { titleRows: ["Stryker Joint Implant Price Agreement — Exhibit A"] }),
    })
    const remap = page.getByRole("dialog")
    await expect(remap.getByRole("heading", { name: "Realign Categories" })).toBeVisible({ timeout: 30_000 })
    await remap.getByRole("button", { name: "Apply & Import" }).click()
    await expect(page.getByText(`Loaded ${pricing.length} pricing items from ${pricingName}`)).toBeVisible({ timeout: 15_000 })
    const pricingTotal = Math.round(pricing.reduce((a, p) => a + p.contractPrice, 0) * 100) / 100
    const pricingCard = page.getByText("Upload a pricing schedule (CSV or Excel)").locator("xpath=ancestor::div[@data-slot='card'][1]")
    await expect(pricingCard).toContainText(`Items${pricing.length}`)
    await expect(pricingCard).toContainText(`$${pricingTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`)

    const supportName = "vnde2e-supporting-exhibit.pdf"
    await page.locator('input[type="file"][accept=".pdf,.doc,.docx,.xls,.xlsx"]').setInputFiles({
      name: supportName,
      mimeType: "application/pdf",
      buffer: Buffer.from(await buildTextPdf([["Exhibit B — Implant Price Schedule", "Supporting document for VNDE2E"]])),
    })
    const attached = page.getByText("Attached Documents").locator("xpath=ancestor::div[@data-slot='card'][1]")
    await expect(attached.getByText(supportName, { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(attached.getByText(pdfName, { exact: true }).first()).toBeVisible()

    await pickFacility(page)
    await submit(page)

    const rows = await pendingSince(since)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    await expectExtractedFields(row)

    const userId = await vendorUserId()
    const vendorId = await vendorIdForUser()
    expect(row.documents).toHaveLength(2)
    expectContractPdfDoc(row, pdfName, userId)
    const support = row.documents.find((d) => d.name === supportName)
    expect(support, "supporting document attached").toBeDefined()
    expect(support!.url).toMatch(new RegExp(`^contracts/(${vendorId}|${userId})/\\d+-[0-9a-z]+-.*vnde2e-supporting-exhibit\\.pdf$`))

    const pd = row.pricingData
    expect(pd).not.toBeNull()
    expect(pd!.fileName).toBe(pricingName)
    expect(pd!.itemCount).toBe(pricing.length)
    expect(pd!.items).toHaveLength(pricing.length)
    expect(pd!.totalValue).toBeCloseTo(pricingTotal, 2)
    expect([...pd!.categories].sort()).toEqual([...new Set(pricing.map((p) => p.category))].sort())
    const items = [...pd!.items].sort((a, b) => a.vendorItemNo.localeCompare(b.vendorItemNo))
    pricing.forEach((p, i) => {
      const it = items[i]!
      expect(it.vendorItemNo).toBe(p.vendorItemNo)
      expect(it.description).toBe(p.description)
      expect(it.unitPrice).toBeCloseTo(p.contractPrice, 2)
      expect(it.listPrice).toBeCloseTo(p.listPrice, 2)
      expect(it.category).toBe(p.category)
      expect(it.uom).toBe(p.uom)
    })
  } finally {
    await deletePendingSince(since)
  }
})

test("scanned (image-only) contract PDF → OCR/vision extraction → submitted pending contract", async ({ page }) => {
  test.setTimeout(360_000)
  await purgeExtractionCache()
  const since = await dbNow()
  try {
    const pdfName = await extractAndAccept(page, "scanned")
    await pickFacility(page)
    await submit(page)
    const rows = await pendingSince(since)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    await expectExtractedFields(row)
    expect(row.documents).toHaveLength(1)
    expectContractPdfDoc(row, pdfName, await vendorUserId())
    expect(row.pricingData).toBeNull()
  } finally {
    await deletePendingSince(since)
  }
})

test("extracted contract number fills the Contract Number field", async ({ page }) => {
  test.setTimeout(300_000)
  await extractAndAccept(page, "text")
  await expect(page.locator("#vc-contract-number")).toHaveValue(FIXTURE.contractNumber, { timeout: 5_000 })
})

test("Upload PDF tab 'Additional Documents' are attached to the submission", async ({ page }) => {
  test.setTimeout(300_000)
  const since = await dbNow()
  try {
    await extractAndAccept(page, "text")
    await page.getByRole("tab", { name: "Upload PDF" }).click()
    const amendment = "vnde2e-amendment-1.pdf"
    const chooser = page.waitForEvent("filechooser")
    await page.getByRole("button", { name: "Add Document" }).click()
    await (await chooser).setFiles({
      name: amendment,
      mimeType: "application/pdf",
      buffer: Buffer.from(await buildTextPdf([["Amendment No. 1", "VNDE2E amendment"]])),
    })
    await expect(page.getByText(amendment, { exact: true })).toBeVisible()
    await pickFacility(page)
    await submit(page)
    const rows = await pendingSince(since)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.documents.map((d) => d.name)).toContain(amendment)
  } finally {
    await deletePendingSince(since)
  }
})

test("sidebar 'Upload document' button only opens the file picker", async ({ page }) => {
  test.setTimeout(300_000)
  const since = await dbNow()
  try {
    await extractAndAccept(page, "text")
    await pickFacility(page)
    const chooser = page.waitForEvent("filechooser")
    await page.getByRole("button", { name: "Upload document" }).click()
    await (await chooser).setFiles({
      name: "vnde2e-late-exhibit.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await buildTextPdf([["Late exhibit"]])),
    })
    await page.waitForTimeout(10_000)
    expect(await pendingSince(since), "no contract submitted by clicking Upload document").toHaveLength(0)
    await expect(page).toHaveURL(/\/vendor\/contracts\/new$/)
  } finally {
    await page.waitForTimeout(5_000)
    await deletePendingSince(since)
  }
})
