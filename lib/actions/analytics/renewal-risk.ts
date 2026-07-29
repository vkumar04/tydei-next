"use server"

/**
 * Charles audit suggestion (v0-port): Renewal Risk Score per contract.
 * Wraps `renewalRisk` with live data so the contract-detail surface
 * can render LOW/MED/HIGH with the contributing factors.
 *
 * v0 doc §9 weights:
 *   daysToExpiration  20%
 *   complianceRate    25%
 *   priceVarianceAvg  20%
 *   vendorResponsiveness 15%
 *   rebateUtilization 10%
 *   issueCount        10%
 */

import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import { renewalRisk } from "@/lib/contracts/performance-metrics"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { requireContractScope } from "@/lib/actions/analytics/_scope"
import { withTelemetry } from "@/lib/actions/analytics/_telemetry"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { hasSpendDollarTierLadder } from "@/lib/contracts/tier-metric"

export async function getRenewalRisk(contractId: string) {
  return withTelemetry("getRenewalRisk", { contractId }, async () => {
    try {
      return await _getRenewalRiskImpl(contractId)
    } catch (err) {
      console.error("[getRenewalRisk]", err, { contractId })
      throw new Error("Renewal risk is unavailable for this contract.")
    }
  })
}

async function _getRenewalRiskImpl(contractId: string) {
  const scope = await requireContractScope(contractId)

  const contract = await prisma.contract.findFirstOrThrow({
    where: { id: contractId },
    select: {
      id: true,
      expirationDate: true,
      complianceRate: true,
      vendorId: true,
      additionalVendorIds: true,
      facilityId: true,
      annualValue: true,
      rebates: {
        select: {
          rebateEarned: true,
          payPeriodEnd: true,
        },
      },
      terms: {
        select: {
          termType: true,
          tiers: {
            select: { rebateValue: true },
            orderBy: { tierNumber: "desc" },
          },
        },
      },
    },
  })

  // Open issues count = open alerts on the contract.
  const openIssues = await prisma.alert.count({
    where: {
      contractId,
      facilityId: { in: scope.cogScopeFacilityIds },
      status: "new_alert",
    },
  })

  // Avg price variance: pull from invoice line variances if any.
  //
  // 2026-06-09 audit M15: scope to THIS contract's vendor set (group-
  // aware via contractVendorIds) — the previous facility-wide pull let
  // an unrelated vendor's pricing chaos inflate this contract's risk
  // score. Order deterministically (newest first) so the `take: 50`
  // sample is stable and recency-weighted rather than insertion-order
  // arbitrary.
  const riskVendorIds = contractVendorIds(contract)
  const variances =
    riskVendorIds.length > 0
      ? await prisma.invoiceLineItem.findMany({
          where: {
            invoice: {
              facilityId: { in: scope.cogScopeFacilityIds },
              vendorId: { in: riskVendorIds },
            },
            variancePercent: { not: null },
          },
          select: { variancePercent: true },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : []
  const avgPriceVariance =
    variances.length > 0
      ? variances.reduce((acc, v) => acc + Math.abs(Number(v.variancePercent ?? 0)), 0) /
        variances.length
      : 0

  // Rebate utilization: lifetime earned / max-tier-rebate-projected.
  //
  // 2026-06-09 audit M15: pick the top rate from a SPEND-DOLLAR tier
  // ladder only (canonical hasSpendDollarTierLadder gate). terms[0]
  // could be a market_share / carve_out / volume term whose rebateValue
  // units don't multiply against dollar spend — carve-out placeholder
  // tiers (rebateValue 0) also zeroed the ceiling, forcing the "unknown
  // → mid" branch with a misleadingly confident input.
  const projectedAnnualSpend = Number(contract.annualValue ?? 0)
  const ladderTerm = contract.terms.find((t) => hasSpendDollarTierLadder(t))
  const topRebateRaw = ladderTerm?.tiers[0]?.rebateValue
  const topRebatePct = topRebateRaw != null ? Number(topRebateRaw) : 0
  const maxPossibleRebate = projectedAnnualSpend * topRebatePct
  const earned = sumEarnedRebatesLifetime(contract.rebates)
  const rebateUtilization =
    maxPossibleRebate > 0
      ? Math.min(100, (earned / maxPossibleRebate) * 100)
      : 50 // unknown → mid

  const today = new Date()
  const expiry = new Date(contract.expirationDate)
  const daysRemaining = Math.max(
    0,
    Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
  )

  const result = renewalRisk({
    daysRemaining,
    compliancePct: Number(contract.complianceRate ?? 50),
    avgPriceVariancePct: avgPriceVariance,
    avgResponseTimeHours: 8, // proxy default
    rebateUtilizationPct: rebateUtilization,
    openIssues,
  })

  return serialize(result)
}
