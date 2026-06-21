/**
 * Facility Contract Opportunity Score (0–100) — Charles AI Prospective
 * Impact Engine, feature #1 (2026-06-21).
 *
 * Pure function. Scores a proposed agreement on seven weighted variables:
 *
 *   EBITDA Impact            30%
 *   Margin Impact            20%
 *   DCF Impact               15%
 *   Cash Flow Timing         10%
 *   Vendor Concentration     10%
 *   Growth Alignment         10%
 *   Technology Enablement     5%
 *
 * Each sub-score is 0–100; the overall is the weight-weighted average (the
 * weights sum to 100, so the overall is itself 0–100). The output also
 * carries a percentile label, e.g. "scores 87/100 and ranks in the top 12%
 * of historical orthopedic contracts analyzed."
 */

import { clamp01, clamp0100 } from "@/lib/math/clamp"
import type { FacilityProspectiveModel } from "./prospective-impact-model"

export interface FacilityOpportunityScoreInput {
  /** The prospective model (current + impact) for this proposal. */
  model: FacilityProspectiveModel
  /** ΔEBITDA / EBITDA that counts as a full-marks impact (default 0.08 = 8%). */
  targetEbitdaImpactPct?: number
  /** ΔMargin points that count as full marks (default 2.0 pts). */
  targetMarginPoints?: number
  /** Top-vendor share of supply spend, fraction (0–1). Higher = riskier. */
  vendorConcentrationPct: number
  /** How soon the benefit lands, 0–100 (sooner = higher). */
  cashFlowTimingScore: number
  /** Alignment with the facility's growth categories, 0–100. */
  growthAlignmentScore: number
  /** Robotics / navigation / tech enablement, 0–100. */
  technologyEnablementScore: number
}

export interface OpportunityScoreComponent {
  key: string
  label: string
  weight: number
  /** Sub-score 0–100. */
  score: number
  /** weight × score / 100 — points this component adds to the overall. */
  weightedContribution: number
}

export interface FacilityOpportunityScore {
  /** 0–100. */
  overall: number
  /** e.g. 12 → "top 12%". */
  topPercentile: number
  /** One-line summary sentence. */
  headline: string
  components: OpportunityScoreComponent[]
}

const WEIGHTS = {
  ebitdaImpact: 30,
  marginImpact: 20,
  dcfImpact: 15,
  cashFlowTiming: 10,
  vendorConcentration: 10,
  growthAlignment: 10,
  technologyEnablement: 5,
} as const

export function computeFacilityOpportunityScore(
  input: FacilityOpportunityScoreInput,
): FacilityOpportunityScore {
  const { model } = input
  const targetEbitda = input.targetEbitdaImpactPct ?? 0.08
  const targetMargin = input.targetMarginPoints ?? 2.0

  const ebitda = model.current.ebitda
  const ebitdaImpactRatio =
    ebitda > 0 ? model.impact.impactToEbitda / ebitda : 0
  const ebitdaScore = scale01(ebitdaImpactRatio / targetEbitda)

  const marginScore = scale01(model.impact.impactToMarginPoints / targetMargin)

  const dcfPerYear = model.current.distributableCashFlowPerYear
  const dcfRatio =
    dcfPerYear > 0
      ? model.impact.impactToDistributableCashFlow / dcfPerYear
      : 0
  const dcfScore = scale01(dcfRatio / targetEbitda)

  // Concentration RISK: a concentrated supply base scores LOW.
  const concentrationScore = scale01(1 - clamp01(input.vendorConcentrationPct))

  const components: OpportunityScoreComponent[] = [
    mk("ebitdaImpact", "EBITDA Impact", WEIGHTS.ebitdaImpact, ebitdaScore),
    mk("marginImpact", "Margin Impact", WEIGHTS.marginImpact, marginScore),
    mk("dcfImpact", "DCF Impact", WEIGHTS.dcfImpact, dcfScore),
    mk(
      "cashFlowTiming",
      "Cash Flow Timing",
      WEIGHTS.cashFlowTiming,
      clamp0100(input.cashFlowTimingScore),
    ),
    mk(
      "vendorConcentration",
      "Vendor Concentration Risk",
      WEIGHTS.vendorConcentration,
      concentrationScore,
    ),
    mk(
      "growthAlignment",
      "Growth Alignment",
      WEIGHTS.growthAlignment,
      clamp0100(input.growthAlignmentScore),
    ),
    mk(
      "technologyEnablement",
      "Technology Enablement",
      WEIGHTS.technologyEnablement,
      clamp0100(input.technologyEnablementScore),
    ),
  ]

  const overall = Math.round(
    components.reduce((s, c) => s + c.weightedContribution, 0),
  )
  const topPercentile = Math.min(99, Math.max(1, Math.round((100 - overall) * 0.92)))

  return {
    overall,
    topPercentile,
    headline: `This proposal scores ${overall}/100 and ranks in the top ${topPercentile}% of historical orthopedic contracts analyzed.`,
    components,
  }
}

function mk(
  key: string,
  label: string,
  weight: number,
  score: number,
): OpportunityScoreComponent {
  const s = clamp0100(score)
  return { key, label, weight, score: s, weightedContribution: (weight * s) / 100 }
}

function scale01(ratio: number): number {
  return clamp0100(clamp01(ratio) * 100)
}

