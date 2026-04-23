/**
 * Multi-facility rebate rollup + COG dedup confidence.
 * v0 spec from docs/cogs-contracts-multifacility-dedup.md §27-28.
 * Pure functions.
 */

import { calculateCumulative, type TierLike } from "@/lib/rebates/calculate"

/**
 * Multi-facility rebate rollup: sum each facility's spend, evaluate
 * the tier on the combined total (higher tiers via pooled spend), then
 * split the earned rebate back to each facility proportionally.
 */
export interface FacilityRebateAllocation {
  facilityId: string
  spend: number
  sharePct: number
  rebateShare: number
}

export interface MultiFacilityRollupResult {
  totalSpend: number
  totalRebate: number
  achievedTier: number
  perFacility: FacilityRebateAllocation[]
}

export function multiFacilityRebateRollup(
  facilityTotals: Array<{ facilityId: string; spend: number }>,
  tiers: TierLike[],
): MultiFacilityRollupResult {
  const totalSpend = facilityTotals.reduce((s, f) => s + f.spend, 0)
  const result = calculateCumulative(totalSpend, tiers)
  const perFacility = facilityTotals.map((f) => {
    const sharePct = totalSpend > 0 ? (f.spend / totalSpend) * 100 : 0
    return {
      facilityId: f.facilityId,
      spend: f.spend,
      sharePct,
      rebateShare:
        totalSpend > 0 ? result.rebateEarned * (f.spend / totalSpend) : 0,
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
 * COG duplicate-detection confidence (docs §28).
 *   EXACT  — inventoryNumber AND vendorItemNo both match (case-insensitive)
 *   HIGH   — one of the two matches
 *   MEDIUM — neither matches but same vendor + item description + date, different PO
 *   NONE   — no match
 */
export type DedupConfidence = "exact" | "high" | "medium" | "none"

export interface DedupCandidate {
  inventoryNumber: string | null
  vendorItemNo: string | null
  vendorName: string
  itemDescription: string
  date: string // YYYY-MM-DD
  poNumber: string
}

export function dedupConfidence(
  a: DedupCandidate,
  b: DedupCandidate,
): DedupConfidence {
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
