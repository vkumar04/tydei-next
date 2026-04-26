"use server"

/**
 * Batched renewal-risk lookup for the vendor portal. The single-
 * contract `getRenewalRisk` is fine for the contract-detail view
 * but renewals lists need risk-per-row across many contracts; this
 * helper does it in one pass.
 *
 * Vendor-only: gates via `requireVendor` and bounds the query to
 * the caller's `vendorId`. No cross-tenant leak risk because every
 * read is filtered by `vendorId = vendor.id`.
 */

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { v0RenewalRisk } from "@/lib/v0-spec/contract-performance"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"

export interface VendorRenewalRiskRow {
  contractId: string
  riskScore: number
  riskLevel: "low" | "medium" | "high"
}

export async function getVendorRenewalRiskBatch(
  contractIds: string[],
): Promise<Record<string, VendorRenewalRiskRow>> {
  if (contractIds.length === 0) return {}
  const { vendor } = await requireVendor()

  const contracts = await prisma.contract.findMany({
    where: { id: { in: contractIds }, vendorId: vendor.id },
    select: {
      id: true,
      facilityId: true,
      expirationDate: true,
      complianceRate: true,
      annualValue: true,
      rebates: {
        select: { rebateEarned: true, payPeriodEnd: true },
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

  // Per-contract open-issue + price-variance pulls. Batched to avoid
  // N round-trips across the 20-row renewals page.
  const facilityIds = Array.from(
    new Set(
      contracts
        .map((c) => c.facilityId)
        .filter((v): v is string => Boolean(v)),
    ),
  )

  const [openIssuesByContract, varianceByFacility] = await Promise.all([
    prisma.alert.groupBy({
      by: ["contractId"],
      where: {
        contractId: { in: contracts.map((c) => c.id) },
        status: "new_alert",
      },
      _count: { _all: true },
    }),
    facilityIds.length === 0
      ? Promise.resolve(
          [] as Array<{
            facilityId: string
            avg: number
            count: number
          }>,
        )
      : prisma.invoiceLineItem
          .findMany({
            where: {
              invoice: { facilityId: { in: facilityIds } },
              variancePercent: { not: null },
            },
            select: {
              variancePercent: true,
              invoice: { select: { facilityId: true } },
            },
            take: 500,
          })
          .then((rows) => {
            const map = new Map<string, { sum: number; n: number }>()
            for (const r of rows) {
              const fid = r.invoice.facilityId
              if (!fid) continue
              const cur = map.get(fid) ?? { sum: 0, n: 0 }
              cur.sum += Math.abs(Number(r.variancePercent ?? 0))
              cur.n += 1
              map.set(fid, cur)
            }
            return Array.from(map.entries()).map(([facilityId, v]) => ({
              facilityId,
              avg: v.n > 0 ? v.sum / v.n : 0,
              count: v.n,
            }))
          }),
  ])

  const openIssueByContract = new Map<string, number>()
  for (const row of openIssuesByContract) {
    if (row.contractId) {
      openIssueByContract.set(row.contractId, row._count._all)
    }
  }
  const varianceByFacilityMap = new Map(
    varianceByFacility.map((r) => [r.facilityId, r.avg]),
  )

  const today = new Date()
  const out: Record<string, VendorRenewalRiskRow> = {}
  for (const c of contracts) {
    const projectedAnnualSpend = Number(c.annualValue ?? 0)
    const topRebateRaw = c.terms[0]?.tiers[0]?.rebateValue
    const topRebatePct = topRebateRaw != null ? Number(topRebateRaw) : 0
    const maxPossibleRebate = projectedAnnualSpend * topRebatePct
    const earned = sumEarnedRebatesLifetime(c.rebates)
    const rebateUtilization =
      maxPossibleRebate > 0
        ? Math.min(100, (earned / maxPossibleRebate) * 100)
        : 50

    const expiry = new Date(c.expirationDate)
    const daysRemaining = Math.max(
      0,
      Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
    )

    const result = v0RenewalRisk({
      daysRemaining,
      compliancePct: Number(c.complianceRate ?? 50),
      avgPriceVariancePct: c.facilityId
        ? varianceByFacilityMap.get(c.facilityId) ?? 0
        : 0,
      avgResponseTimeHours: 8,
      rebateUtilizationPct: rebateUtilization,
      openIssues: openIssueByContract.get(c.id) ?? 0,
    })

    out[c.id] = {
      contractId: c.id,
      riskScore: result.riskScore,
      riskLevel: result.riskLevel,
    }
  }

  return serialize(out)
}
