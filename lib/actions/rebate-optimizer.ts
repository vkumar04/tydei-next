"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"
import { pickThresholdMetric } from "@/lib/contracts/tier-metric"
import { onlySpendTargetAlerts } from "@/lib/alerts/spend-target-filter"
import { getTrailing12MonthWindow } from "@/lib/dates/trailing-window"

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
  // Charles 2026-04-25 v0-port Tier-2: ladder ceiling so the UI can
  // compute rebate utilization without an extra round-trip — actual
  // rebate at currentRebatePercent vs ceiling at topTierRebatePercent.
  topTierRebatePercent: number
  topTierThreshold: number
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
    },
  })

  // Trailing-12-month spend from canonical COG source (single batched groupBy).
  const { start: trailingStart } = getTrailing12MonthWindow()
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

  const opportunities: RebateOpportunity[] = []

  for (const contract of contracts) {
    const currentSpend = contract.vendorId
      ? spendByVendor.get(contract.vendorId) ?? 0
      : 0
    // Charles 2026-05-24 (Bug Cluster B): per-term metric routing. The
    // engine compares against tier.spendMin regardless of term type
    // (column-reuse pattern), but the UNIT of that threshold differs:
    // market_share → percent, volume_rebate → count, etc. Routing each
    // term through pickThresholdMetric eliminates the silent
    // wrong-metric drift that produced Tier 1 in the optimizer while
    // Contract Detail (qualifying by spend) showed Tier 3.
    const metricInputs = {
      currentSpend,
      currentMarketShare:
        contract.currentMarketShare === null ? null : Number(contract.currentMarketShare),
      complianceRate:
        contract.complianceRate === null ? null : Number(contract.complianceRate),
      // currentVolume not on Contract yet — volume terms still fall through
      // to currentSpend until that column exists (separate task).
      currentVolume: null,
    }

    for (const term of contract.terms) {
      if (term.tiers.length < 2) continue

      const metric = pickThresholdMetric(term.termType, metricInputs)

      // Sort tiers by spendMin and pick the highest-qualifying tier.
      const sortedTiers = [...term.tiers].sort(
        (a, b) => Number(a.spendMin) - Number(b.spendMin),
      )

      let currentIdx = -1
      for (let i = 0; i < sortedTiers.length; i++) {
        if (metric >= Number(sortedTiers[i].spendMin)) currentIdx = i
      }

      const nextIdx = currentIdx + 1

      // Bug 2026-05-26 (Vick "No contracts being picked up on the
      // rebate optimizer now"): when every tiered contract a facility
      // has is already at top tier (e.g. S&N at $7.3M trailing spend
      // vs a $2M top threshold), the prior `continue` here dropped
      // them entirely — opportunities ended up empty and the hero
      // rendered "No tiered rebate contracts to optimize yet."
      // contradicting the visible contracts on the page.
      //
      // Push a zero-projection opportunity instead so the contract
      // counts toward stats.contractCount (drives the more honest
      // "Tracking N tiered rebate contracts." copy) and shows up in
      // any "all tracked contracts" surfaces. rankOpportunities
      // downstream already filters projectedAdditionalRebate === 0
      // from the "Top ranked" list, so no false ranking creeps in.
      if (nextIdx >= sortedTiers.length) {
        const topTier = sortedTiers[currentIdx]!
        const topRebatePercent = toDisplayRebateValue(
          topTier.rebateType,
          Number(topTier.rebateValue),
        )
        opportunities.push({
          contractId: contract.id,
          contractName: contract.name,
          vendorName: contract.vendor.name,
          currentTier: topTier.tierNumber,
          nextTier: topTier.tierNumber, // at top — no next
          currentSpend,
          nextTierThreshold: Number(topTier.spendMin),
          spendGap: 0,
          projectedAdditionalRebate: 0,
          percentToNextTier: 100,
          currentRebatePercent: topRebatePercent,
          nextRebatePercent: topRebatePercent,
          topTierRebatePercent: topRebatePercent,
          topTierThreshold: Number(topTier.spendMin),
        })
        continue
      }

      const currentTier = currentIdx >= 0 ? sortedTiers[currentIdx] : null
      const nextTier = sortedTiers[nextIdx]

      const nextThreshold = Number(nextTier.spendMin)
      const metricGap = Math.max(0, nextThreshold - metric)
      // For spend terms this is a dollar gap; for market-share terms it's
      // a percent-points gap. The output field name stays `spendGap` for
      // back-compat with the UI — its UNIT now matches the term's metric.
      const spendGap = metricGap

      const currentRebatePercent = currentTier
        ? toDisplayRebateValue(currentTier.rebateType, Number(currentTier.rebateValue))
        : 0
      const nextRebatePercent = toDisplayRebateValue(
        nextTier.rebateType,
        Number(nextTier.rebateValue),
      )

      const projectedAdditionalRebate =
        ((nextRebatePercent - currentRebatePercent) * currentSpend) / 100

      const percentToNextTier =
        nextThreshold > 0
          ? Math.min(100, (metric / nextThreshold) * 100)
          : 100

      opportunities.push({
        contractId: contract.id,
        contractName: contract.name,
        vendorName: contract.vendor.name,
        currentTier: currentTier?.tierNumber ?? 0,
        nextTier: nextTier.tierNumber,
        currentSpend,
        nextTierThreshold: nextThreshold,
        spendGap,
        projectedAdditionalRebate,
        percentToNextTier,
        currentRebatePercent,
        nextRebatePercent,
        topTierRebatePercent: (() => {
          const top = sortedTiers[sortedTiers.length - 1]
          return top
            ? toDisplayRebateValue(top.rebateType, Number(top.rebateValue))
            : nextRebatePercent
        })(),
        topTierThreshold: Number(
          sortedTiers[sortedTiers.length - 1]?.spendMin ?? nextThreshold,
        ),
      })
    }
  }

  return serialize(
    opportunities.sort(
      (a, b) => b.projectedAdditionalRebate - a.projectedAdditionalRebate,
    ),
  )
}

// ─── Set Spend Target ────────────────────────────────────────────

export async function setSpendTarget(input: {
  contractId: string
  facilityId?: string
  targetSpend: number
  targetDate: string
}): Promise<void> {
  const { facility } = await requireFacility()
  await requireCanMutate()

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

  // 2026-06-09 audit H5: match on the metadata discriminator in SQL and
  // WITHOUT a status constraint. Spend targets live in the Alert table
  // (schema-migration dodge, see setSpendTarget above); the previous
  // `status: "new_alert"` filter meant any alert-surface mark-read /
  // resolve / dismiss silently DELETED the target from this page. Alert
  // reads now exclude `metadata.type === "spend_target"` rows entirely
  // (lib/alerts/spend-target-filter.ts), and this reader is the inverse.
  const alerts = await prisma.alert.findMany({
    where: {
      facilityId: facility.id,
      alertType: "tier_threshold",
      ...onlySpendTargetAlerts(),
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
