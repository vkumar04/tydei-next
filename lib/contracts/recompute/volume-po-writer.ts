// Charles audit round-10 BLOCKER: removed "use server" — internal
// helper consumed by recomputeAccrualForContract. Do NOT add the
// directive to this module.

import { prisma } from "@/lib/db"
import { AUTO_VOLUME_PREFIX } from "@/lib/contracts/recompute/auto-accrual-prefixes"
import {
  loadPreservedCollectedPeriods,
  periodKey,
} from "@/lib/contracts/recompute/preserved-collected"
import type { VolumeRebateTermLike } from "@/lib/contracts/recompute/volume-shared"
import {
  addMonthsUTC,
  endOfDay,
  termVendorIds,
  widthMonths,
} from "@/lib/contracts/recompute/volume-shared"

/**
 * Bug 2026-05-20 (Vick): purchase_order baseline writer.
 *
 * Counts distinct PurchaseOrder rows for the contract's vendor at this
 * facility, bucketed by `orderDate` into the term's evaluation period,
 * then runs each bucket's PO count through the tier ladder. Mirrors
 * the COG-records writer's bucket → tier-pick → reward shape so the
 * three volume paths (CPT procedures, COG units, POs) share semantics.
 *
 * Reward types behave the same as the CPT/COG paths:
 *   - percent_of_spend → bucket spend × rebateValue (fraction)
 *   - fixed_rebate     → flat rebateValue dollars per qualifying period
 *   - fixed_rebate_per_unit / per_procedure_rebate → poCount × rebateValue
 */
export async function recomputeVolumeFromPurchaseOrders(input: {
  contractId: string
  facilityId: string
  contractEffectiveDate: Date
  contractExpirationDate: Date
  isTieIn?: boolean
  term: VolumeRebateTermLike
}): Promise<{ inserted: number; sumEarned: number }> {
  const { contractId, facilityId, contractEffectiveDate, term, isTieIn } = input
  // bugs.rtfd 2026-06-11 A5: same group-vendor-drift gate fix as the COG
  // fallback — bail only when the effective vendor set is empty.
  const vendorIds = termVendorIds(term)
  if (vendorIds.length === 0) {
    return { inserted: 0, sumEarned: 0 }
  }

  const today = new Date()
  const start = new Date(
    Math.max(
      contractEffectiveDate.getTime(),
      term.effectiveStart?.getTime() ?? -Infinity,
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

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      facilityId,
      vendorId: { in: vendorIds },
      orderDate: { gte: start, lte: end },
    },
    select: {
      id: true,
      orderDate: true,
      totalAmount: true,
    },
  })

  const width = widthMonths(term.evaluationPeriod)
  const firstWindowStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  )
  type Bucket = {
    periodStart: Date
    periodEnd: Date
    poCount: number
    spendSum: number
  }
  const bucketMap = new Map<string, Bucket>()
  for (const po of pos) {
    if (!po.orderDate) continue
    const monthsFromStart =
      (po.orderDate.getUTCFullYear() - firstWindowStart.getUTCFullYear()) * 12 +
      (po.orderDate.getUTCMonth() - firstWindowStart.getUTCMonth())
    const periodIndex = Math.floor(monthsFromStart / width)
    const periodStart = addMonthsUTC(firstWindowStart, periodIndex * width)
    const periodEnd = new Date(addMonthsUTC(periodStart, width).getTime() - 1)
    const key = periodStart.toISOString()
    const bucket = bucketMap.get(key) ?? {
      periodStart,
      periodEnd,
      poCount: 0,
      spendSum: 0,
    }
    bucket.poCount += 1
    bucket.spendSum += Number(po.totalAmount ?? 0)
    bucketMap.set(key, bucket)
  }
  const buckets = Array.from(bucketMap.values()).sort(
    (a, b) => a.periodStart.getTime() - b.periodStart.getTime(),
  )

  // Decomposition 2026-08-05: this inline normalizer LOOKS like
  // `normalizeVolumeTiers` (volume-tier-math.ts) but is intentionally
  // kept as this path's own copy — moved verbatim, do not consolidate.
  type SortedTier = {
    tierNumber: number
    tierName: string | null
    thresholdMin: number
    thresholdMax: number | null
    rebateValue: number
    rebateType: string | null
  }
  const sortedTiers: SortedTier[] = term.tiers
    .map((t) => {
      const tVolMin = (t as unknown as { volumeMin?: number | null }).volumeMin
      const tVolMax = (t as unknown as { volumeMax?: number | null }).volumeMax
      const thresholdMin =
        tVolMin != null && Number.isFinite(Number(tVolMin))
          ? Number(tVolMin)
          : Number(t.spendMin ?? 0)
      const thresholdMax =
        tVolMax != null && Number.isFinite(Number(tVolMax))
          ? Number(tVolMax)
          : t.spendMax === null || t.spendMax === undefined
            ? null
            : Number(t.spendMax)
      return {
        tierNumber: t.tierNumber,
        tierName: t.tierName,
        thresholdMin,
        thresholdMax,
        rebateValue: Number(t.rebateValue ?? 0),
        rebateType: t.rebateType ?? null,
      }
    })
    .sort((a, b) => a.thresholdMin - b.thresholdMin)

  type BucketResult = {
    periodStart: Date
    periodEnd: Date
    poCount: number
    rebateEarned: number
  }
  const results: BucketResult[] = buckets.map((b) => {
    let achieved: SortedTier | null = null
    for (const t of sortedTiers) {
      if (b.poCount >= t.thresholdMin) {
        const ceilingOk =
          t.thresholdMax == null || b.poCount < t.thresholdMax
        if (ceilingOk) achieved = t
        else if (achieved == null) achieved = t
      }
    }
    if (!achieved) {
      return {
        periodStart: b.periodStart,
        periodEnd: b.periodEnd,
        poCount: b.poCount,
        rebateEarned: 0,
      }
    }
    let rebate = 0
    switch (achieved.rebateType) {
      case "percent_of_spend":
        rebate = b.spendSum * achieved.rebateValue
        break
      case "fixed_rebate":
        rebate = achieved.rebateValue
        break
      case "fixed_rebate_per_unit":
      case "per_procedure_rebate":
      default:
        rebate = b.poCount * achieved.rebateValue
        break
    }
    return {
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
      poCount: b.poCount,
      rebateEarned: rebate,
    }
  })

  const termPrefix = `${AUTO_VOLUME_PREFIX} term:${term.id}`
  await prisma.rebate.deleteMany({
    where: {
      contractId,
      notes: { startsWith: termPrefix },
      // Bug #16: tie-in contracts auto-stamp collectionDate, so the
      // collectionDate=null gate would never match. Drop the gate when
      // the parent contract is tie-in.
      ...(isTieIn ? {} : { collectionDate: null }),
    },
  })

  // Windows already covered by a COLLECTED row. Those rows survive the delete
  // above (it spares collectionDate != null), so re-inserting their window
  // duplicates them permanently — 2026-07-29 math audit.
  const preservedCollected = await loadPreservedCollectedPeriods(
    contractId,
    termPrefix,
    isTieIn,
  )

  let sumEarned = 0
  const toInsert: Array<{
    contractId: string
    facilityId: string
    rebateEarned: number
    rebateCollected: number
    payPeriodStart: Date
    payPeriodEnd: Date
    collectionDate: Date | null
    notes: string
  }> = []
  for (const r of results) {
    if (r.rebateEarned <= 0 && r.poCount <= 0) continue
    // Skip a window a COLLECTED row already covers — see the load above.
    if (preservedCollected.has(periodKey(r.periodStart, r.periodEnd))) continue
    sumEarned += r.rebateEarned
    toInsert.push({
      contractId,
      facilityId,
      rebateEarned: r.rebateEarned,
      // See carve-out.ts:248 — tie-in auto-stamps collectionDate at
      // accrual so the rebate flows into "applied to capital".
      rebateCollected: isTieIn ? r.rebateEarned : 0,
      payPeriodStart: r.periodStart,
      payPeriodEnd: r.periodEnd,
      collectionDate: isTieIn ? r.periodEnd : null,
      notes: `${termPrefix} · ${r.poCount} POs · $${r.rebateEarned.toFixed(2)}`,
    })
  }
  if (toInsert.length > 0) {
    await prisma.rebate.createMany({ data: toInsert, skipDuplicates: true })
  }

  return { inserted: toInsert.length, sumEarned }
}
