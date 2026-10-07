import { test, expect } from "../../support/test"
import type { Locator, Page } from "@playwright/test"
import { facilityIdByName, vendorIdByName, withDb } from "../../support/db"
import {
  CONTRACT_FIXTURE,
  buildCsv,
  buildTextPdf,
  buildXlsx,
  cogFixtureRows,
  cogMatrix,
  cogTotal,
  contractPdfLinesFor,
  pricingFixtureRows,
  pricingMatrix,
  type ContractFixture,
} from "../../support/upload-fixtures"

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const COG_SEED = 31
const PRICING_SEED = 32
const NEUTRAL_PRICING_SEED = 33

const MASS_CONTRACT: ContractFixture = {
  ...CONTRACT_FIXTURE,
  vendor: "Halvorsen Spine Technologies",
  contractNumber: "HST-2026-1188",
}

test.use({ storageState: "tests/e2e/.auth/facility.json" })
test.describe.configure({ mode: "serial" })

const pad = (n: number) => String(n).padStart(2, "0")

async function deleteContractsForVendor(vendorName: string) {
  await withDb(async (c) => {
    const { rows } = await c.query(
      `select c.id from contract c join vendor v on v.id = c."vendorId" where v.name = $1`,
      [vendorName],
    )
    const ids = rows.map((r: { id: string }) => r.id)
    if (ids.length) {
      await c.query(`delete from contract_tier where "termId" in (select id from contract_term where "contractId" = any($1))`, [ids])
      await c.query(`delete from contract where id = any($1)`, [ids])
    }
    await c.query(
      `delete from vendor v where v.name = $1
         and not exists (select 1 from contract c where c."vendorId" = v.id)
         and not exists (select 1 from pricing_file p where p."vendorId" = v.id)
         and not exists (select 1 from cog_record r where r."vendorId" = v.id)`,
      [vendorName],
    ).catch(() => undefined)
  })
}

async function cleanup() {
  await withDb(async (c) => {
    await c.query(`delete from cog_record where "poNumber" like $1`, [`PO-FX-${pad(COG_SEED)}-%`])
    for (const seed of [PRICING_SEED, NEUTRAL_PRICING_SEED]) {
      await c.query(`delete from pricing_file where "vendorItemNo" like $1`, [`PX-${pad(seed)}-%`])
    }
  })
  await deleteContractsForVendor(MASS_CONTRACT.vendor)
}

async function openMassUpload(page: Page): Promise<Locator> {
  await page.goto("/dashboard/cog-data")
  await page.getByRole("button", { name: "Mass Upload" }).click()
  const dialog = page.getByRole("dialog").filter({ hasText: "Mass Document Upload" })
  await expect(dialog.getByText("Drop files here")).toBeVisible({ timeout: 15_000 })
  return dialog
}

async function answerQuestionsUntilReview(page: Page, dialog: Locator, vendorAnswer: string) {
  const questions = page.getByRole("dialog").filter({ hasText: "Additional Information Needed" })
  const complete = dialog.getByRole("button", { name: /^Complete \(\d+ documents\)$/ })
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    if (await complete.isVisible().catch(() => false)) return
    if (await questions.isVisible().catch(() => false)) {
      const vendorInput = questions.getByPlaceholder("Enter vendorName")
      if (await vendorInput.isVisible().catch(() => false)) await vendorInput.fill(vendorAnswer)
      const contractInput = questions.getByPlaceholder("Enter contractName")
      if (await contractInput.isVisible().catch(() => false)) await contractInput.fill(`${MASS_CONTRACT.vendor} Agreement`)
      const typeQuestion = questions.getByText("What type of document is this?")
      if (await typeQuestion.isVisible().catch(() => false)) {
        throw new Error(`classifier could not type ${await questions.locator("strong").innerText()}`)
      }
      await questions.getByRole("button", { name: "Continue" }).click()
      await expect(questions).toBeHidden({ timeout: 10_000 })
      continue
    }
    await page.waitForTimeout(500)
  }
  throw new Error("mass upload never reached the review step")
}

function queueRow(dialog: Locator, fileName: string): Locator {
  return dialog.locator("div.rounded-lg.border").filter({ has: dialog.page().getByText(fileName, { exact: true }) })
}

test.describe("Mass Upload classifies a mixed batch and commits every file", () => {
  const cogRows = cogFixtureRows(60, COG_SEED)
  const pricingRows = pricingFixtureRows(40, PRICING_SEED)
  const files = {
    cog: "lighthouse-cog-q3-2026.xlsx",
    pricing: "stryker-net-pricing.csv",
    contract: "halvorsen-supply-agreement.pdf",
  }

  test.beforeAll(cleanup)
  test.afterAll(cleanup)

  test("COG .xlsx with a title row + pricing .csv + contract PDF → cog_record, pricing_file, contract rows", async ({ page }) => {
    test.setTimeout(480_000)
    const dialog = await openMassUpload(page)
    const cogBuffer = await buildXlsx(cogMatrix(cogRows), {
      titleRows: ["Lighthouse Surgical Center — Cost of Goods Report", "Period: Q3 2026"],
    })
    const contractPdf = Buffer.from(await buildTextPdf(contractPdfLinesFor(MASS_CONTRACT)))
    await dialog.locator('input[type="file"][multiple]').setInputFiles([
      { name: files.cog, mimeType: XLSX, buffer: cogBuffer },
      { name: files.pricing, mimeType: "text/csv", buffer: buildCsv(pricingMatrix(pricingRows)) },
      { name: files.contract, mimeType: "application/pdf", buffer: contractPdf },
    ])
    await expect(dialog.getByText("Document Queue (3)")).toBeVisible()
    await dialog.getByRole("button", { name: "Process All (3)" }).click()
    await answerQuestionsUntilReview(page, dialog, "Stryker")

    await expect(queueRow(dialog, files.cog).getByText(/^COG Data/)).toBeVisible()
    await expect(queueRow(dialog, files.pricing).getByText(/^Pricing File/)).toBeVisible()
    await expect(queueRow(dialog, files.contract).getByText(/^Contract/)).toBeVisible()
    await expect(dialog.getByText(/^Error$/)).toHaveCount(0)

    await dialog.getByRole("button", { name: "Complete (3 documents)" }).click()
    await expect(dialog).toBeHidden({ timeout: 240_000 })
    await expect(page.getByText(`Imported ${cogRows.length + pricingRows.length + 1} documents`)).toBeVisible({ timeout: 30_000 })

    const facilityId = await facilityIdByName()
    const strykerId = await vendorIdByName("Stryker")

    const cog = await withDb(async (c) => {
      const { rows } = await c.query(
        `select count(*)::int as n, coalesce(round(sum("extendedPrice")::numeric, 2), 0)::float as total,
                count(distinct "vendorId")::int as vendors, count(*) filter (where "facilityId" <> $1)::int as foreign
           from cog_record where "poNumber" like $2`,
        [facilityId, `PO-FX-${pad(COG_SEED)}-%`],
      )
      return rows[0] as { n: number; total: number; vendors: number; foreign: number }
    })
    expect(cog.n, "cog_record rows").toBe(cogRows.length)
    expect(cog.total, "sum of extendedPrice").toBeCloseTo(cogTotal(cogRows), 2)
    expect(cog.vendors, "resolved vendors").toBe(4)
    expect(cog.foreign).toBe(0)

    const pricing = await withDb(async (c) => {
      const { rows } = await c.query(
        `select "vendorItemNo", "productDescription", "contractPrice"::float as price, "listPrice"::float as list,
                "vendorId", "facilityId", uom
           from pricing_file where "vendorItemNo" like $1 order by "vendorItemNo"`,
        [`PX-${pad(PRICING_SEED)}-%`],
      )
      return rows as { vendorItemNo: string; productDescription: string; price: number; list: number; vendorId: string; facilityId: string; uom: string }[]
    })
    expect(pricing, "pricing_file rows").toHaveLength(pricingRows.length)
    expect(pricing.every((r) => r.vendorId === strykerId && r.facilityId === facilityId)).toBe(true)
    pricingRows.forEach((row, i) => {
      expect(pricing[i]!.vendorItemNo).toBe(row.vendorItemNo)
      expect(pricing[i]!.productDescription).toBe(row.description)
      expect(pricing[i]!.price).toBeCloseTo(row.contractPrice, 2)
      expect(pricing[i]!.list).toBeCloseTo(row.listPrice, 2)
      expect(pricing[i]!.uom).toBe(row.uom)
    })

    const contract = await withDb(async (c) => {
      const { rows } = await c.query(
        `select c.id, c."facilityId", c."contractType", c.status, c."contractNumber",
                c."effectiveDate"::text as eff, c."expirationDate"::text as exp,
                (select count(*)::int from contract_facility f where f."contractId" = c.id) as facilities,
                (select coalesce(sum(l."contractTotal"), 0)::float from contract_capital_line_item l where l."contractId" = c.id) as capital
           from contract c join vendor v on v.id = c."vendorId" where v.name = $1`,
        [MASS_CONTRACT.vendor],
      )
      expect(rows, "exactly one contract created").toHaveLength(1)
      const row = rows[0] as { id: string; facilityId: string; contractType: string; status: string; contractNumber: string | null; eff: string; exp: string; facilities: number; capital: number }
      const tiers = await c.query(
        `select t."tierNumber", t."spendMin"::float as min, t."rebateValue"::float as value, t."rebateType"
           from contract_tier t join contract_term ct on ct.id = t."termId"
          where ct."contractId" = $1 order by t."tierNumber"`,
        [row.id],
      )
      return { row, tiers: tiers.rows as { tierNumber: number; min: number; value: number; rebateType: string }[] }
    })
    expect(contract.row.facilityId).toBe(facilityId)
    expect(contract.row.facilities).toBe(1)
    expect(contract.row.status).toBe("active")
    expect(contract.row.contractType).toBe("tie_in")
    expect(contract.row.eff.slice(0, 10)).toBe("2026-01-01")
    expect(contract.row.exp.slice(0, 10)).toBe("2028-12-31")
    expect(contract.row.capital, "capital line item from Amount Financed").toBe(785_195)
    expect(contract.tiers.map((t) => t.min)).toEqual([0, 500_000, 1_000_000])
    expect(contract.tiers.every((t) => t.rebateType === "percent_of_spend")).toBe(true)
    expect(contract.tiers.map((t) => t.value)).toEqual([0.02, 0.03, 0.04])
  })

  test("mass-upload contract keeps the PDF's Total Contract Value, not the capital cost", async () => {
    const total = await withDb(async (c) => {
      const { rows } = await c.query(
        `select c."totalValue"::float as total from contract c join vendor v on v.id = c."vendorId" where v.name = $1`,
        [MASS_CONTRACT.vendor],
      )
      return (rows[0] as { total: number } | undefined)?.total ?? null
    })
    expect(total).toBe(1_250_000)
  })

  test("mass-upload contract keeps the PDF's contract number", async () => {
    const numbers = await withDb(async (c) => {
      const { rows } = await c.query(
        `select c."contractNumber" from contract c join vendor v on v.id = c."vendorId" where v.name = $1`,
        [MASS_CONTRACT.vendor],
      )
      return rows.map((r: { contractNumber: string | null }) => r.contractNumber)
    })
    expect(numbers).toEqual([MASS_CONTRACT.contractNumber])
  })

  test("mass-upload pricing honors the file's EFFECTIVE DATE column", async () => {
    const dates = await withDb(async (c) => {
      const { rows } = await c.query(
        `select distinct "effectiveDate"::date::text as eff from pricing_file where "vendorItemNo" like $1`,
        [`PX-${pad(PRICING_SEED)}-%`],
      )
      return rows.map((r: { eff: string }) => r.eff)
    })
    expect(dates).toEqual(["2026-01-01"])
  })
})

test.describe("Mass Upload honors the vendor the user names for a pricing file", () => {
  let placeholderExisted = true
  test.beforeAll(async () => {
    placeholderExisted = Boolean(await withDb(async (c) => (await c.query(`select 1 from vendor where name = 'Unknown Vendor'`)).rowCount))
  })
  test.afterAll(async () => {
    await cleanup()
    if (placeholderExisted) return
    await withDb((c) =>
      c.query(
        `delete from vendor v where v.name = 'Unknown Vendor'
           and not exists (select 1 from pricing_file p where p."vendorId" = v.id)
           and not exists (select 1 from cog_record r where r."vendorId" = v.id)
           and not exists (select 1 from contract k where k."vendorId" = v.id)`,
      ),
    )
  })

  test("answering 'Which vendor?' for a pricing file is honored at commit", async ({ page }) => {
    test.setTimeout(240_000)
    await withDb((c) => c.query(`delete from pricing_file where "vendorItemNo" like $1`, [`PX-${pad(NEUTRAL_PRICING_SEED)}-%`]))
    const rows = pricingFixtureRows(12, NEUTRAL_PRICING_SEED)
    const dialog = await openMassUpload(page)
    await dialog.locator('input[type="file"][multiple]').setInputFiles({
      name: "price-list-2026.csv",
      mimeType: "text/csv",
      buffer: buildCsv(pricingMatrix(rows)),
    })
    await dialog.getByRole("button", { name: "Process All (1)" }).click()
    const questions = page.getByRole("dialog").filter({ hasText: "Additional Information Needed" })
    await expect(questions.getByText("Which vendor is this document from?")).toBeVisible({ timeout: 60_000 })
    await questions.getByPlaceholder("Enter vendorName").fill("Stryker")
    await questions.getByRole("button", { name: "Continue" }).click()
    await expect(dialog.getByText("Stryker", { exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: "Complete (1 documents)" }).click()
    await expect(dialog).toBeHidden({ timeout: 120_000 })
    await expect(page.getByText(`Imported ${rows.length} documents`)).toBeVisible({ timeout: 30_000 })

    const strykerId = await vendorIdByName("Stryker")
    const vendors = await withDb(async (c) => {
      const { rows: r } = await c.query(
        `select distinct v.name from pricing_file p join vendor v on v.id = p."vendorId" where p."vendorItemNo" like $1`,
        [`PX-${pad(NEUTRAL_PRICING_SEED)}-%`],
      )
      return r.map((x: { name: string }) => x.name)
    })
    expect(strykerId).toBeTruthy()
    expect(vendors).toEqual(["Stryker"])
  })
})
