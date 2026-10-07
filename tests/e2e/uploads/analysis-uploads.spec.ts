import { test, expect } from "../../support/test"
import type { Locator, Page } from "@playwright/test"
import { facilityIdByName, vendorIdByName, withDb } from "../../support/db"
import { CONTRACT_FIXTURE, buildTextPdf, buildXlsx, contractPdfLinesFor, type Cell } from "../../support/upload-fixtures"

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

test.use({ storageState: "tests/e2e/.auth/facility.json" })
test.describe.configure({ mode: "serial" })

const RUN = Date.now().toString(36).toUpperCase()
const SKU = (n: number) => `E2E-AN-${RUN}-${n}`
const PROPOSAL_VENDOR = "Calloway Orthopedics"

const COG_SEED: { sku: number; unitCost: number; quantity: number; date: string }[] = [
  { sku: 1, unitCost: 100, quantity: 10, date: "2026-08-15" },
  { sku: 1, unitCost: 110, quantity: 10, date: "2026-09-10" },
  { sku: 2, unitCost: 250, quantity: 4, date: "2026-08-20" },
  { sku: 3, unitCost: 40, quantity: 50, date: "2026-09-01" },
]

const PROPOSAL_LINES: { sku: number; description: string; proposed: number }[] = [
  { sku: 1, description: "Acetabular Shell 54mm", proposed: 94.5 },
  { sku: 2, description: "Femoral Head 32mm", proposed: 262.5 },
  { sku: 3, description: "Bone Screw 6.5x30", proposed: 36 },
  { sku: 4, description: "Liner Poly 54mm", proposed: 75 },
]

const EXPECTED = {
  totalItems: 4,
  matched: 3,
  avgVariance: "-5.0%",
  potentialSavings: "$410",
  belowAbove: "2 / 1",
  proposedSpend: "$4,740",
  currentSpend: "$5,100",
  lines: [
    { sku: 1, current: 105, variance: "-10.0%", savings: "$210" },
    { sku: 2, current: 250, variance: "+5.0%", savings: "—" },
    { sku: 3, current: 40, variance: "-10.0%", savings: "$200" },
    { sku: 4, current: null, variance: "—", savings: "—" },
  ],
}

async function seedCog() {
  const facilityId = await facilityIdByName()
  const vendorId = await vendorIdByName("Stryker")
  await withDb(async (c) => {
    for (const [i, r] of COG_SEED.entries()) {
      await c.query(
        `insert into cog_record (id, "facilityId", "vendorId", "vendorName", "inventoryNumber", "inventoryDescription", "vendorItemNo",
                                 "poNumber", "unitCost", "extendedPrice", quantity, "transactionDate", "updatedAt")
         values ($1, $2, $3, 'Stryker', $4, $5, $4, $6, $7, $8, $9, $10, now())`,
        [`e2e-an-${RUN}-${i}`, facilityId, vendorId, SKU(r.sku), `Analysis fixture ${r.sku}`, `PO-E2E-AN-${RUN}-${i}`, r.unitCost, r.unitCost * r.quantity, r.quantity, r.date],
      )
    }
  })
}

async function cleanup() {
  const facilityId = await facilityIdByName()
  await withDb(async (c) => {
    await c.query(`delete from cog_record where id like $1`, [`e2e-an-${RUN}-%`])
    await c.query(`delete from upload_header_event where "fileName" like $1`, [`%${RUN}%`])
    await c.query(`delete from proposal_evaluation where "facilityId" = $1 and "vendorName" = $2`, [facilityId, PROPOSAL_VENDOR])
  })
}

async function openProposals(page: Page) {
  await page.goto("/dashboard/analysis/prospective")
  await page.getByRole("tab", { name: "Evaluate Proposals" }).click()
  await expect(page.getByRole("tab", { name: "Upload", exact: true })).toBeVisible({ timeout: 30_000 })
}

async function pickVendor(page: Page, scope: Locator, vendor: string) {
  await scope.getByRole("combobox").filter({ hasText: "Select vendor…" }).first().click()
  await page.getByRole("option", { name: vendor, exact: true }).click()
}

async function chooseFile(page: Page, trigger: Locator, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent("filechooser")
  await trigger.click()
  await (await chooser).setFiles(file)
}

function proposalMatrix(headers: [string, string, string]): Cell[][] {
  return [headers, ...PROPOSAL_LINES.map((l) => [SKU(l.sku), l.description, l.proposed])]
}

test.describe("Prospective analysis uploads compute the right numbers", () => {
  test.beforeAll(async () => {
    await cleanup()
    await seedCog()
  })
  test.afterAll(cleanup)

  test("Upload Proposal PDF (AI) → scored verdict shown and evaluation persisted", async ({ page }) => {
    test.setTimeout(360_000)
    await openProposals(page)
    const proposal = {
      ...CONTRACT_FIXTURE,
      vendor: PROPOSAL_VENDOR,
      contractNumber: `CAL-${RUN}`,
    }
    await chooseFile(page, page.getByRole("button", { name: /Contract PDF/ }), {
      name: `calloway-proposal-${RUN}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(await buildTextPdf(contractPdfLinesFor(proposal, "PROPOSED SUPPLY AND REBATE AGREEMENT"))),
    })
    await expect(page.getByText("Proposal scored")).toBeVisible({ timeout: 300_000 })
    await expect(page.getByText(/^(Good deal|Negotiate|Decline)$/).first()).toBeVisible()
    await expect(page.getByText("12-month lookback projection")).toBeVisible()
    await expect(page.getByText(/^Legal scan: \d+ clauses? checked$/)).toBeVisible({ timeout: 180_000 })
    await expect(page.getByText(/Clause extractor failed/)).toHaveCount(0)

    const facilityId = await facilityIdByName()
    await expect
      .poll(
        () =>
          withDb(async (c) => {
            const { rows } = await c.query(
              `select source, "overallScore", verdict, (payload->'input'->>'proposedAnnualSpend')::float as proposed
                 from proposal_evaluation where "facilityId" = $1 and "vendorName" = $2`,
              [facilityId, PROPOSAL_VENDOR],
            )
            return rows as { source: string; overallScore: number | null; verdict: string | null; proposed: number }[]
          }),
        { timeout: 30_000 },
      )
      .toEqual([
        expect.objectContaining({
          source: "upload",
          overallScore: expect.any(Number),
          verdict: expect.stringMatching(/^(accept|negotiate|decline)$/),
          proposed: 1_250_000,
        }),
      ])
  })

  test("proposal price file with unrecognised headers → column mapping → COG variance + upload_header_event rows", async ({ page }) => {
    test.setTimeout(180_000)
    await openProposals(page)
    await pickVendor(page, page.locator("main"), "Stryker Corporation")
    const fileName = `proposal-prices-${RUN}.xlsx`
    await chooseFile(page, page.getByRole("button", { name: /Price file \(CSV \/ XLSX\)/ }), {
      name: fileName,
      mimeType: XLSX,
      buffer: await buildXlsx(proposalMatrix(["Widget Code", "Widget Name", "Offer Amount"]), {
        titleRows: ["Stryker proposal pricing — confidential"],
      }),
    })
    const mapper = page.getByRole("dialog").filter({ hasText: `Map columns — ${fileName}` })
    await expect(mapper).toBeVisible({ timeout: 30_000 })
    const setField = async (field: string, column: string) => {
      await mapper.getByRole("row").filter({ hasText: field }).getByRole("combobox").click()
      await page.getByRole("option", { name: column, exact: true }).click()
    }
    await setField("Item number", "Widget Code")
    await setField("Description", "Widget Name")
    await setField("Current price", "Not in this file")
    await setField("Proposed price", "Offer Amount")
    await setField("Estimated annual quantity", "Not in this file")
    await mapper.getByRole("button", { name: "Import", exact: true }).click()
    await expect(mapper).toBeHidden({ timeout: 30_000 })

    const card = page.locator('[data-slot="card"]').filter({ hasText: "Pricing vs your current cost" })
    await expect(card).toBeVisible({ timeout: 60_000 })
    const stat = (label: string) => card.getByText(label, { exact: true }).locator("xpath=..")
    await expect(stat("Avg variance")).toContainText(EXPECTED.avgVariance)
    await expect(stat("Potential savings")).toContainText(EXPECTED.potentialSavings)
    await expect(stat("Matched to COG")).toContainText(`${EXPECTED.matched} / ${EXPECTED.totalItems}`)
    await expect(stat("Below / above COG")).toContainText(EXPECTED.belowAbove)
    for (const l of EXPECTED.lines.filter((x) => x.current !== null)) {
      const row = card.getByRole("row").filter({ hasText: SKU(l.sku) })
      await expect(row).toContainText(`$${l.current!.toLocaleString("en-US")}`)
      await expect(row).toContainText(l.variance.replace("+", ""))
    }

    await expect
      .poll(
        () =>
          withDb(async (c) => {
            const { rows } = await c.query(
              `select surface, outcome, "finalMapping", "missingRequired" from upload_header_event
                where "fileName" = $1 order by "createdAt"`,
              [fileName],
            )
            return rows as { surface: string; outcome: string; finalMapping: Record<string, string | null> | null; missingRequired: string[] | null }[]
          }),
        { timeout: 15_000 },
      )
      .toEqual([
        expect.objectContaining({ surface: "facility-proposal-analyzer-price-file", outcome: "auto" }),
        expect.objectContaining({
          surface: "facility-proposal-analyzer-price-file",
          outcome: "manual_fix",
          finalMapping: expect.objectContaining({
            itemNumber: "Widget Code",
            description: "Widget Name",
            proposedPrice: "Offer Amount",
          }),
        }),
      ])
  })

  test("Pricing tab .xlsx → per-line variance and summary vs seeded COG", async ({ page }) => {
    test.setTimeout(180_000)
    await openProposals(page)
    await page.getByRole("tab", { name: "Pricing" }).click()
    const panel = page.getByRole("tabpanel").filter({ hasText: "Upload pricing file (CSV / Excel)" })
    await pickVendor(page, panel, "Stryker Corporation")
    const fileName = `pricing-tab-${RUN}.xlsx`
    await chooseFile(page, panel.getByRole("button", { name: /Drop a pricing file/ }), {
      name: fileName,
      mimeType: XLSX,
      buffer: await buildXlsx(proposalMatrix(["Vendor Item No", "Description", "Proposed Price"])),
    })
    await expect(page.getByText(`Parsed ${EXPECTED.totalItems} rows — ${EXPECTED.matched} matched to COG`)).toBeVisible({ timeout: 60_000 })
    await expect(panel.getByText(`${EXPECTED.totalItems} rows · ${EXPECTED.matched} matched to COG · 1 unmatched`)).toBeVisible()
    const stat = (label: string) => panel.getByText(label, { exact: true }).locator("xpath=..")
    await expect(stat("Avg variance")).toHaveText(`Avg variance${EXPECTED.avgVariance}`)
    await expect(stat("Proposed spend")).toHaveText(`Proposed spend${EXPECTED.proposedSpend}`)
    await expect(stat("Current spend")).toHaveText(`Current spend${EXPECTED.currentSpend}`)
    await expect(stat("Potential savings")).toHaveText(`Potential savings${EXPECTED.potentialSavings}`)
    await expect(stat("Below / Above COG")).toHaveText(`Below / Above COG${EXPECTED.belowAbove}`)
    for (const l of EXPECTED.lines) {
      const cells = panel.getByRole("row").filter({ hasText: SKU(l.sku) }).getByRole("cell")
      const proposed = PROPOSAL_LINES.find((p) => p.sku === l.sku)!.proposed
      await expect(cells).toHaveText([
        SKU(l.sku),
        PROPOSAL_LINES.find((p) => p.sku === l.sku)!.description,
        `$${proposed.toFixed(2)}`,
        l.current === null ? "—" : `$${l.current.toFixed(2)}`,
        l.variance,
        l.savings,
      ])
    }
  })

  test("Current State 'Model from uploaded file' .xlsx → mapped spend drives the headline figures", async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto("/dashboard/analysis/prospective")
    await page.getByRole("tab", { name: "Current State" }).click()
    const fileName = `spend-model-${RUN}.xlsx`
    const rows: Cell[][] = [
      ["Category", "Vendor", "Item Number", "Unit Price", "Quantity", "Extended Price"],
      ["Joint Replacement", "Stryker", "SP-1", 4200, 40, 168000],
      ["Joint Replacement", "Zimmer Biomet", "SP-2", 3900, 30, 117000],
      ["Spine", "Medtronic", "SP-3", 2650, 48, 127200],
      ["Sports Medicine", "Arthrex", "SP-4", 1255.5, 60, 75120],
    ]
    const total = 168000 + 117000 + 127200 + 75120
    const chooser = page.waitForEvent("filechooser")
    await page.getByRole("button", { name: "Model from uploaded file" }).first().click()
    await (await chooser).setFiles({ name: fileName, mimeType: XLSX, buffer: await buildXlsx(rows) })
    const mapper = page.getByRole("dialog").filter({ hasText: `Map columns — ${fileName}` })
    await expect(mapper).toBeVisible({ timeout: 30_000 })
    await expect(mapper.getByText(`4 rows · $${total.toLocaleString("en-US")} total spend`)).toBeVisible()
    await mapper.getByRole("button", { name: "Import", exact: true }).click()
    await expect(mapper).toBeHidden({ timeout: 30_000 })
    await expect(page.getByText(`Modeling from ${fileName}`)).toBeVisible()
    const spendCard = page.getByText("Current Vendor Spend", { exact: true }).locator("xpath=..")
    await expect(spendCard).toContainText("$487.3K")
    const revenueCard = page.getByText("Net Revenue", { exact: true }).first().locator("xpath=..")
    await expect(revenueCard).toContainText("$1.6M")
  })
})
