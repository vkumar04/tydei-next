/**
 * Vendor Opportunity Engine — the engine behind the vendor "Prospective"
 * page's Opportunity Engine tab (Charles spec, 2026-06-21).
 *
 * Pure function. Zero Prisma, zero IO. Fully assumption-driven: the vendor
 * models a deal scenario with three sliders (price change vs current ASP,
 * target market share, expected volume growth) plus a handful of seeds,
 * and the engine derives the six output cards shown in the screenshot:
 *
 *   1. Win Probability         (long-shot ↔ likely)
 *   2. Incremental Revenue     (current vendor revenue → target revenue)
 *   3. Net Unit Impact         (units vs current run-rate)
 *   4. Blended Market Share    (share of the addressable category spend)
 *   5. Territory Recurring Rev (counts toward the rep's territory number)
 *   6. Capital / Robotic Rev   (does NOT hit the territory number)
 *
 * Robotic/capital revenue is deliberately separated because, per Charles,
 * "robotic does not need service as it doesn't hit territory number."
 */

import { clamp01 } from "@/lib/math/clamp"

// ─── Inputs ────────────────────────────────────────────────────

export interface OpportunityScenarioInput {
  /** Current average selling price per unit. */
  currentAsp: number
  /** Price change vs current ASP, fraction (-0.05 = 5% price cut). */
  priceChangePct: number

  /** Total addressable category spend at the facility/territory. */
  addressableSpend: number
  /** Vendor's current market share, fraction (0.0–1.0). */
  currentShare: number
  /** Target market share for this scenario, fraction (0.0–1.0). */
  targetShare: number

  /** Expected annual volume growth, fraction (0.08 = 8%). */
  expectedVolumeGrowthPct: number

  /** Vendor gross margin on the units, fraction (0.55 = 55%). Default 0.55. */
  grossMarginPct?: number

  /** One-time / financed capital + robotic revenue in the deal (optional). */
  capitalRoboticRevenue?: number
  /**
   * Recurring service/consumable revenue that counts toward the rep's
   * territory number (optional). When omitted, the engine treats the full
   * target net-unit revenue as territory-recurring.
   */
  recurringServiceRevenue?: number

  /** Strength of the incumbent competitor, 0–1 (1 = entrenched). Default 0.5. */
  incumbentStrength?: number
}

// ─── Outputs ───────────────────────────────────────────────────

export interface OpportunityEngineResult {
  /** 0–1 likelihood of winning the conversion. */
  winProbability: number
  /** "long shot" | "competitive" | "likely" — display band. */
  winProbabilityBand: "long_shot" | "competitive" | "likely"

  /** Current vendor revenue at current share. */
  currentRevenue: number
  /** Projected vendor revenue at target share (price + volume adjusted). */
  targetRevenue: number
  /** targetRevenue − currentRevenue. */
  incrementalRevenue: number

  /** Units sold today (current run-rate). */
  currentUnits: number
  /** Units sold at target share + volume growth + new price. */
  targetUnits: number
  /** targetUnits − currentUnits. */
  netUnitImpact: number

  /** Blended market share after the deal, fraction. */
  blendedMarketShare: number
  /** The addressable spend the share is measured against. */
  addressableSpend: number

  /** Recurring revenue that counts toward the rep's territory number. */
  territoryRecurringRevenue: number
  /** Capital + robotic revenue — separated; does NOT hit territory number. */
  capitalRoboticRevenue: number
}

const DEFAULT_INCUMBENT_STRENGTH = 0.5

// ─── Engine ────────────────────────────────────────────────────

export function computeOpportunityEngine(
  input: OpportunityScenarioInput,
): OpportunityEngineResult {
  const incumbent = clamp01(input.incumbentStrength ?? DEFAULT_INCUMBENT_STRENGTH)

  const currentShare = clamp01(input.currentShare)
  const targetShare = clamp01(input.targetShare)
  const newAsp = input.currentAsp * (1 + input.priceChangePct)

  // ── Revenue ─────────────────────────────────────────────────
  // Market share is a share of category SPEND (dollars), so target revenue
  // is driven by the target share of the grown addressable market — NOT by
  // the price change. The price change instead drives units (below) and win
  // probability: at a lower ASP the vendor needs more units to hold the same
  // dollar share.
  const currentRevenue = input.addressableSpend * currentShare
  const grownAddressable =
    input.addressableSpend * (1 + input.expectedVolumeGrowthPct)
  const targetRevenue = grownAddressable * targetShare
  const incrementalRevenue = targetRevenue - currentRevenue

  // ── Units ───────────────────────────────────────────────────
  // Units = revenue / asp. Current uses current ASP; target uses new ASP,
  // so a price cut converts the same dollar share into more units.
  const currentUnits =
    input.currentAsp > 0 ? currentRevenue / input.currentAsp : 0
  const targetUnits = newAsp > 0 ? targetRevenue / newAsp : 0
  const netUnitImpact = targetUnits - currentUnits

  // ── Blended market share ────────────────────────────────────
  // Post-deal vendor revenue ÷ grown addressable spend.
  const blendedMarketShare =
    grownAddressable > 0 ? targetRevenue / grownAddressable : 0

  // ── Revenue split: territory-recurring vs capital/robotic ────
  const capitalRoboticRevenue = Math.max(0, input.capitalRoboticRevenue ?? 0)
  const territoryRecurringRevenue =
    input.recurringServiceRevenue != null
      ? Math.max(0, input.recurringServiceRevenue)
      : Math.max(0, targetRevenue)

  // ── Win probability ─────────────────────────────────────────
  const winProbability = computeWinProbability({
    priceChangePct: input.priceChangePct,
    shareGap: targetShare - currentShare,
    expectedVolumeGrowthPct: input.expectedVolumeGrowthPct,
    incumbent,
  })

  return {
    winProbability,
    winProbabilityBand: bandForWinProb(winProbability),
    currentRevenue,
    targetRevenue,
    incrementalRevenue,
    currentUnits,
    targetUnits,
    netUnitImpact,
    blendedMarketShare,
    addressableSpend: input.addressableSpend,
    territoryRecurringRevenue,
    capitalRoboticRevenue,
  }
}

/**
 * Win probability is a bounded logistic over the deal levers:
 *  - a price CUT raises it (more aggressive offer → more likely to win)
 *  - a larger share GAP lowers it (asking the facility to switch more)
 *  - volume growth raises it slightly (rising tide)
 *  - a strong incumbent lowers it
 *
 * Tuned so an aggressive scenario lands ~70%+ and a soft, ambitious one
 * lands in the high-20s/low-30s (matching the two screenshot states).
 */
function computeWinProbability(args: {
  priceChangePct: number
  shareGap: number
  expectedVolumeGrowthPct: number
  incumbent: number
}): number {
  const { priceChangePct, shareGap, expectedVolumeGrowthPct, incumbent } = args

  // A price cut is negative priceChangePct → contributes positively.
  const priceLever = -priceChangePct * 8 // -5% cut → +0.4
  const shareLever = -Math.max(0, shareGap) * 2.2 // bigger ask → harder
  const growthLever = expectedVolumeGrowthPct * 2
  const incumbentLever = -(incumbent - 0.5) * 1.6

  const z = 0.1 + priceLever + shareLever + growthLever + incumbentLever
  return clamp01(1 / (1 + Math.exp(-z)))
}

function bandForWinProb(p: number): OpportunityEngineResult["winProbabilityBand"] {
  if (p >= 0.6) return "likely"
  if (p >= 0.35) return "competitive"
  return "long_shot"
}

/** Sensible defaults — seeds the Opportunity Engine sliders on first load. */
export const DEFAULT_OPPORTUNITY_SCENARIO: OpportunityScenarioInput = {
  currentAsp: 1200,
  priceChangePct: -0.05,
  addressableSpend: 10_500_000,
  currentShare: 0.08,
  targetShare: 0.6,
  expectedVolumeGrowthPct: 0.08,
  grossMarginPct: 0.55,
  capitalRoboticRevenue: 1_300_000,
  incumbentStrength: 0.6,
}
