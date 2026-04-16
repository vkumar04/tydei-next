/**
 * Shared rebate calculation logic.
 *
 * Every place in the codebase that computes rebates — the seed, the
 * synthetic ContractPeriod generator, the dashboard aggregate fallback,
 * the contract-detail fallback — must use these functions. That way
 * tier logic lives in one file and every surface stays consistent.
 *
 * Previous bug pattern: each caller re-implemented the tier lookup
 * slightly differently (e.g. some used `>=` on spendMin, one used `>`,
 * one ignored tierNumber ordering) and user-visible rebate numbers
 * disagreed depending on which page you were on.
 */
import type { ContractTier } from "@prisma/client"

// ─── Types ──────────────────────────────────────────────────────

export interface TierInput {
  tierNumber: number
  spendMin: number | string | { toString(): string }
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
 * Given a cumulative spend amount and a list of tiers, return the
 * highest tier whose spendMin the spend meets or exceeds, plus the
 * corresponding rebate percentage.
 *
 * Tiers don't need to be pre-sorted — we scan all of them and pick the
 * highest qualifying tierNumber. This matches how the seed builds
 * data and the synthetic period generator walks the list.
 */
export function applyTiers(
  spend: number,
  tiers: TierInput[],
): { tierAchieved: number; rebatePercent: number } {
  let tierAchieved = 0
  let rebatePercent = 0

  for (const tier of tiers) {
    const min = Number(tier.spendMin)
    if (spend >= min && tier.tierNumber >= tierAchieved) {
      tierAchieved = tier.tierNumber
      rebatePercent = Number(tier.rebateValue)
    }
  }

  return { tierAchieved, rebatePercent }
}

// ─── Full rebate computation ────────────────────────────────────

/**
 * Compute earned + collected rebate for a given spend amount and
 * tier structure. Collection rate defaults to DEFAULT_COLLECTION_RATE
 * but can be overridden per-contract.
 *
 * Returns zeroed result when no tiers or no spend — always safe to
 * call unconditionally.
 */
export function computeRebate(
  spend: number,
  tiers: TierInput[],
  opts: { collectionRate?: number } = {},
): RebateResult {
  const { tierAchieved, rebatePercent } = applyTiers(spend, tiers)
  const rebateEarned = (spend * rebatePercent) / 100
  const rebateCollected = rebateEarned * (opts.collectionRate ?? DEFAULT_COLLECTION_RATE)

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
  tiers: Pick<ContractTier, "tierNumber" | "spendMin" | "rebateValue">[],
  opts?: { collectionRate?: number },
): RebateResult {
  return computeRebate(spend, tiers as TierInput[], opts)
}
