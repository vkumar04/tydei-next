"use server"

/**
 * Charles audit suggestion (v0-port): Renewal Risk Score per contract.
 * Wraps `v0RenewalRisk` with live data so the contract-detail surface
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
import { v0RenewalRisk } from "@/lib/v0-spec/contract-performance"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { requireContractScope } from "@/lib/actions/analytics/_scope"

export async function getRenewalRisk(contractId: string) {
  try {
    return await _getRenewalRiskImpl(contractId)
  } catch (err) {
    console.error("[getRenewalRisk]", err, { contractId })
    throw new Error("Renewal risk is unavailable for this contract.")
  }
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
          tiers: {
            select: { rebateValue: true },
            orderBy: { tierNumber: "desc" },
            take: 1,
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
  const variances = await prisma.invoiceLineItem.findMany({
    where: {
      invoice: { facilityId: { in: scope.cogScopeFacilityIds } },
      variancePercent: { not: null },
    },
    select: { variancePercent: true },
    take: 50,
  })
  const avgPriceVariance =
    variances.length > 0
      ? variances.reduce((acc, v) => acc + Math.abs(Number(v.variancePercent ?? 0)), 0) /
        variances.length
      : 0

  // Rebate utilization: lifetime earned / max-tier-rebate-projected.
  const projectedAnnualSpend = Number(contract.annualValue ?? 0)
  const topRebateRaw = contract.terms[0]?.tiers[0]?.rebateValue
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

  const result = v0RenewalRisk({
    daysRemaining,
    compliancePct: Number(contract.complianceRate ?? 50),
    avgPriceVariancePct: avgPriceVariance,
    avgResponseTimeHours: 8, // proxy default
    rebateUtilizationPct: rebateUtilization,
    openIssues,
  })

  return serialize(result)
}
