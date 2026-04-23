/**
 * v0 spec — Multi-facility contract rollup + COG dedup.
 * Source: docs/cogs-contracts-multifacility-dedup.md §27-28.
 */
import { v0Cumulative, type V0Tier } from "./rebate-math"

/**
 * Multi-facility rebate rollup: sum spend across all in-scope facilities,
 * evaluate the tier on the combined total, then split the earned rebate
 * back to each facility by its spend share.
 *
 * Doc example: 4-hospital system, $1M combined spend, tier 3 @ 4% →
 *   $40,000 rebate; shares 50/30/20/0 → $20k / $12k / $8k / $0.
 */
export interface V0FacilitySpendAllocation {
  facilityId: string
  spend: number
  sharePct: number
  rebateShare: number
}
export interface V0MultiFacilityRollup {
  totalSpend: number
  totalRebate: number
  achievedTier: number
  perFacility: V0FacilitySpendAllocation[]
}
export function v0MultiFacilityRebateRollup(
  facilityTotals: Array<{ facilityId: string; spend: number }>,
  tiers: V0Tier[],
): V0MultiFacilityRollup {
  const totalSpend = facilityTotals.reduce((s, f) => s + f.spend, 0)
  const result = v0Cumulative(totalSpend, tiers)
  const perFacility = facilityTotals.map((f) => {
    const sharePct = totalSpend > 0 ? (f.spend / totalSpend) * 100 : 0
    return {
      facilityId: f.facilityId,
      spend: f.spend,
      sharePct,
      rebateShare: result.rebateEarned * (totalSpend > 0 ? f.spend / totalSpend : 0),
    }
  })
  return {
    totalSpend,
    totalRebate: result.rebateEarned,
    achievedTier: result.tierAchieved,
    perFacility,
  }
}

/**
 * COG duplicate-detection confidence (v0 multi-facility-dedup §28).
 *   EXACT  — inventoryNumber AND vendorItemNo both match (case-insensitive)
 *   HIGH   — one of the two matches
 *   MEDIUM — neither matches but same vendor + same item description + same date (different PO)
 *   NONE   — no match at all
 */
export type V0DedupConfidence = "exact" | "high" | "medium" | "none"
export interface V0DedupCandidate {
  inventoryNumber: string | null
  vendorItemNo: string | null
  vendorName: string
  itemDescription: string
  date: string // YYYY-MM-DD
  poNumber: string
}

export function v0DedupConfidence(
  a: V0DedupCandidate,
  b: V0DedupCandidate,
): V0DedupConfidence {
  const norm = (s: string | null) => (s ?? "").toLowerCase().trim()
  const invMatch =
    !!a.inventoryNumber &&
    !!b.inventoryNumber &&
    norm(a.inventoryNumber) === norm(b.inventoryNumber)
  const itemMatch =
    !!a.vendorItemNo &&
    !!b.vendorItemNo &&
    norm(a.vendorItemNo) === norm(b.vendorItemNo)
  if (invMatch && itemMatch) return "exact"
  if (invMatch || itemMatch) return "high"
  if (
    norm(a.vendorName) === norm(b.vendorName) &&
    norm(a.itemDescription) === norm(b.itemDescription) &&
    a.date === b.date &&
    a.poNumber !== b.poNumber
  ) {
    return "medium"
  }
  return "none"
}
