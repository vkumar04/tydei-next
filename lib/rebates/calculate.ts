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
 */
export function computeRebateFromPrismaTiers(
  spend: number,
  tiers: Pick<ContractTier, "tierNumber" | "spendMin" | "spendMax" | "rebateValue">[],
  opts?: { collectionRate?: number; method?: RebateMethodName },
): RebateResult {
  return computeRebate(spend, tiers as TierInput[], opts)
}
