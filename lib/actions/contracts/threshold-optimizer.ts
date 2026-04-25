"use server"

/**
 * Threshold-rebate optimizer (Charles 2026-04-25 audit follow-up).
 *
 * Companion to the spend-rebate optimizer (`lib/rebate-optimizer/`)
 * for `compliance_rebate` and `market_share` term types. These two
 * share the same shape: a single contract-level metric (% achieved)
 * is compared against a tier ladder; reaching a higher tier unlocks
 * a flat dollar payout per evaluation period.
 *
 * Returns per-contract opportunities sorted by the easiest tier to
 * unlock next (smallest delta wins). The UI renders this as a list
 * of "you're 3% short of an extra $X/period" recommendations.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"

export interface ThresholdOpportunity {
  contractId: string
  contractName: string
  vendorName: string
  /** Which metric the term reads — drives the UI label. */
  metric: "complianceRate" | "currentMarketShare"
  /** Term that produces this opportunity. */
  termId: string
  termName: string
  /** Current metric value on the contract. */
  currentMetricValue: number
  /** Tier the contract is currently at (number, or 0 if below the lowest). */
  currentTierNumber: number
  /** Per-period rebate at the current tier. */
  currentRebatePerPeriod: number
  /** Next-tier threshold the contract hasn't reached yet. */
  nextTierNumber: number | null
  /** Required metric value to reach the next tier. */
  nextTierThreshold: number | null
  /** Per-period rebate at the next tier. */
  nextRebatePerPeriod: number | null
  /** Delta in metric % needed to unlock the next tier. */
  metricGap: number | null
  /** Annualized uplift (next - current) × periods/year. */
  annualUplift: number | null
}

/**
 * Charles 2026-04-25 audit re-pass F2 — legacy compatibility.
 * Mirrors `payoutForTier` in recompute-threshold-accrual.ts. The
 * threshold engine pays a flat dollar amount per period; older
 * contracts may store rebateValue as a fraction with rebateType =
 * percent_of_spend. Until those rows are backfilled to fixed_rebate,
 * scale the fraction by 100 to recover the intended dollar amount.
 */
function payoutForTier(
  tier: { rebateValue: unknown; rebateType?: string | null },
  contractId: string,
  warned: Set<string>,
): number {
  const raw = Number(tier.rebateValue ?? 0)
  if (tier.rebateType === "fixed_rebate") return raw
  if (tier.rebateType === "percent_of_spend") {
    if (!warned.has(contractId)) {
      console.warn(
        `[getThresholdOpportunities] contract ${contractId}: tier.rebateType=percent_of_spend on a threshold term — interpreting tier.rebateValue (${raw}) as percent-points × 100 for legacy compatibility. Backfill to fixed_rebate when possible.`,
      )
      warned.add(contractId)
    }
    return raw * 100
  }
  return raw
}

const LEGACY_PAYOUT_WARNED = new Set<string>()

function widthMonths(eval_: string | null): number {
  switch (eval_) {
    case "monthly":
      return 1
    case "quarterly":
      return 3
    case "semi_annual":
      return 6
    case "annual":
    default:
      return 12
  }
}

export async function getThresholdOpportunities(): Promise<ThresholdOpportunity[]> {
  try {
    const { facility } = await requireFacility()
    const contracts = await prisma.contract.findMany({
      where: {
        ...contractsOwnedByFacility(facility.id),
        status: { in: ["active", "expiring"] },
        terms: {
          some: {
            termType: { in: ["compliance_rebate", "market_share"] },
            tiers: { some: {} },
          },
        },
      },
      select: {
        id: true,
        name: true,
        complianceRate: true,
        currentMarketShare: true,
        vendor: { select: { name: true } },
        terms: {
          where: {
            termType: { in: ["compliance_rebate", "market_share"] },
            tiers: { some: {} },
          },
          select: {
            id: true,
            termName: true,
            termType: true,
            evaluationPeriod: true,
            tiers: {
              orderBy: { tierNumber: "asc" },
              select: {
                tierNumber: true,
                spendMin: true,
                rebateValue: true,
                rebateType: true,
              },
            },
          },
        },
      },
    })

    const result: ThresholdOpportunity[] = []
    for (const c of contracts) {
      for (const t of c.terms) {
        const metric: "complianceRate" | "currentMarketShare" =
          t.termType === "market_share" ? "currentMarketShare" : "complianceRate"
        const metricValue =
          metric === "currentMarketShare"
            ? c.currentMarketShare === null
              ? null
              : Number(c.currentMarketShare)
            : c.complianceRate === null
              ? null
              : Number(c.complianceRate)
        if (metricValue == null) continue

        const sortedTiers = [...t.tiers]
          .map((tier) => ({
            tierNumber: tier.tierNumber,
            threshold: Number(tier.spendMin ?? 0),
            rebate: payoutForTier(tier, c.id, LEGACY_PAYOUT_WARNED),
          }))
          .sort((a, b) => a.threshold - b.threshold)
        if (sortedTiers.length === 0) continue

        let currentTier = sortedTiers[0]
        let currentTierIdx = -1
        for (let i = 0; i < sortedTiers.length; i++) {
          if (metricValue >= sortedTiers[i].threshold) {
            currentTier = sortedTiers[i]
            currentTierIdx = i
          } else {
            break
          }
        }
        const nextTier =
          currentTierIdx + 1 < sortedTiers.length
            ? sortedTiers[currentTierIdx + 1]
            : null
        const periodsPerYear = 12 / widthMonths(t.evaluationPeriod ?? "annual")
        const currentRebatePerPeriod =
          currentTierIdx >= 0 ? currentTier.rebate : 0

        result.push({
          contractId: c.id,
          contractName: c.name,
          vendorName: c.vendor.name,
          metric,
          termId: t.id,
          termName: t.termName,
          currentMetricValue: metricValue,
          currentTierNumber:
            currentTierIdx >= 0 ? currentTier.tierNumber : 0,
          currentRebatePerPeriod,
          nextTierNumber: nextTier?.tierNumber ?? null,
          nextTierThreshold: nextTier?.threshold ?? null,
          nextRebatePerPeriod: nextTier?.rebate ?? null,
          metricGap:
            nextTier != null ? nextTier.threshold - metricValue : null,
          annualUplift:
            nextTier != null
              ? (nextTier.rebate - currentRebatePerPeriod) * periodsPerYear
              : null,
        })
      }
    }

    // Sort by smallest metric gap first — easiest opportunities up
    // top. Contracts at top tier (no nextTier) sink to the bottom.
    result.sort((a, b) => {
      if (a.metricGap == null && b.metricGap == null) return 0
      if (a.metricGap == null) return 1
      if (b.metricGap == null) return -1
      return a.metricGap - b.metricGap
    })
    return serialize(result)
  } catch (err) {
    console.error("[getThresholdOpportunities]", err)
    throw err
  }
}
