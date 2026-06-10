"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  computeInvoiceVariances,
  type InvoiceLineForVariance,
} from "@/lib/data-pipeline/invoice-variance"
import { normalizeSku } from "@/lib/contracts/normalize-sku"

// ─── Invoice variance population — data-pipeline subsystem 1 ────
//
// These server actions take the pure `computeInvoiceVariances` helper
// and connect it to the database: resolving contract prices for each
// invoice line, upserting `InvoicePriceVariance` rows, and giving
// callers a single entry point to trigger or backfill variance
// detection for an invoice (or every invoice at a facility).
//
// Spec: docs/superpowers/specs/2026-04-18-data-pipeline-rewrite.md §4.1

type Direction = "overcharge" | "undercharge" | "at_price"

function directionFor(actualPrice: number, contractPrice: number): Direction {
  if (actualPrice > contractPrice) return "overcharge"
  if (actualPrice < contractPrice) return "undercharge"
  return "at_price"
}

/**
 * Recompute + persist `InvoicePriceVariance` rows for a single
 * invoice. Called by invoice create/update flows after the invoice +
 * line items have been written, and usable as a manual backfill.
 *
 * Algorithm:
 *  - Load the invoice (scoped to the caller's facility) with its line
 *    items.
 *  - Query `ContractPricing` for the invoice's vendor, restricted to
 *    active contracts + the vendorItemNos that appear on the invoice.
 *  - Build a `${contractId}::${vendorItemNo}` → unitPrice map and a
 *    vendorItemNo → contractId index for shaping the line-items
 *    input.
 *  - Delegate to the pure `computeInvoiceVariances` helper to compute
 *    the variance rows.
 *  - Upsert each row keyed by `invoiceLineItemId` so repeat calls are
 *    idempotent.
 */
export async function recomputeInvoiceVariance(invoiceId: string): Promise<{
  variancesWritten: number
}> {
  const { facility } = await requireFacility()

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId, facilityId: facility.id },
    select: {
      id: true,
      vendorId: true,
      lineItems: {
        select: {
          id: true,
          vendorItemNo: true,
          invoicePrice: true,
          invoiceQuantity: true,
        },
      },
    },
  })
  if (!invoice) {
    throw new Error("Invoice not found")
  }

  const lineItemIds = invoice.lineItems.map((li) => li.id)

  // H2(c): match SKUs at the normalizeSku boundary, never raw `===`
  // or SQL `IN` on the raw string.
  const normalizedItemNos = new Set(
    invoice.lineItems
      .map((li) => normalizeSku(li.vendorItemNo))
      .filter((k) => k.length > 0)
  )

  if (normalizedItemNos.size === 0) {
    // M9: still purge stale variance rows (e.g. line items edited to
    // drop their SKUs) before bailing.
    await prisma.invoicePriceVariance.deleteMany({
      where: { invoiceLineItemId: { in: lineItemIds } },
    })
    return { variancesWritten: 0 }
  }

  // Fetch every active contract-pricing row that could match one of
  // the invoice's line items. H2(a): facility-scoped — never another
  // facility's pricing. H2(b): grouped vendors (`additionalVendorIds`)
  // count as the vendor. H2(d): rows are ordered deterministically in
  // SQL and the FIRST match per SKU wins — same rule as
  // `validateInvoice`/`revalidateInvoice` in lib/actions/invoices.ts.
  const pricingRows = await prisma.contractPricing.findMany({
    where: {
      contract: {
        OR: [
          { vendorId: invoice.vendorId },
          { additionalVendorIds: { has: invoice.vendorId } },
        ],
        status: "active",
        facilityId: facility.id,
      },
    },
    select: { contractId: true, vendorItemNo: true, unitPrice: true },
    orderBy: [
      { effectiveDate: { sort: "desc", nulls: "last" } },
      { id: "asc" },
    ],
  })

  const priceLookup = new Map<string, number>()
  const contractByVendorItem = new Map<string, string>()
  for (const p of pricingRows) {
    const sku = normalizeSku(p.vendorItemNo)
    if (!sku || !normalizedItemNos.has(sku)) continue
    const key = `${p.contractId}::${sku}`
    if (!priceLookup.has(key)) {
      priceLookup.set(key, Number(p.unitPrice))
    }
    if (!contractByVendorItem.has(sku)) {
      contractByVendorItem.set(sku, p.contractId)
    }
  }

  const linesForVariance: InvoiceLineForVariance[] = []
  for (const li of invoice.lineItems) {
    const sku = normalizeSku(li.vendorItemNo)
    if (!sku) continue
    const contractId = contractByVendorItem.get(sku)
    if (!contractId) continue
    linesForVariance.push({
      id: li.id,
      contractId,
      vendorItemNo: sku,
      invoicePrice: Number(li.invoicePrice),
      invoiceQuantity: li.invoiceQuantity,
    })
  }

  const rows = computeInvoiceVariances({
    lineItems: linesForVariance,
    priceLookup,
  })

  let variancesWritten = 0
  for (const row of rows) {
    const direction = directionFor(row.actualPrice, row.contractPrice)
    await prisma.invoicePriceVariance.upsert({
      where: { invoiceLineItemId: row.invoiceLineItemId },
      create: {
        invoiceLineItemId: row.invoiceLineItemId,
        contractId: row.contractId,
        contractPrice: row.contractPrice,
        actualPrice: row.actualPrice,
        variancePercent: row.variancePercent,
        severity: row.severity,
        direction,
        dollarImpact: row.variance,
      },
      update: {
        contractId: row.contractId,
        contractPrice: row.contractPrice,
        actualPrice: row.actualPrice,
        variancePercent: row.variancePercent,
        severity: row.severity,
        direction,
        dollarImpact: row.variance,
      },
    })
    variancesWritten++
  }

  // M9: delete stale variance rows the engine no longer produces
  // (line item re-priced to exact match, contract expired, SKU edited)
  // so re-runs converge instead of accreting.
  await prisma.invoicePriceVariance.deleteMany({
    where: {
      invoiceLineItemId: {
        in: lineItemIds,
        notIn: rows.map((r) => r.invoiceLineItemId),
      },
    },
  })

  return { variancesWritten }
}

/**
 * Batch backfill — recomputes variances for every invoice at the
 * caller's facility. Useful after pricing changes, contract-status
 * flips, or when first turning on the feature against historical
 * data.
 */
export async function recomputeAllInvoiceVariances(): Promise<{
  invoicesProcessed: number
  totalVariancesWritten: number
}> {
  const { facility } = await requireFacility()

  const invoices = await prisma.invoice.findMany({
    where: { facilityId: facility.id },
    select: { id: true },
    orderBy: { invoiceDate: "desc" },
  })

  let invoicesProcessed = 0
  let totalVariancesWritten = 0
  for (const { id } of invoices) {
    const { variancesWritten } = await recomputeInvoiceVariance(id)
    invoicesProcessed++
    totalVariancesWritten += variancesWritten
  }

  return { invoicesProcessed, totalVariancesWritten }
}
