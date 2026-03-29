"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

export interface VendorPORow {
  id: string
  poNumber: string
  facilityName: string
  orderDate: string
  totalCost: number
  status: string
}

export async function getVendorPurchaseOrders(vendorId: string): Promise<VendorPORow[]> {
  await requireVendor()

  const pos = await prisma.purchaseOrder.findMany({
    where: { vendorId },
    include: { facility: { select: { name: true } } },
    orderBy: { orderDate: "desc" },
    take: 50,
  })

  return serialize(pos.map((p) => ({
    id: p.id,
    poNumber: p.poNumber,
    facilityName: p.facility.name,
    orderDate: p.orderDate.toISOString(),
    totalCost: Number(p.totalCost ?? 0),
    status: p.status,
  })))
}
