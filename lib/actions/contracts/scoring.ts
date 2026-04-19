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
 * Internal: load every metric the scoring engine needs and run it.
 * Returns both the result and the contract id so callers that want
 * to persist (recomputeContractScore) can do so without re-querying.
 */
async function loadAndScoreContract(
  contractId: string,
  facilityId: string,
): Promise<{ contractId: string; result: ContractScoreResult }> {
  const contract = await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(contractId, facilityId),
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
  const [onContractAgg, vendorAgg] = await Promise.all([
    prisma.cOGRecord.aggregate({
      where: {
        facilityId,
        contractId: contract.id,
        isOnContract: true,
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        facilityId,
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

  return { contractId: contract.id, result }
}

/**
 * Read-only score computation. Same metrics as `recomputeContractScore`
 * but does NOT write Contract.score / scoreBand / scoreUpdatedAt and
 * does NOT log an audit row. Use this for read-side surfaces (e.g. the
 * score page radar) where you want a fresh number on every render
 * without generating writes + audit log spam.
 */
export async function computeContractScoreLive(
  contractId: string,
): Promise<ContractScoreResult> {
  const { facility } = await requireFacility()
  const { result } = await loadAndScoreContract(contractId, facility.id)
  return result
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
  const { contractId: id, result } = await loadAndScoreContract(
    contractId,
    facility.id,
  )

  const now = new Date()
  await prisma.contract.update({
    where: { id },
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
    entityId: id,
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
