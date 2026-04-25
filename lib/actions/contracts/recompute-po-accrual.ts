// Charles audit round-10 BLOCKER: removed "use server" — internal
// helper consumed by recomputeAccrualForContract (which gates auth +
// ownership). Pre-fix the directive auto-registered the export as an
// RPC entry point that any caller could invoke with arbitrary
// contractId/facilityId to delete/insert Rebate rows on a foreign
// tenant.

/**
 * PO rebate accrual writer (Charles 2026-04-25).
 *
 * Counts PurchaseOrder rows attached to the contract (or matching the
 * contract's vendor at the contract's facility) within the term's
 * evaluation period and applies the term's tier ladder, where tier
 * thresholds are PO COUNTS and `rebateValue` is dollars-per-PO at the
 * achieved tier. Mirrors `recompute-volume-accrual.ts` in shape.
 *
 * v1 scope:
 *   - Counts POs whose `vendorId === contract.vendorId` AND
 *     `facilityId === contract's facility scope` AND `orderDate` falls
 *     in the term's evaluation period bucket.
 *   - Status filter: include `submitted | approved | received` (ignore
 *     `draft` and `cancelled`).
 *   - Cumulative or marginal honored from `term.rebateMethod`.
 *   - Idempotent via `[auto-po-accrual] term:<id>` notes prefix.
 *
 * v2 captured in rebate-engine-map.md:
 *   - Per-PO baseline (e.g. "rebate only on POs above $X").
 *   - Multi-vendor / GPO PO aggregation.
 */
import { prisma } from "@/lib/db"
import type { RebateTier } from "@/lib/rebates/engine/types"
import { determineTier } from "@/lib/rebates/engine/shared/determine-tier"

const AUTO_PO_PREFIX = "[auto-po-accrual]"

interface PoRebateTermLike {
  id: string
  rebateMethod: string | null
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

function computePoRebate(
  count: number,
  tiers: RebateTier[],
  method: "cumulative" | "marginal",
): number {
  if (count <= 0 || tiers.length === 0) return 0
  if (method === "marginal") {
    let total = 0
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i]
      if (count <= t.thresholdMin) break
      const next = tiers[i + 1]
      const upper = next ? next.thresholdMin : Infinity
      const inThisTier = Math.max(0, Math.min(count, upper) - t.thresholdMin)
      total += inThisTier * t.rebateValue
    }
    return total
  }
  // cumulative: achieved tier's $/PO × total PO count.
  const achieved = determineTier(count, tiers, "EXCLUSIVE")
  if (!achieved) return 0
  return count * achieved.rebateValue
}

export async function recomputePoAccrualForTerm(input: {
  contractId: string
  vendorId: string
  facilityId: string
  contractEffectiveDate: Date
  contractExpirationDate: Date
  term: PoRebateTermLike
}): Promise<{ inserted: number; sumEarned: number }> {
  const { contractId, vendorId, facilityId, term } = input

  const today = new Date()
  const start = new Date(
    Math.max(
      input.contractEffectiveDate.getTime(),
      term.effectiveStart?.getTime() ?? -Infinity,
    ),
  )
  // Push date-only bounds to end-of-day so a period whose periodEnd
  // is the same calendar day as the contract expiration still counts
  // as in-window (Charles 2026-04-25 — same fix as the threshold
  // and volume writers).
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

  // Load every qualifying PO: matching vendor + facility + within
  // window + countable status. Bucketing into evaluation periods is
  // done in memory below.
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      vendorId,
      facilityId,
      orderDate: { gte: start, lte: end },
      // POStatus enum: draft | pending | approved | sent | completed | cancelled.
      // Count anything that's been acted on (not draft, not cancelled).
      status: { in: ["pending", "approved", "sent", "completed"] },
    },
    select: { id: true, orderDate: true },
  })

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
  const method: "cumulative" | "marginal" =
    term.rebateMethod === "marginal" ? "marginal" : "cumulative"

  // Bucket PO counts by evaluation period.
  const width = widthMonths(term.evaluationPeriod)
  const firstWindowStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  )
  type BucketResult = {
    periodStart: Date
    periodEnd: Date
    count: number
    rebateEarned: number
  }
  const results: BucketResult[] = []
  let cursor = firstWindowStart
  for (let iter = 0; iter < 200; iter++) {
    const next = addMonthsUTC(cursor, width)
    const periodEnd = new Date(next.getTime() - 1)
    if (periodEnd.getTime() > end.getTime()) break
    const count = purchaseOrders.filter((p) => {
      const t = p.orderDate.getTime()
      return t >= cursor.getTime() && t <= periodEnd.getTime()
    }).length
    results.push({
      periodStart: cursor,
      periodEnd,
      count,
      rebateEarned: computePoRebate(count, tiers, method),
    })
    cursor = next
  }

  // Idempotent persist: delete prior auto-po rows for THIS term
  // (preserve user-collected rows via collectionDate filter).
  const termPrefix = `${AUTO_PO_PREFIX} term:${term.id}`
  await prisma.rebate.deleteMany({
    where: {
      contractId,
      collectionDate: null,
      notes: { startsWith: termPrefix },
    },
  })

  let sumEarned = 0
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
    if (r.rebateEarned <= 0 && r.count <= 0) continue
    sumEarned += r.rebateEarned
    toInsert.push({
      contractId,
      facilityId,
      rebateEarned: r.rebateEarned,
      rebateCollected: 0,
      payPeriodStart: r.periodStart,
      payPeriodEnd: r.periodEnd,
      collectionDate: null,
      notes: `${termPrefix} · ${r.count} POs · $${r.rebateEarned.toFixed(2)}`,
    })
  }
  if (toInsert.length > 0) {
    await prisma.rebate.createMany({ data: toInsert, skipDuplicates: true })
  }

  return { inserted: toInsert.length, sumEarned }
}
