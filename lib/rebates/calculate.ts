/**
 * Shared rebate calculation facade.
 *
 * All callers compute rebates through this module so tier logic stays
 * consistent. The actual engine lives in `lib/contracts/rebate-method.ts`
 * — this facade adds the DEFAULT_COLLECTION_RATE concept and a
 * Prisma-shaped convenience wrapper.
 *
 * Previous bug pattern: each caller re-implemented the tier lookup
 * slightly differently (e.g. some used `>=` on spendMin, one used `>`,
 * one ignored tierNumber ordering) and user-visible rebate numbers
 * disagreed depending on which page you were on. Keep this the single
 * choke point.
 */
import type { ContractTier } from "@prisma/client"
import {
  calculateRebate,
  type RebateMethodName,
  type TierLike,
} from "@/lib/contracts/rebate-method"

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
      const scaled: TierInput[] = sortedTiers.map((t) => ({
        tierNumber: t.tierNumber,
        spendMin: t.spendMin,
        spendMax: t.spendMax,
        rebateValue:
          t.rebateType === "percent_of_spend"
            ? Number(t.rebateValue) * 100
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
