/**
 * Shared rebate calculation facade.
 *
 * Single chokepoint for rebate math across the app. Two layers:
 *
 *  1. `TierLike` / `RebateMethodName` / `calculateCumulative` /
 *     `calculateMarginal` / `calculateRebate` — the flat-tier API.
 *     These are thin adapters over the canonical engine at
 *     `lib/rebates/engine/shared/*` (the previously-legacy
 *     `lib/contracts/rebate-method.ts` was deleted 2026-04-20).
 *
 *  2. `computeRebate` / `computeRebateFromPrismaTiers` — Prisma-shape
 *     wrappers that additionally handle the rebate-units scaling
 *     (Prisma stores `ContractTier.rebateValue` as a fraction; the
 *     engine expects integer percent) and the `DEFAULT_COLLECTION_RATE`
 *     concept.
 *
 * Previous bug pattern: each caller re-implemented the tier lookup
 * slightly differently (e.g. some used `>=` on spendMin, one used `>`,
 * one ignored tierNumber ordering) and user-visible rebate numbers
 * disagreed depending on which page you were on. Keep this the single
 * choke point.
 */
import type { ContractTier, RebateType } from "@prisma/client"
import { calculateCumulativeRebate } from "@/lib/rebates/engine/shared/cumulative"
import { calculateMarginalRebate } from "@/lib/rebates/engine/shared/marginal"
import type { RebateTier } from "@/lib/rebates/engine/types"

// ─── Flat-tier public API (legacy shape, canonical math) ────────

export type RebateMethodName = "cumulative" | "marginal"

export interface TierLike {
  tierNumber: number
  tierName?: string | null
  spendMin: number | string | { toString(): string }
  spendMax?: number | string | { toString(): string } | null
  rebateValue: number | string | { toString(): string }
  /**
   * Flat-dollar rebate at this tier. When set, overrides `rebateValue`:
   * tier qualifies → facility earns exactly this amount, ignoring
   * spend. Use when `ContractTier.rebateType === "fixed_rebate"`.
   * Null/undefined = percent-of-spend math via rebateValue.
   *
   * Charles iMessage 2026-04-21: accrual pipeline previously ignored
   * rebateType and treated every tier as percent_of_spend, so a
   * "Fixed Rebate \$30,000" tier computed as 30000% × spend. This
   * field is the plumbing that lets the canonical engine short-circuit
   * to flat-dollar math per tier.
   */
  fixedRebateAmount?: number | null
}

export interface RebateEngineResult {
  tierAchieved: number
  rebatePercent: number
  rebateEarned: number
}

function asNumber(v: unknown): number {
  return typeof v === "number" ? v : Number(v)
}

function toRebateTier(t: TierLike): RebateTier {
  return {
    tierNumber: t.tierNumber,
    tierName: t.tierName ?? null,
    thresholdMin: asNumber(t.spendMin),
    thresholdMax:
      t.spendMax === null || t.spendMax === undefined
        ? null
        : asNumber(t.spendMax),
    rebateValue: asNumber(t.rebateValue),
    fixedRebateAmount:
      t.fixedRebateAmount === null || t.fixedRebateAmount === undefined
        ? null
        : Number(t.fixedRebateAmount),
  }
}

/**
 * Charles W1.W-B2 dedup: when a malformed seed has multiple tiers
 * sharing spendMin, keep the lowest tierNumber. The canonical engine's
 * `determineTier` returns the HIGHEST qualifying tier by design
 * (audit [A1]); this dedup at the boundary preserves the defensive
 * posture that protected us against that class of silent-wrong-number
 * bug on real data.
 */
function dedupTiers(tiers: TierLike[]): RebateTier[] {
  const converted = tiers
    .map(toRebateTier)
    .sort((a, b) => {
      const d = a.thresholdMin - b.thresholdMin
      if (d !== 0) return d
      return a.tierNumber - b.tierNumber
    })
  const out: RebateTier[] = []
  let lastMin: number | null = null
  for (const t of converted) {
    if (lastMin !== null && t.thresholdMin === lastMin) continue
    out.push(t)
    lastMin = t.thresholdMin
  }
  return out
}

/**
 * Cumulative tier rebate: whole spend earns the top-qualifying tier's
 * rate. Below-baseline → all zeros.
 */
export function calculateCumulative(
  spend: number,
  tiers: TierLike[],
): RebateEngineResult {
  if (tiers.length === 0) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }
  const { rebate, tier } = calculateCumulativeRebate(
    spend,
    dedupTiers(tiers),
    "EXCLUSIVE",
  )
  if (!tier) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }
  return {
    tierAchieved: tier.tierNumber,
    rebatePercent: tier.rebateValue,
    rebateEarned: rebate,
  }
}

/**
 * Marginal tier rebate: each bracket earns at its own rate, summed.
 * Below-baseline → all zeros.
 *
 * Below-baseline guard: the canonical `calculateMarginalRebate` treats
 * the first tier as starting at 0 and accumulates brackets from the
 * first dollar — incorrect semantics for contracts where tier 1 has a
 * non-zero spendMin (e.g. Charles's Qualified Annual Spend Rebate with
 * tier 1 at \$5.3M). Engine-invariant property tests caught this. The
 * shim zeros out below baseline before delegating so marginal agrees
 * with cumulative at the "no tier qualified" boundary.
 */
export function calculateMarginal(
  spend: number,
  tiers: TierLike[],
): RebateEngineResult {
  if (tiers.length === 0) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }
  const deduped = dedupTiers(tiers)
  if (deduped.length === 0) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }
  const lowestMin = deduped[0]!.thresholdMin
  if (spend < lowestMin) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }
  const { totalRebate, brackets } = calculateMarginalRebate(
    spend,
    deduped,
    "EXCLUSIVE",
  )
  if (brackets.length === 0) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }
  const last = brackets[brackets.length - 1]!
  return {
    tierAchieved: last.tierNumber,
    rebatePercent: last.bracketRate,
    rebateEarned: totalRebate,
  }
}

export function calculateRebate(
  spend: number,
  tiers: TierLike[],
  method: RebateMethodName = "cumulative",
): RebateEngineResult {
  return method === "marginal"
    ? calculateMarginal(spend, tiers)
    : calculateCumulative(spend, tiers)
}

// ─── Types ──────────────────────────────────────────────────────

export interface TierInput {
  tierNumber: number
  spendMin: number | string | { toString(): string }
  spendMax?: number | string | { toString(): string } | null
  rebateValue: number | string | { toString(): string }
}

export interface RebateResult {
  tierAchieved: number
  rebatePercent: number
  rebateEarned: number
  rebateCollected: number
}

// Default collection rate applied when a contract doesn't specify its
// own payment terms. Exposed so tests can override it and UI can
// display it. 80% is the industry rule-of-thumb for "paid on time".
// TODO: move to per-contract paymentTiming config once that column is
// wired into the UI everywhere.
export const DEFAULT_COLLECTION_RATE = 0.8

// ─── Prisma→engine unit scaling ─────────────────────────────────

/**
 * Scale `ContractTier.rebateValue` from its storage form (a fraction,
 * `0.03` = 3%) to the integer-percent shape the rebate engine in
 * `lib/rebates/calculate.ts` expects. Non-percent tier types are
 * returned unchanged — their stored value is already a dollar amount and
 * the engine never applies percentage math to them.
 *
 * Why this helper exists: every caller that feeds raw Prisma tier rows
 * into the engine MUST scale at this boundary (CLAUDE.md "Rebate engine
 * units" rule). Historical bugs (Charles W1.S, W1.V) were caused by
 * callers forgetting this and writing 100×-too-small rebates. Route all
 * scaling through this function so a single place owns the convention.
 *
 * Used by:
 *  - `computeRebateFromPrismaTiers` (this file)
 *  - `lib/actions/contracts/accrual.ts` → `getAccrualTimeline` (display)
 *  - `lib/actions/contracts/recompute-accrual.ts` → `recomputeAccrualForContract` (persistence)
 *  - `scripts/regen-all-accruals.ts` (bulk backfill)
 */
export function scaleRebateValueForEngine(
  rebateValue: number | string | { toString(): string },
  rebateType: RebateType,
): number {
  const raw = Number(rebateValue)
  return rebateType === "percent_of_spend" ? raw * 100 : raw
}

// ─── Tier lookup ────────────────────────────────────────────────

/**
 * Returns the highest tier whose spendMin the spend meets, plus the
 * rebate percentage at that tier. Kept for backward compat — this is the
 * cumulative-method view. New code should call `computeRebate` /
 * `calculateRebate` directly and pass the method.
 */
export function applyTiers(
  spend: number,
  tiers: TierInput[],
): { tierAchieved: number; rebatePercent: number } {
  const r = calculateRebate(spend, tiers as TierLike[], "cumulative")
  return { tierAchieved: r.tierAchieved, rebatePercent: r.rebatePercent }
}

// ─── Full rebate computation ────────────────────────────────────

/**
 * Compute earned + collected rebate for a given spend amount and
 * tier structure. Defaults to cumulative method for backward compat;
 * pass `method: "marginal"` for bracket-style calculation.
 */
export function computeRebate(
  spend: number,
  tiers: TierInput[],
  opts: { collectionRate?: number; method?: RebateMethodName } = {},
): RebateResult {
  const method = opts.method ?? "cumulative"
  const { tierAchieved, rebatePercent, rebateEarned } = calculateRebate(
    spend,
    tiers as TierLike[],
    method,
  )
  const rebateCollected =
    rebateEarned * (opts.collectionRate ?? DEFAULT_COLLECTION_RATE)

  return {
    tierAchieved,
    rebatePercent,
    rebateEarned,
    rebateCollected,
  }
}

// ─── Prisma-shaped helper ───────────────────────────────────────

/**
 * Convenience for callers that have raw Prisma ContractTier rows.
 * Same as computeRebate but accepts the Decimal-typed Prisma shape
 * without requiring each call site to coerce fields.
 *
 * Unit convention: `ContractTier.rebateValue` is stored as a FRACTION
 * (0.02 = 2%) for `percent_of_spend` tiers, but the math engine expects
 * INTEGER percent (2). Multiply by 100 at this boundary so every caller
 * reading from Prisma gets consistent results. Mirrors the display-side
 * convention in `lib/contracts/tier-rebate-label.ts`.
 *
 * Rebate-type routing: this facade is spend-based. Unit-based tier types
 * (`fixed_rebate_per_unit`, `per_procedure_rebate`) need a unit count that
 * callers must obtain from `computeRebateFromPrismaTerm` (which has access
 * to the full `RebateConfig` including `ContractPeriod` unit rollups).
 * Returning a spend-scaled number here silently inflates values 100× (see
 * Medtronic regression: tier-3 fixed_rebate_per_unit=100 @ $750K returned
 * $750,000 instead of a unit-count-based number). We short-circuit to 0
 * for non-percent types — callers that need real numbers must use the
 * bridge helper.
 */
export function computeRebateFromPrismaTiers(
  spend: number,
  tiers: Pick<
    ContractTier,
    "tierNumber" | "spendMin" | "spendMax" | "rebateValue" | "rebateType"
  >[],
  opts?: { collectionRate?: number; method?: RebateMethodName },
): RebateResult {
  if (tiers.length === 0) {
    return {
      tierAchieved: 0,
      rebatePercent: 0,
      rebateEarned: 0,
      rebateCollected: 0,
    }
  }

  // Identify the applicable tier first (highest spendMin <= spend).
  const sortedTiers = [...tiers].sort(
    (a, b) => Number(a.spendMin) - Number(b.spendMin),
  )
  const applicable = sortedTiers.reduce<(typeof sortedTiers)[number] | null>(
    (best, t) => (spend >= Number(t.spendMin) ? t : best),
    null,
  )
  if (!applicable) {
    return {
      tierAchieved: 0,
      rebatePercent: 0,
      rebateEarned: 0,
      rebateCollected: 0,
    }
  }

  const collectionRate = opts?.collectionRate ?? DEFAULT_COLLECTION_RATE

  // Route by rebateType. Tiers can mix types in theory, but in practice a
  // single contract term uses one type across all its tiers. We branch on
  // the *applicable* tier's type to decide how to compute.
  switch (applicable.rebateType) {
    case "percent_of_spend": {
      // Existing percent-of-spend path — scale fractional .02 to 2% for
      // the math engine (mirrors lib/contracts/tier-rebate-label.ts).
      // Routes through `scaleRebateValueForEngine` to keep the unit
      // convention owned by one helper (CLAUDE.md "Rebate engine units").
      const scaled: TierInput[] = sortedTiers.map((t) => ({
        tierNumber: t.tierNumber,
        spendMin: t.spendMin,
        spendMax: t.spendMax,
        rebateValue:
          t.rebateType === "percent_of_spend"
            ? scaleRebateValueForEngine(t.rebateValue, t.rebateType)
            : 0,
      }))
      return computeRebate(spend, scaled, opts)
    }
    case "fixed_rebate": {
      const rebateEarned = Number(applicable.rebateValue)
      return {
        tierAchieved: applicable.tierNumber,
        rebatePercent: 0,
        rebateEarned,
        rebateCollected: rebateEarned * collectionRate,
      }
    }
    case "fixed_rebate_per_unit":
    case "per_procedure_rebate":
    default:
      // Unit-based or unknown — can't compute from spend alone. Callers
      // must route through computeRebateFromPrismaTerm for a real number.
      return {
        tierAchieved: applicable.tierNumber,
        rebatePercent: 0,
        rebateEarned: 0,
        rebateCollected: 0,
      }
  }
}
