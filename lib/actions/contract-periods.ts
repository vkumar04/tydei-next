"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { computeRebateFromPrismaTiers } from "@/lib/rebates/calculate"

/**
 * Fetch all contract periods for a given contract, ordered by periodStart desc.
 * Used by the Contract Transactions ledger component.
 *
 * Falls back to computing synthetic monthly periods from live COG data
 * when no persisted ContractPeriod rows exist — otherwise a newly-created
 * contract with real COG activity renders a blank Performance tab even
 * though the spend and rebate data are sitting in adjacent tables.
 */
export async function getContractPeriods(contractId: string) {
  const { facility } = await requireFacility()

  // Verify access + pull the contract shape we need for the fallback
  // compute (vendor, effective window, term tiers).
  const contract = await prisma.contract.findUniqueOrThrow({
    where: {
      id: contractId,
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
    select: {
      id: true,
      vendorId: true,
      facilityId: true,
      effectiveDate: true,
      expirationDate: true,
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  })

  const persisted = await prisma.contractPeriod.findMany({
    where: { contractId },
    orderBy: { periodStart: "desc" },
  })
  if (persisted.length > 0) return serialize(persisted)

  // ── Fallback: compute monthly periods from COG matched to this
  // vendor at this facility, bounded by the contract's effective window.
  const cogRows = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
      transactionDate: {
        gte: new Date(contract.effectiveDate),
        lte: new Date(contract.expirationDate),
      },
    },
    select: { transactionDate: true, extendedPrice: true },
  })

  if (cogRows.length === 0) return serialize([])

  // Bucket by YYYY-MM
  const monthBuckets = new Map<string, { start: Date; end: Date; spend: number }>()
  for (const row of cogRows) {
    if (!row.transactionDate) continue
    const d = new Date(row.transactionDate)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    const existing = monthBuckets.get(key)
    if (existing) {
      existing.spend += Number(row.extendedPrice ?? 0)
    } else {
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      monthBuckets.set(key, {
        start,
        end,
        spend: Number(row.extendedPrice ?? 0),
      })
    }
  }

  // Apply the contract's first-term tier structure to cumulative spend.
  const tiers = contract.terms[0]?.tiers ?? []
  const sortedKeys = Array.from(monthBuckets.keys()).sort()
  let cumulative = 0
  const synthetic = sortedKeys.map((key, idx) => {
    const bucket = monthBuckets.get(key)!
    cumulative += bucket.spend

    // Tier is determined by CUMULATIVE spend-to-date, but the rebate
    // amount is earned on THIS month's spend at that tier's rate.
    const { tierAchieved, rebatePercent } = computeRebateFromPrismaTiers(cumulative, tiers)
    const { rebateEarned, rebateCollected } = computeRebateFromPrismaTiers(bucket.spend, [
      { tierNumber: tierAchieved, spendMin: 0, rebateValue: rebatePercent },
    ] as unknown as Parameters<typeof computeRebateFromPrismaTiers>[1])

    return {
      id: `synthetic-${contract.id}-${key}`,
      contractId: contract.id,
      facilityId: contract.facilityId ?? facility.id,
      periodStart: bucket.start,
      periodEnd: bucket.end,
      totalSpend: bucket.spend,
      totalVolume: 0,
      rebateEarned,
      rebateCollected,
      paymentExpected: 0,
      paymentActual: 0,
      balanceExpected: 0,
      balanceActual: 0,
      tierAchieved,
      createdAt: new Date(),
      updatedAt: new Date(),
      _synthetic: true as const,
      _periodIndex: idx,
    }
  })

  // UI expects desc order (latest first) — same as the persisted branch.
  return serialize(synthetic.reverse())
}

/**
 * Create a contract transaction (stored as a ContractPeriod record).
 */
export async function createContractTransaction(input: {
  contractId: string
  type: "rebate" | "credit" | "payment"
  amount: number
  description: string
  date: string
}) {
  const { facility } = await requireFacility()

  // Verify access
  await prisma.contract.findUniqueOrThrow({
    where: {
      id: input.contractId,
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
    select: { id: true },
  })

  const periodDate = new Date(input.date)

  const period = await prisma.contractPeriod.create({
    data: {
      contractId: input.contractId,
      facilityId: facility.id,
      periodStart: periodDate,
      periodEnd: periodDate,
      totalSpend: input.type === "payment" ? input.amount : 0,
      rebateEarned: input.type === "rebate" ? input.amount : 0,
      rebateCollected: input.type === "rebate" ? input.amount : 0,
      paymentExpected: input.type === "credit" ? input.amount : 0,
      paymentActual: input.type === "credit" ? input.amount : 0,
    },
  })

  return serialize(period)
}
