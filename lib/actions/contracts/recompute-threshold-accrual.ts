"use server"

/**
 * Threshold-based rebate accrual writer (Charles 2026-04-25).
 *
 * Generic bridge for term types that pay a flat tier rebate when a
 * contract-level metric crosses a threshold. Today this covers:
 *   - `compliance_rebate` — metric is `Contract.complianceRate` (%)
 *   - `market_share`     — metric is `Contract.currentMarketShare` (%)
 *
 * Both share the same shape: tier ladder where `spendMin` is the
 * threshold percent (0-100) and `rebateValue` is the flat dollar
 * amount paid for the evaluation period when that tier is achieved.
 * Cumulative method only — marginal doesn't make sense for a "you
 * either hit the threshold or you don't" payout.
 *
 * v1 scope:
 *   - Reads the contract-level metric value as it exists right now.
 *     Future v2: snapshot the metric per evaluation period from a
 *     compliance / market-share history table once those exist.
 *   - One Rebate row per evaluation period in the contract window.
 *   - Idempotent via `[auto-threshold-accrual] term:<id>` notes prefix.
 */
import { prisma } from "@/lib/db"
import type { RebateTier } from "@/lib/rebates/engine/types"
import { determineTier } from "@/lib/rebates/engine/shared/determine-tier"

const AUTO_THRESHOLD_PREFIX = "[auto-threshold-accrual]"

export type ThresholdMetric = "complianceRate" | "currentMarketShare"

interface ThresholdRebateTermLike {
  id: string
  evaluationPeriod: string | null
  effectiveStart: Date | null
  effectiveEnd: Date | null
  tiers: Array<{
    tierNumber: number
    tierName: string | null
    spendMin: unknown
    spendMax: unknown
    rebateValue: unknown
  }>
}

function widthMonths(eval_: string | null): number {
  switch (eval_) {
    case "monthly":
      return 1
    case "quarterly":
      return 3
    case "semi_annual":
      return 6
    case "annual":
    default:
      return 12
  }
}

function addMonthsUTC(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
}

export async function recomputeThresholdAccrualForTerm(input: {
  contractId: string
  facilityId: string
  contractEffectiveDate: Date
  contractExpirationDate: Date
  metric: ThresholdMetric
  metricValue: number | null
  term: ThresholdRebateTermLike
}): Promise<{ inserted: number; sumEarned: number }> {
  const { contractId, facilityId, term } = input

  // No metric value = no qualification. (e.g. complianceRate is null
  // on contracts where we haven't tracked compliance yet.)
  if (input.metricValue == null || input.metricValue < 0) {
    return { inserted: 0, sumEarned: 0 }
  }

  const today = new Date()
  const start = new Date(
    Math.max(
      input.contractEffectiveDate.getTime(),
      term.effectiveStart?.getTime() ?? -Infinity,
    ),
  )
  // Push date-only bounds to end-of-day so a period whose periodEnd
  // is the same calendar day as the contract/term expiration still
  // counts as in-window. Without this an annual contract from
  // 2025-01-01 through 2025-12-31 emits 0 buckets because
  // periodEnd = 2025-12-31T23:59:59.999 > end = 2025-12-31T00:00:00.
  const endOfDay = (d: Date) =>
    new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    )
  const end = new Date(
    Math.min(
      today.getTime(),
      endOfDay(input.contractExpirationDate).getTime(),
      term.effectiveEnd ? endOfDay(term.effectiveEnd).getTime() : Infinity,
    ),
  )
  if (end.getTime() <= start.getTime()) {
    return { inserted: 0, sumEarned: 0 }
  }

  // Tier ladder: spendMin is the threshold percent (0-100);
  // rebateValue is the flat dollar payment when that tier is achieved.
  const tiers: RebateTier[] = term.tiers
    .map((t) => ({
      tierNumber: t.tierNumber,
      tierName: t.tierName,
      thresholdMin: Number(t.spendMin ?? 0),
      thresholdMax:
        t.spendMax === null || t.spendMax === undefined
          ? null
          : Number(t.spendMax),
      rebateValue: Number(t.rebateValue ?? 0),
    }))
    .sort((a, b) => a.thresholdMin - b.thresholdMin)
  if (tiers.length === 0) return { inserted: 0, sumEarned: 0 }

  const achieved = determineTier(input.metricValue, tiers, "EXCLUSIVE")
  const perPeriodPayment = achieved ? achieved.rebateValue : 0

  // Bucket by evaluation period — one row per closed period inside
  // the contract window.
  const width = widthMonths(term.evaluationPeriod)
  const firstWindowStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  )
  type BucketResult = {
    periodStart: Date
    periodEnd: Date
  }
  const results: BucketResult[] = []
  let cursor = firstWindowStart
  for (let iter = 0; iter < 200; iter++) {
    const next = addMonthsUTC(cursor, width)
    const periodEnd = new Date(next.getTime() - 1)
    if (periodEnd.getTime() > end.getTime()) break
    results.push({ periodStart: cursor, periodEnd })
    cursor = next
  }

  // Idempotent persist
  const termPrefix = `${AUTO_THRESHOLD_PREFIX} term:${term.id}`
  await prisma.rebate.deleteMany({
    where: {
      contractId,
      collectionDate: null,
      notes: { startsWith: termPrefix },
    },
  })

  const toInsert: Array<{
    contractId: string
    facilityId: string
    rebateEarned: number
    rebateCollected: number
    payPeriodStart: Date
    payPeriodEnd: Date
    collectionDate: null
    notes: string
  }> = []
  for (const r of results) {
    if (perPeriodPayment <= 0) continue
    toInsert.push({
      contractId,
      facilityId,
      rebateEarned: perPeriodPayment,
      rebateCollected: 0,
      payPeriodStart: r.periodStart,
      payPeriodEnd: r.periodEnd,
      collectionDate: null,
      notes: `${termPrefix} · ${input.metric}=${input.metricValue.toFixed(1)}% · tier ${achieved?.tierNumber ?? 0} · $${perPeriodPayment.toFixed(2)}`,
    })
  }
  if (toInsert.length > 0) {
    await prisma.rebate.createMany({ data: toInsert, skipDuplicates: true })
  }

  return {
    inserted: toInsert.length,
    sumEarned: perPeriodPayment * toInsert.length,
  }
}
