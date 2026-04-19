"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"

export interface OffContractSpendResult {
  onContract: number
  offContract: number
  offContractItems: Array<{
    vendorItemNo: string
    totalSpend: number
  }>
}

export async function getOffContractSpend(
  contractId: string,
): Promise<OffContractSpendResult> {
  const { facility } = await requireFacility()
  const contract = await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true, vendorId: true },
  })

  const [onAgg, offAgg, offItems] = await Promise.all([
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: contract.vendorId,
        isOnContract: true,
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: contract.vendorId,
        isOnContract: false,
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.groupBy({
      by: ["vendorItemNo"],
      where: {
        facilityId: facility.id,
        vendorId: contract.vendorId,
        isOnContract: false,
        vendorItemNo: { not: null },
      },
      _sum: { extendedPrice: true },
      orderBy: { _sum: { extendedPrice: "desc" } },
      take: 10,
    }),
  ])

  return serialize({
    onContract: Number(onAgg._sum.extendedPrice ?? 0),
    offContract: Number(offAgg._sum.extendedPrice ?? 0),
    offContractItems: offItems
      .filter((r): r is typeof r & { vendorItemNo: string } => r.vendorItemNo !== null)
      .map((r) => ({
        vendorItemNo: r.vendorItemNo,
        totalSpend: Number(r._sum.extendedPrice ?? 0),
      })),
  })
}
