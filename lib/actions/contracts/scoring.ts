"use server"

/**
 * Contract score recompute — persists Contract.score + scoreBand +
 * scoreUpdatedAt by driving the pure engine in lib/contracts/scoring.ts
 * from live facility metrics.
 *
 * Inputs gathered per contract:
 *   - commitment    : currentMarketShare / marketShareCommitment × 100,
 *                     falling back to rebatesEarned / totalValue × 100
 *                     when market-share fields are not populated.
 *   - compliance    : onContractSpend / totalSpend × 100 from COGRecord
 *                     (contractId = this contract vs vendor-wide spend).
 *   - rebatesEarned : sum of Rebate.rebateEarned for the contract.
 *   - totalValue    : contract.totalValue (Decimal → number).
 *   - daysUntilExp  : (expirationDate - now) in whole days (may be neg).
 *   - variance      : InvoicePriceVariance counts (major vs total).
 *
 * All writes are gated by contractOwnershipWhere to keep cross-facility
 * leakage impossible.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  contractOwnershipWhere,
  contractsOwnedByFacility,
} from "@/lib/actions/contracts-auth"
import {
  calculateContractScore,
  type ContractScoreResult,
} from "@/lib/contracts/scoring"
import { logAudit } from "@/lib/audit"

const MS_PER_DAY = 1000 * 60 * 60 * 24

function daysBetween(future: Date, now: Date): number {
  const diffMs = future.getTime() - now.getTime()
  return Math.floor(diffMs / MS_PER_DAY)
}

/**
 * Recompute + persist Contract.score for a single contract.
 * Loads the contract + its live metrics, calls calculateContractScore,
 * writes score + scoreBand + scoreUpdatedAt back to the row.
 */
export async function recomputeContractScore(
  contractId: string,
): Promise<ContractScoreResult> {
  const { facility, user } = await requireFacility()

  const contract = await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    include: {
      rebates: { select: { rebateEarned: true } },
    },
  })

  // ─── commitment ────────────────────────────────────────────────
  const marketShare =
    contract.currentMarketShare != null
      ? Number(contract.currentMarketShare)
      : null
  const marketShareCommitment =
    contract.marketShareCommitment != null
      ? Number(contract.marketShareCommitment)
      : null

  const totalContractValue = Number(contract.totalValue ?? 0)
  const rebatesEarned = contract.rebates.reduce(
    (sum, r) => sum + Number(r.rebateEarned ?? 0),
    0,
  )

  let commitmentMet = 0
  if (
    marketShare != null &&
    marketShareCommitment != null &&
    marketShareCommitment > 0
  ) {
    commitmentMet = (marketShare / marketShareCommitment) * 100
  } else if (totalContractValue > 0) {
    commitmentMet = (rebatesEarned / totalContractValue) * 100
  }

  // ─── compliance ───────────────────────────────────────────────
  // On-contract spend = COGRecord rows flagged isOnContract=true AND
  // contractId=this.contract. Total spend = vendor-wide COG spend at this
  // facility (denominator for "how much of the vendor's purchasing ran
  // through this contract").
  const [onContractAgg, vendorAgg] = await Promise.all([
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        contractId: contract.id,
        isOnContract: true,
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: contract.vendorId,
      },
      _sum: { extendedPrice: true },
    }),
  ])
  const onContractSpend = Number(onContractAgg._sum.extendedPrice ?? 0)
  const totalSpend = Number(vendorAgg._sum.extendedPrice ?? 0)
  const complianceRate = totalSpend > 0 ? (onContractSpend / totalSpend) * 100 : 0

  // ─── variance ─────────────────────────────────────────────────
  const variances = await prisma.invoicePriceVariance.findMany({
    where: { contractId: contract.id },
    select: { severity: true },
  })
  const totalVarianceCount = variances.length
  const majorVarianceCount = variances.filter(
    (v) => v.severity === "major",
  ).length

  // ─── timeliness ───────────────────────────────────────────────
  const daysUntilExpiration = daysBetween(contract.expirationDate, new Date())

  // ─── score ────────────────────────────────────────────────────
  const result = calculateContractScore({
    commitmentMet,
    complianceRate,
    rebatesEarned,
    totalContractValue,
    daysUntilExpiration,
    majorVarianceCount,
    totalVarianceCount,
  })

  const now = new Date()
  await prisma.contract.update({
    where: { id: contract.id },
    data: {
      score: Math.round(result.overallScore),
      scoreBand: result.band,
      scoreUpdatedAt: now,
    },
  })

  await logAudit({
    userId: user.id,
    action: "contract.score_recomputed",
    entityType: "contract",
    entityId: contract.id,
    metadata: {
      overallScore: result.overallScore,
      band: result.band,
      components: result.components,
    },
  })

  return result
}

/**
 * Batch version — recomputes scores for every facility contract.
 * Returns { updated, skipped } summary.
 */
export async function recomputeAllContractScores(): Promise<{
  updated: number
  skipped: number
}> {
  const { facility } = await requireFacility()

  const contracts = await prisma.contract.findMany({
    where: {
      AND: [
        contractsOwnedByFacility(facility.id),
        { status: { in: ["active", "expiring"] } },
      ],
    },
    select: { id: true },
  })

  let updated = 0
  let skipped = 0
  for (const c of contracts) {
    try {
      await recomputeContractScore(c.id)
      updated += 1
    } catch {
      skipped += 1
    }
  }

  return { updated, skipped }
}
