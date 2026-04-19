"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"

export async function deriveContractTotalFromCOG(
  vendorId: string,
  months = 12
): Promise<{
  totalValue: number
  annualValue: number
  monthsObserved: number
}> {
  const { facility } = await requireFacility()
  const since = new Date()
  since.setMonth(since.getMonth() - months)

  const agg = await prisma.cOGRecord.aggregate({
    where: {
      facilityId: facility.id,
      vendorId,
      transactionDate: { gte: since },
    },
    _sum: { extendedPrice: true },
    _count: true,
  })

  const totalValue = Number(agg._sum.extendedPrice ?? 0)
  const annualValue = totalValue // last 12 months IS annual

  return { totalValue, annualValue, monthsObserved: months }
}
