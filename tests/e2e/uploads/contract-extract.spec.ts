import { test, expect } from "../../support/test"
import type { Page } from "@playwright/test"
import { facilityIdByName, withDb } from "../../support/db"
import {
  CONTRACT_FIXTURE,
  buildTextPdf,
  contractPdfLines,
  rasterizeToScannedPdf,
} from "../../support/upload-fixtures"

test.use({ storageState: "tests/e2e/.auth/facility.json" })
test.describe.configure({ mode: "serial" })

async function deleteFixtureContracts() {
  await withDb(async (c) => {
    const { rows } = await c.query(
      `select c.id from contract c join vendor v on v.id = c."vendorId" where v.name = $1`,
      [CONTRACT_FIXTURE.vendor],
    )
    const ids = rows.map((r: { id: string }) => r.id)
    if (ids.length) {
      await c.query(`delete from contract_tier where "termId" in (select id from contract_term where "contractId" = any($1))`, [ids])
      await c.query(`delete from contract_term where "contractId" = any($1)`, [ids])
      await c.query(`delete from contract_document where "contractId" = any($1)`, [ids])
      await c.query(`delete from contract_facility where "contractId" = any($1)`, [ids]).catch(() => undefined)
      await c.query(`delete from contract where id = any($1)`, [ids])
    }
  })
}

async function extractAndReview(page: Page, variant: "text" | "scanned") {
  const text = await buildTextPdf(contractPdfLines())
  const pdf = variant === "text" ? text : await rasterizeToScannedPdf(text)
  await page.goto("/dashboard/contracts/new")
  await page.locator("#contract-pdf").setInputFiles({
    name: `omx-${variant}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(pdf),
  })
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("AI Contract Extraction")).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByRole("button", { name: /Accept & Populate Form/ })).toBeVisible({ timeout: 240_000 })
  const review = await dialog.innerText()
  expect(review).toContain(CONTRACT_FIXTURE.vendor)
  expect(review).toContain("2026-01-01")
  expect(review).toContain("2028-12-31")
  expect(review).toContain(CONTRACT_FIXTURE.totalValue)
  expect(review).toMatch(/3 Tiers/)
  return dialog
}

for (const variant of ["text", "scanned"] as const) {
  test(`${variant} contract PDF: extraction review → created contract with terms and tiers`, async ({ page }) => {
    test.setTimeout(360_000)
    await deleteFixtureContracts()
    const dialog = await extractAndReview(page, variant)
    await dialog.getByRole("button", { name: /Accept & Populate Form/ }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })

    await page.getByRole("button", { name: /^Create Contract$/ }).click()
    await page.waitForURL(/\/dashboard\/contracts\/(?!new)[^/]+$/, { timeout: 120_000 })

    const facilityId = await facilityIdByName()
    const saved = await withDb(async (c) => {
      const { rows } = await c.query(
        `select c.id, c."contractType", c."effectiveDate"::text as eff, c."expirationDate"::text as exp,
                c."totalValue"::float as total, c."facilityId",
                (select count(*)::int from contract_document d where d."contractId" = c.id) as docs
           from contract c join vendor v on v.id = c."vendorId"
          where v.name = $1 order by c."createdAt" desc limit 1`,
        [CONTRACT_FIXTURE.vendor],
      )
      const contract = rows[0] as { id: string; contractType: string; eff: string; exp: string; total: number; facilityId: string; docs: number } | undefined
      if (!contract) return null
      const tiers = await c.query(
        `select t."tierNumber", t."spendMin"::float as min, t."rebateValue"::float as value, t."rebateType"
           from contract_tier t join contract_term ct on ct.id = t."termId"
          where ct."contractId" = $1 order by t."tierNumber"`,
        [contract.id],
      )
      return { contract, tiers: tiers.rows as { tierNumber: number; min: number; value: number; rebateType: string }[] }
    })

    expect(saved, "contract row created").not.toBeNull()
    expect(saved!.contract.facilityId).toBe(facilityId)
    expect(saved!.contract.contractType).toBe("tie_in")
    expect(saved!.contract.eff.slice(0, 10)).toBe("2026-01-01")
    expect(saved!.contract.exp.slice(0, 10)).toBe("2028-12-31")
    expect(saved!.contract.total).toBe(1_250_000)
    expect(saved!.contract.docs, "source PDF attached as a contract document").toBe(1)
    expect(saved!.tiers.map((t) => t.min)).toEqual([0, 500_000, 1_000_000])
    expect(saved!.tiers.every((t) => t.rebateType === "percent_of_spend")).toBe(true)
    expect(saved!.tiers.map((t) => t.value)).toEqual([0.02, 0.03, 0.04])

    await deleteFixtureContracts()
  })
}
