"use server"

/**
 * Charles audit suggestion (v0-port): Contract Composite Score for
 * ACTIVE contracts. v0 has a 6-axis radar at
 * `/dashboard/contracts/[id]/score`; tydei previously only scored
 * prospective deals via `lib/actions/prospective.ts`. This action
 * produces the same shape for an active contract so the UI can
 * render the radar + grade.
 *
 * Axes + weights (mirrors v0 doc §9):
 *   - rebateEfficiency  (25%) — earned vs potential rebate
 *   - tierProgress      (20%) — tier achievement + spend progress
 *   - marketShare       (15%) — actual vs commitment
 *   - pricePerformance  (20%) — price discipline / off-contract penalty
 *   - compliance        (10%) — direct from contract.complianceRate
 *   - timeValue         (10%) — value delivered vs contract elapsed
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
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

export async function getContractCompositeScore(
  contractId: string,
): Promise<ContractCompositeScore> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
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

  // Sum trailing-12 / lifetime spend from COG → vendor scope.
  const today = new Date()
  const twelveMonthsAgo = new Date(today)
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
  const cogAgg = await prisma.cOGRecord.aggregate({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
      transactionDate: { gte: twelveMonthsAgo, lte: today },
    },
    _sum: { extendedPrice: true },
  })
  const currentSpend = Number(cogAgg._sum.extendedPrice ?? 0)

  const rebatesEarned = sumEarnedRebatesLifetime(contract.rebates)
  const rebatesCollected = sumCollectedRebates(contract.rebates)

  // Axis 1: rebate efficiency. Assume 12% as the ceiling (matches v0).
  const potentialRebate = currentSpend * 0.12
  const rebateEfficiency =
    potentialRebate > 0
      ? Math.min(100, (rebatesEarned / potentialRebate) * 100)
      : 0

  // Axis 2: tier progress. tierAchievement (70%) + spendProgress (30%).
  // Use first term's tier ladder; pick max tier as denominator.
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

  // Axis 3: market share compliance.
  const ms = Number(contract.currentMarketShare ?? 0)
  const msTarget = Number(contract.marketShareCommitment ?? 0)
  const marketShare = Math.min(
    100,
    Math.max(0, msTarget === 0 ? 70 : 70 + (ms - msTarget) * 3),
  )

  // Axis 4: price performance — proxy via collection rate (collected /
  // earned, capped). v0 uses locked-pricing savings vs off-contract
  // penalty; without those metrics persisted we use the collection
  // rate as a fidelity proxy.
  const collectionRate =
    rebatesEarned > 0 ? (rebatesCollected / rebatesEarned) * 100 : 0
  const pricePerformance = Math.min(100, collectionRate * 0.8 + 20)

  // Axis 5: compliance — direct.
  const compliance = Math.min(
    100,
    Math.max(0, Number(contract.complianceRate ?? 0)),
  )

  // Axis 6: time value — actual progress / expected progress, with a
  // floor so brand-new contracts don't score 0.
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
