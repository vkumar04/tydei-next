"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import {
  importInvoiceSchema,
  invoiceFiltersSchema,
  type ImportInvoiceInput,
  type InvoiceFilters,
} from "@/lib/validators/invoices"
import type { Prisma } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import { normalizeSku } from "@/lib/contracts/normalize-sku"

// ─── Vendor-scoped: list invoices owned by the authed vendor ────

export async function getInvoicesForVendor(input?: Partial<InvoiceFilters>) {
  const { vendor } = await requireVendor()
  const filters = invoiceFiltersSchema.partial().parse(input ?? {})

  const conditions: Prisma.InvoiceWhereInput[] = [{ vendorId: vendor.id }]
  if (filters.status) conditions.push({ status: filters.status })

  const where: Prisma.InvoiceWhereInput = conditions.length > 0 ? { AND: conditions } : {}
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 20

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true } },
        facility: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        _count: { select: { lineItems: true } },
        lineItems: {
          select: {
            id: true,
            isFlagged: true,
            invoicePrice: true,
            invoiceQuantity: true,
            contractPrice: true,
          },
        },
      },
      orderBy: { invoiceDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invoice.count({ where }),
  ])

  return serialize({
    invoices: invoices.map((inv) => {
      const flaggedCount = inv.lineItems.filter((li) => li.isFlagged).length
      const lineItemCount = inv._count.lineItems
      // H1: an invoice with ZERO line items has no contract basis —
      // its variance is unknowable, NOT "the full invoice total"
      // (lineItems reduce → 0 → variance = total - 0). Report null
      // contract cost and zero variance so list rows and hero/tab
      // counts don't fabricate variance.
      const totalContractCost =
        inv.lineItems.length > 0
          ? inv.lineItems.reduce((sum, li) => {
              const cp = li.contractPrice !== null ? Number(li.contractPrice) : Number(li.invoicePrice)
              return sum + cp * li.invoiceQuantity
            }, 0)
          : null
      const totalInvoiceCostNum = Number(inv.totalInvoiceCost ?? 0)
      const variance =
        totalContractCost !== null ? totalInvoiceCostNum - totalContractCost : 0
      const variancePercent =
        totalContractCost !== null && totalContractCost > 0
          ? (variance / totalContractCost) * 100
          : 0
      return {
        ...inv,
        lineItems: undefined,
        flaggedCount,
        lineItemCount,
        totalContractCost,
        variance,
        variancePercent,
      }
    }),
    total,
  })
}

// ─── List Invoices ──────────────────────────────────────────────

export async function getInvoices(input: InvoiceFilters) {
  const { facility } = await requireFacility()
  const filters = invoiceFiltersSchema.parse(input)

  const conditions: Prisma.InvoiceWhereInput[] = [{ facilityId: facility.id }]
  if (filters.vendorId) conditions.push({ vendorId: filters.vendorId })
  if (filters.status) conditions.push({ status: filters.status })

  const where: Prisma.InvoiceWhereInput = conditions.length > 0 ? { AND: conditions } : {}
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 20

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true } },
        facility: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        _count: { select: { lineItems: true } },
        lineItems: {
          select: {
            id: true,
            isFlagged: true,
            invoicePrice: true,
            invoiceQuantity: true,
            contractPrice: true,
          },
        },
      },
      orderBy: { invoiceDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invoice.count({ where }),
  ])

  return serialize({
    invoices: invoices.map((inv) => {
      const flaggedCount = inv.lineItems.filter((li) => li.isFlagged).length
      const lineItemCount = inv._count.lineItems
      // Compute contract total from line items with contract pricing.
      // H1: zero line items → no contract basis → null contract cost
      // and zero variance (see getInvoicesForVendor for rationale).
      const totalContractCost =
        inv.lineItems.length > 0
          ? inv.lineItems.reduce((sum, li) => {
              const cp = li.contractPrice !== null ? Number(li.contractPrice) : Number(li.invoicePrice)
              return sum + cp * li.invoiceQuantity
            }, 0)
          : null
      const totalInvoiceCostNum = Number(inv.totalInvoiceCost ?? 0)
      const variance =
        totalContractCost !== null ? totalInvoiceCostNum - totalContractCost : 0
      const variancePercent =
        totalContractCost !== null && totalContractCost > 0
          ? (variance / totalContractCost) * 100
          : 0

      return {
        ...inv,
        lineItems: undefined, // strip raw line items from payload
        flaggedCount,
        lineItemCount,
        totalContractCost,
        variance,
        variancePercent,
      }
    }),
    total,
  })
}

// ─── Invoice Summary Stats ──────────────────────────────────────

export async function getInvoiceSummary(_facilityId?: string) {
  const { facility } = await requireFacility()

  const invoices = await prisma.invoice.findMany({
    where: { facilityId: facility.id },
    select: {
      totalInvoiceCost: true,
      status: true,
      lineItems: {
        select: {
          invoicePrice: true,
          invoiceQuantity: true,
          contractPrice: true,
        },
      },
    },
  })

  let totalInvoiced = 0
  let totalContracted = 0
  let totalVariance = 0

  for (const inv of invoices) {
    const invoiced = Number(inv.totalInvoiceCost ?? 0)
    totalInvoiced += invoiced
    // H1: zero-line-item invoices have no contract basis — they must
    // not contribute "variance = full invoice total" to the summary.
    if (inv.lineItems.length === 0) continue
    let contracted = 0
    for (const li of inv.lineItems) {
      const cp = li.contractPrice !== null ? Number(li.contractPrice) : Number(li.invoicePrice)
      contracted += cp * li.invoiceQuantity
    }
    totalContracted += contracted
    totalVariance += invoiced - contracted
  }

  const variancePercent = totalContracted > 0 ? (totalVariance / totalContracted) * 100 : 0

  return serialize({
    totalInvoiced,
    totalContracted,
    totalVariance,
    variancePercent,
  })
}

// ─── Get Invoice Detail ─────────────────────────────────────────

export async function getInvoice(id: string) {
  const { facility } = await requireFacility()

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
    include: {
      vendor: { select: { id: true, name: true } },
      facility: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
      lineItems: { orderBy: { createdAt: "asc" } },
    },
  })
  return serialize(invoice)
}

// ─── Import Invoice ─────────────────────────────────────────────

export async function importInvoice(input: ImportInvoiceInput) {
  // Charles audit round-9 CONCERN: facilityId comes from session, not
  // client. Verify purchaseOrderId belongs to this facility before
  // attaching. Pre-fix a facility user could create an Invoice owned
  // by another facility OR attach a foreign PO id.
  const { facility, user } = await requireFacility()
  await requireCanMutate()
  const data = importInvoiceSchema.parse(input)
  let purchaseOrderId = data.purchaseOrderId
  if (purchaseOrderId) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: { facilityId: true, vendorId: true },
    })
    if (!po || po.facilityId !== facility.id) {
      throw new Error("Purchase order not found or not owned by this facility")
    }
    // M12: PO must belong to the same vendor as the invoice.
    if (data.vendorId && po.vendorId !== data.vendorId) {
      throw new Error("PO belongs to a different vendor")
    }
  } else if (data.poNumber?.trim()) {
    // Manual-entry dialog collects a PO *number*; resolve it to the
    // facility's PurchaseOrder. (poNumber is unique per facility as of
    // migration 20260610030000.) Same vendor guard as the by-id path —
    // an honest error beats silently dropping the link.
    const poNumber = data.poNumber.trim()
    const po = await prisma.purchaseOrder.findFirst({
      where: { facilityId: facility.id, poNumber },
      select: { id: true, vendorId: true },
    })
    if (!po) {
      throw new Error(
        `Purchase order "${poNumber}" was not found for this facility. Clear the PO Number field to import without a PO link.`
      )
    }
    if (data.vendorId && po.vendorId !== data.vendorId) {
      throw new Error(`PO "${poNumber}" belongs to a different vendor`)
    }
    purchaseOrderId = po.id
  }

  const lineSum = data.lineItems.reduce(
    (sum, item) => sum + item.invoicePrice * item.invoiceQuantity,
    0
  )
  const taxAmount = data.taxAmount ?? 0
  const shippingAmount = data.shippingAmount ?? 0
  const discountAmount = data.discountAmount ?? 0
  // Round to cents — float sums like 0.1 + 0.2 must not leak into a
  // Decimal(14,2) column via Prisma's exact-decimal validation.
  const totalCost =
    Math.round((lineSum + taxAmount + shippingAmount - discountAmount) * 100) /
    100

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: data.invoiceNumber,
      facilityId: facility.id,
      vendorId: data.vendorId,
      purchaseOrderId,
      invoiceDate: new Date(data.invoiceDate),
      totalInvoiceCost: totalCost,
      taxAmount,
      shippingAmount,
      discountAmount,
      notes: data.notes?.trim() || null,
      status: "pending",
      lineItems: {
        create: data.lineItems.map((item) => ({
          inventoryDescription: item.inventoryDescription,
          vendorItemNo: item.vendorItemNo,
          invoicePrice: item.invoicePrice,
          invoiceQuantity: item.invoiceQuantity,
          totalLineCost:
            Math.round(item.invoicePrice * item.invoiceQuantity * 100) / 100,
        })),
      },
    },
    include: { lineItems: true },
  })

  await logAudit({
    userId: user.id,
    action: "invoice.imported",
    entityType: "invoice",
    entityId: invoice.id,
    metadata: { invoiceNumber: data.invoiceNumber, lineItemCount: data.lineItems.length, totalCost },
  })

  // Auto-compute price variance rows per subsystem 1 of
  // data-pipeline-rewrite spec. Errors are swallowed so variance
  // failures can't break the invoice import.
  const { recomputeInvoiceVariance } = await import(
    "@/lib/actions/invoices/variance"
  )
  await recomputeInvoiceVariance(invoice.id).catch((err) => {
    console.warn("[importInvoice] variance recompute failed:", err)
  })

  // M18: persist line-item contractPrice/variancePercent here (an
  // explicit mutation path) instead of as a side effect of the
  // validateInvoice read during page render.
  await revalidateInvoice(invoice.id).catch((err) => {
    console.warn("[importInvoice] line-item validation persist failed:", err)
  })

  return serialize(invoice)
}

// ─── Validate Invoice ───────────────────────────────────────────

/**
 * Shared pricing-match compute for validateInvoice (read-only) and
 * revalidateInvoice (persisting mutation). Not exported — "use server"
 * files may only export async server actions.
 *
 * H2: the pricing match is
 *   (a) facility-scoped — never another facility's contract pricing,
 *   (b) group-vendor aware — `additionalVendorIds` counts as the vendor,
 *   (c) SKU-normalized — both sides keyed through `normalizeSku`,
 *   (d) deterministic — rows ordered in SQL, FIRST match per SKU wins
 *       (same rule as `recomputeInvoiceVariance` in
 *       lib/actions/invoices/variance.ts).
 */
async function computeInvoiceValidation(id: string, facilityId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id, facilityId },
    include: { lineItems: true },
  })

  const normalizedItemNos = new Set(
    invoice.lineItems
      .map((li) => normalizeSku(li.vendorItemNo))
      .filter((k) => k.length > 0)
  )

  const pricingMap = new Map<string, number>()
  if (normalizedItemNos.size > 0) {
    const pricing = await prisma.contractPricing.findMany({
      where: {
        contract: {
          OR: [
            { vendorId: invoice.vendorId },
            { additionalVendorIds: { has: invoice.vendorId } },
          ],
          status: "active",
          facilityId,
        },
      },
      select: { vendorItemNo: true, unitPrice: true },
      orderBy: [
        { effectiveDate: { sort: "desc", nulls: "last" } },
        { id: "asc" },
      ],
    })
    for (const p of pricing) {
      const key = normalizeSku(p.vendorItemNo)
      if (!key || !normalizedItemNos.has(key)) continue
      if (!pricingMap.has(key)) pricingMap.set(key, Number(p.unitPrice))
    }
  }

  const results = invoice.lineItems.map((li) => {
    const skuKey = normalizeSku(li.vendorItemNo)
    const contractPrice = skuKey ? pricingMap.get(skuKey) ?? null : null
    const invoicePrice = Number(li.invoicePrice)
    const variance =
      contractPrice !== null && contractPrice > 0
        ? ((invoicePrice - contractPrice) / contractPrice) * 100
        : null

    return {
      lineItemId: li.id,
      inventoryDescription: li.inventoryDescription,
      vendorItemNo: li.vendorItemNo,
      invoicePrice,
      invoiceQuantity: li.invoiceQuantity,
      totalLineCost: Number(li.totalLineCost),
      contractPrice,
      variancePercent: variance !== null ? Math.round(variance * 100) / 100 : null,
      isFlagged: li.isFlagged,
      notes: li.notes,
      hasDiscrepancy: variance !== null && Math.abs(variance) > 5,
    }
  })

  return results
}

/**
 * Read-only validation compute. M18: this used to write line-item
 * contractPrice/variancePercent during page render (the detail page
 * calls it in a Promise.all) — writes now live in `revalidateInvoice`.
 */
export async function validateInvoice(id: string) {
  const { facility } = await requireFacility()

  const results = await computeInvoiceValidation(id, facility.id)

  const discrepancyCount = results.filter((r) => r.hasDiscrepancy).length
  const totalVariance = results.reduce(
    (sum, r) => sum + (r.hasDiscrepancy ? Math.abs(r.variancePercent ?? 0) : 0),
    0
  )

  return serialize({
    invoiceId: id,
    lineItems: results,
    discrepancyCount,
    averageVariance: discrepancyCount > 0 ? totalVariance / discrepancyCount : 0,
  })
}

/**
 * Explicit mutation: recompute the pricing match and persist
 * contractPrice/variancePercent onto the invoice's line items (these
 * persisted fields feed the list/summary variance reducers). Called
 * after import; safe to re-run any time pricing changes.
 */
export async function revalidateInvoice(id: string) {
  const { facility } = await requireFacility()
  await requireCanMutate()

  const results = await computeInvoiceValidation(id, facility.id)

  const toUpdate = results.filter(
    (r) => r.contractPrice !== null || r.variancePercent !== null,
  )
  // All-or-nothing: persist every line item's recomputed
  // contractPrice/variancePercent in one commit so the persisted
  // variance fields can't end up partially updated mid-loop.
  if (toUpdate.length > 0) {
    await prisma.$transaction(
      toUpdate.map((r) =>
        // auth-scope-scanner-skip: lineItemId comes from the
        // facility-scoped computeInvoiceValidation read above.
        prisma.invoiceLineItem.update({
          where: { id: r.lineItemId },
          data: {
            contractPrice: r.contractPrice,
            variancePercent: r.variancePercent,
          },
        }),
      ),
    )
  }
  const updated = toUpdate.length

  revalidatePath("/dashboard/invoice-validation")

  return serialize({ invoiceId: id, lineItemsUpdated: updated })
}

// ─── Approve Invoice ────────────────────────────────────────────

export async function approveInvoice(invoiceId: string) {
  const { facility, user } = await requireFacility()
  await requireCanMutate()

  const invoice = await prisma.invoice.findFirstOrThrow({
    where: { id: invoiceId, facilityId: facility.id },
    select: { id: true, invoiceNumber: true, status: true },
  })

  if (invoice.status !== "pending") {
    throw new Error("Only pending invoices can be approved")
  }

  // auth-scope-scanner-skip: id comes from the facility-scoped
  // findFirstOrThrow above.
  const result = await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "verified" },
  })

  await logAudit({
    userId: user.id,
    action: "invoice.approved",
    entityType: "invoice",
    entityId: invoice.id,
    metadata: { invoiceNumber: invoice.invoiceNumber },
  })

  revalidatePath("/dashboard/invoice-validation")
  revalidatePath("/vendor/invoices")

  return serialize(result)
}

// ─── Flag Line Item ─────────────────────────────────────────────

export async function flagInvoiceLineItem(lineItemId: string, notes?: string) {
  const { facility } = await requireFacility()
  await requireCanMutate()

  // Verify line item belongs to this facility's invoice.
  // Notes from the DisputeDialog are persisted (previously dropped);
  // an empty/whitespace note leaves any existing note untouched.
  const trimmed = notes?.trim()
  await prisma.invoiceLineItem.update({
    where: { id: lineItemId, invoice: { facilityId: facility.id } },
    data: { isFlagged: true, ...(trimmed ? { notes: trimmed } : {}) },
  })
}

// ─── Delete Invoice ─────────────────────────────────────────────

export async function deleteInvoice(id: string) {
  const { facility, user } = await requireFacility()
  await requireCanMutate()

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
    select: { id: true, invoiceNumber: true, status: true },
  })

  if (invoice.status !== "draft") {
    throw new Error("Only draft invoices can be deleted")
  }

  // auth-scope-scanner-skip: id was re-read under the facility scope in
  // the findUniqueOrThrow above (post-authorized delete).
  await prisma.invoice.delete({ where: { id } })

  await logAudit({
    userId: user.id,
    action: "invoice.deleted",
    entityType: "invoice",
    entityId: id,
    metadata: { invoiceNumber: invoice.invoiceNumber },
  })
}

// ─── Resolve Flagged Item ───────────────────────────────────────

export async function resolveInvoiceLineItem(lineItemId: string) {
  const { facility } = await requireFacility()
  await requireCanMutate()

  await prisma.invoiceLineItem.update({
    where: { id: lineItemId, invoice: { facilityId: facility.id } },
    data: { isFlagged: false },
  })
}
