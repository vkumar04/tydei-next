"use server"
import { prisma } from "@/lib/db"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
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
    select: { id: true, vendorId: true, effectiveDate: true, facilityId: true },
  })
  return _buildPerformanceHistory(contract, facility.id)
}

/**
 * Vendor-scoped performance history — 2026-06-09 facility→vendor UI parity
 * ("the UI on vendor side needs to function more like the facility side").
 * Same charts, auth pivots on Contract.vendorId like the other getVendor*
 * reads.
 */
export async function getVendorContractPerformanceHistory(
  contractId: string,
): Promise<{ monthly: MonthlyPoint[]; quarterly: QuarterlyPoint[] }> {
  const { vendor } = await requireVendor()
  const contract = await prisma.contract.findFirstOrThrow({
    where: { id: contractId, vendorId: vendor.id },
    select: { id: true, vendorId: true, effectiveDate: true, facilityId: true },
  })
  if (!contract.facilityId) return serialize({ monthly: [], quarterly: [] })
  return _buildPerformanceHistory(contract, contract.facilityId)
}

async function _buildPerformanceHistory(
  contract: {
    id: string
    vendorId: string | null
    effectiveDate: Date
  },
  facilityId: string,
): Promise<{ monthly: MonthlyPoint[]; quarterly: QuarterlyPoint[] }> {
  const since = new Date(contract.effectiveDate)
  const cog = await prisma.cOGRecord.findMany({
    where: {
      facilityId,
      OR: [
        { contractId: contract.id },
        { contractId: null, vendorId: contract.vendorId },
      ],
      // 2026-06-09 audit: upper-bound at NOW — future-dated COG rows were
      // charting months that haven't happened yet.
      transactionDate: { gte: since, lte: new Date() },
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
