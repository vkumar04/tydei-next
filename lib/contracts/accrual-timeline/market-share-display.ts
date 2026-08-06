/**
 * Market-share display overlay for the accrual timeline. Moved verbatim
 * from `lib/actions/contracts/accrual.ts` (2026-08-05 decomposition).
 */
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { resolveOverlayTierRate } from "@/lib/contracts/tier-rebate-label"
// bugs.rtfd 2026-06-13 M: the threshold writer's window grid + per-period
// market-share computation, exported so the timeline shows the SAME share
// the writer pays on — including below-threshold windows the writer never
// persists ($0 payment rows are skipped by its `periodPayment <= 0` gate).
import {
  buildThresholdEvaluationWindows,
  computePerPeriodMarketShare,
} from "@/lib/contracts/recompute/threshold"
import { determineTier } from "@/lib/rebates/engine/shared/determine-tier"
import type { RebateTier } from "@/lib/rebates/engine/types"
import type { AccrualContract } from "./types"

/**
 * bugs.rtfd 2026-06-13 M: per-evaluation-window market share for the
 * timeline display (both the early overlay-only path and the normal walk
 * path), computed through the threshold WRITER's own exported helpers —
 * `buildThresholdEvaluationWindows` for the window grid (same clamps,
 * same anchoring) and `computePerPeriodMarketShare` for the share itself
 * (group-aware vendor union ÷ facility union across the SAME canonical
 * category variants — multi-category terms use COMBINED spend on both
 * sides, never a per-category average). Display only: writes nothing.
 *
 * The tier per window comes from the writer's same bridge —
 * `determineTier` over `spendMin`→`thresholdMin` PERCENT points (0-100,
 * the threshold-units rule) — and the rate from the achieved tier via
 * `resolveOverlayTierRate` (tier 0 → 0 → the UI's "—").
 */
export type MarketShareDisplayData = {
  /** YYYY-MM → share (%) of the evaluation window the month belongs to. */
  shareByMonth: Map<string, number>
  /** One entry per evaluation window: its display end month (natural
   * period end clamped to the horizon) + share-derived tier/rate. */
  windowEnds: Array<{
    termId: string
    month: string
    share: number
    tierAchieved: number
    rebatePercent: number
  }>
}

export async function computeMarketShareDisplayForContract(
  contract: AccrualContract,
  facilityId: string,
): Promise<MarketShareDisplayData | null> {
  const msTerms = contract.terms.filter(
    (t) => t.termType === "market_share" && t.tiers.length > 0,
  )
  if (msTerms.length === 0) return null
  const vendorIds = contractVendorIds(contract)
  if (vendorIds.length === 0) return null

  const shareByMonth = new Map<string, number>()
  const windowEnds: MarketShareDisplayData["windowEnds"] = []
  for (const term of msTerms) {
    const grid = buildThresholdEvaluationWindows({
      contractEffectiveDate: contract.effectiveDate,
      contractExpirationDate: contract.expirationDate,
      effectiveStart: term.effectiveStart ?? null,
      effectiveEnd: term.effectiveEnd ?? null,
      evaluationPeriod: term.evaluationPeriod ?? null,
    })
    if (!grid) continue
    // Closed windows (the writer's buckets) + the currently-running tail
    // window when it has started — its share is the to-date share (the
    // helper's COG queries are clamped at grid.end).
    const windows = [...grid.windows]
    if (
      grid.openTail &&
      grid.openTail.periodStart.getTime() <= grid.end.getTime()
    ) {
      windows.push(grid.openTail)
    }
    if (windows.length === 0) continue
    // Same category scoping the threshold dispatcher feeds the writer
    // (`recompute-accrual.ts`): explicit term categories, else the
    // contract's product category name.
    const scopedCategoryNames =
      term.appliesTo === "specific_category" &&
      Array.isArray(term.categories) &&
      term.categories.length > 0
        ? Array.from(new Set(term.categories))
        : contract.productCategory?.name
          ? [contract.productCategory.name]
          : []
    const windowShares = await computePerPeriodMarketShare({
      facilityId,
      vendorIds,
      scopedCategoryNames,
      windows,
      queryStart: grid.start,
      queryEnd: grid.end,
    })
    const thresholdTiers: RebateTier[] = term.tiers.map((t) => ({
      tierNumber: t.tierNumber,
      tierName: t.tierName ?? null,
      thresholdMin: Number(t.spendMin ?? 0),
      thresholdMax:
        t.spendMax === null || t.spendMax === undefined
          ? null
          : Number(t.spendMax),
      // Unused for tier SELECTION; the display rate comes from
      // resolveOverlayTierRate so dollar payouts never render as %.
      rebateValue: Number(t.rebateValue ?? 0),
    }))
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]
      const share = windowShares[i]?.share ?? 0
      const achieved = determineTier(share, thresholdTiers, "EXCLUSIVE")
      const tierAchieved = achieved?.tierNumber ?? 0
      const rebatePercent = resolveOverlayTierRate(term, tierAchieved)
      const last = new Date(
        Math.min(w.periodEnd.getTime(), grid.end.getTime()),
      )
      const cursor = new Date(
        Date.UTC(
          w.periodStart.getUTCFullYear(),
          w.periodStart.getUTCMonth(),
          1,
        ),
      )
      const lastMonth = new Date(
        Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1),
      )
      let endMonthKey: string | null = null
      while (cursor <= lastMonth) {
        const key = `${cursor.getUTCFullYear()}-${String(
          cursor.getUTCMonth() + 1,
        ).padStart(2, "0")}`
        // Multi-market-share contracts: later terms win on collisions —
        // the column carries one number per month.
        shareByMonth.set(key, share)
        endMonthKey = key
        cursor.setUTCMonth(cursor.getUTCMonth() + 1)
      }
      if (endMonthKey) {
        windowEnds.push({
          termId: term.id,
          month: endMonthKey,
          share,
          tierAchieved,
          rebatePercent,
        })
      }
    }
  }
  return { shareByMonth, windowEnds }
}
