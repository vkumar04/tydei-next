import { test, expect } from "../../support/test"
import type { Locator, Page } from "@playwright/test"
import { facilityIdByName, vendorIdByName, withDb } from "../../support/db"
import {
  buildEdi810,
  buildTextPdf,
  invoiceLineTotal,
  invoicePdfLines,
  invoiceTotal,
  type Edi810Invoice,
  type InvoiceFixture,
} from "../../support/upload-fixtures"

test.use({ storageState: "tests/e2e/.auth/facility.json" })
test.describe.configure({ mode: "serial" })

const RUN = Date.now().toString(36).toUpperCase()
const PREFIX = `E2E-INV-${RUN}`

interface SavedInvoice {
  id: string
  facilityId: string
  vendorId: string
  purchaseOrderId: string | null
  invoiceDate: string
  total: number
  tax: number
  shipping: number
  lines: { vendorItemNo: string | null; inventoryDescription: string; price: number; qty: number; lineTotal: number }[]
}

async function savedInvoice(invoiceNumber: string): Promise<SavedInvoice | null> {
  return withDb(async (c) => {
    const { rows } = await c.query(
      `select id, "facilityId", "vendorId", "purchaseOrderId", "invoiceDate"::date::text as "invoiceDate",
              "totalInvoiceCost"::float as total, "taxAmount"::float as tax, "shippingAmount"::float as shipping
         from invoice where "invoiceNumber" = $1`,
      [invoiceNumber],
    )
    if (rows.length !== 1) return null
    const inv = rows[0] as Omit<SavedInvoice, "lines">
    const lines = await c.query(
      `select "vendorItemNo", "inventoryDescription", "invoicePrice"::float as price, "invoiceQuantity" as qty,
              "totalLineCost"::float as "lineTotal"
         from invoice_line_item where "invoiceId" = $1 order by "vendorItemNo"`,
      [inv.id],
    )
    return { ...inv, lines: lines.rows as SavedInvoice["lines"] }
  })
}

async function cleanup() {
  await withDb((c) => c.query(`delete from invoice where "invoiceNumber" like $1`, [`${PREFIX}%`]))
}

async function openImportDialog(page: Page, method: "OCR Scan" | "EDI Import"): Promise<Locator> {
  await page.goto("/dashboard/invoice-validation")
  await page.getByRole("button", { name: "Upload invoice" }).click()
  const dialog = page.getByRole("dialog").filter({ hasText: "Import New Invoices" })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole("button", { name: new RegExp(method) }).click()
  return dialog
}

function expectLinesMatch(saved: SavedInvoice["lines"], expected: InvoiceFixture["lines"]) {
  const sorted = [...expected].sort((a, b) => a.sku.localeCompare(b.sku))
  expect(saved).toHaveLength(sorted.length)
  sorted.forEach((l, i) => {
    expect(saved[i]!.vendorItemNo).toBe(l.sku)
    expect(saved[i]!.inventoryDescription).toBe(l.description)
    expect(saved[i]!.qty).toBe(l.quantity)
    expect(saved[i]!.price).toBeCloseTo(l.unitPrice, 2)
    expect(saved[i]!.lineTotal).toBeCloseTo(invoiceLineTotal(l), 2)
  })
}

test.describe("Invoice import dialog persists invoices with their line items", () => {
  test.beforeAll(cleanup)
  test.afterAll(cleanup)

  test("PDF invoice → AI extraction prefills the form → Import & Validate → invoice + line items", async ({ page }) => {
    test.setTimeout(300_000)
    const fixture: InvoiceFixture = {
      invoiceNumber: `${PREFIX}-PDF`,
      invoiceDate: "2026-09-15",
      vendor: "Stryker",
      tax: 41.25,
      shipping: 18.5,
      lines: [
        { sku: "STK-6260-1-115", description: "Triathlon Tibial Baseplate", quantity: 2, unitPrice: 1245 },
        { sku: "STK-5550-G-209", description: "Accolade II Femoral Stem", quantity: 1, unitPrice: 2310.75 },
        { sku: "STK-0102-3-040", description: "Simplex P Bone Cement", quantity: 6, unitPrice: 48.9 },
      ],
    }
    const dialog = await openImportDialog(page, "OCR Scan")
    await dialog.locator('input[accept=".pdf,application/pdf"]').setInputFiles({
      name: `${fixture.invoiceNumber}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(await buildTextPdf(invoicePdfLines(fixture))),
    })
    await expect(dialog.locator("#invoiceNumber")).toHaveValue(fixture.invoiceNumber, { timeout: 240_000 })
    await expect(dialog.locator("#invoiceDate")).toHaveValue(fixture.invoiceDate)
    await expect(dialog.getByRole("combobox").filter({ hasText: "Stryker" })).toBeVisible()
    await expect(dialog.locator("#taxAmount")).toHaveValue(fixture.tax.toFixed(2))
    await expect(dialog.locator("#shippingAmount")).toHaveValue(fixture.shipping.toFixed(2))
    for (const l of fixture.lines) {
      const row = dialog.getByRole("row").filter({ hasText: l.sku })
      await expect(row).toContainText(`$${invoiceLineTotal(l).toFixed(2)}`)
    }
    await expect(dialog.getByText(`$${invoiceTotal(fixture).toFixed(2)}`)).toBeVisible()

    await dialog.getByRole("button", { name: "Import & Validate" }).click()
    await expect(dialog).toBeHidden({ timeout: 60_000 })

    const saved = await savedInvoice(fixture.invoiceNumber)
    expect(saved, "invoice row created").not.toBeNull()
    expect(saved!.facilityId).toBe(await facilityIdByName())
    expect(saved!.vendorId).toBe(await vendorIdByName("Stryker"))
    expect(saved!.invoiceDate).toBe(fixture.invoiceDate)
    expect(saved!.tax).toBeCloseTo(fixture.tax, 2)
    expect(saved!.shipping).toBeCloseTo(fixture.shipping, 2)
    expect(saved!.total).toBeCloseTo(invoiceTotal(fixture), 2)
    expectLinesMatch(saved!.lines, fixture.lines)
  })

  test("EDI 810 with two transactions → preview → Import 2 Invoices → both invoices + line items", async ({ page }) => {
    test.setTimeout(180_000)
    const invoices: Edi810Invoice[] = [
      {
        invoiceNumber: `${PREFIX}-EDI-A`,
        invoiceDate: "2026-09-01",
        vendor: "Stryker",
        lines: [
          { sku: "STK-EDI-100", description: "SURGICAL GLOVES BOX", quantity: 10, unitPrice: 25.5 },
          { sku: "STK-EDI-200", description: "SUTURE KIT", quantity: 2, unitPrice: 100 },
        ],
      },
      {
        invoiceNumber: `${PREFIX}-EDI-B`,
        invoiceDate: "2026-09-03",
        vendor: "Medtronic",
        lines: [
          { sku: "MDT-EDI-300", description: "PEDICLE SCREW 6.5MM", quantity: 8, unitPrice: 312.4 },
          { sku: "MDT-EDI-400", description: "SPINAL ROD 5.5MM", quantity: 2, unitPrice: 189.95 },
          { sku: "MDT-EDI-500", description: "BONE GRAFT 5CC", quantity: 1, unitPrice: 845 },
        ],
      },
    ]
    const dialog = await openImportDialog(page, "EDI Import")
    await dialog.locator('input[accept=".edi,.x12,.810,.txt,.dat,text/plain"]').setInputFiles({
      name: `${PREFIX}.810`,
      mimeType: "text/plain",
      buffer: buildEdi810(invoices),
    })
    for (const inv of invoices) {
      await expect(dialog.getByText(inv.invoiceNumber)).toBeVisible({ timeout: 15_000 })
      for (const l of inv.lines) await expect(dialog.getByRole("cell", { name: l.sku })).toBeVisible()
    }
    await expect(dialog.getByRole("combobox").filter({ hasText: "Stryker" })).toBeVisible()
    await expect(dialog.getByRole("combobox").filter({ hasText: "Medtronic" })).toBeVisible()
    await dialog.getByRole("button", { name: "Import 2 Invoices" }).click()
    await expect(dialog).toBeHidden({ timeout: 60_000 })

    const facilityId = await facilityIdByName()
    for (const inv of invoices) {
      const saved = await savedInvoice(inv.invoiceNumber)
      expect(saved, `${inv.invoiceNumber} created`).not.toBeNull()
      expect(saved!.facilityId).toBe(facilityId)
      expect(saved!.vendorId).toBe(await vendorIdByName(inv.vendor))
      expect(saved!.purchaseOrderId).toBeNull()
      expect(saved!.invoiceDate).toBe(inv.invoiceDate)
      const sum = Math.round(inv.lines.reduce((a, l) => a + invoiceLineTotal(l), 0) * 100) / 100
      expect(saved!.total).toBeCloseTo(sum, 2)
      expectLinesMatch(saved!.lines, inv.lines)
    }
  })

  test("EDI invoice whose BIG04 PO is not in tydei imports unlinked", async ({ page }) => {
    test.setTimeout(120_000)
    const inv: Edi810Invoice = {
      invoiceNumber: `${PREFIX}-EDI-PO`,
      invoiceDate: "2026-09-05",
      vendor: "Stryker",
      poNumber: `${PREFIX}-NO-SUCH-PO`,
      lines: [{ sku: "STK-EDI-600", description: "IRRIGATION SET", quantity: 4, unitPrice: 37.25 }],
    }
    const dialog = await openImportDialog(page, "EDI Import")
    await dialog.locator('input[accept=".edi,.x12,.810,.txt,.dat,text/plain"]').setInputFiles({
      name: `${PREFIX}-po.810`,
      mimeType: "text/plain",
      buffer: buildEdi810([inv]),
    })
    await expect(dialog.getByText(`PO ${inv.poNumber}`)).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole("button", { name: "Import 1 Invoice" }).click()
    await expect(page.getByText(/Imported \d+/).first()).toBeVisible({ timeout: 60_000 })
    const saved = await savedInvoice(inv.invoiceNumber)
    expect(saved, "invoice imported without the PO link").not.toBeNull()
    expect(saved!.purchaseOrderId).toBeNull()
    expectLinesMatch(saved!.lines, inv.lines)
  })
})
