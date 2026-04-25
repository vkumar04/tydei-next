"use server"

import { prisma } from "@/lib/db"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
import {
  importInvoiceSchema,
  invoiceFiltersSchema,
  type ImportInvoiceInput,
  type InvoiceFilters,
} from "@/lib/validators/invoices"
import type { Prisma } from "@prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"

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
      const totalContractCost = inv.lineItems.reduce((sum, li) => {
        const cp = li.contractPrice !== null ? Number(li.contractPrice) : Number(li.invoicePrice)
        return sum + cp * li.invoiceQuantity
      }, 0)
      const totalInvoiceCostNum = Number(inv.totalInvoiceCost ?? 0)
      const variance = totalInvoiceCostNum - totalContractCost
      const variancePercent =
        totalContractCost > 0 ? (variance / totalContractCost) * 100 : 0
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
      // Compute contract total from line items with contract pricing
      const totalContractCost = inv.lineItems.reduce((sum, li) => {
        const cp = li.contractPrice !== null ? Number(li.contractPrice) : Number(li.invoicePrice)
        return sum + cp * li.invoiceQuantity
      }, 0)
      const totalInvoiceCostNum = Number(inv.totalInvoiceCost ?? 0)
      const variance = totalInvoiceCostNum - totalContractCost
      const variancePercent =
        totalContractCost > 0 ? (variance / totalContractCost) * 100 : 0

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

  for (const inv of invoices) {
    totalInvoiced += Number(inv.totalInvoiceCost ?? 0)
    for (const li of inv.lineItems) {
      const cp = li.contractPrice !== null ? Number(li.contractPrice) : Number(li.invoicePrice)
      totalContracted += cp * li.invoiceQuantity
    }
  }

  const totalVariance = totalInvoiced - totalContracted
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
  const data = importInvoiceSchema.parse(input)
  if (data.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: data.purchaseOrderId },
      select: { facilityId: true, vendorId: true },
    })
    if (!po || po.facilityId !== facility.id) {
      throw new Error("Purchase order not found or not owned by this facility")
    }
  }

  const totalCost = data.lineItems.reduce(
    (sum, item) => sum + item.invoicePrice * item.invoiceQuantity,
    0
  )

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: data.invoiceNumber,
      facilityId: facility.id,
      vendorId: data.vendorId,
      purchaseOrderId: data.purchaseOrderId,
      invoiceDate: new Date(data.invoiceDate),
      totalInvoiceCost: totalCost,
      status: "pending",
      lineItems: {
        create: data.lineItems.map((item) => ({
          inventoryDescription: item.inventoryDescription,
          vendorItemNo: item.vendorItemNo,
          invoicePrice: item.invoicePrice,
          invoiceQuantity: item.invoiceQuantity,
          totalLineCost: item.invoicePrice * item.invoiceQuantity,
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

  return serialize(invoice)
}

// ─── Validate Invoice ───────────────────────────────────────────

export async function validateInvoice(id: string) {
  const { facility } = await requireFacility()

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
    include: { lineItems: true },
  })

  const vendorItemNos = invoice.lineItems
    .map((li) => li.vendorItemNo)
    .filter(Boolean) as string[]

  const pricingMap = new Map<string, number>()
  if (vendorItemNos.length > 0) {
    const pricing = await prisma.contractPricing.findMany({
      where: {
        vendorItemNo: { in: vendorItemNos },
        contract: { vendorId: invoice.vendorId, status: "active" },
      },
      select: { vendorItemNo: true, unitPrice: true },
    })
    for (const p of pricing) {
      pricingMap.set(p.vendorItemNo, Number(p.unitPrice))
    }
  }

  const results = invoice.lineItems.map((li) => {
    const contractPrice = li.vendorItemNo ? pricingMap.get(li.vendorItemNo) ?? null : null
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
      hasDiscrepancy: variance !== null && Math.abs(variance) > 5,
    }
  })

  // Update line items with contract pricing info
  for (const r of results) {
    if (r.contractPrice !== null || r.variancePercent !== null) {
      await prisma.invoiceLineItem.update({
        where: { id: r.lineItemId },
        data: {
          contractPrice: r.contractPrice,
          variancePercent: r.variancePercent,
        },
      })
    }
  }

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

// ─── Flag Line Item ─────────────────────────────────────────────

export async function flagInvoiceLineItem(lineItemId: string, notes?: string) {
  const { facility } = await requireFacility()

  // Verify line item belongs to this facility's invoice
  await prisma.invoiceLineItem.update({
    where: { id: lineItemId, invoice: { facilityId: facility.id } },
    data: { isFlagged: true },
  })
}

// ─── Delete Invoice ─────────────────────────────────────────────

export async function deleteInvoice(id: string) {
  const { facility, user } = await requireFacility()

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
    select: { id: true, invoiceNumber: true, status: true },
  })

  if (invoice.status !== "draft") {
    throw new Error("Only draft invoices can be deleted")
  }

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

  await prisma.invoiceLineItem.update({
    where: { id: lineItemId, invoice: { facilityId: facility.id } },
    data: { isFlagged: false },
  })
}
