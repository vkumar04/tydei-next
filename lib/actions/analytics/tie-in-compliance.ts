"use server"

/**
 * Charles audit suggestion (v0-port): Tie-in Bundle Compliance.
 * Wraps `v0TieInAllOrNothing` + `v0TieInProportional` with bonus
 * + accelerator tiers (20% / 50% over). Members are derived from the
 * contract's term scopes and YTD spend per scope.
 */

import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import {
  v0TieInAllOrNothing,
  v0TieInProportional,
} from "@/lib/v0-spec/rebate-math"
import { requireContractScope } from "@/lib/actions/analytics/_scope"
import { withTelemetry } from "@/lib/actions/analytics/_telemetry"

export interface TieInComplianceResult {
  mode: "all_or_nothing" | "proportional"
  members: Array<{
    name: string
    minimumSpend: number
    currentSpend: number
    metPct: number
  }>
  allOrNothing: ReturnType<typeof v0TieInAllOrNothing>
  proportional: ReturnType<typeof v0TieInProportional>
}

export async function getTieInCompliance(
  contractId: string,
  mode: "all_or_nothing" | "proportional" = "all_or_nothing",
): Promise<TieInComplianceResult> {
  return withTelemetry(
    "getTieInCompliance",
    { contractId, mode },
    async () => {
      try {
        return await _getTieInComplianceImpl(contractId, mode)
      } catch (err) {
        console.error("[getTieInCompliance]", err, { contractId, mode })
        throw new Error("Tie-in compliance is unavailable for this contract.")
      }
    },
  )
}

async function _getTieInComplianceImpl(
  contractId: string,
  mode: "all_or_nothing" | "proportional",
): Promise<TieInComplianceResult> {
  const scope = await requireContractScope(contractId)

  const contract = await prisma.contract.findFirstOrThrow({
    where: { id: contractId },
    select: {
      vendorId: true,
      facilityId: true,
      effectiveDate: true,
      terms: {
        select: {
          termName: true,
          minimumPurchaseCommitment: true,
          tiers: {
            select: { spendMin: true, rebateValue: true },
            orderBy: { tierNumber: "desc" },
            take: 1,
          },
        },
      },
    },
  })

  // YTD vendor spend.
  const today = new Date()
  const startOfYear = new Date(today.getFullYear(), 0, 1)
  const cog = await prisma.cOGRecord.aggregate({
    where: {
      facilityId: { in: scope.cogScopeFacilityIds },
      vendorId: contract.vendorId,
      transactionDate: { gte: startOfYear, lte: today },
    },
    _sum: { extendedPrice: true },
  })
  const totalSpend = Number(cog._sum.extendedPrice ?? 0)

  // Distribute total spend across terms by minimumPurchaseCommitment
  // weight (proxy — without per-category COG joins this is the
  // honest split). When all terms have null commitments, equal split.
  const terms = contract.terms
  const totalMin = terms.reduce(
    (acc, t) => acc + Number(t.minimumPurchaseCommitment ?? 0),
    0,
  )
  const members = terms.map((t) => {
    const min = Number(t.minimumPurchaseCommitment ?? 0)
    const share =
      totalMin > 0 ? min / totalMin : terms.length > 0 ? 1 / terms.length : 0
    return {
      name: t.termName,
      minimumSpend: min,
      currentSpend: totalSpend * share,
    }
  })

  // Top-tier rebate as the bundle base rate; bonus + accelerator
  // surface from the v0 doc defaults (1% bonus, 1.5x accelerator)
  // unless the contract opts in to overrides (future field).
  const topTier = terms[0]?.tiers[0]
  const baseRate = topTier
    ? Math.round(Number(topTier.rebateValue) * 100 * 100) / 100
    : 2

  const bundle = {
    baseRate,
    bonusRate: 1,
    acceleratorMultiplier: 1.5,
  }

  const allOrNothing = v0TieInAllOrNothing(members, bundle)
  const proportional = v0TieInProportional(
    members.map((m) => ({ ...m, weight: 1 / members.length })),
    baseRate,
  )

  const enrichedMembers = members.map((m) => ({
    name: m.name,
    minimumSpend: m.minimumSpend,
    currentSpend: m.currentSpend,
    metPct:
      m.minimumSpend > 0
        ? Math.min(100, (m.currentSpend / m.minimumSpend) * 100)
        : 100,
  }))

  return serialize({
    mode,
    members: enrichedMembers,
    allOrNothing,
    proportional,
  })
}
