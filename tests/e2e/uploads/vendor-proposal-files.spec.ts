import { test, expect } from "../../support/test"
import type { Locator, Page } from "@playwright/test"
import { vendorIdForUser, withDb } from "../../support/db"
import {
  buildCsv,
  buildXlsx,
  vendorProposedPriceMatrix,
  vendorProposedPrices,
  vendorUsageLines,
  vendorUsageMatrix,
} from "../../support/upload-fixtures"

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const NAME_PREFIX = "VNDE2E Proposal"

test.use({ storageState: "tests/e2e/.auth/vendor.json" })
test.describe.configure({ mode: "serial" })

const usage = vendorUsageLines()
const prices = vendorProposedPrices()

function usageByRef() {
  const m = new Map<string, { qty: number; revenue: number }>()
  for (const l of usage) {
    const cur = m.get(l.ref) ?? { qty: 0, revenue: 0 }
    m.set(l.ref, { qty: cur.qty + l.quantity, revenue: cur.revenue + l.quantity * l.unitCost })
  }
  return m
}

const USAGE = usageByRef()
const USAGE_REVENUE = [...USAGE.values()].reduce((a, u) => a + u.revenue, 0)
const PRICED_VOLUME = prices.reduce((a, p) => a + USAGE.get(p.ref)!.qty, 0)
const PROPOSED_VALUE = prices.reduce((a, p) => a + p.proposedPrice * USAGE.get(p.ref)!.qty, 0)

async function cleanup() {
  const vendorId = await vendorIdForUser()
  await withDb(async (c) => {
    const { rows } = await c.query(
      `select id from pending_contract where "vendorId" = $1 and status = 'draft' and "contractName" like $2`,
      [vendorId, `${NAME_PREFIX}%`],
    )
    const ids = (rows as { id: string }[]).map((r) => r.id)
    if (ids.length === 0) return
    await c.query(`delete from notification where payload->>'proposalId' = any($1)`, [ids])
    await c.query(`delete from pending_contract where id = any($1)`, [ids])
  })
}

function dropzoneInput(page: Page, heading: string): Locator {
  return page
    .getByText(heading, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'border-dashed')][1]")
    .locator('input[type="file"]')
}

async function confirmMapping(page: Page, fileName: string) {
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: `Map columns — ${fileName}` })).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole("button", { name: "Import", exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

async function openBuilder(page: Page) {
  await page.goto("/vendor/prospective")
  await page.getByRole("tab", { name: "Proposals" }).click()
  await page.getByRole("button", { name: /Build the proposal/ }).click()
  await expect(page.getByText("Products / Pricing")).toBeVisible({ timeout: 15_000 })
}

async function loadUsageThenPricing(page: Page) {
  await dropzoneInput(page, "Upload Usage History").setInputFiles({
    name: "vendor-usage.csv",
    mimeType: "text/csv",
    buffer: buildCsv(vendorUsageMatrix(usage)),
  })
  await confirmMapping(page, "vendor-usage.csv")
  await expect(page.getByText(`Processed ${USAGE.size} products from ${usage.length} transactions.`)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(`${USAGE.size} products`, { exact: true })).toBeVisible()
  await expect(page.getByText(`${USAGE.size} products with historical data`)).toBeVisible()
  await expect(page.getByText("Avg 3 months of history per product")).toBeVisible()
  await expect(page.getByText(`Additional Opportunity (${USAGE.size} products not in pricing)`)).toBeVisible()

  await dropzoneInput(page, "Upload Proposed Pricing").setInputFiles({
    name: "vendor-proposed-pricing.xlsx",
    mimeType: XLSX,
    buffer: await buildXlsx(vendorProposedPriceMatrix(prices), { titleRows: ["Stryker Proposed Pricing — VNDE2E"] }),
  })
  await confirmMapping(page, "vendor-proposed-pricing.xlsx")
  await expect(page.getByText(`Merged pricing with usage: ${prices.length} matched of ${prices.length} products`)).toBeVisible({ timeout: 15_000 })
}

test.beforeAll(cleanup)
test.afterAll(cleanup)

test("proposal builder: usage .csv + proposed pricing .xlsx compute the deal and save to a draft proposal", async ({ page }) => {
  test.setTimeout(180_000)
  const name = `${NAME_PREFIX} ${Date.now()}`
  await openBuilder(page)
  await page.locator("#proposal-name").fill(name)
  await loadUsageThenPricing(page)

  await expect(page.getByText(`${prices.length} products loaded from pricing file`)).toBeVisible()
  await expect(page.getByText(`${prices.length} matched with usage data (100%)`)).toBeVisible()
  const avg = prices.reduce((a, p) => a + p.proposedPrice, 0) / prices.length
  await expect(page.getByText(`Avg price: $${avg.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)).toBeVisible()
  await expect(page.getByText(`Proposed Pricing (${prices.length} products)`)).toBeVisible()
  for (const p of prices) {
    const row = page.locator("div.rounded-lg.border", { hasText: p.name }).filter({ has: page.getByText(p.ref, { exact: true }) }).last()
    await expect(row).toContainText(`$${p.proposedPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}/unit`)
    await expect(row).toContainText(`${USAGE.get(p.ref)!.qty} units used`)
  }
  const summary = page.locator("div.grid", { hasText: "Proposed Products" }).last()
  await expect(summary).toContainText(`${prices.length} with volume`)
  await expect(summary.getByText(String(PRICED_VOLUME), { exact: true })).toBeVisible()
  await expect(summary).toContainText(`${((PROPOSED_VALUE / USAGE_REVENUE) * 100).toFixed(0)}% of opportunity`)

  await page.getByRole("button", { name: "Save proposal" }).click()
  await expect(page.getByText(`Proposal "${name}" saved`)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(`· usage ${prices.length} products`)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(`· pricing ${prices.length} products`)).toBeVisible()

  const vendorId = await vendorIdForUser()
  const saved = await withDb(async (c) => {
    const { rows } = await c.query(
      `select "contractName", status, "facilityId", "totalValue"::float as total, "pricingData"
         from pending_contract where "vendorId" = $1 and "contractName" = $2`,
      [vendorId, name],
    )
    return rows as {
      contractName: string
      status: string
      facilityId: string | null
      total: number
      pricingData: {
        kind: string
        pricingItems: { vendorItemNo: string; description: string; proposedPrice: number; currentPrice?: number; quantity: number }[]
        totalCost: number
        productCategories: string[]
        projectedSpend: number
      }
    }[]
  })
  expect(saved).toHaveLength(1)
  const row = saved[0]!
  expect(row.status).toBe("draft")
  expect(row.facilityId).toBeNull()
  expect(row.total).toBeCloseTo(PROPOSED_VALUE, 2)
  expect(row.pricingData.totalCost).toBeCloseTo(PROPOSED_VALUE, 2)
  expect(row.pricingData.projectedSpend).toBeCloseTo(USAGE_REVENUE, 2)
  expect(row.pricingData.productCategories).toEqual(["Ortho-Joints"])
  const items = [...row.pricingData.pricingItems].sort((a, b) => a.vendorItemNo.localeCompare(b.vendorItemNo))
  expect(items.map((i) => [i.vendorItemNo, i.description, i.proposedPrice, i.currentPrice, i.quantity])).toEqual(
    prices.map((p) => [p.ref, p.name, p.proposedPrice, p.currentPrice, USAGE.get(p.ref)!.qty]),
  )
})

test("proposal builder: a usage-only product survives the pricing merge as Additional Opportunity", async ({ page }) => {
  test.setTimeout(120_000)
  await openBuilder(page)
  await loadUsageThenPricing(page)
  const unpriced = [...USAGE.keys()].filter((ref) => !prices.some((p) => p.ref === ref))
  expect(unpriced).toHaveLength(1)
  await expect(page.getByText(`Additional Opportunity (${unpriced.length} products not in pricing)`)).toBeVisible({ timeout: 10_000 })
})

test("proposal builder: saved projected volume equals the merged usage volume", async ({ page }) => {
  test.setTimeout(180_000)
  const name = `${NAME_PREFIX} Volume ${Date.now()}`
  await openBuilder(page)
  await page.locator("#proposal-name").fill(name)
  await loadUsageThenPricing(page)
  await page.getByRole("button", { name: "Save proposal" }).click()
  await expect(page.getByText(`Proposal "${name}" saved`)).toBeVisible({ timeout: 30_000 })
  const vendorId = await vendorIdForUser()
  const projectedVolume = await withDb(async (c) => {
    const { rows } = await c.query(
      `select ("pricingData"->>'projectedVolume')::float as v from pending_contract where "vendorId" = $1 and "contractName" = $2`,
      [vendorId, name],
    )
    return (rows[0] as { v: number | null } | undefined)?.v ?? null
  })
  expect(projectedVolume).toBe(PRICED_VOLUME)
})
