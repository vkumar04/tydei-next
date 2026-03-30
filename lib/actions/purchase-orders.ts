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
import { serialize } from "@/lib/serialize"

// ─── List Purchase Orders ───────────────────────────────────────

export async function getPurchaseOrders(input: POFilters) {
  const { facility } = await requireFacility()
  const filters = poFiltersSchema.parse(input)

  const conditions: Prisma.PurchaseOrderWhereInput[] = [{ facilityId: facility.id }]

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

  return serialize({ orders, total })
}

// ─── PO Stats ──────────────────────────────────────────────────

export async function getPOStats(_facilityId?: string) {
  const { facility } = await requireFacility()

  const facilityWhere: Prisma.PurchaseOrderWhereInput = { facilityId: facility.id }

  const [totalCount, pendingCount, totalValueAgg, totalItemsAgg] =
    await Promise.all([
      prisma.purchaseOrder.count({ where: facilityWhere }),
      prisma.purchaseOrder.count({
        where: { ...facilityWhere, status: "pending" },
      }),
      prisma.purchaseOrder.aggregate({
        where: facilityWhere,
        _sum: { totalCost: true },
      }),
      prisma.pOLineItem.aggregate({
        where: { purchaseOrder: facilityWhere },
        _sum: { quantity: true },
      }),
    ])

  return serialize({
    totalPOs: totalCount,
    pendingApproval: pendingCount,
    totalValue: Number(totalValueAgg._sum.totalCost ?? 0),
    totalItems: Number(totalItemsAgg._sum.quantity ?? 0),
  })
}

// ─── Facility Vendors (for filter dropdown) ────────────────────

export async function getFacilityVendors(_facilityId?: string) {
  const { facility } = await requireFacility()

  const vendors = await prisma.vendor.findMany({
    where: {
      contracts: { some: { facilityId: facility.id } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return serialize(vendors)
}

// ─── Get Single PO ──────────────────────────────────────────────

export async function getPurchaseOrder(id: string) {
  const { facility } = await requireFacility()

  const po = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
    include: {
      vendor: { select: { id: true, name: true } },
      contract: { select: { id: true, name: true } },
      lineItems: { orderBy: { createdAt: "asc" } },
    },
  })
  return serialize(po)
}

// ─── Create PO ──────────────────────────────────────────────────

export async function createPurchaseOrder(input: CreatePOInput) {
  const { facility } = await requireFacility()
  const data = createPOSchema.parse(input)

  const totalCost = data.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  )

  const count = await prisma.purchaseOrder.count({
    where: { facilityId: facility.id },
  })
  const poNumber = `PO-${String(count + 1).padStart(5, "0")}`

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber,
      facilityId: facility.id,
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
  return serialize(po)
}

// ─── Update PO Status ───────────────────────────────────────────

export async function updatePOStatus(id: string, status: POStatus) {
  const { facility } = await requireFacility()

  await prisma.purchaseOrder.update({
    where: { id, facilityId: facility.id },
    data: { status },
  })
}

// ─── Search Products ────────────────────────────────────────────

export async function searchProducts(input: {
  facilityId?: string
  query: string
  vendorId?: string
}) {
  const { facility } = await requireFacility()
  const facilityId = facility.id
  const { query, vendorId } = input

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

  return serialize(results.map((r) => ({
    id: r.id,
    vendorItemNo: r.vendorItemNo,
    description: r.productDescription,
    contractPrice: r.contractPrice ? Number(r.contractPrice) : null,
    listPrice: r.listPrice ? Number(r.listPrice) : null,
    uom: r.uom,
    vendorId: r.vendorId,
  })))
}
