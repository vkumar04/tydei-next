/**
 * Prospective proposal — per-term rebate/savings estimator (structural six,
 * Wave 1.C, 2026-07-03).
 *
 * PURE MODULE. Replaces the proposal builder's inline
 * `calculateEstimatedRebate`, which had three verified defects:
 *   - volume terms paid spend × %, ignoring per-unit semantics entirely;
 *   - market_share_rebate and price_reduction terms paid $0;
 *   - tier ladders were typed but never consulted.
 *
 * Unit semantics (the repo's recurring type-confusion class — see CLAUDE.md
 * invariants + the market-share memory): thresholds are DOLLARS for spend
 * targets, UNITS for volume targets, and PERCENTS (0–100) for market-share
 * targets. Never mix them. The rebate value's denomination is routed by
 * `rebateType` (mirroring ContractTerm/ContractTier parity):
 *   - "percent"  → value is a percent of projected spend (3 = 3%)
 *   - "fixed"    → value is a flat dollar amount
 *   - "per_unit" → value is dollars per unit × projected volume
 *
 * Term semantics:
 *   - spend_rebate / (unknown types) → ladder walks tiers on projectedSpend;
 *     empty tiers fall back to the flat rebatePercent gated on targetValue.
 *   - volume_rebate → ladder/threshold on projectedVolume (UNITS).
 *   - market_share_rebate → the achieved share cannot be known prospectively,
 *     so the commitment (targetValue, a PERCENT) is assumed met and the note
 *     says so ("assumes … commitment is met").
 *   - price_reduction → contributes SAVINGS (price delta × volume, or
 *     discount % × spend), NOT rebate.
 */

export type ProposalRebateType = "percent" | "fixed" | "per_unit"

export type ProposalTargetType = "spend" | "volume" | "market_share"

/** Persistence-shaped tier row (no UI `_uid` — strip it before calling). */
export interface ProposalTermTierInput {
  /** Lower bound in the target metric's units ($ spend / units / share %). */
  min: number
  /** Optional upper bound of the band — display/bookkeeping only. */
  max?: number
  /** Rebate value at this tier, denominated per the term's rebateType. */
  value: number
}

/** Structurally compatible with `ProposalTermSummary` (lib/actions/prospective). */
export interface ProposalTermEstimateInput {
  termType: string
  name?: string
  targetType?: string
  targetValue?: number
  /** Flat rebate value — % / $ / $-per-unit per rebateType. */
  rebatePercent?: number
  /** Absent (historic proposals) defaults to "percent". */
  rebateType?: ProposalRebateType
  tiers?: ProposalTermTierInput[]
}

export interface ProposalTermEstimate {
  label: string
  termType: string
  /** Estimated annual rebate dollars this term pays. */
  rebate: number
  /** Estimated annual SAVINGS dollars (price_reduction terms only). */
  savings: number
  /** Human explanation of how the number was reached (or why it's $0). */
  note: string
}

export interface ProposalTermsEstimateResult {
  perTerm: ProposalTermEstimate[]
  totalRebate: number
  totalSavings: number
}

/** The targetType a termType implies — used to sync the builder's selector
 *  and to default persistence rows that lack an explicit targetType. */
export function defaultTargetTypeForTermType(
  termType: string,
): ProposalTargetType {
  switch (termType) {
    case "volume_rebate":
      return "volume"
    case "market_share_rebate":
      return "market_share"
    default:
      // spend_rebate, price_reduction, and anything unknown ladder on spend.
      return "spend"
  }
}

const TARGET_TYPES: ProposalTargetType[] = ["spend", "volume", "market_share"]

function normalizeTargetType(
  term: ProposalTermEstimateInput,
): ProposalTargetType {
  const raw = term.targetType as ProposalTargetType | undefined
  return raw && TARGET_TYPES.includes(raw)
    ? raw
    : defaultTargetTypeForTermType(term.termType)
}

const fmtDollars = (n: number): string =>
  `$${Math.round(n).toLocaleString("en-US")}`

function fmtMetric(targetType: ProposalTargetType, n: number): string {
  if (targetType === "spend") return fmtDollars(n)
  if (targetType === "volume") return `${Math.round(n).toLocaleString("en-US")} units`
  return `${n}% share`
}

/** Route the rebate value's denomination — percent×spend / flat $ / $×units. */
function payout(
  rebateType: ProposalRebateType,
  value: number,
  projectedSpend: number,
  projectedVolume: number,
): number {
  switch (rebateType) {
    case "fixed":
      return value
    case "per_unit":
      return value * projectedVolume
    case "percent":
      return projectedSpend * (value / 100)
  }
}

function payoutNote(
  rebateType: ProposalRebateType,
  value: number,
  projectedSpend: number,
  projectedVolume: number,
): string {
  switch (rebateType) {
    case "fixed":
      return `flat ${fmtDollars(value)}`
    case "per_unit":
      return `${fmtDollars(value)}/unit × ${Math.round(projectedVolume).toLocaleString("en-US")} units`
    case "percent":
      return `${value}% of ${fmtDollars(projectedSpend)} projected spend`
  }
}

function estimateTerm(
  term: ProposalTermEstimateInput,
  projectedSpend: number,
  projectedVolume: number,
): ProposalTermEstimate {
  const targetType = normalizeTargetType(term)
  const rebateType: ProposalRebateType = term.rebateType ?? "percent"
  const isPriceReduction = term.termType === "price_reduction"
  const isMarketShare = targetType === "market_share"
  const targetValue = term.targetValue ?? 0

  // The metric the ladder/threshold is measured in. Market-share terms can't
  // observe the achieved share prospectively — assume the commitment is met,
  // so the committed share IS the metric (a PERCENT, never dollars/units).
  const metric = isMarketShare
    ? targetValue
    : targetType === "volume"
      ? projectedVolume
      : projectedSpend
  const metricNoun = isMarketShare
    ? "committed share"
    : targetType === "volume"
      ? "projected volume"
      : "projected spend"

  const tiers = (term.tiers ?? [])
    .filter((t) => Number.isFinite(t.min) && Number.isFinite(t.value))
    .slice()
    .sort((a, b) => a.min - b.min)

  let amount = 0
  let note: string

  if (tiers.length > 0) {
    // Ladder walk: highest tier whose min the metric reaches wins.
    let achievedIdx = -1
    for (let i = 0; i < tiers.length; i++) {
      if (metric >= tiers[i]!.min) achievedIdx = i
    }
    if (achievedIdx >= 0) {
      const tier = tiers[achievedIdx]!
      amount = payout(rebateType, tier.value, projectedSpend, projectedVolume)
      note = `Tier ${achievedIdx + 1} of ${tiers.length} at ${fmtMetric(targetType, metric)} ${metricNoun} — ${payoutNote(rebateType, tier.value, projectedSpend, projectedVolume)}`
    } else {
      note = `${fmtMetric(targetType, metric)} ${metricNoun} is below the first tier (${fmtMetric(targetType, tiers[0]!.min)}) — no rebate`
    }
  } else {
    // Flat fallback: rebatePercent gated on the targetValue threshold.
    // Market-share commitments are assumed met (see above).
    const met = isMarketShare || metric >= targetValue
    if (met) {
      const value = term.rebatePercent ?? 0
      amount = payout(rebateType, value, projectedSpend, projectedVolume)
      note = payoutNote(rebateType, value, projectedSpend, projectedVolume)
    } else {
      note = `${fmtMetric(targetType, metric)} ${metricNoun} is below the ${fmtMetric(targetType, targetValue)} target — no rebate`
    }
  }

  if (isMarketShare && amount > 0) {
    note += `; assumes the ${targetValue}% share commitment is met`
  }

  if (isPriceReduction) {
    return {
      label: term.name || "Price reduction",
      termType: term.termType,
      rebate: 0,
      savings: amount,
      note:
        amount > 0
          ? `Savings from reduced pricing (not a rebate) — ${note}`
          : note,
    }
  }

  return {
    label: term.name || term.termType.replace(/_/g, " "),
    termType: term.termType,
    rebate: amount,
    savings: 0,
    note,
  }
}

/**
 * Estimate every proposed term's annual rebate + savings contribution.
 * Pure; safe to call on every render with builder state.
 */
export function estimateProposalTerms(
  terms: ProposalTermEstimateInput[],
  projectedSpend: number,
  projectedVolume: number,
): ProposalTermsEstimateResult {
  const perTerm = terms.map((t) =>
    estimateTerm(t, projectedSpend, projectedVolume),
  )
  return {
    perTerm,
    totalRebate: perTerm.reduce((s, t) => s + t.rebate, 0),
    totalSavings: perTerm.reduce((s, t) => s + t.savings, 0),
  }
}
