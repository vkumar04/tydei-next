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
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"

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
            select: { spendMin: true, rebateValue: true, rebateType: true },
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
  //
  // Vick 2026-05-30 screenshot: a Zimmer tie-in showed "Effective
  // rate 45000001.50%" because this contract's top tier had
  // rebateValue=300000 (a spend threshold mis-stored into the
  // rebate column by the AI extractor). Pre-fix this file hand-
  // rolled `× 100 × 100 / 100`, which faithfully blew the bad
  // datum up to 30,000,000% and the accelerator multiplied that
  // by 1.5 to produce the nonsense headline.
  //
  // Fix: (1) use the canonical toDisplayRebateValue helper instead
  // of hand-rolling the conversion (matches every other surface
  // per CLAUDE.md's invariants table). (2) clamp the result to a
  // sane 0-100% range and log when we clamp — so a future bad
  // tier doesn't crater the UI again; the operator gets a server
  // log pointing at the offending contract.
  const topTier = terms[0]?.tiers[0]
  let baseRate = 2
  if (topTier) {
    const rawDisplay = toDisplayRebateValue(
      topTier.rebateType ?? "percent_of_spend",
      Number(topTier.rebateValue),
    )
    if (rawDisplay < 0 || rawDisplay > 100) {
      console.warn(
        "[getTieInCompliance] clamping out-of-range top-tier rebate",
        {
          contractId,
          rawValue: Number(topTier.rebateValue),
          asDisplay: rawDisplay,
          clamped: Math.max(0, Math.min(100, rawDisplay)),
        },
      )
    }
    baseRate = Math.max(0, Math.min(100, rawDisplay))
  }

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
