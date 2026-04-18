/**
 * Pure per-ContractPeriod aggregation helper.
 *
 * Given a flat list of purchases (COG records) and a set of contract-period
 * definitions (with inclusive start/end dates), this module buckets purchases
 * into their owning period and computes the aggregates that the existing
 * `ContractPeriod` schema persists:
 *
 *   - totalSpend              — sum of extendedPrice
 *   - totalQuantity           — sum of quantity
 *   - uniqueCptOccurrences    — count of distinct (case+cpt) occurrences, used
 *                               by the volume-rebate engine to avoid
 *                               double-counting the same CPT on the same case
 *   - purchaseCount           — number of purchase rows in the bucket
 *
 * ─── Conventions ────────────────────────────────────────────────────
 *
 *   - Period windows are INCLUSIVE on both ends (periodStart <= d <= periodEnd).
 *   - Purchases whose `transactionDate` falls in no period are silently dropped.
 *     A single purchase can only fall in one period because well-formed contract
 *     periods do not overlap; if they do overlap the first matching period (by
 *     input order) wins.
 *   - The returned array preserves the input period order.
 *
 * This module is pure. No DB, no I/O. It intentionally does not know about
 * rebate method, tier curves, or contract terms — those are layered on top.
 */

export interface PeriodDefinition {
  id: string
  periodNumber: number
  periodStart: Date
  periodEnd: Date
}

export interface PurchaseForAggregation {
  transactionDate: Date
  extendedPrice: number
  quantity: number
  cptCode?: string | null
  caseId?: string | null
}

export interface AggregatedPeriod {
  periodId: string
  periodNumber: number
  periodStart: Date
  periodEnd: Date
  totalSpend: number
  totalQuantity: number
  /** Distinct (case+cpt else date+cpt) occurrences — for volume rebate dedup. */
  uniqueCptOccurrences: number
  purchaseCount: number
}

interface PeriodAccumulator {
  def: PeriodDefinition
  totalSpend: number
  totalQuantity: number
  purchaseCount: number
  cptKeys: Set<string>
}

/**
 * Bucket purchases into contract periods and compute per-period aggregates.
 *
 * Purchases outside every period are silently dropped. The dedup key for
 * `uniqueCptOccurrences` prefers `caseId+cptCode` when a caseId is present and
 * falls back to ISO-date+cptCode otherwise (so same-day repeats of the same
 * CPT without a case anchor are still treated as one occurrence).
 */
export function aggregatePurchasesByPeriod(input: {
  periods: readonly PeriodDefinition[]
  purchases: readonly PurchaseForAggregation[]
}): AggregatedPeriod[] {
  const accumulators: PeriodAccumulator[] = input.periods.map((def) => ({
    def,
    totalSpend: 0,
    totalQuantity: 0,
    purchaseCount: 0,
    cptKeys: new Set<string>(),
  }))

  for (const purchase of input.purchases) {
    const bucket = findBucket(accumulators, purchase.transactionDate)
    if (bucket === null) continue

    bucket.totalSpend += purchase.extendedPrice
    bucket.totalQuantity += purchase.quantity
    bucket.purchaseCount += 1

    const cpt = purchase.cptCode
    if (cpt !== null && cpt !== undefined && cpt !== "") {
      const anchor =
        purchase.caseId !== null && purchase.caseId !== undefined && purchase.caseId !== ""
          ? `case:${purchase.caseId}`
          : `date:${isoDay(purchase.transactionDate)}`
      bucket.cptKeys.add(`${anchor}|${cpt}`)
    }
  }

  return accumulators.map((a) => ({
    periodId: a.def.id,
    periodNumber: a.def.periodNumber,
    periodStart: a.def.periodStart,
    periodEnd: a.def.periodEnd,
    totalSpend: a.totalSpend,
    totalQuantity: a.totalQuantity,
    uniqueCptOccurrences: a.cptKeys.size,
    purchaseCount: a.purchaseCount,
  }))
}

function findBucket(
  accumulators: readonly PeriodAccumulator[],
  d: Date,
): PeriodAccumulator | null {
  const t = d.getTime()
  for (const a of accumulators) {
    if (t >= a.def.periodStart.getTime() && t <= a.def.periodEnd.getTime()) {
      return a
    }
  }
  return null
}

function isoDay(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0")
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0")
  const dd = d.getUTCDate().toString().padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}
