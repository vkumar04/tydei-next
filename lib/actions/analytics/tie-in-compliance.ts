"use server"

/**
 * Charles audit suggestion (v0-port): Tie-in Bundle Compliance.
 * Wraps `tieInAllOrNothing` + `tieInProportional` with bonus
 * + accelerator tiers (20% / 50% over). Members are derived from the
 * contract's term scopes and YTD spend per scope.
 */

import { prisma } from "@/lib/db"
import { getTrailing12MonthWindow } from "@/lib/dates/trailing-window"
import { serialize } from "@/lib/serialize"
import {
  tieInAllOrNothing,
  tieInProportional,
} from "@/lib/contracts/tie-in-bundle-math"
import { requireContractScope } from "@/lib/actions/analytics/_scope"
import { withTelemetry } from "@/lib/actions/analytics/_telemetry"
import { selectBundleBaseRate } from "@/lib/contracts/bundle-base-rate"
import { buildUnionCategoryWhereClause } from "@/lib/contracts/cog-category-filter"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"

export interface TieInComplianceResult {
  mode: "all_or_nothing" | "proportional"
  members: Array<{
    name: string
    minimumSpend: number
    currentSpend: number
    metPct: number
  }>
  allOrNothing: ReturnType<typeof tieInAllOrNothing>
  proportional: ReturnType<typeof tieInProportional>
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
          appliesTo: true,
          categories: true,
          tiers: {
            select: { spendMin: true, rebateValue: true, rebateType: true },
            orderBy: { tierNumber: "desc" },
            take: 1,
          },
        },
      },
    },
  })

  // Trailing-12-month, category-scoped vendor spend.
  //
  // Charles 2026-06-20 ("not sure why it is showing not compliant"): this used
  // a YTD window with NO category scope, so the basis was both far smaller than
  // (and scoped differently from) the contract header's "Current Spend (Last 12
  // Months)". With ~5 months of YTD spend the bundle never met its minimums and
  // read 0.00% / Not compliant despite real trailing-12mo spend. Align the
  // window with the header (trailing 12mo) and route the category scope through
  // the canonical union helper so unrelated vendor spend isn't over-counted.
  const { start: twelveMonthsAgo, end: today } = getTrailing12MonthWindow()
  const cogCategoryUniverse = contract.facilityId
    ? await facilityCogCategoryUniverse(contract.facilityId)
    : []
  const unionCategoryWhere = buildUnionCategoryWhereClause(
    contract.terms.map((t) => ({
      appliesTo: t.appliesTo,
      categories: t.categories,
    })),
    cogCategoryUniverse,
  )
  const cog = await prisma.cOGRecord.aggregate({
    where: {
      facilityId: { in: scope.cogScopeFacilityIds },
      vendorId: contract.vendorId,
      transactionDate: { gte: twelveMonthsAgo, lte: today },
      ...unionCategoryWhere,
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

  // Bundle base rate = top tier of the first PERCENT-based term; bonus +
  // accelerator surface from the v0 doc defaults (1% bonus, 1.5x accelerator)
  // unless the contract opts in to overrides (future field).
  //
  // selectBundleBaseRate skips fixed-dollar tiers (a `compliance_rebate`
  // term's `fixed_rebate` tier carries a DOLLAR amount, not a rate — Charles
  // 2026-06-07: STK-2025-TIE's $17,500 fixed tier was read as 17,500% then
  // clamped to 100%). It still clamps a genuinely out-of-range PERCENT value
  // (Vick 2026-05-30: a spend threshold mis-stored in the rebate column blew a
  // Zimmer tie-in's headline up to 30,000,000%) and falls back to the v0
  // default when the contract has no percent tier at all.
  const { baseRate, clamped, rawValue, rawDisplay } = selectBundleBaseRate(terms)
  if (clamped) {
    console.warn("[getTieInCompliance] clamping out-of-range top-tier rebate", {
      contractId,
      rawValue,
      asDisplay: rawDisplay,
      clamped: baseRate,
    })
  }

  const bundle = {
    baseRate,
    bonusRate: 1,
    acceleratorMultiplier: 1.5,
  }

  const allOrNothing = tieInAllOrNothing(members, bundle)
  const proportional = tieInProportional(
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
