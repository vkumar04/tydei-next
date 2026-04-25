"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"

export interface RebateOpportunity {
  contractId: string
  contractName: string
  vendorName: string
  currentTier: number
  nextTier: number
  currentSpend: number
  nextTierThreshold: number
  spendGap: number
  projectedAdditionalRebate: number
  percentToNextTier: number
  currentRebatePercent: number
  nextRebatePercent: number
}

export interface SpendTarget {
  id: string
  contractId: string
  contractName: string
  targetSpend: number
  targetDate: string
  currentSpend: number
  percentComplete: number
}

// ─── Get Rebate Opportunities ────────────────────────────────────

export async function getRebateOpportunities(_facilityId?: string): Promise<RebateOpportunity[]> {
  const { facility } = await requireFacility()
  const facilityId = facility.id

  const contracts = await prisma.contract.findMany({
    where: {
      // Multi-facility scoping: include contracts that reach this
      // facility through the contractFacilities join table as well as
      // directly-attached ones. Without this, facilities whose seeded
      // contracts live only on the join get an empty optimizer.
      OR: [
        { facilityId },
        { contractFacilities: { some: { facilityId } } },
      ],
      status: { in: ["active", "expiring"] },
    },
    include: {
      vendor: { select: { name: true } },
      terms: {
        include: {
          tiers: { orderBy: { tierNumber: "asc" } },
        },
      },
      periods: {
        select: { totalSpend: true, tierAchieved: true },
        orderBy: { periodEnd: "desc" },
        take: 4,
      },
    },
  })

  const opportunities: RebateOpportunity[] = []

  // Charles 2026-04-25 (Bug 25): the prior implementation summed
  // `ContractPeriod.totalSpend` over the last 4 periods, which is empty
  // on contracts that haven't generated periods yet (and stale on ones
  // that have). Replace with a trailing-12-month sum from the canonical
  // COG source so this matches the contracts list / detail. Pre-fetch
  // all spend in one grouped query to avoid an N+1 round-trip per
  // contract.
  const trailingStart = new Date()
  trailingStart.setMonth(trailingStart.getMonth() - 12)
  const vendorIds = Array.from(
    new Set(
      contracts.map((c) => c.vendorId).filter((v): v is string => Boolean(v)),
    ),
  )
  const spendRows = vendorIds.length
    ? await prisma.cOGRecord.groupBy({
        by: ["vendorId"],
        where: {
          facilityId,
          vendorId: { in: vendorIds },
          transactionDate: { gte: trailingStart },
        },
        _sum: { extendedPrice: true },
      })
    : []
  const spendByVendor = new Map<string, number>()
  for (const r of spendRows) {
    if (r.vendorId) {
      spendByVendor.set(r.vendorId, Number(r._sum.extendedPrice ?? 0))
    }
  }

  for (const contract of contracts) {
    const currentSpend = contract.vendorId
      ? spendByVendor.get(contract.vendorId) ?? 0
      : 0
    const currentTierAchieved = contract.periods[0]?.tierAchieved ?? 0

    for (const term of contract.terms) {
      if (term.tiers.length < 2) continue

      const currentTierIdx = term.tiers.findIndex(
        (t) => t.tierNumber === currentTierAchieved
      )
      const nextTierIdx = currentTierIdx + 1

      if (nextTierIdx >= term.tiers.length) continue

      const currentTier = term.tiers[currentTierIdx] ?? term.tiers[0]
      const nextTier = term.tiers[nextTierIdx]
      if (!currentTier || !nextTier) continue

      const nextThreshold = Number(nextTier.spendMin)
      const spendGap = Math.max(0, nextThreshold - currentSpend)
      // Charles 2026-04-25 (Bug 25): `ContractTier.rebateValue` is stored
      // as a fraction (0.02 = 2%) but the optimizer math below expects
      // integer percent (the `/100` divisor). Without `toDisplayRebateValue`
      // every projected-rebate number was 100x too small. CLAUDE.md
      // canonical-helpers table marks this as the boundary scaler.
      const currentRebatePercent = toDisplayRebateValue(
        currentTier.rebateType,
        Number(currentTier.rebateValue),
      )
      const nextRebatePercent = toDisplayRebateValue(
        nextTier.rebateType,
        Number(nextTier.rebateValue),
      )

      const projectedAdditionalRebate =
        (nextRebatePercent - currentRebatePercent) * currentSpend / 100

      const percentToNextTier =
        nextThreshold > 0
          ? Math.min(100, (currentSpend / nextThreshold) * 100)
          : 100

      opportunities.push({
        contractId: contract.id,
        contractName: contract.name,
        vendorName: contract.vendor.name,
        currentTier: currentTier.tierNumber,
        nextTier: nextTier.tierNumber,
        currentSpend,
        nextTierThreshold: nextThreshold,
        spendGap,
        projectedAdditionalRebate,
        percentToNextTier,
        currentRebatePercent,
        nextRebatePercent,
      })
    }
  }

  return serialize(opportunities.sort(
    (a, b) => b.projectedAdditionalRebate - a.projectedAdditionalRebate
  ))
}

// ─── Set Spend Target ────────────────────────────────────────────

export async function setSpendTarget(input: {
  contractId: string
  facilityId?: string
  targetSpend: number
  targetDate: string
}): Promise<void> {
  const { facility } = await requireFacility()

  // Use Alert model to persist spend target as metadata (avoids schema migration)
  await prisma.alert.create({
    data: {
      portalType: "facility",
      alertType: "tier_threshold",
      title: `Spend target set`,
      description: `Target: $${input.targetSpend.toLocaleString()} by ${input.targetDate}`,
      severity: "low",
      status: "new_alert",
      contractId: input.contractId,
      facilityId: facility.id,
      metadata: {
        type: "spend_target",
        targetSpend: input.targetSpend,
        targetDate: input.targetDate,
      },
    },
  })
}

// ─── Get Spend Targets ───────────────────────────────────────────

export async function getSpendTargets(_facilityId?: string): Promise<SpendTarget[]> {
  const { facility } = await requireFacility()

  const alerts = await prisma.alert.findMany({
    where: {
      facilityId: facility.id,
      alertType: "tier_threshold",
      status: "new_alert",
    },
    include: {
      contract: {
        select: {
          id: true,
          name: true,
          periods: {
            select: { totalSpend: true },
            orderBy: { periodEnd: "desc" },
            take: 4,
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return serialize(alerts
    .filter((a) => {
      const meta = a.metadata as Record<string, unknown> | null
      return meta?.type === "spend_target" && a.contract
    })
    .map((a) => {
      const meta = a.metadata as Record<string, unknown>
      const currentSpend =
        a.contract?.periods.reduce((s, p) => s + Number(p.totalSpend), 0) ?? 0
      const targetSpend = Number(meta.targetSpend)

      return {
        id: a.id,
        contractId: a.contract!.id,
        contractName: a.contract!.name,
        targetSpend,
        targetDate: String(meta.targetDate),
        currentSpend,
        percentComplete:
          targetSpend > 0
            ? Math.min(100, (currentSpend / targetSpend) * 100)
            : 0,
      }
    }))
}
