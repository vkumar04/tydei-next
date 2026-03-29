"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  createPOSchema,
  poFiltersSchema,
  type CreatePOInput,
  type POFilters,
} from "@/lib/validators/purchase-orders"
import type { POStatus, Prisma } from "@prisma/client"

// ─── List Purchase Orders ───────────────────────────────────────

export async function getPurchaseOrders(input: POFilters) {
  await requireFacility()
  const filters = poFiltersSchema.parse(input)

  const conditions: Prisma.PurchaseOrderWhereInput[] = [{ facilityId: filters.facilityId }]

  if (filters.vendorId) conditions.push({ vendorId: filters.vendorId })
  if (filters.status) conditions.push({ status: filters.status })

  const where: Prisma.PurchaseOrderWhereInput = { AND: conditions }
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 20

  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true } },
        contract: { select: { id: true, name: true } },
        _count: { select: { lineItems: true } },
      },
      orderBy: { orderDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.purchaseOrder.count({ where }),
  ])

  return { orders, total }
}

// ─── Get Single PO ──────────────────────────────────────────────

export async function getPurchaseOrder(id: string) {
  await requireFacility()

  return prisma.purchaseOrder.findUniqueOrThrow({
    where: { id },
    include: {
      vendor: { select: { id: true, name: true } },
      contract: { select: { id: true, name: true } },
      lineItems: { orderBy: { createdAt: "asc" } },
    },
  })
}

// ─── Create PO ──────────────────────────────────────────────────

export async function createPurchaseOrder(input: CreatePOInput) {
  await requireFacility()
  const data = createPOSchema.parse(input)

  const totalCost = data.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  )

  const count = await prisma.purchaseOrder.count({
    where: { facilityId: data.facilityId },
  })
  const poNumber = `PO-${String(count + 1).padStart(5, "0")}`

  return prisma.purchaseOrder.create({
    data: {
      poNumber,
      facilityId: data.facilityId,
      vendorId: data.vendorId,
      contractId: data.contractId,
      orderDate: new Date(data.orderDate),
      totalCost,
      status: "draft",
      lineItems: {
        create: data.lineItems.map((item) => ({
          sku: item.sku,
          inventoryDescription: item.inventoryDescription,
          vendorItemNo: item.vendorItemNo,
          manufacturerNo: item.manufacturerNo,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          extendedPrice: item.quantity * item.unitPrice,
          uom: item.uom,
          isOffContract: item.isOffContract,
          contractId: item.contractId,
        })),
      },
    },
    include: { lineItems: true },
  })
}

// ─── Update PO Status ───────────────────────────────────────────

export async function updatePOStatus(id: string, status: POStatus) {
  await requireFacility()

  await prisma.purchaseOrder.update({
    where: { id },
    data: { status },
  })
}

// ─── Search Products ────────────────────────────────────────────

export async function searchProducts(input: {
  facilityId: string
  query: string
  vendorId?: string
}) {
  await requireFacility()
  const { facilityId, query, vendorId } = input

  if (!query || query.length < 2) return []

  const conditions: Prisma.PricingFileWhereInput[] = [
    { facilityId },
    {
      OR: [
        { productDescription: { contains: query, mode: "insensitive" } },
        { vendorItemNo: { contains: query, mode: "insensitive" } },
      ],
    },
  ]
  if (vendorId) conditions.push({ vendorId })

  const results = await prisma.pricingFile.findMany({
    where: { AND: conditions },
    select: {
      id: true,
      vendorItemNo: true,
      productDescription: true,
      contractPrice: true,
      listPrice: true,
      uom: true,
      vendorId: true,
    },
    take: 20,
  })

  return results.map((r) => ({
    id: r.id,
    vendorItemNo: r.vendorItemNo,
    description: r.productDescription,
    contractPrice: r.contractPrice ? Number(r.contractPrice) : null,
    listPrice: r.listPrice ? Number(r.listPrice) : null,
    uom: r.uom,
    vendorId: r.vendorId,
  }))
}
