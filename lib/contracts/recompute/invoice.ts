/**
 * Charles audit round-10 BLOCKER: removed "use server" — this
 * module's exports are internal helpers consumed by
 * recomputeAccrualForContract (which authenticates + verifies
 * ownership). Pre-fix the "use server" directive auto-exposed
 * recomputeInvoiceAccrualForTerm as an RPC entry point that any
 * caller could invoke with arbitrary contractId/facilityId/vendorId
 * to delete/insert Rebate rows on a foreign tenant.
 */

/**
 * Invoice rebate accrual writer (Charles 2026-04-25).
 *
 * Per-invoice rebate counted against Invoice rows tied to the
 * contract's vendor. Mirrors `recompute-po-accrual.ts` in shape but
 * counts invoices instead of POs. Used by `payment_rebate` term
 * type — facility receives a per-invoice rebate when the invoice
 * count crosses the tier threshold within an evaluation period.
 *
 * v1 scope:
 *   - Counts Invoice rows whose `vendorId === contract.vendorId` AND
 *     `facilityId === contract's facility scope` AND `invoiceDate`
 *     falls in the term's evaluation period bucket.
 *   - Status filter: include `paid` and `pending` (skip `disputed` /
 *     `cancelled` if they exist as statuses; `Invoice.status` is a
 *     free-form String today, so we accept anything that isn't
 *     explicitly "cancelled").
 *   - Cumulative or marginal honored from `term.rebateMethod`.
 *   - Idempotent via `[auto-invoice-accrual] term:<id>` notes prefix.
 *
 * v2 captured in rebate-engine-map.md:
 *   - On-time payment threshold (Invoice schema would need a paidDate
 *     field). Today we count any non-cancelled invoice as eligible.
 *   - Per-invoice baseline (e.g. "rebate only on invoices above $X").
 */
import { prisma } from "@/lib/db"
import type { RebateTier } from "@/lib/rebates/engine/types"
import { determineTier } from "@/lib/rebates/engine/shared/determine-tier"

// bugs.rtfd 2026-06-12 R1: prefix now lives in the shared family
// module so recomputeAccrualForContract's upfront wipe can cover
// every writer's rows (term-type edits left the prior writer's
// rows immortal — volume math 38,775 + stale 26,751 = 65,526).
import { AUTO_INVOICE_PREFIX } from "@/lib/contracts/recompute/auto-accrual-prefixes"

interface InvoiceRebateTermLike {
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

function endOfDay(d: Date): Date {
  return new Date(
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
}

// TODO (Charles canonical engine wiring 2026-05-05): the canonical
// `calculateRebate(VOLUME_REBATE)` engine treats `rebateValue` as
// percent and divides by 100; invoice tiers store dollars-per-invoice.
// Wiring requires an engine semantic flag or a per-tier scaling pass.
// Skipped per "DO NOT change engine math; just call it." See audit
// gap #1 in docs/superpowers/audits/2026-05-04-vendor-rebate-audit.md.
function computeInvoiceRebate(
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
  const achieved = determineTier(count, tiers, "EXCLUSIVE")
  if (!achieved) return 0
  return count * achieved.rebateValue
}

export async function recomputeInvoiceAccrualForTerm(input: {
  contractId: string
  vendorId: string
  /** #2: full vendor set for grouped contracts; falls back to [vendorId]. */
  vendorIds?: string[]
  facilityId: string
  contractEffectiveDate: Date
  contractExpirationDate: Date
  /**
   * Bug #16 (2026-05-24): when the parent contract is tie-in, every
   * auto-accrual row is system-stamped with collectionDate = periodEnd
   * (no user-collect workflow exists for tie-in). Set this true so the
   * delete filter wipes ALL auto-accrual rows for this term — not just
   * uncollected ones. Without this, Recompute is non-idempotent.
   */
  isTieIn?: boolean
  term: InvoiceRebateTermLike
}): Promise<{ inserted: number; sumEarned: number }> {
  const { contractId, vendorId, facilityId, term, isTieIn } = input
  const vendorIds = input.vendorIds ?? (vendorId ? [vendorId] : [])

  const today = new Date()
  const start = new Date(
    Math.max(
      input.contractEffectiveDate.getTime(),
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

  // Load qualifying invoices: matching vendor + facility + within
  // window. Skip explicitly-cancelled ones; accept anything else as
  // eligible (Invoice.status is a free-form String).
  const invoices = await prisma.invoice.findMany({
    where: {
      vendorId: { in: vendorIds },
      facilityId,
      invoiceDate: { gte: start, lte: end },
      NOT: { status: "cancelled" },
    },
    select: { id: true, invoiceDate: true },
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

  // Bucket invoice counts by evaluation period.
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
    const count = invoices.filter((p) => {
      const t = p.invoiceDate.getTime()
      return t >= cursor.getTime() && t <= periodEnd.getTime()
    }).length
    results.push({
      periodStart: cursor,
      periodEnd,
      count,
      rebateEarned: computeInvoiceRebate(count, tiers, method),
    })
    cursor = next
  }

  // Idempotent persist
  const termPrefix = `${AUTO_INVOICE_PREFIX} term:${term.id}`
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
    if (r.rebateEarned <= 0 && r.count <= 0) continue
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
      notes: `${termPrefix} · ${r.count} invoices · $${r.rebateEarned.toFixed(2)}`,
    })
  }
  if (toInsert.length > 0) {
    await prisma.rebate.createMany({ data: toInsert, skipDuplicates: true })
  }

  return { inserted: toInsert.length, sumEarned }
}
