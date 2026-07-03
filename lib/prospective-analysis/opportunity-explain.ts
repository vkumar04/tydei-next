/**
 * Opportunity Engine — calculation transparency (Vick 2026-07-03, item 3).
 *
 * Pure function. Mirrors the exact math in `computeOpportunityEngine`
 * (opportunity-engine.ts) and turns it into per-output "explain" tables the
 * UI renders in an Info popover beside each stat card: the formula, every
 * lever that feeds it, and WHERE each lever came from (slider / your data /
 * default / deal handoff).
 *
 * The section builds the sources map (it knows whether dbData seeded a value,
 * whether a deal handoff set a slider, or whether a slider still sits at the
 * DEFAULT_OPPORTUNITY_SCENARIO seed); this module only formats + reproduces
 * the engine math so the two can be asserted equal in tests.
 */

import { clamp01 } from "@/lib/math/clamp"
import { formatCompactCurrency, formatPercent } from "@/lib/formatting"
import type { OpportunityScenarioInput } from "@/lib/prospective-analysis/opportunity-engine"

// ─── Types ─────────────────────────────────────────────────────

export type OpportunityLeverSource =
  | "slider"
  | "your data"
  | "default"
  | "deal handoff"

export interface OpportunityLeverRow {
  label: string
  /** Formatted input value (e.g. "-5%", "$10.5M"). */
  value: string
  /** Optional math detail (e.g. "× −8 = +0.40"). */
  detail?: string
  /**
   * Numeric contribution where the output is additive (the win-probability
   * z-terms). Absent for multiplicative levers.
   */
  contribution?: number
  source: OpportunityLeverSource
}

export type OpportunityExplainKey =
  | "winProbability"
  | "currentRevenue"
  | "incrementalRevenue"
  | "netUnitImpact"

export interface OpportunityOutputExplanation {
  key: OpportunityExplainKey
  title: string
  formula: string
  levers: OpportunityLeverRow[]
  /** The engine output this explanation reproduces (parity-tested). */
  value: number
  note?: string
}

/** Where each scenario input came from — built by the section, which knows. */
export interface OpportunityExplainSources {
  priceChangePct: OpportunityLeverSource
  currentShare: OpportunityLeverSource
  targetShare: OpportunityLeverSource
  expectedVolumeGrowthPct: OpportunityLeverSource
  incumbentStrength: OpportunityLeverSource
  addressableSpend: OpportunityLeverSource
  currentAsp: OpportunityLeverSource
}

// ─── Formatting helpers (module-local, deterministic) ──────────

const DEFAULT_INCUMBENT_STRENGTH = 0.5

function signedPct(fraction: number, decimals = 0): string {
  const pct = fraction * 100
  return `${pct > 0 ? "+" : ""}${pct.toFixed(decimals)}%`
}

function signed(n: number, decimals = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}`
}

function usd(n: number): string {
  return formatCompactCurrency(n, { kDecimals: 1 })
}

// ─── Explain ───────────────────────────────────────────────────

export function explainOpportunityEngine(
  scenario: OpportunityScenarioInput,
  sources: OpportunityExplainSources,
): OpportunityOutputExplanation[] {
  // Reproduce the engine's normalization exactly (opportunity-engine.ts).
  const currentShare = clamp01(scenario.currentShare)
  const targetShare = clamp01(scenario.targetShare)
  const incumbent = clamp01(
    scenario.incumbentStrength ?? DEFAULT_INCUMBENT_STRENGTH,
  )
  const growth = scenario.expectedVolumeGrowthPct
  const newAsp = scenario.currentAsp * (1 + scenario.priceChangePct)

  // ── Win probability (bounded logistic over the deal levers) ──
  const priceLever = -scenario.priceChangePct * 8
  const shareGap = Math.max(0, targetShare - currentShare)
  const shareLever = -shareGap * 2.2
  const growthLever = growth * 2
  const incumbentLever = -(incumbent - 0.5) * 1.6
  const z = 0.1 + priceLever + shareLever + growthLever + incumbentLever
  const winProbability = clamp01(1 / (1 + Math.exp(-z)))

  const winExplanation: OpportunityOutputExplanation = {
    key: "winProbability",
    title: "Win Probability",
    formula: "logistic(0.1 + price + share ask + growth + incumbent)",
    levers: [
      {
        label: "Model baseline",
        value: "+0.10",
        contribution: 0.1,
        source: "default",
      },
      {
        label: "Price change",
        value: signedPct(scenario.priceChangePct),
        detail: `× −8 = ${signed(priceLever)}`,
        contribution: priceLever,
        source: sources.priceChangePct,
      },
      {
        label: "Share ask (target − current)",
        value: `${signedPct(shareGap)} pts`,
        detail: `× −2.2 = ${signed(shareLever)}`,
        contribution: shareLever,
        source: sources.targetShare,
      },
      {
        label: "Volume growth",
        value: signedPct(growth),
        detail: `× 2 = ${signed(growthLever)}`,
        contribution: growthLever,
        source: sources.expectedVolumeGrowthPct,
      },
      {
        label: "Incumbent strength",
        value: formatPercent(incumbent * 100, 0),
        detail: `−(x − 0.5) × 1.6 = ${signed(incumbentLever)}`,
        contribution: incumbentLever,
        source: sources.incumbentStrength,
      },
    ],
    value: winProbability,
    note: "A price cut raises it; a bigger share ask and a stronger incumbent lower it.",
  }

  // ── Revenue (dollar-share model) ─────────────────────────────
  const currentRevenue = scenario.addressableSpend * currentShare
  const grownAddressable = scenario.addressableSpend * (1 + growth)
  const targetRevenue = grownAddressable * targetShare
  const incrementalRevenue = targetRevenue - currentRevenue

  const currentRevenueExplanation: OpportunityOutputExplanation = {
    key: "currentRevenue",
    title: "Current Revenue",
    formula: "addressable spend × current share",
    levers: [
      {
        label: "Addressable spend",
        value: usd(scenario.addressableSpend),
        source: sources.addressableSpend,
      },
      {
        label: "Current share",
        value: formatPercent(currentShare * 100, 1),
        source: sources.currentShare,
      },
    ],
    value: currentRevenue,
  }

  const incrementalExplanation: OpportunityOutputExplanation = {
    key: "incrementalRevenue",
    title: "Incremental Revenue",
    formula: "addressable × (1 + growth) × target share − current revenue",
    levers: [
      {
        label: "Addressable spend",
        value: usd(scenario.addressableSpend),
        source: sources.addressableSpend,
      },
      {
        label: "Volume growth",
        value: signedPct(growth),
        detail: `→ ${usd(grownAddressable)} grown`,
        source: sources.expectedVolumeGrowthPct,
      },
      {
        label: "Target share",
        value: formatPercent(targetShare * 100, 0),
        detail: `→ ${usd(targetRevenue)} target`,
        source: sources.targetShare,
      },
      {
        label: "Current revenue (subtracted)",
        value: usd(currentRevenue),
        source: sources.currentShare,
      },
    ],
    value: incrementalRevenue,
    note: "Price change deliberately does not move revenue — market share is a share of category dollars (dollar-share model). Price moves units and win probability instead.",
  }

  // ── Units (revenue ÷ ASP; price-adjusted on the target side) ─
  const currentUnits =
    scenario.currentAsp > 0 ? currentRevenue / scenario.currentAsp : 0
  const targetUnits = newAsp > 0 ? targetRevenue / newAsp : 0
  const netUnitImpact = targetUnits - currentUnits

  const netUnitExplanation: OpportunityOutputExplanation = {
    key: "netUnitImpact",
    title: "Net Unit Impact",
    formula: "target revenue ÷ new ASP − current revenue ÷ current ASP",
    levers: [
      {
        label: "Current ASP",
        value: usd(scenario.currentAsp),
        source: sources.currentAsp,
      },
      {
        label: "Price change → new ASP",
        value: signedPct(scenario.priceChangePct),
        detail: `→ ${usd(newAsp)}`,
        source: sources.priceChangePct,
      },
      {
        label: "Current revenue",
        value: usd(currentRevenue),
        detail: `÷ ASP = ${Math.round(currentUnits).toLocaleString("en-US")} units`,
        source: sources.currentShare,
      },
      {
        label: "Target revenue",
        value: usd(targetRevenue),
        detail: `÷ new ASP = ${Math.round(targetUnits).toLocaleString("en-US")} units`,
        source: sources.targetShare,
      },
    ],
    value: netUnitImpact,
    note: "A price cut converts the same dollar share into more units.",
  }

  return [
    winExplanation,
    currentRevenueExplanation,
    incrementalExplanation,
    netUnitExplanation,
  ]
}
