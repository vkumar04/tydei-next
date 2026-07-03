/**
 * Deal score — the weighted deal-QUALITY blend (Wave-3 F of the 2026-07-03
 * prospective-structural-six plan).
 *
 * Replaces the margin-only anchor score in
 * `lib/actions/vendor-prospective.ts` (`deriveOverallScore`, now a thin
 * adapter over `computeDealScore`). The old score was self-referential:
 * it read ONLY `recommendedScenario.grossMarginPercent` vs the vendor's own
 * target, and with internal cost blank the analyzer assumes a 55% gross
 * margin — so an EMPTY form scored ~95 "strong_accept" every time. The new
 * score measures deal quality across five weighted components (weights sum
 * to exactly 100):
 *
 *   - marginVsTarget (35)        — the old anchor logic, rescaled into 0–35
 *   - priceVsBenchmark (25)      — spend-weighted Target price vs the picked
 *                                  benchmarks' median (cheaper → higher);
 *                                  neutral half credit with no benchmarks
 *   - rebateCompetitiveness (15) — blended rebate % vs a 2–5% healthy band
 *   - shareAskRealism (10)       — target−current share gap ≤10pts full,
 *                                  taper to 0 at ≥25pts; neutral when unknown
 *   - dataConfidence (15)        — fraction of inputs that are REAL (internal
 *                                  cost entered, ≥1 resolved benchmark,
 *                                  actuals present, current share provided)
 *
 * A blank-everything form now lands ~50 "negotiate" with dataConfidence 0
 * and an explicit `marginAssumed` flag, instead of 95 "strong_accept".
 *
 * Pure function — zero Prisma, zero IO. The server action resolves
 * benchmark medians (percentile50, fallback nationalAvgPrice — UPLOADED
 * rows only per the prospective-benchmarks invariant) and threads them in.
 *
 * The 0–100 `overall` keeps the existing read-time recommendation
 * thresholds (80/65/40 — `recommendationForScore` in
 * lib/actions/prospective.ts). `recommendationForDealScore` below mirrors
 * them for client display; never let the two drift.
 */

import { z } from "zod"

// ─── Weights (sum = 100, locked by test) ───────────────────────

export const DEAL_SCORE_WEIGHTS = {
  marginVsTarget: 35,
  priceVsBenchmark: 25,
  rebateCompetitiveness: 15,
  shareAskRealism: 10,
  dataConfidence: 15,
} as const

export type DealScoreComponentKey = keyof typeof DEAL_SCORE_WEIGHTS

const COMPONENT_KEYS = [
  "marginVsTarget",
  "priceVsBenchmark",
  "rebateCompetitiveness",
  "shareAskRealism",
  "dataConfidence",
] as const satisfies readonly DealScoreComponentKey[]

// ─── Persisted-component schema ────────────────────────────────

/**
 * One legend row. Persisted onto the proposal's `pricingData.scoreComponents`
 * (zod-validated JSON-column write, like `dealAssumptions`) so My-Proposals /
 * the detail dialog can explain a saved score later. Additive/optional on
 * read — proposals scored before this feature simply have no key.
 */
export const dealScoreComponentSchema = z.object({
  key: z.enum(COMPONENT_KEYS),
  label: z.string(),
  /** Points earned, 0..max, rounded to 0.1. */
  points: z.number(),
  max: z.number(),
  /** Plain-English one-liner explaining the points. */
  detail: z.string(),
})

export const dealScoreComponentsSchema = z.array(dealScoreComponentSchema)

export type DealScoreComponent = z.infer<typeof dealScoreComponentSchema>

// ─── Input / output ────────────────────────────────────────────

/** One Deal-Scorer construct, reduced to what the score needs. */
export interface DealScoreConstructInput {
  /** The vendor's proposed Target unit price ($). */
  targetUnitPrice: number
  annualVolume: number
  /** Integer percent (5 = 5%), as typed on the construct row. */
  rebatePercent: number
  /**
   * The picked benchmark's median price: `percentile50`, falling back to
   * `nationalAvgPrice` — resolved by the caller from the vendor's UPLOADED
   * benchmark rows only. Null when the construct has no picked benchmark
   * (free-text row) or the benchmark carries no usable price.
   */
  benchmarkMedian: number | null
}

export interface DealScoreInput {
  /**
   * `recommendedScenario.grossMarginPercent` from the analyzer — a FRACTION
   * (0.40 = 40%). Null when no scenario clears the floor.
   */
  recommendedGrossMargin: number | null
  /** Vendor margin targets, FRACTIONS (0.40 = 40%). */
  targetGrossMargin: number
  floorGrossMargin: number
  /**
   * True when the vendor entered a real internal unit cost. False means the
   * analyzer fell back to the 55% gross-margin assumption — the margin
   * component is then flagged `marginAssumed`.
   */
  internalCostProvided: boolean
  constructs: DealScoreConstructInput[]
  /** Shares as FRACTIONS (0.25 = 25%) — matching `VendorProspectiveInput`,
   *  NOT the UI's whole-percent strings. Null when not provided. */
  currentShareFraction: number | null
  targetShareFraction: number | null
  /**
   * True when real facility actuals fed the analysis — the usage/price
   * reference produced a `facilityCurrentVendorRevenue` (uploads, proposal
   * items, or the two-way facility sync).
   */
  actualsPresent: boolean
}

export interface DealScoreBreakdown {
  /** 0–100, rounded. Read with the 80/65/40 recommendation thresholds. */
  overall: number
  components: DealScoreComponent[]
  /** True when the margin component rests on the 55% GM assumption
   *  (no internal cost entered) — surface an explicit amber flag. */
  marginAssumed: boolean
}

// ─── Scoring ───────────────────────────────────────────────────

const round1 = (n: number) => Math.round(n * 10) / 10

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

const pct1 = (fraction: number) => `${(fraction * 100).toFixed(1)}%`

/**
 * The legacy margin-anchor logic on its original 0–100 scale: no passing
 * scenario → 20; margin at the floor → 50; at target → 80; +1 point per
 * margin point above target, capped at 100.
 */
function legacyMarginAnchor(
  margin: number | null,
  target: number,
  floor: number,
): number {
  if (margin == null) return 20
  if (margin >= target) return Math.min(100, 80 + (margin - target) * 100)
  const span = target - floor
  if (span <= 0) return 80
  return 50 + 30 * ((margin - floor) / span)
}

function marginComponent(input: DealScoreInput): DealScoreComponent {
  const max = DEAL_SCORE_WEIGHTS.marginVsTarget
  const anchor = legacyMarginAnchor(
    input.recommendedGrossMargin,
    input.targetGrossMargin,
    input.floorGrossMargin,
  )
  const points = round1((clamp(anchor, 0, 100) / 100) * max)
  const assumedNote = input.internalCostProvided
    ? ""
    : " — margin ASSUMED at 55% GM (no internal cost entered)"
  const detail =
    input.recommendedGrossMargin == null
      ? "No scenario clears the floor margin."
      : `Recommended margin ${pct1(input.recommendedGrossMargin)} vs ${pct1(input.targetGrossMargin)} target${assumedNote}.`
  return { key: "marginVsTarget", label: "Margin vs target", points, max, detail }
}

function priceComponent(input: DealScoreInput): DealScoreComponent {
  const max = DEAL_SCORE_WEIGHTS.priceVsBenchmark
  const rated = input.constructs.filter(
    (c) =>
      c.benchmarkMedian != null &&
      c.benchmarkMedian > 0 &&
      c.targetUnitPrice > 0 &&
      c.annualVolume > 0,
  )
  if (rated.length === 0) {
    return {
      key: "priceVsBenchmark",
      label: "Price vs benchmark",
      points: round1(max / 2),
      max,
      detail:
        "No picked benchmarks resolve — neutral half credit. Add products from your uploaded benchmark list to score price position.",
    }
  }
  // Spend-weighted (Target price × volume) discount vs the benchmark median.
  // Positive = cheaper than market → higher score.
  let weightSum = 0
  let weightedDiscount = 0
  for (const c of rated) {
    const median = c.benchmarkMedian
    if (median == null || median <= 0) continue
    const w = c.targetUnitPrice * c.annualVolume
    weightSum += w
    weightedDiscount += w * ((median - c.targetUnitPrice) / median)
  }
  const discount = weightSum > 0 ? weightedDiscount / weightSum : 0
  // Neutral (at-market) = half credit; 10% cheaper = full; 10% above = 0.
  const points = round1(clamp(max / 2 + discount * 100 * (max / 20), 0, max))
  const dir = discount >= 0 ? "cheaper than" : "above"
  return {
    key: "priceVsBenchmark",
    label: "Price vs benchmark",
    points,
    max,
    detail: `Target pricing ${pct1(Math.abs(discount))} ${dir} the benchmark median (spend-weighted, ${rated.length} benchmarked product${rated.length === 1 ? "" : "s"}).`,
  }
}

/** Healthy facility-rebate band, integer percent. */
const REBATE_BAND_MIN = 2
const REBATE_BAND_MAX = 5
/** Points lost per rebate point above the band (margin erosion taper). */
const REBATE_OVER_TAPER = 2

function rebateComponent(input: DealScoreInput): DealScoreComponent {
  const max = DEAL_SCORE_WEIGHTS.rebateCompetitiveness
  // Spend-weighted blended rebate % across constructs (Target spend weights,
  // volume fallback — mirrors blendConstructsToScenarios' weighting idea).
  const valid = input.constructs.filter((c) => c.annualVolume > 0)
  let weightSum = 0
  let weighted = 0
  for (const c of valid) {
    const w =
      c.targetUnitPrice > 0 ? c.targetUnitPrice * c.annualVolume : c.annualVolume
    weightSum += w
    weighted += w * c.rebatePercent
  }
  const rebate = weightSum > 0 ? weighted / weightSum : 0

  let points: number
  let verdict: string
  if (rebate < REBATE_BAND_MIN) {
    points = round1(max * (rebate / REBATE_BAND_MIN))
    verdict = `below the ${REBATE_BAND_MIN}–${REBATE_BAND_MAX}% healthy band — a thin rebate weakens the facility pitch`
  } else if (rebate <= REBATE_BAND_MAX) {
    points = max
    verdict = `inside the ${REBATE_BAND_MIN}–${REBATE_BAND_MAX}% healthy band`
  } else {
    points = round1(
      clamp(max - (rebate - REBATE_BAND_MAX) * REBATE_OVER_TAPER, 0, max),
    )
    verdict = `above the ${REBATE_BAND_MIN}–${REBATE_BAND_MAX}% healthy band — rich rebates erode your margin`
  }
  return {
    key: "rebateCompetitiveness",
    label: "Rebate competitiveness",
    points,
    max,
    detail: `Blended rebate ${rebate.toFixed(1)}% — ${verdict}.`,
  }
}

/** Share-ask taper bounds, in percentage points of share gap. */
const SHARE_GAP_FULL_PTS = 10
const SHARE_GAP_ZERO_PTS = 25

function shareComponent(input: DealScoreInput): DealScoreComponent {
  const max = DEAL_SCORE_WEIGHTS.shareAskRealism
  if (input.currentShareFraction == null || input.targetShareFraction == null) {
    return {
      key: "shareAskRealism",
      label: "Share-ask realism",
      points: round1(max / 2),
      max,
      detail:
        "Current / target share not provided — neutral half credit. Enter both to score how realistic the share ask is.",
    }
  }
  const gapPts =
    (input.targetShareFraction - input.currentShareFraction) * 100
  let points: number
  if (gapPts <= SHARE_GAP_FULL_PTS) {
    points = max
  } else if (gapPts >= SHARE_GAP_ZERO_PTS) {
    points = 0
  } else {
    points = round1(
      (max * (SHARE_GAP_ZERO_PTS - gapPts)) /
        (SHARE_GAP_ZERO_PTS - SHARE_GAP_FULL_PTS),
    )
  }
  const detail =
    gapPts <= 0
      ? `Target share at or below current — no share ask to defend.`
      : `Asking for +${gapPts.toFixed(1)}pts of share (realistic ≤${SHARE_GAP_FULL_PTS}pts; ≥${SHARE_GAP_ZERO_PTS}pts scores 0).`
  return { key: "shareAskRealism", label: "Share-ask realism", points, max, detail }
}

function confidenceComponent(input: DealScoreInput): DealScoreComponent {
  const max = DEAL_SCORE_WEIGHTS.dataConfidence
  const hasBenchmark = input.constructs.some(
    (c) => c.benchmarkMedian != null && c.benchmarkMedian > 0,
  )
  const signals: { label: string; present: boolean }[] = [
    { label: "internal cost", present: input.internalCostProvided },
    { label: "benchmarks", present: hasBenchmark },
    { label: "facility actuals", present: input.actualsPresent },
    { label: "current share", present: input.currentShareFraction != null },
  ]
  const present = signals.filter((s) => s.present)
  const missing = signals.filter((s) => !s.present)
  const points = round1((max * present.length) / signals.length)
  const detail =
    present.length === signals.length
      ? "All inputs are real: internal cost, benchmarks, facility actuals, current share."
      : `${present.length} of ${signals.length} real inputs${present.length > 0 ? ` (${present.map((s) => s.label).join(", ")})` : ""} — missing ${missing.map((s) => s.label).join(", ")}.`
  return { key: "dataConfidence", label: "Data confidence", points, max, detail }
}

/**
 * The weighted deal-quality score. Component maxes always sum to 100
 * (weights-sum invariance, locked by test), so `overall` is simply the
 * rounded sum of points, clamped to 0–100.
 */
export function computeDealScore(input: DealScoreInput): DealScoreBreakdown {
  const components: DealScoreComponent[] = [
    marginComponent(input),
    priceComponent(input),
    rebateComponent(input),
    shareComponent(input),
    confidenceComponent(input),
  ]
  const overall = clamp(
    Math.round(components.reduce((s, c) => s + c.points, 0)),
    0,
    100,
  )
  return {
    overall,
    components,
    marginAssumed: !input.internalCostProvided,
  }
}

/**
 * Read-time recommendation for a 0–100 deal score. MIRRORS the private
 * `recommendationForScore` in lib/actions/prospective.ts (80/65/40 — the
 * legacy scorer thresholds); keep the two identical, never drift.
 */
export function recommendationForDealScore(
  score: number,
): "strong_accept" | "accept" | "negotiate" | "reject" {
  if (score >= 80) return "strong_accept"
  if (score >= 65) return "accept"
  if (score < 40) return "reject"
  return "negotiate"
}
