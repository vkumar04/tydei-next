// Charles 2026-04-26 #55 — internal helper consumed by
// recomputeAccrualForContract (which gates auth + ownership).
// No "use server" directive: same convention as po.ts / volume.ts /
// threshold.ts so the helper isn't exposed as an RPC entry point.

/**
 * Carve-out rebate accrual writer.
 *
 * Mirrors po.ts / volume.ts / threshold.ts: bucket purchases into
 * evaluation periods, run the canonical carve-out engine on each
 * bucket, persist a Rebate row per period under
 * `[auto-carve-out-accrual] term:<id>`.
 *
 * Per-line carve-out rates live on `ContractPricing.carveOutPercent`
 * — same source `lib/actions/contracts/carve-out.ts` (the read-only
 * adapter) uses. This writer adds the per-period persistence so the
 * Transactions tab and the dashboard collected/earned aggregates
 * pick the rebate up automatically. Without it, carve-out terms
 * fell through to the spend writer's tier math which ignores the
 * per-line rates entirely.
 *
 * Idempotent via the `[auto-carve-out-accrual] term:<id>` notes
 * prefix. User-collected rows (collectionDate set) are preserved on
 * delete just like every other dispatcher.
 */
import { prisma } from "@/lib/db"
import { calculateCarveOut } from "@/lib/rebates/engine/carve-out"
import type {
  CarveOutConfig,
  PeriodData,
  PurchaseRecord,
} from "@/lib/rebates/engine/types"

const AUTO_CARVE_OUT_PREFIX = "[auto-carve-out-accrual]"

interface CarveOutTermLike {
  id: string
  evaluationPeriod: string | null
  effectiveStart: Date | null
  effectiveEnd: Date | null
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

export async function recomputeCarveOutAccrualForTerm(input: {
  contractId: string
  vendorId: string | null
  facilityId: string
  contractEffectiveDate: Date
  contractExpirationDate: Date
  term: CarveOutTermLike
}): Promise<{ inserted: number; sumEarned: number }> {
  const { contractId, vendorId, facilityId, term } = input

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

  // Pull the per-SKU carve-out rates from ContractPricing. Lines with
  // no carveOutPercent are skipped — they're regular contract pricing,
  // not carve-outs.
  const pricingItems = await prisma.contractPricing.findMany({
    where: { contractId, carveOutPercent: { not: null } },
    select: { vendorItemNo: true, carveOutPercent: true },
  })

  if (pricingItems.length === 0) {
    // Nothing to carve out. Still wipe any prior auto-carve rows so
    // a contract that had carve-out lines and then removed them
    // doesn't keep stale rebates.
    await prisma.rebate.deleteMany({
      where: {
        contractId,
        collectionDate: null,
        notes: { startsWith: `${AUTO_CARVE_OUT_PREFIX} term:${term.id}` },
      },
    })
    return { inserted: 0, sumEarned: 0 }
  }

  const lines: CarveOutConfig["lines"] = pricingItems.map((p) => ({
    referenceNumber: p.vendorItemNo,
    rateType: "PERCENT_OF_SPEND" as const,
    rebatePercent: Number(p.carveOutPercent),
  }))
  const config: CarveOutConfig = { type: "CARVE_OUT", lines }

  // Pull every matched COG record for the contract within the window.
  // Same scoping as the read-only adapter in
  // lib/actions/contracts/carve-out.ts: prefer rows pinned to this
  // contract; fall back to vendor-pinned rows that haven't been
  // contract-matched yet.
  const cogRecords = await prisma.cOGRecord.findMany({
    where: {
      facilityId,
      transactionDate: { gte: start, lte: end },
      OR: [
        { contractId },
        ...(vendorId ? [{ contractId: null, vendorId }] : []),
      ],
      matchStatus: { in: ["on_contract", "price_variance"] },
    },
    select: {
      vendorItemNo: true,
      quantity: true,
      unitCost: true,
      extendedPrice: true,
      transactionDate: true,
      category: true,
    },
  })

  // Bucket COG into evaluation periods.
  const width = widthMonths(term.evaluationPeriod)
  const firstWindowStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  )
  type BucketResult = {
    periodStart: Date
    periodEnd: Date
    rebateEarned: number
    lineCount: number
  }
  const results: BucketResult[] = []
  let cursor = firstWindowStart
  for (let iter = 0; iter < 200; iter++) {
    const next = addMonthsUTC(cursor, width)
    const periodEnd = new Date(next.getTime() - 1)
    if (periodEnd.getTime() > end.getTime()) break

    const periodPurchases: PurchaseRecord[] = cogRecords
      .filter((r) => {
        if (!r.vendorItemNo) return false
        const t = r.transactionDate.getTime()
        return t >= cursor.getTime() && t <= periodEnd.getTime()
      })
      .map((r) => ({
        referenceNumber: r.vendorItemNo as string,
        productCategory: r.category,
        quantity: r.quantity,
        unitPrice: Number(r.unitCost),
        extendedPrice: Number(r.extendedPrice ?? 0),
        purchaseDate: r.transactionDate,
      }))

    const totalSpend = periodPurchases.reduce(
      (s, p) => s + p.extendedPrice,
      0,
    )
    const periodData: PeriodData = {
      purchases: periodPurchases,
      totalSpend,
      periodLabel: null,
    }

    const engineResult = calculateCarveOut(config, periodData)
    results.push({
      periodStart: cursor,
      periodEnd,
      rebateEarned: Number(engineResult.rebateEarned ?? 0),
      lineCount: engineResult.carveOutLines?.length ?? 0,
    })
    cursor = next
  }

  // Idempotent persist.
  const termPrefix = `${AUTO_CARVE_OUT_PREFIX} term:${term.id}`
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
    if (r.rebateEarned <= 0) continue
    sumEarned += r.rebateEarned
    toInsert.push({
      contractId,
      facilityId,
      rebateEarned: r.rebateEarned,
      rebateCollected: 0,
      payPeriodStart: r.periodStart,
      payPeriodEnd: r.periodEnd,
      collectionDate: null,
      notes: `${termPrefix} · ${r.lineCount} carve lines · $${r.rebateEarned.toFixed(2)}`,
    })
  }
  if (toInsert.length > 0) {
    await prisma.rebate.createMany({ data: toInsert, skipDuplicates: true })
  }

  return { inserted: toInsert.length, sumEarned }
}
