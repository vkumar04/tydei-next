"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  computeInvoiceVariances,
  type InvoiceLineForVariance,
} from "@/lib/data-pipeline/invoice-variance"

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

  const vendorItemNos = invoice.lineItems
    .map((li) => li.vendorItemNo)
    .filter((v): v is string => typeof v === "string" && v.length > 0)

  if (vendorItemNos.length === 0) {
    return { variancesWritten: 0 }
  }

  // Fetch every active contract-pricing row for this vendor that could
  // match one of the invoice's line items. A single vendorItemNo may
  // resolve to multiple contracts (e.g. overlapping tiers); we keep
  // the first match per vendorItemNo — consistent with how
  // `validateInvoice` treats the first active contract as the
  // authoritative price.
  const pricingRows = await prisma.contractPricing.findMany({
    where: {
      vendorItemNo: { in: vendorItemNos },
      contract: { vendorId: invoice.vendorId, status: "active" },
    },
    select: { contractId: true, vendorItemNo: true, unitPrice: true },
  })

  const priceLookup = new Map<string, number>()
  const contractByVendorItem = new Map<string, string>()
  for (const p of pricingRows) {
    const key = `${p.contractId}::${p.vendorItemNo}`
    if (!priceLookup.has(key)) {
      priceLookup.set(key, Number(p.unitPrice))
    }
    if (!contractByVendorItem.has(p.vendorItemNo)) {
      contractByVendorItem.set(p.vendorItemNo, p.contractId)
    }
  }

  const linesForVariance: InvoiceLineForVariance[] = []
  for (const li of invoice.lineItems) {
    if (!li.vendorItemNo) continue
    const contractId = contractByVendorItem.get(li.vendorItemNo)
    if (!contractId) continue
    linesForVariance.push({
      id: li.id,
      contractId,
      vendorItemNo: li.vendorItemNo,
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
