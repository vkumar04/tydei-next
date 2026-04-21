/**
 * Legacy rebate-method API — BACK-COMPAT SHIM.
 *
 * The math here used to live inline. As of 2026-04-20 it is a thin
 * delegation layer over `lib/rebates/engine/shared/*` — the canonical
 * engine that was previously dormant (see
 * `docs/superpowers/specs/2026-04-20-canonical-rebate-engine-gap-design.md`
 * and `docs/superpowers/specs/2026-04-20-engine-improvement-roadmap.md`
 * track 1). Keeping the legacy exports + shapes so the 17 call sites
 * don't have to change; the math behind them now matches the tested
 * engine (A1-A10 audit fixes, EXCLUSIVE boundary by default, clean
 * bracket sums, below-baseline zero-return).
 *
 * Next step in the roadmap: migrate call sites to import directly from
 * `lib/rebates/engine/` and delete this file. Done once those imports
 * stop referencing `TierLike` / `RebateMethodName`.
 */
import {
  calculateCumulativeRebate,
} from "@/lib/rebates/engine/shared/cumulative"
import {
  calculateMarginalRebate,
} from "@/lib/rebates/engine/shared/marginal"
import type { RebateTier } from "@/lib/rebates/engine/types"

// ─── Legacy public API ──────────────────────────────────────────────

export type RebateMethodName = "cumulative" | "marginal"

export interface TierLike {
  tierNumber: number
  tierName?: string | null
  spendMin: number | string | { toString(): string }
  spendMax?: number | string | { toString(): string } | null
  rebateValue: number | string | { toString(): string }
}

export interface RebateEngineResult {
  tierAchieved: number
  rebatePercent: number
  rebateEarned: number
}

// ─── Adapters ───────────────────────────────────────────────────────

function asNumber(v: unknown): number {
  return typeof v === "number" ? v : Number(v)
}

/**
 * Convert the legacy `TierLike` shape (spendMin/spendMax) into the new
 * engine's `RebateTier` shape (thresholdMin/thresholdMax). Number
 * coercion happens here so the engine's pure helpers get clean
 * numerics regardless of whether the caller passed Prisma Decimals,
 * numeric strings, or JS numbers.
 */
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
  }
}

/**
 * Charles W1.W-B2 dedup (legacy defensive behavior): malformed seed
 * data with multiple tiers sharing the same spendMin previously
 * caused a silent wrong-number bug — the legacy engine's scan-and-
 * promote loop picked the lowest tierNumber via a tiebreaker + strict-
 * greater promotion. The new engine's `determineTier` scans to the end
 * and returns the HIGHEST qualifying tier, which would jump straight
 * to tier N on a contract where every tier says spendMin=0. Preserve
 * the defensive behavior at the shim boundary: drop duplicate-
 * thresholdMin tiers, keeping the lowest tierNumber.
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

// ─── Public functions (signatures preserved) ────────────────────────

/**
 * Cumulative tier rebate: whole spend earns the top-qualifying tier's
 * rate. Below-baseline (spend < lowest threshold) returns all zeros.
 * Delegates to `calculateCumulativeRebate` in the canonical engine.
 */
export function calculateCumulative(
  spend: number,
  tiers: TierLike[],
): RebateEngineResult {
  if (tiers.length === 0) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }
  const converted = dedupTiers(tiers)
  const { rebate, tier } = calculateCumulativeRebate(
    spend,
    converted,
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
 * Marginal tier rebate: each bracket earns at its own rate; sum across
 * all brackets up to the qualifying tier. Below-baseline returns zeros.
 * Delegates to `calculateMarginalRebate` in the canonical engine.
 */
export function calculateMarginal(
  spend: number,
  tiers: TierLike[],
): RebateEngineResult {
  if (tiers.length === 0) {
    return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0 }
  }
  const converted = dedupTiers(tiers)
  const { totalRebate, brackets } = calculateMarginalRebate(
    spend,
    converted,
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

/** Dispatcher kept for back-compat. */
export function calculateRebate(
  spend: number,
  tiers: TierLike[],
  method: RebateMethodName = "cumulative",
): RebateEngineResult {
  return method === "marginal"
    ? calculateMarginal(spend, tiers)
    : calculateCumulative(spend, tiers)
}
