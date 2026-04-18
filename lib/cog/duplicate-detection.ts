/**
 * COG duplicate detection.
 *
 * Pure function — groups `COGRecordForDedup` records into duplicate groups
 * using a two-dimensional match: (`inventoryNumber`, `vendorItemNo`, date)
 * for EXACT matches ("both") and either identifier individually (paired with
 * date) for PARTIAL matches.
 *
 * Aligns with canonical COG doc §7 and spec
 * `docs/superpowers/specs/2026-04-18-cog-data-rewrite.md` §4.4 (Subsystem 4).
 *
 * Algorithm:
 *   1. Bucket every record by `(inventoryNumber, vendorItemNo, date-only)`.
 *      Any bucket with 2+ records is an EXACT ("both") duplicate group.
 *      Every record in a "both" group is removed from further consideration.
 *   2. For the remaining records:
 *      a. Bucket by `(inventoryNumber, date-only)` → `inventory_number` partial.
 *      b. Bucket by `(vendorItemNo, date-only)` → `vendor_item_no` partial.
 *         Records with `vendorItemNo === null` are skipped in step (b).
 *   3. A record participates in at most one group. When step (2a) and step
 *      (2b) would both claim a record, step (2a) (inventory_number) wins;
 *      the "both" group from step (1) always wins over either partial.
 *
 * Output:
 *   - `groups` — sorted by record count desc, then `groupKey` alphabetical.
 *   - `exactMatchCount` — total records across all "both" groups.
 *   - `partialMatchCount` — total records across all `inventory_number` and
 *     `vendor_item_no` groups.
 *
 * NOTE: This module is consumed by `components/facility/cog/duplicate-validator.tsx`
 * (audit + refine per subsystem 4) and by the import pipeline's pre-persist
 * duplicate pass. It has no side effects and no Prisma dependency so it is
 * trivially unit-testable.
 */

export interface COGRecordForDedup {
  /** Optional — set when comparing new imports against existing rows. */
  id?: string
  inventoryNumber: string
  vendorItemNo: string | null
  transactionDate: Date
  unitCost: number
  quantity: number
  vendorName?: string | null
}

export type DuplicateMatchKey = "inventory_number" | "vendor_item_no" | "both"

export interface DuplicateGroup {
  /** Key used to group these records. */
  groupKey: string
  matchKey: DuplicateMatchKey
  records: COGRecordForDedup[]
  /**
   * True when EVERY field matches exactly (full dup); false when only one
   * of `inventoryNumber` / `vendorItemNo` matched.
   */
  isExactMatch: boolean
}

export interface DuplicateDetectionReport {
  groups: DuplicateGroup[]
  exactMatchCount: number
  partialMatchCount: number
}

/** Format a Date as YYYY-MM-DD (UTC, via ISO). */
function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Stable per-record identity for tracking "already claimed" without `id`. */
function recordIdentity(
  record: COGRecordForDedup,
  index: number,
): string {
  return record.id ?? `__idx_${index}`
}

function bucketBy<T>(
  items: readonly T[],
  keyFn: (item: T) => string | null,
): Map<string, T[]> {
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    if (key === null) continue
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
    }
    bucket.push(item)
  }
  return buckets
}

function sortGroups(groups: DuplicateGroup[]): DuplicateGroup[] {
  return [...groups].sort((a, b) => {
    if (b.records.length !== a.records.length) {
      return b.records.length - a.records.length
    }
    return a.groupKey.localeCompare(b.groupKey)
  })
}

export function detectDuplicates(
  records: COGRecordForDedup[],
): DuplicateDetectionReport {
  if (records.length === 0) {
    return { groups: [], exactMatchCount: 0, partialMatchCount: 0 }
  }

  // Tag each record with a stable identity so we can track group membership
  // without mutating the input.
  const tagged = records.map((record, index) => ({
    record,
    identity: recordIdentity(record, index),
  }))

  const claimed = new Set<string>()
  const groups: DuplicateGroup[] = []

  // 1. EXACT ("both") groups — (inventoryNumber, vendorItemNo, date)
  const exactBuckets = bucketBy(tagged, ({ record }) => {
    return [
      record.inventoryNumber,
      record.vendorItemNo ?? "__null__",
      dateKey(record.transactionDate),
    ].join("|")
  })

  for (const [groupKey, bucket] of exactBuckets) {
    if (bucket.length < 2) continue
    groups.push({
      groupKey,
      matchKey: "both",
      records: bucket.map((t) => t.record),
      isExactMatch: true,
    })
    for (const t of bucket) claimed.add(t.identity)
  }

  const remaining = tagged.filter((t) => !claimed.has(t.identity))

  // 2a. Partial groups — (inventoryNumber, date)
  const invBuckets = bucketBy(remaining, ({ record }) => {
    return [record.inventoryNumber, dateKey(record.transactionDate)].join("|")
  })

  for (const [groupKey, bucket] of invBuckets) {
    if (bucket.length < 2) continue
    groups.push({
      groupKey,
      matchKey: "inventory_number",
      records: bucket.map((t) => t.record),
      isExactMatch: false,
    })
    for (const t of bucket) claimed.add(t.identity)
  }

  const stillRemaining = remaining.filter((t) => !claimed.has(t.identity))

  // 2b. Partial groups — (vendorItemNo, date); skip null vendorItemNo.
  const vinBuckets = bucketBy(stillRemaining, ({ record }) => {
    if (record.vendorItemNo === null) return null
    return [record.vendorItemNo, dateKey(record.transactionDate)].join("|")
  })

  for (const [groupKey, bucket] of vinBuckets) {
    if (bucket.length < 2) continue
    groups.push({
      groupKey,
      matchKey: "vendor_item_no",
      records: bucket.map((t) => t.record),
      isExactMatch: false,
    })
    for (const t of bucket) claimed.add(t.identity)
  }

  const sorted = sortGroups(groups)

  let exactMatchCount = 0
  let partialMatchCount = 0
  for (const group of sorted) {
    if (group.matchKey === "both") {
      exactMatchCount += group.records.length
    } else {
      partialMatchCount += group.records.length
    }
  }

  return {
    groups: sorted,
    exactMatchCount,
    partialMatchCount,
  }
}
