"use server"

/**
 * True-margin analysis for one contract.
 *
 * Extracted from lib/actions/contracts.ts during subsystem F5 (tech
 * debt split). Re-exported from there for backward-compat.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { computeRebateFromPrismaTiers } from "@/lib/rebates/calculate"
import {
  allocateRebatesToProcedures,
  calculateMargins,
  type ProcedureSpend,
} from "@/lib/contracts/true-margin"
import { serialize } from "@/lib/serialize"

export async function getContractMarginAnalysis(contractId: string) {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      rebates: { select: { rebateEarned: true } },
    },
  })

  const supplies = await prisma.caseSupply.findMany({
    where: {
      contractId,
      caseRecord: { facilityId: facility.id },
    },
    include: {
      caseRecord: {
        select: {
          id: true,
          primaryCptCode: true,
          totalSpend: true,
          totalReimbursement: true,
        },
      },
    },
  })

  if (supplies.length === 0) {
    return serialize({ procedures: [], totalVendorSpend: 0, totalRebate: 0 })
  }

  interface ProcedureAgg {
    vendorSpend: number
    caseIds: Set<string>
    revenue: number
    costs: number
  }
  const byProcedure = new Map<string, ProcedureAgg>()

  for (const s of supplies) {
    const cpt = s.caseRecord?.primaryCptCode
    if (!cpt) continue
    const entry = byProcedure.get(cpt) ?? {
      vendorSpend: 0,
      caseIds: new Set<string>(),
      revenue: 0,
      costs: 0,
    }
    entry.vendorSpend += Number(s.extendedCost)
    if (s.caseRecord && !entry.caseIds.has(s.caseRecord.id)) {
      entry.caseIds.add(s.caseRecord.id)
      entry.revenue += Number(s.caseRecord.totalReimbursement)
      entry.costs += Number(s.caseRecord.totalSpend)
    }
    byProcedure.set(cpt, entry)
  }

  const procedureSpends: ProcedureSpend[] = Array.from(byProcedure.entries()).map(
    ([cpt, agg]) => ({ procedureId: cpt, vendorSpend: agg.vendorSpend }),
  )
  const totalVendorSpend = procedureSpends.reduce(
    (s, p) => s + p.vendorSpend,
    0,
  )

  let totalRebate = contract.rebates.reduce(
    (s, r) => s + Number(r.rebateEarned),
    0,
  )
  if (totalRebate === 0 && contract.terms[0]?.tiers.length) {
    const firstTerm = contract.terms[0]
    const cogAgg = await prisma.cOGRecord.aggregate({
      where: { facilityId: facility.id, vendorId: contract.vendorId },
      _sum: { extendedPrice: true },
    })
    const vendorCog = Number(cogAgg._sum.extendedPrice ?? 0)
    if (vendorCog > 0) {
      totalRebate = computeRebateFromPrismaTiers(vendorCog, firstTerm.tiers, {
        method: firstTerm.rebateMethod ?? "cumulative",
      }).rebateEarned
    }
  }

  const allocations = allocateRebatesToProcedures(
    procedureSpends,
    totalVendorSpend,
    totalRebate,
  )

  const procedures = Array.from(byProcedure.entries())
    .map(([cpt, agg]) => {
      const allocation = allocations.get(cpt) ?? 0
      const margins = calculateMargins(
        { revenue: agg.revenue, costs: agg.costs },
        allocation,
      )
      return {
        cptCode: cpt,
        vendorSpend: agg.vendorSpend,
        caseCount: agg.caseIds.size,
        revenue: agg.revenue,
        costs: agg.costs,
        rebateAllocation: allocation,
        standardMargin: margins.standardMargin,
        trueMargin: margins.trueMargin,
        standardMarginPercent: margins.standardMarginPercent,
        trueMarginPercent: margins.trueMarginPercent,
      }
    })
    .sort((a, b) => b.vendorSpend - a.vendorSpend)

  return serialize({
    procedures,
    totalVendorSpend,
    totalRebate,
  })
}
