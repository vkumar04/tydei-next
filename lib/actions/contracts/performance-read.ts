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
  utilization: RebateUtilizationResult | null
  renewalRisk: RenewalRiskResult | null
}> {
  try {
    const { facility } = await requireFacility()
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
          take: 1,
        },
      },
    })
    if (!contract) return { utilization: null, renewalRisk: null }

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

    const firstTerm = contract.terms[0]
    const tiers: TierLike[] = (firstTerm?.tiers ?? []).map((t) => ({
      tierNumber: t.tierNumber,
      tierName: t.tierName ?? null,
      spendMin: Number(t.spendMin),
      spendMax: t.spendMax != null ? Number(t.spendMax) : null,
      // Boundary-scale: ContractTier.rebateValue is a fraction (0.03 =
      // 3%). Engine expects integer percent per CLAUDE.md.
      rebateValue: Number(t.rebateValue) * 100,
    }))
    const utilization =
      tiers.length > 0 && actualSpend > 0
        ? calculateRebateUtilization(actualSpend, tiers)
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
