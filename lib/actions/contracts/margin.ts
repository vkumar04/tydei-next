"use server"

/**
 * True-margin analysis for one contract.
 *
 * Extracted from lib/actions/contracts.ts during subsystem F5 (tech
 * debt split). Re-exported from there for backward-compat.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { computeRebateFromPrismaTiers } from "@/lib/rebates/calculate"
import {
  allocateContractBenefitsToProcedures,
  calculateMarginsV2,
} from "@/lib/case-costing/contract-contribution"
import { serialize } from "@/lib/serialize"

export async function getContractMarginAnalysis(contractId: string) {
  const { facility } = await requireFacility()

  // Charles audit round-11 BLOCKER: scope by ownership.
  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
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

  // [A9] retrofit: switched from lib/contracts/true-margin.ts to the
  // unified case-costing Contract Contribution engine so price-reduction
  // allocations + totalContractBenefit surface on every row alongside
  // the cash rebate. All rebate-only downstream consumers still see
  // rebateAllocation unchanged.
  const procedureVendorSpends = Array.from(byProcedure.entries()).map(
    ([cpt, agg]) => ({
      procedureId: cpt,
      vendorId: contract.vendorId,
      vendorSpend: agg.vendorSpend,
    }),
  )
  const totalVendorSpend = procedureVendorSpends.reduce(
    (s, p) => s + p.vendorSpend,
    0,
  )

  let totalRebate = contract.rebates.reduce(
    (s, r) => s + Number(r.rebateEarned),
    0,
  )
  // Charles R5.29: fallback path now SUMS across every term with tiers.
  // Primary data source is still persisted Rebate rows; this only fires
  // when the ledger is empty (new contract, pre-recompute). Multi-term
  // contracts need each term's rebate added, not just terms[0].
  if (totalRebate === 0) {
    const termsWithTiers = contract.terms.filter((t) => t.tiers.length > 0)
    if (termsWithTiers.length > 0) {
      const cogAgg = await prisma.cOGRecord.aggregate({
        where: { facilityId: facility.id, vendorId: contract.vendorId },
        _sum: { extendedPrice: true },
      })
      const vendorCog = Number(cogAgg._sum.extendedPrice ?? 0)
      if (vendorCog > 0) {
        totalRebate = termsWithTiers.reduce((acc, term) => {
          return (
            acc +
            computeRebateFromPrismaTiers(vendorCog, term.tiers, {
              method: term.rebateMethod ?? "cumulative",
            }).rebateEarned
          )
        }, 0)
      }
    }
  }

  // Price-reduction allocation is not yet tracked on this surface —
  // the underlying contract pricing price-reduction math ships in a
  // follow-up that also adds a ContractPriceReduction accrual source.
  // Default to 0 for now; allocation still works and rows pick up the
  // priceReductionAllocation column for future-proof rendering.
  const priceReductionAmount = 0

  const { allocations } = allocateContractBenefitsToProcedures({
    procedures: procedureVendorSpends,
    vendors: [
      {
        vendorId: contract.vendorId,
        totalVendorSpend,
        rebateAmount: totalRebate,
        priceReductionAmount,
      },
    ],
  })

  const procedures = Array.from(byProcedure.entries())
    .map(([cpt, agg]) => {
      const allocation = allocations.get(cpt) ?? {
        procedureId: cpt,
        rebateAllocation: 0,
        priceReductionAllocation: 0,
        totalContractBenefit: 0,
      }
      const margins = calculateMarginsV2(
        { reimbursement: agg.revenue, costs: agg.costs },
        {
          rebateAllocation: allocation.rebateAllocation,
          priceReductionAllocation: allocation.priceReductionAllocation,
          totalContractBenefit: allocation.totalContractBenefit,
        },
      )
      return {
        cptCode: cpt,
        vendorSpend: agg.vendorSpend,
        caseCount: agg.caseIds.size,
        revenue: agg.revenue,
        costs: agg.costs,
        rebateAllocation: allocation.rebateAllocation,
        priceReductionAllocation: allocation.priceReductionAllocation,
        totalContractBenefit: allocation.totalContractBenefit,
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
    totalPriceReduction: priceReductionAmount,
    totalContractBenefit: totalRebate + priceReductionAmount,
  })
}
