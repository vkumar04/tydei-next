"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

export interface VendorContractReport {
  id: string
  name: string
  facilityName: string
  totalSpend: number
  rebateEarned: number
  status: string
}

export async function getVendorReportData(vendorId: string): Promise<VendorContractReport[]> {
  await requireVendor()

  const contracts = await prisma.contract.findMany({
    where: { vendorId },
    include: {
      facility: { select: { name: true } },
      periods: { orderBy: { periodStart: "desc" }, take: 1 },
    },
    orderBy: { name: "asc" },
    take: 50,
  })

  return serialize(contracts.map((c) => ({
    id: c.id,
    name: c.name,
    facilityName: c.facility?.name ?? "N/A",
    totalSpend: Number(c.periods[0]?.totalSpend ?? 0),
    rebateEarned: Number(c.periods[0]?.rebateEarned ?? 0),
    status: c.status,
  })))
}
