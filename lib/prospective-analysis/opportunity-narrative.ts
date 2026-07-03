/**
 * Plain-English narrative for the vendor Opportunity Engine export — leads the
 * PDF and CSV with the story of the deal instead of bare tables. Mirrors
 * `buildNarrative` (facility Analysis export) and `buildProposalNarrative`
 * (facility proposal report): who is pitching where → the facility today → the
 * proposed deal → what winning it is worth → the recommended offer.
 *
 * Pure + defensive: the facility snapshot and constructs are optional (the
 * engine can run from sliders alone), so each paragraph only appears when its
 * data is present — and the narrative says so honestly when it isn't
 * ("modeled from default assumptions", "win probability from the
 * deterministic model").
 */

import { formatCompactCurrency, formatPercent } from "@/lib/formatting"
import type { OpportunityEngineResult } from "./opportunity-engine"

/** Fraction → "12.3%". */
const pct = (fraction: number) => formatPercent(fraction * 100)
const usd = (n: number) => formatCompactCurrency(n, { kDecimals: 1 })

/**
 * The scenario levers as shown on the Opportunity Engine page (fractions).
 * Structurally matches `OpportunityScenarioMeta` in export-opportunity.ts.
 */
export interface NarrativeScenario {
  division: string
  facility: string
  priceChangePct: number
  targetShare: number
  expectedVolumeGrowthPct: number
}

/** The score fields the narrative reads — a structural subset of
 *  `VendorOpportunityScore` (matches the PDF payload's score block). */
export interface NarrativeScore {
  overall: number
  winProbability: {
    probability: number
    riskLevel: string
    recommendedAction: string
  }
  recommendedOffer: { targetConversionPct: number; items: string[] }
}

/** The Facility Current State figures the narrative reads — a structural
 *  subset of `FacilityCurrentStateSnapshot` (facility-current-state.tsx). */
export interface NarrativeFacilitySnapshot {
  facilityName: string
  currentVendorSpend: number
  netRevenue: number
  ebitda: number
  /** Fraction (0.3 = 30%). */
  ebitdaMarginPct: number
  dcf: number
  revenueMode: "actuals" | "manual"
}

/** Per-construct deal row — a structural subset of `ExportDealConstruct`. */
export interface NarrativeConstruct {
  productName: string
  current: number
  target: number
  annualVolume: number
  /** Already a percent (3 = 3%). */
  rebatePercent: number
}

export interface OpportunityNarrativeInput {
  scenario: NarrativeScenario
  engine: Pick<
    OpportunityEngineResult,
    | "winProbability"
    | "currentRevenue"
    | "targetRevenue"
    | "incrementalRevenue"
    | "blendedMarketShare"
    | "territoryRecurringRevenue"
    | "capitalRoboticRevenue"
  >
  score: NarrativeScore
  facility?: NarrativeFacilitySnapshot | null
  constructs?: NarrativeConstruct[] | null
}

export function buildOpportunityNarrative(
  input: OpportunityNarrativeInput,
): string[] {
  const { scenario, engine, score, facility, constructs } = input
  const paragraphs: string[] = []

  // 1 — Who / where + the scenario levers.
  const priceMove =
    scenario.priceChangePct < 0
      ? `a ${pct(-scenario.priceChangePct)} price cut`
      : scenario.priceChangePct > 0
        ? `a ${pct(scenario.priceChangePct)} price increase`
        : "flat pricing"
  paragraphs.push(
    `${scenario.division} is pitching ${scenario.facility} with ${priceMove} vs current ASP, ` +
      `targeting ${pct(scenario.targetShare)} market share on ` +
      `${pct(scenario.expectedVolumeGrowthPct)} expected volume growth.`,
  )

  // 2 — The facility today (or an honest note when no snapshot was loaded).
  if (facility) {
    const revenueBasis =
      facility.revenueMode === "actuals"
        ? "from case-costing actuals"
        : "a manual assumption"
    paragraphs.push(
      `${facility.facilityName} runs ${usd(facility.netRevenue)} of net revenue (${revenueBasis}) ` +
        `against ${usd(facility.currentVendorSpend)} of current vendor spend, producing ` +
        `${usd(facility.ebitda)} of EBITDA at a ${pct(facility.ebitdaMarginPct)} margin and a ` +
        `${usd(facility.dcf)} DCF enterprise value.`,
    )
  } else {
    paragraphs.push(
      "No facility financial snapshot was loaded for this scenario — the " +
        "current-state figures are modeled from default assumptions, not " +
        "facility data.",
    )
  }

  // 3 — The proposed deal (per-construct summary) — only when a deal rode in
  // from the stepper.
  if (constructs && constructs.length > 0) {
    const totalVolume = constructs.reduce((s, c) => s + c.annualVolume, 0)
    const currentSpend = constructs.reduce(
      (s, c) => s + c.current * c.annualVolume,
      0,
    )
    const targetSpend = constructs.reduce(
      (s, c) => s + c.target * c.annualVolume,
      0,
    )
    // Spend-weighted blended rebate at Target pricing (simple average when
    // there is no target spend to weight by).
    const blendedRebatePct =
      targetSpend > 0
        ? constructs.reduce(
            (s, c) => s + c.rebatePercent * c.target * c.annualVolume,
            0,
          ) / targetSpend
        : constructs.reduce((s, c) => s + c.rebatePercent, 0) /
          constructs.length

    const priceClause =
      currentSpend > 0
        ? (() => {
            const change = (targetSpend - currentSpend) / currentSpend
            if (change < 0) return `runs ${pct(-change)} below current pricing`
            if (change > 0) return `runs ${pct(change)} above current pricing`
            return "holds current pricing"
          })()
        : "is priced without a current-price baseline"

    const plural = constructs.length === 1 ? "product" : "products"
    paragraphs.push(
      `The proposed deal covers ${constructs.length} ${plural} ` +
        `(${totalVolume.toLocaleString("en-US")} units/yr): Target pricing ${priceClause} ` +
        `with a ${formatPercent(blendedRebatePct)} blended rebate.`,
    )
  }

  // 4 — What winning it is worth. Win probability is deterministic — say so.
  const incremental =
    engine.incrementalRevenue >= 0
      ? `+${usd(engine.incrementalRevenue)}`
      : usd(engine.incrementalRevenue)
  let winParagraph =
    `The deterministic model puts win probability at ${pct(engine.winProbability)}. ` +
    `Winning moves vendor revenue from ${usd(engine.currentRevenue)} to ` +
    `${usd(engine.targetRevenue)} (${incremental}) and blended market share to ` +
    `${pct(engine.blendedMarketShare)}, with ${usd(engine.territoryRecurringRevenue)} ` +
    `counting as territory recurring revenue.`
  if (engine.capitalRoboticRevenue > 0) {
    winParagraph +=
      ` The deal also carries ${usd(engine.capitalRoboticRevenue)} of capital / robotic ` +
      `revenue, which does not hit the territory number.`
  }
  paragraphs.push(winParagraph)

  // 5 — Score + recommended offer.
  let offerParagraph =
    `It scores ${score.overall}/100 on the opportunity model ` +
    `(${score.winProbability.riskLevel.toLowerCase()} risk). ` +
    `Recommended action: ${score.winProbability.recommendedAction}.`
  if (score.recommendedOffer.items.length > 0) {
    offerParagraph +=
      ` To reach ${score.recommendedOffer.targetConversionPct}% conversion, the ` +
      `recommended offer includes ${score.recommendedOffer.items.join(", ")}.`
  }
  paragraphs.push(offerParagraph)

  return paragraphs
}
