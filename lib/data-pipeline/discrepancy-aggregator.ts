/**
 * Data pipeline — price discrepancy aggregator.
 *
 * Pure function: takes a flat array of discrepancy records (either
 * enriched COGRecord rows or InvoicePriceVariance rows) and buckets
 * them into multiple aggregation dimensions for the price-discrepancy
 * report.
 *
 * Reference: docs/superpowers/specs/2026-04-18-data-pipeline-rewrite.md §4.5
 */

export interface DiscrepancyRecord {
  /** "overcharge" | "undercharge" */
  direction: "overcharge" | "undercharge"
  /** Dollars — always non-negative; direction determines bucket. */
  amount: number
  vendorId: string
  vendorName: string
  /** For item-level aggregation. */
  vendorItemNo: string | null
  itemDescription: string | null
  facilityId: string
  facilityName: string
  /** Optional dispute linkage — from Invoice.disputeStatus on the parent invoice. */
  disputeStatus?: "none" | "disputed" | "resolved" | "rejected" | null
}

export interface AggregatedGroup<TKey> {
  key: TKey
  label: string
  overchargeTotal: number
  underchargeTotal: number
  /** Net = overcharge - undercharge (positive = facility lost money net). */
  netTotal: number
  /** Count of discrepancy rows in this group. */
  count: number
}

export interface DiscrepancyReport {
  overall: {
    overchargeTotal: number
    underchargeTotal: number
    recoveryPotential: number // alias for overchargeTotal
    netTotal: number
    count: number
    disputeRollup: {
      none: number
      disputed: number
      resolved: number
      rejected: number
    }
  }
  topVendors: AggregatedGroup<string>[]
  topItems: AggregatedGroup<string>[]
  byFacility: AggregatedGroup<string>[]
}

function bucketByKey<TKey>(
  records: DiscrepancyRecord[],
  keyFn: (r: DiscrepancyRecord) => TKey | null,
  labelFn: (r: DiscrepancyRecord) => string,
): Map<TKey, AggregatedGroup<TKey>> {
  const map = new Map<TKey, AggregatedGroup<TKey>>()
  for (const r of records) {
    const key = keyFn(r)
    if (key === null) continue
    const existing = map.get(key) ?? {
      key,
      label: labelFn(r),
      overchargeTotal: 0,
      underchargeTotal: 0,
      netTotal: 0,
      count: 0,
    }
    if (r.direction === "overcharge") {
      existing.overchargeTotal += r.amount
    } else {
      existing.underchargeTotal += r.amount
    }
    existing.netTotal = existing.overchargeTotal - existing.underchargeTotal
    existing.count += 1
    map.set(key, existing)
  }
  return map
}

/**
 * Aggregate discrepancy records into the report shape used by the
 * price-discrepancy page. Groups: top 20 vendors, top 50 items, all
 * facilities. Sorting: overchargeTotal descending.
 */
export function aggregateDiscrepancies(
  records: DiscrepancyRecord[],
  options?: {
    topVendors?: number
    topItems?: number
  },
): DiscrepancyReport {
  const topVendorCap = options?.topVendors ?? 20
  const topItemCap = options?.topItems ?? 50

  // Overall totals
  let overchargeTotal = 0
  let underchargeTotal = 0
  const disputeRollup = { none: 0, disputed: 0, resolved: 0, rejected: 0 }
  for (const r of records) {
    if (r.direction === "overcharge") overchargeTotal += r.amount
    else underchargeTotal += r.amount
    const ds = r.disputeStatus ?? "none"
    disputeRollup[ds] = (disputeRollup[ds] ?? 0) + 1
  }

  // Per-dimension buckets
  const vendorMap = bucketByKey<string>(
    records,
    (r) => r.vendorId,
    (r) => r.vendorName,
  )
  const itemMap = bucketByKey<string>(
    records,
    (r) => r.vendorItemNo,
    (r) => r.itemDescription ?? r.vendorItemNo ?? "(unknown)",
  )
  const facilityMap = bucketByKey<string>(
    records,
    (r) => r.facilityId,
    (r) => r.facilityName,
  )

  const sortByOvercharge = <TKey>(
    groups: AggregatedGroup<TKey>[],
  ): AggregatedGroup<TKey>[] =>
    [...groups].sort((a, b) => b.overchargeTotal - a.overchargeTotal)

  return {
    overall: {
      overchargeTotal,
      underchargeTotal,
      recoveryPotential: overchargeTotal,
      netTotal: overchargeTotal - underchargeTotal,
      count: records.length,
      disputeRollup,
    },
    topVendors: sortByOvercharge(Array.from(vendorMap.values())).slice(
      0,
      topVendorCap,
    ),
    topItems: sortByOvercharge(Array.from(itemMap.values())).slice(
      0,
      topItemCap,
    ),
    byFacility: sortByOvercharge(Array.from(facilityMap.values())),
  }
}
