"use server"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import {
  aggregateRebatesByQuarter,
  type RebateRowForQuarterly,
} from "@/lib/contracts/rebate-quarterly"

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

  // Charles R5.32: The Rebate by Quarter chart was reading from
  // ContractPeriod rollups which a) aren't deduped per-quarter (one row per
  // period, not per calendar quarter) and b) can diverge wildly from the
  // actual Rebate rows that feed the header's "Rebates Earned" card. Source
  // the chart from Rebate rows instead so it matches the card. Earned is
  // bucketed by `payPeriodEnd` quarter (only closed periods count); collected
  // is bucketed by `collectionDate` quarter (only rows with a real
  // collection date count). See CLAUDE.md "Rebates are NEVER auto-computed
  // for display" rule — both Rebate rows and ContractPeriod rollups are
  // valid sources; we pick Rebate rows to stay in sync with the card.
  const rebates = await prisma.rebate.findMany({
    where: { contractId: contract.id },
    select: {
      payPeriodEnd: true,
      rebateEarned: true,
      rebateCollected: true,
      collectionDate: true,
    },
  })
  const quarterly = aggregateRebatesByQuarter(
    rebates as RebateRowForQuarterly[],
    new Date(),
  )

  return serialize({ monthly, quarterly })
}
