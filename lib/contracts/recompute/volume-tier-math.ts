// Charles audit round-10 BLOCKER: removed "use server" — internal
// helper consumed by recomputeAccrualForContract. Do NOT add the
// directive to this module: its exports are sync helpers and would be
// flagged by use-server-async-export-scanner.test.ts (and worse,
// registered as server actions).

import type { VolumeRebateTermLike } from "@/lib/contracts/recompute/volume-shared"
import {
  addMonthsUTC,
  endOfDay,
  widthMonths,
} from "@/lib/contracts/recompute/volume-shared"

/**
 * bug-bash 2026-06-11 follow-up F2: the COG-fallback writer's tier
 * selection + reward math, extracted as PURE helpers so the accrual
 * timeline (`lib/actions/contracts/accrual.ts`) can render a
 * display-only in-progress accrual for the current UNCLOSED evaluation
 * window using the writer's exact math (canonical-helper culture —
 * never reimplement). `recomputeVolumeFromCogRecords` (volume-cog-writer.ts)
 * calls these same functions, so writer behavior is unchanged and the two
 * surfaces cannot drift. Persisted `[auto-volume-accrual]` rows are still
 * written ONLY for closed windows (W1.W-B1 honesty rule — ledger earned
 * stays `payPeriodEnd <= today`).
 */
export interface NormalizedVolumeTier {
  tierNumber: number
  tierName: string | null
  thresholdMin: number
  thresholdMax: number | null
  rebateValue: number
  rebateType: string | null
}

/**
 * Threshold-normalize a volume term's tier ladder and sort ascending.
 * Bug #13 rule: volume tiers store their threshold in volumeMin/volumeMax
 * (Int columns); fall back to spendMin/spendMax only for legacy rows that
 * wrote the threshold to the wrong column. Extracted verbatim from the
 * COG-fallback writer (F2, 2026-06-11).
 */
export function normalizeVolumeTiers(
  tiers: VolumeRebateTermLike["tiers"],
): NormalizedVolumeTier[] {
  return tiers
    .map((t) => {
      const tVolMin = (t as unknown as { volumeMin?: number | null }).volumeMin
      const tVolMax = (t as unknown as { volumeMax?: number | null }).volumeMax
      const thresholdMin =
        tVolMin != null && Number.isFinite(Number(tVolMin))
          ? Number(tVolMin)
          : Number(t.spendMin ?? 0)
      const thresholdMax =
        tVolMax != null && Number.isFinite(Number(tVolMax))
          ? Number(tVolMax)
          : t.spendMax === null || t.spendMax === undefined
            ? null
            : Number(t.spendMax)
      return {
        tierNumber: t.tierNumber,
        tierName: t.tierName,
        thresholdMin,
        thresholdMax,
        rebateValue: Number(t.rebateValue ?? 0),
        rebateType: t.rebateType ?? null,
      }
    })
    .sort((a, b) => a.thresholdMin - b.thresholdMin)
}

/**
 * Cumulative tier pick: highest tier whose thresholdMin is met by `count`
 * (EXCLUSIVE upper bound — the canonical engine convention). When the
 * count overshoots every ceiling without qualifying for a higher tier,
 * keep the lowest qualifying tier (the writer's pre-existing fallback).
 * Extracted verbatim from the COG-fallback writer (F2, 2026-06-11).
 */
export function selectAchievedVolumeTier(
  sortedTiers: NormalizedVolumeTier[],
  count: number,
): NormalizedVolumeTier | null {
  let achieved: NormalizedVolumeTier | null = null
  for (const t of sortedTiers) {
    if (count >= t.thresholdMin) {
      const ceilingOk = t.thresholdMax == null || count < t.thresholdMax
      if (ceilingOk) achieved = t
      else if (achieved == null) achieved = t
    }
  }
  return achieved
}

/**
 * Reward math per the achieved tier's `rebateType` — the identical switch
 * the writer persists (F2, 2026-06-11). `spendSum` only matters for
 * `percent_of_spend` tiers (rebateValue stored as fraction, 0.02 = 2%).
 * Cumulative semantics: the WHOLE count is rewarded at the achieved
 * tier's rate (recompute-on-window-total), which is why the timeline's
 * mid-window delta attribution stays exactly consistent with what this
 * writer will persist at window close.
 */
export function computeVolumeTierRebate(
  sortedTiers: NormalizedVolumeTier[],
  count: number,
  spendSum: number,
): { achieved: NormalizedVolumeTier | null; rebateEarned: number } {
  const achieved = selectAchievedVolumeTier(sortedTiers, count)
  if (!achieved) return { achieved: null, rebateEarned: 0 }
  let rebate = 0
  switch (achieved.rebateType) {
    case "percent_of_spend":
      // rebateValue stored as fraction (0.02 = 2%) by the form.
      rebate = spendSum * achieved.rebateValue
      break
    case "fixed_rebate":
      rebate = achieved.rebateValue
      break
    case "fixed_rebate_per_unit":
    case "per_procedure_rebate":
    default:
      rebate = count * achieved.rebateValue
      break
  }
  return { achieved, rebateEarned: rebate }
}

/**
 * bug-bash 2026-06-11 follow-up F2: the writer's evaluation-window
 * bucketing, surfaced for the timeline's display-only in-progress
 * accrual. Returns the FIRST window the writer does NOT persist — the
 * one whose natural periodEnd lands beyond min(today, contract expiry,
 * term effectiveEnd), i.e. exactly where the writer's bucketing loop
 * `break`s (the currently-running or partial-tail window). Same
 * start/end clamps as the writer: start = max(contract effective, term
 * effectiveStart), end-of-day on date-only bounds, window grid anchored
 * at the first of start's month stepping `widthMonths(evaluationPeriod)`.
 * Null when the contract window is empty or no open window exists within
 * the writer's 200-iteration guard.
 */
export function currentOpenVolumeWindow(input: {
  contractEffectiveDate: Date
  contractExpirationDate: Date
  effectiveStart: Date | null
  effectiveEnd: Date | null
  evaluationPeriod: string | null
  today?: Date
}): { windowStart: Date; windowEnd: Date } | null {
  const today = input.today ?? new Date()
  const start = new Date(
    Math.max(
      input.contractEffectiveDate.getTime(),
      input.effectiveStart?.getTime() ?? -Infinity,
    ),
  )
  const end = new Date(
    Math.min(
      today.getTime(),
      endOfDay(input.contractExpirationDate).getTime(),
      input.effectiveEnd ? endOfDay(input.effectiveEnd).getTime() : Infinity,
    ),
  )
  if (end.getTime() <= start.getTime()) return null
  // bugs.rtfd 2026-06-14: a lifetime term is a single window spanning the
  // whole contract through `end` (already min(today,…)); there is no separate
  // currently-running window to surface, so the open-window probe is null.
  if (input.evaluationPeriod === "lifetime") return null
  const width = widthMonths(input.evaluationPeriod)
  let cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  )
  for (let iter = 0; iter < 200; iter++) {
    const next = addMonthsUTC(cursor, width)
    const periodEnd = new Date(next.getTime() - 1)
    if (periodEnd.getTime() > end.getTime()) {
      // The writer `break`s here — this window is unclosed/unpersisted.
      return { windowStart: cursor, windowEnd: periodEnd }
    }
    cursor = next
  }
  return null
}
