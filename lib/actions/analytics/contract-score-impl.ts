/**
 * Non-"use server" peer of contract-score.ts. Holds the pure
 * implementation so the 'use cache' helper in _cached.ts can import
 * it without dragging server-action constraints through the cache
 * boundary. The auth gate stays in contract-score.ts.
 *
 * Body unchanged from the prior `_getContractCompositeScoreImpl`
 * inline definition — moved verbatim per Cache Components rollout
 * plan task 3.
 */

import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"

export interface ContractCompositeScore {
  composite: number
  grade: "A" | "B" | "C" | "D" | "F"
  axes: {
    rebateEfficiency: number
    tierProgress: number
    marketShare: number
    pricePerformance: number
    compliance: number
    timeValue: number
  }
  weights: {
    rebateEfficiency: number
    tierProgress: number
    marketShare: number
    pricePerformance: number
    compliance: number
    timeValue: number
  }
}

const WEIGHTS = {
  rebateEfficiency: 0.25,
  tierProgress: 0.2,
  marketShare: 0.15,
  pricePerformance: 0.2,
  compliance: 0.1,
  timeValue: 0.1,
} as const

export async function getContractCompositeScoreImpl(
  contractId: string,
  cogScopeFacilityIds: string[],
): Promise<ContractCompositeScore> {
  const contract = await prisma.contract.findFirstOrThrow({
    where: { id: contractId },
    select: {
      id: true,
      effectiveDate: true,
      expirationDate: true,
      totalValue: true,
      annualValue: true,
      complianceRate: true,
      currentMarketShare: true,
      marketShareCommitment: true,
      vendorId: true,
      facilityId: true,
      rebates: {
        select: {
          rebateEarned: true,
          rebateCollected: true,
          collectionDate: true,
          payPeriodEnd: true,
        },
      },
      terms: {
        select: {
          tiers: {
            select: { tierNumber: true },
            orderBy: { tierNumber: "asc" },
          },
        },
      },
    },
  })

  const today = new Date()
  const twelveMonthsAgo = new Date(today)
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
  const cogAgg = await prisma.cOGRecord.aggregate({
    where: {
      facilityId: { in: cogScopeFacilityIds },
      vendorId: contract.vendorId,
      transactionDate: { gte: twelveMonthsAgo, lte: today },
    },
    _sum: { extendedPrice: true },
  })
  const currentSpend = Number(cogAgg._sum.extendedPrice ?? 0)

  const rebatesEarned = sumEarnedRebatesLifetime(contract.rebates)
  const rebatesCollected = sumCollectedRebates(contract.rebates)

  const potentialRebate = currentSpend * 0.12
  const rebateEfficiency =
    potentialRebate > 0
      ? Math.min(100, (rebatesEarned / potentialRebate) * 100)
      : 0

  const maxTier = Math.max(
    1,
    ...contract.terms.flatMap((t) => t.tiers.map((tier) => tier.tierNumber)),
  )
  const projectedSpend = Number(contract.annualValue ?? 0)
  const currentTier = Math.max(
    1,
    Math.min(
      maxTier,
      Math.ceil((currentSpend / Math.max(1, projectedSpend)) * maxTier),
    ),
  )
  const tierAchievement = (currentTier / maxTier) * 70
  const spendProgress =
    projectedSpend > 0
      ? Math.min(30, (currentSpend / projectedSpend) * 30)
      : 0
  const tierProgress = tierAchievement + spendProgress

  const ms = Number(contract.currentMarketShare ?? 0)
  const msTarget = Number(contract.marketShareCommitment ?? 0)
  const marketShare = Math.min(
    100,
    Math.max(0, msTarget === 0 ? 70 : 70 + (ms - msTarget) * 3),
  )

  const collectionRate =
    rebatesEarned > 0 ? (rebatesCollected / rebatesEarned) * 100 : 0
  const pricePerformance = Math.min(100, collectionRate * 0.8 + 20)

  const compliance = Math.min(
    100,
    Math.max(0, Number(contract.complianceRate ?? 0)),
  )

  const start = new Date(contract.effectiveDate).getTime()
  const end = new Date(contract.expirationDate).getTime()
  const elapsed = Math.max(0, today.getTime() - start)
  const total = Math.max(1, end - start)
  const expectedProgress = elapsed / total
  const totalValue = Number(contract.totalValue ?? 0)
  const actualProgress =
    totalValue > 0 ? Math.min(1, currentSpend / totalValue) : 0
  const timeValue =
    expectedProgress > 0
      ? Math.min(100, (actualProgress / expectedProgress) * 80 + 20)
      : 50

  const composite = Math.round(
    rebateEfficiency * WEIGHTS.rebateEfficiency +
      tierProgress * WEIGHTS.tierProgress +
      marketShare * WEIGHTS.marketShare +
      pricePerformance * WEIGHTS.pricePerformance +
      compliance * WEIGHTS.compliance +
      timeValue * WEIGHTS.timeValue,
  )

  const grade: ContractCompositeScore["grade"] =
    composite >= 90
      ? "A"
      : composite >= 80
        ? "B"
        : composite >= 70
          ? "C"
          : composite >= 60
            ? "D"
            : "F"

  return serialize({
    composite,
    grade,
    axes: {
      rebateEfficiency: Math.round(rebateEfficiency),
      tierProgress: Math.round(tierProgress),
      marketShare: Math.round(marketShare),
      pricePerformance: Math.round(pricePerformance),
      compliance: Math.round(compliance),
      timeValue: Math.round(timeValue),
    },
    weights: WEIGHTS,
  })
}
