"use server"

/**
 * Tie-In bundle read for one contract.
 *
 * Extracted from lib/actions/contracts.ts during subsystem F5 (tech
 * debt split). Re-exported from there for backward-compat.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { computeRebateFromPrismaTiers } from "@/lib/rebates/calculate"
import {
  evaluateAllOrNothing,
  evaluateProportional,
  type TieInMember,
  type MemberPerformance,
} from "@/lib/contracts/tie-in"
import { serialize } from "@/lib/serialize"

export async function getContractTieInBundle(contractId: string) {
  const { facility } = await requireFacility()

  const bundle = await prisma.tieInBundle.findUnique({
    where: { primaryContractId: contractId },
    include: {
      primaryContract: { select: { id: true, name: true, vendorId: true } },
      members: {
        include: {
          contract: {
            include: {
              vendor: { select: { id: true, name: true } },
              // Charles R5.29: include ALL terms, not just the first —
              // multi-term member contracts otherwise under-reported their
              // currentRebate inside tie-in bundles.
              terms: {
                include: { tiers: { orderBy: { tierNumber: "asc" } } },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
    },
  })

  if (!bundle) {
    return serialize({ bundle: null })
  }

  const perf: MemberPerformance[] = []
  for (const m of bundle.members) {
    const cogAgg = await prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: m.contract.vendorId,
      },
      _sum: { extendedPrice: true },
    })
    const spend = Number(cogAgg._sum.extendedPrice ?? 0)
    // Charles R5.29: sum rebate across every term with tiers. Tie-in
    // member contracts typically have one term, but nothing prevents
    // two — and when they do, both should contribute.
    let rebate = 0
    if (spend > 0) {
      for (const term of m.contract.terms) {
        if (term.tiers.length === 0) continue
        rebate += computeRebateFromPrismaTiers(spend, term.tiers, {
          method: term.rebateMethod ?? "cumulative",
        }).rebateEarned
      }
    }
    perf.push({
      contractId: m.contractId,
      currentSpend: spend,
      currentRebate: rebate,
    })
  }

  const members: TieInMember[] = bundle.members.map((m) => ({
    contractId: m.contractId,
    weightPercent: Number(m.weightPercent),
    minimumSpend: m.minimumSpend != null ? Number(m.minimumSpend) : null,
  }))

  const bonusMultiplier =
    bundle.bonusMultiplier != null ? Number(bundle.bonusMultiplier) : undefined

  const evaluation =
    bundle.complianceMode === "proportional"
      ? evaluateProportional(members, perf)
      : evaluateAllOrNothing(members, perf, { bonusMultiplier })

  const memberRows = bundle.members.map((m) => {
    const p = perf.find((p) => p.contractId === m.contractId)
    return {
      contractId: m.contractId,
      contractName: m.contract.name,
      vendorName: m.contract.vendor.name,
      weightPercent: Number(m.weightPercent),
      minimumSpend: m.minimumSpend != null ? Number(m.minimumSpend) : null,
      currentSpend: p?.currentSpend ?? 0,
      currentRebate: p?.currentRebate ?? 0,
      compliantSoFar:
        m.minimumSpend == null
          ? true
          : (p?.currentSpend ?? 0) >= Number(m.minimumSpend),
    }
  })

  return serialize({
    bundle: {
      id: bundle.id,
      complianceMode: bundle.complianceMode,
      bonusMultiplier: bundle.bonusMultiplier != null ? Number(bundle.bonusMultiplier) : null,
      members: memberRows,
      evaluation,
    },
  })
}
