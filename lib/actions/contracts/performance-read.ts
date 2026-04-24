"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import {
  calculateRebateUtilization,
  calculateRenewalRisk,
  type RebateUtilizationResult,
  type RenewalRiskResult,
} from "@/lib/contracts/performance"
import type { TierLike } from "@/lib/rebates/calculate"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"

/**
 * Load the data needed for `<ContractPerformanceCard>` and compute
 * both metrics via the v0-locked helpers.
 *
 * Keeps the card a thin renderer and centralizes the "what inputs
 * does each helper want?" logic in one place. Returns
 * `{ utilization: null, renewalRisk: null }` shapes when the contract
 * doesn't carry the relevant data (capital/service/pricing_only, or
 * no tiers) so the UI can cleanly skip each tile.
 */
export async function getContractPerformance(contractId: string): Promise<{
  utilization:
    | (RebateUtilizationResult & {
        rebateMethod: "cumulative" | "marginal"
        tierCount: number
      })
    | null
  renewalRisk: RenewalRiskResult | null
}> {
  try {
    const { facility } = await requireFacility()
    // Charles 2026-04-24 (Bug A "max at top tier / missed $0" looks wrong):
    // previously this pulled `take:1` by `createdAt asc` — on multi-term
    // contracts that routinely picked the wrong term (e.g. a single-tier
    // carve-out instead of the real tiered rebate term), which made
    // every contract read as 100% utilized. Load all terms and pick the
    // term whose effective window contains today, preferring terms with
    // >1 tier so single-tier baselines don't dominate.
    const contract = await prisma.contract.findFirst({
      where: {
        id: contractId,
        OR: [
          { facilityId: facility.id },
          { contractFacilities: { some: { facilityId: facility.id } } },
        ],
      },
      include: {
        terms: {
          include: { tiers: { orderBy: { tierNumber: "asc" } } },
          orderBy: { createdAt: "asc" },
        },
      },
    })
    if (!contract) return { utilization: null, renewalRisk: null }
    const today = new Date()
    const effectiveTerm =
      contract.terms.find(
        (t) =>
          t.tiers.length > 1 &&
          (!t.effectiveStart || t.effectiveStart <= today) &&
          (!t.effectiveEnd || t.effectiveEnd >= today),
      ) ??
      contract.terms.find((t) => t.tiers.length > 1) ??
      contract.terms[0]

    // Spend for utilization = sum of COG extendedPrice scoped to this
    // contract's vendor within its effective window. Simple, consistent
    // with other canonical reducers; a richer version could join to
    // matched-contract rows only.
    const spendAgg = await prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: contract.vendorId,
        transactionDate: {
          gte: contract.effectiveDate,
          ...(contract.expirationDate ? { lte: contract.expirationDate } : {}),
        },
      },
      _sum: { extendedPrice: true },
    })
    const actualSpend = Number(spendAgg._sum.extendedPrice ?? 0)

    const firstTerm = effectiveTerm
    const tiers: TierLike[] = (firstTerm?.tiers ?? []).map((t) => ({
      tierNumber: t.tierNumber,
      tierName: t.tierName ?? null,
      spendMin: Number(t.spendMin),
      spendMax: t.spendMax != null ? Number(t.spendMax) : null,
      // Boundary-scale: ContractTier.rebateValue is a fraction (0.03 =
      // 3%). Engine expects integer percent per CLAUDE.md.
      rebateValue: toDisplayRebateValue(
        "percent_of_spend",
        Number(t.rebateValue),
      ),
    }))
    // Pass the term's rebateMethod so marginal contracts report the
    // true actual < max. Hardcoding cumulative made marginal terms
    // falsely display 100% utilization / $0 missed (user-reported
    // 2026-04-23 "says it maxed the rebate out but it hit tier 1 a
    // bunch so it did not max it out").
    const firstTermMethod = (firstTerm?.rebateMethod ?? "cumulative") as
      | "cumulative"
      | "marginal"
    const utilizationBase =
      tiers.length > 0 && actualSpend > 0
        ? calculateRebateUtilization(actualSpend, tiers, firstTermMethod)
        : null
    const utilization = utilizationBase
      ? {
          ...utilizationBase,
          rebateMethod: firstTermMethod,
          tierCount: tiers.length,
        }
      : null

    // Renewal risk uses days-to-expiration + compliance + utilization.
    // Compliance we approximate as 100 when the contract has an active
    // status (no per-row compliance rollup wired here yet); price
    // variance and response time default to conservative estimates so
    // the composite is a "best-case so far" until richer inputs exist.
    const renewalRisk: RenewalRiskResult | null = contract.expirationDate
      ? calculateRenewalRisk({
          daysRemaining: Math.max(
            0,
            Math.ceil(
              (contract.expirationDate.getTime() - Date.now()) /
                (1000 * 60 * 60 * 24),
            ),
          ),
          compliancePct: Number(contract.complianceRate ?? 100),
          avgPriceVariancePct: 0,
          avgResponseTimeHours: 0,
          rebateUtilizationPct: utilization?.utilizationPct ?? 100,
          openIssues: 0,
        })
      : null

    return serialize({ utilization, renewalRisk })
  } catch (err) {
    console.error("[getContractPerformance]", err, { contractId })
    throw err
  }
}
