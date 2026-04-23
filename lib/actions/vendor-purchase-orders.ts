"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import type { Prisma } from "@prisma/client"

export interface VendorPORow {
  id: string
  poNumber: string
  facilityId: string
  facilityName: string
  orderDate: string
  totalCost: number
  status: string
  poType: string
  itemCount: number
  receivedDate: string | null
}

export async function getVendorPurchaseOrders(_vendorId?: string): Promise<VendorPORow[]> {
  const { vendor } = await requireVendor()

  const pos = await prisma.purchaseOrder.findMany({
    where: { vendorId: vendor.id },
    include: {
      facility: { select: { name: true } },
      _count: { select: { lineItems: true } },
    },
    orderBy: { orderDate: "desc" },
    take: 50,
  })

  return serialize(pos.map((p) => ({
    id: p.id,
    poNumber: p.poNumber,
    facilityId: p.facilityId,
    facilityName: p.facility.name,
    orderDate: p.orderDate.toISOString(),
    totalCost: Number(p.totalCost ?? 0),
    status: p.status,
    poType: p.isOffContract ? "Off-Contract" : "Standard",
    itemCount: p._count.lineItems,
    receivedDate: p.status === "completed" ? p.updatedAt.toISOString() : null,
  })))
}

// ─── Vendor Facilities (facilities with contracts for this vendor) ──

export interface VendorFacilityRow {
  id: string
  name: string
  contractId: string | null
  contractName: string | null
}

export async function getVendorFacilities(_vendorId?: string): Promise<VendorFacilityRow[]> {
  const { vendor } = await requireVendor()

  const contracts = await prisma.contract.findMany({
    where: { vendorId: vendor.id, status: "active" },
    include: { facility: { select: { id: true, name: true } } },
    orderBy: { facility: { name: "asc" } },
  })

  // Deduplicate facilities, keep first contract per facility
  const seen = new Set<string>()
  const results: VendorFacilityRow[] = []
  for (const c of contracts) {
    if (!c.facilityId || seen.has(c.facilityId)) continue
    seen.add(c.facilityId)
    results.push({
      id: c.facilityId,
      name: c.facility?.name ?? "",
      contractId: c.id,
      contractName: c.name,
    })
  }
  return serialize(results)
}

// ─── Search Vendor Products (from pricing file) ────────────────────

export interface VendorProductRow {
  id: string
  vendorItemNo: string
  description: string
  contractPrice: number | null
  listPrice: number | null
  uom: string
  category: string | null
}

export async function searchVendorProducts(input: {
  vendorId?: string
  facilityId?: string
  query: string
}): Promise<VendorProductRow[]> {
  const { vendor } = await requireVendor()
  const vendorId = vendor.id
  const { facilityId, query } = input

  if (!query || query.length < 2) return []

  const conditions: Prisma.PricingFileWhereInput[] = [
    { vendorId },
    {
      OR: [
        { productDescription: { contains: query, mode: "insensitive" } },
        { vendorItemNo: { contains: query, mode: "insensitive" } },
      ],
    },
  ]
  if (facilityId) conditions.push({ facilityId })

  const results = await prisma.pricingFile.findMany({
    where: { AND: conditions },
    take: 30,
    orderBy: { productDescription: "asc" },
  })

  return serialize(
    results.map((r) => ({
      id: r.id,
      vendorItemNo: r.vendorItemNo,
      description: r.productDescription,
      contractPrice: r.contractPrice ? Number(r.contractPrice) : null,
      listPrice: r.listPrice ? Number(r.listPrice) : null,
      uom: r.uom,
      category: r.category,
    }))
  )
}

// ─── Get Facility Products (load all for a facility+vendor) ────────

export async function getVendorFacilityProducts(input: {
  vendorId?: string
  facilityId: string
}): Promise<VendorProductRow[]> {
  const { vendor } = await requireVendor()
  const vendorId = vendor.id
  const { facilityId } = input

  const results = await prisma.pricingFile.findMany({
    where: { vendorId, facilityId },
    take: 200,
    orderBy: { productDescription: "asc" },
  })

  return serialize(
    results.map((r) => ({
      id: r.id,
      vendorItemNo: r.vendorItemNo,
      description: r.productDescription,
      contractPrice: r.contractPrice ? Number(r.contractPrice) : null,
      listPrice: r.listPrice ? Number(r.listPrice) : null,
      uom: r.uom,
      category: r.category,
    }))
  )
}

// ─── Create PO (vendor-side) ───────────────────────────────────────

export interface CreateVendorPOInput {
  vendorId: string
  facilityId: string
  contractId?: string
  orderDate: string
  notes?: string
  lineItems: {
    sku?: string
    inventoryDescription: string
    vendorItemNo?: string
    quantity: number
    unitPrice: number
    uom?: string
    isOffContract?: boolean
  }[]
}

export async function createVendorPurchaseOrder(input: CreateVendorPOInput) {
  const { vendor } = await requireVendor()

  const totalCost = input.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  )

  const count = await prisma.purchaseOrder.count({
    where: { vendorId: vendor.id },
  })
  const poNumber = `PO-${String(count + 1).padStart(5, "0")}`

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber,
      facilityId: input.facilityId,
      vendorId: vendor.id,
      contractId: input.contractId ?? null,
      orderDate: new Date(input.orderDate),
      totalCost,
      status: "pending",
      lineItems: {
        create: input.lineItems.map((item) => ({
          sku: item.sku,
          inventoryDescription: item.inventoryDescription,
          vendorItemNo: item.vendorItemNo,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          extendedPrice: item.quantity * item.unitPrice,
          uom: item.uom ?? "EA",
          isOffContract: item.isOffContract ?? false,
        })),
      },
    },
    include: { lineItems: true, facility: { select: { name: true } } },
  })

  return serialize({
    id: po.id,
    poNumber: po.poNumber,
    facilityName: po.facility.name,
    orderDate: po.orderDate.toISOString(),
    totalCost: Number(po.totalCost ?? 0),
    status: po.status,
  })
}
