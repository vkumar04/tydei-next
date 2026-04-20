/**
 * COG duplicate detection — FULL-KEY rule (Charles W1.W-A2).
 *
 * Pure function — groups `COGRecordForDedup` records into duplicate groups.
 * A row is a duplicate of another ONLY when EVERY business-relevant column
 * is identical. The comparison key is:
 *
 *   inventoryNumber
 *   vendorItemNo        (null compared as its own "bucket")
 *   transactionDate     (day precision, UTC)
 *   quantity
 *   unitCost
 *   extendedPrice       (null compared as its own "bucket")
 *
 * Rationale: Charles W1.W-A flagged the prior algorithm (which treated
 * same-day + same-invNo as a partial match even when qty/price differed)
 * as far too aggressive — routine POs for the same item across a day
 * were being flagged. The new rule collapses to a single match key:
 * `both`. If every compared column matches exactly, the rows are dupes;
 * otherwise they aren't, full stop.
 *
 * The `DuplicateMatchKey` / `isExactMatch` / `partialMatchCount` shape
 * is preserved so callers (duplicate-validator dialog, import preview,
 * dedup-advisor card) keep working. Under the new rule
 * `partialMatchCount` is always zero and every group has
 * `matchKey === "both"` and `isExactMatch === true`.
 *
 * Aligns with canonical COG doc §7 and the W1.W bug-cluster plan
 * `docs/superpowers/plans/2026-04-20-charles-w1w-bug-cluster.md`.
 */

export interface COGRecordForDedup {
  /** Optional — set when comparing new imports against existing rows. */
  id?: string
  inventoryNumber: string
  vendorItemNo: string | null
  transactionDate: Date
  unitCost: number
  quantity: number
  /** Optional; null treated as its own key bucket. */
  extendedPrice?: number | null
  vendorName?: string | null
}

/**
 * Retained for backward compatibility with consumers that branch on
 * match key (`lib/actions/cog-import/dedup-preview.ts`, UI badges). Under
 * the full-key rule only `"both"` is ever emitted.
 */
export type DuplicateMatchKey = "inventory_number" | "vendor_item_no" | "both"

export interface DuplicateGroup {
  /** Key used to group these records. */
  groupKey: string
  matchKey: DuplicateMatchKey
  records: COGRecordForDedup[]
  /**
   * True when EVERY compared field matches. Under the full-key rule this
   * is always true (we don't emit partial groups anymore).
   */
  isExactMatch: boolean
}

export interface DuplicateDetectionReport {
  groups: DuplicateGroup[]
  exactMatchCount: number
  /**
   * Retained for backward compat. Always `0` under the full-key rule —
   * there's no "partial" tier anymore.
   */
  partialMatchCount: number
}

/** Format a Date as YYYY-MM-DD (UTC, via ISO). */
function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Canonical comparison key — every business-relevant column joined with
 * `|`. Null columns collapse to the sentinel `__null__` so they bucket
 * with each other (two rows both missing `vendorItemNo` on the same day
 * with identical qty/price/etc are still duplicates).
 */
function fullKey(record: COGRecordForDedup): string {
  const ext =
    record.extendedPrice === null || record.extendedPrice === undefined
      ? "__null__"
      : String(record.extendedPrice)
  return [
    record.inventoryNumber,
    record.vendorItemNo ?? "__null__",
    dateKey(record.transactionDate),
    String(record.quantity),
    String(record.unitCost),
    ext,
  ].join("|")
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

  const buckets = new Map<string, COGRecordForDedup[]>()
  for (const record of records) {
    const key = fullKey(record)
    const bucket = buckets.get(key) ?? []
    bucket.push(record)
    buckets.set(key, bucket)
  }

  const groups: DuplicateGroup[] = []
  for (const [groupKey, bucket] of buckets) {
    if (bucket.length < 2) continue
    groups.push({
      groupKey,
      matchKey: "both",
      records: bucket,
      isExactMatch: true,
    })
  }

  const sorted = sortGroups(groups)
  const exactMatchCount = sorted.reduce((sum, g) => sum + g.records.length, 0)

  return {
    groups: sorted,
    exactMatchCount,
    partialMatchCount: 0,
  }
}
