"use server"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"

export interface MonthlyPoint { month: string; spend: number }
export interface QuarterlyPoint { quarter: string; rebateEarned: number; rebateCollected: number }

export async function getContractPerformanceHistory(contractId: string): Promise<{
  monthly: MonthlyPoint[]
  quarterly: QuarterlyPoint[]
}> {
  const { facility } = await requireFacility()
  const contract = await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true, vendorId: true, effectiveDate: true },
  })

  const since = new Date(contract.effectiveDate)
  const cog = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      OR: [
        { contractId: contract.id },
        { contractId: null, vendorId: contract.vendorId },
      ],
      transactionDate: { gte: since },
    },
    select: { transactionDate: true, extendedPrice: true },
  })
  const monthMap = new Map<string, number>()
  for (const r of cog) {
    if (!r.transactionDate) continue
    const key = r.transactionDate.toISOString().slice(0, 7)
    monthMap.set(key, (monthMap.get(key) ?? 0) + Number(r.extendedPrice ?? 0))
  }
  const monthly = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, spend]) => ({ month, spend }))

  const periods = await prisma.contractPeriod.findMany({
    where: { contractId: contract.id },
    select: { periodEnd: true, rebateEarned: true, rebateCollected: true },
    orderBy: { periodEnd: "asc" },
  })
  const quarterly: QuarterlyPoint[] = periods.map((p) => {
    const y = p.periodEnd.getUTCFullYear()
    const q = Math.floor(p.periodEnd.getUTCMonth() / 3) + 1
    return {
      quarter: `${y} Q${q}`,
      rebateEarned: Number(p.rebateEarned ?? 0),
      rebateCollected: Number(p.rebateCollected ?? 0),
    }
  })

  return serialize({ monthly, quarterly })
}
