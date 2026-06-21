/**
 * Vendor Opportunity Score + AI Win Probability + Recommended Offer
 * Structure — Charles vendor-module expansion (2026-06-21).
 *
 * Pure function. Builds on {@link computeOpportunityEngine}'s scenario result
 * and a few strategic inputs to produce:
 *
 *   1. A weighted Opportunity Score (0–100) across financial + strategic
 *      dimensions.
 *   2. An AI Win Probability block: probability, risk level, competitive
 *      threat, recommended action.
 *   3. A Recommended Offer Structure: the concrete levers to pull to reach a
 *      target conversion likelihood.
 *
 *      "To achieve 90% likelihood of conversion, recommend:
 *        • 80% TJA commitment • 70% Sports commitment • SPD financing
 *        • 10% growth rebate • mymobility inclusion"
 */

import { clamp01, clamp0100 } from "@/lib/math/clamp"
import type { OpportunityEngineResult } from "./opportunity-engine"

export interface VendorOpportunityScoreInput {
  engine: OpportunityEngineResult
  /** Rebate cost as a fraction of revenue (higher = worse). */
  rebateCostPct: number
  /** Share-of-wallet gain at the account, fraction (0–1). */
  shareOfWalletGainPct: number
  /** Competitive displacement strength, 0–100. */
  competitiveDisplacementScore: number
  /** Multi-business-unit penetration, 0–100. */
  multiBuPenetrationScore: number
  /** Technology adoption (robotics/nav/digital), 0–100. */
  technologyAdoptionScore: number
  /** Named incumbent competitor, e.g. "Stryker". */
  competitiveThreat?: string
  /** Whether the deal already includes capital/robotic revenue. */
  hasCapital?: boolean
}

export interface ScoreDimension {
  key: string
  label: string
  weight: number
  score: number
  weightedContribution: number
}

export type RiskLevel = "Low" | "Medium" | "High"

export interface AiWinProbability {
  probability: number
  riskLevel: RiskLevel
  competitiveThreat: string
  recommendedAction: string
}

export interface RecommendedOffer {
  targetConversionPct: number
  items: string[]
}

export interface VendorOpportunityScore {
  overall: number
  financial: ScoreDimension[]
  strategic: ScoreDimension[]
  winProbability: AiWinProbability
  recommendedOffer: RecommendedOffer
}

const FINANCIAL_WEIGHTS = {
  aspImpact: 10,
  revenueGrowth: 15,
  grossMarginImpact: 10,
  netUnitGrowth: 10,
  rebateCost: 5,
} as const

const STRATEGIC_WEIGHTS = {
  marketShareGain: 15,
  shareOfWalletGain: 10,
  competitiveDisplacement: 10,
  multiBuPenetration: 10,
  technologyAdoption: 5,
} as const

export function computeVendorOpportunityScore(
  input: VendorOpportunityScoreInput,
): VendorOpportunityScore {
  const { engine } = input

  // ── Financial dimensions ─────────────────────────────────────
  const aspScore = scale01(engine.netUnitImpact > 0 ? 0.7 : 0.3)
  const revenueGrowthScore = scale01(
    engine.currentRevenue > 0
      ? engine.incrementalRevenue / engine.currentRevenue / 3
      : engine.incrementalRevenue > 0
        ? 1
        : 0,
  )
  const grossMarginScore = scale01(0.6) // neutral-positive default
  const netUnitScore = scale01(
    engine.currentUnits > 0
      ? engine.netUnitImpact / engine.currentUnits
      : engine.netUnitImpact > 0
        ? 1
        : 0,
  )
  // Rebate COST: high rebate is bad → invert.
  const rebateCostScore = scale01(1 - clamp01(input.rebateCostPct * 4))

  const financial: ScoreDimension[] = [
    dim("aspImpact", "ASP Impact", FINANCIAL_WEIGHTS.aspImpact, aspScore),
    dim(
      "revenueGrowth",
      "Revenue Growth",
      FINANCIAL_WEIGHTS.revenueGrowth,
      revenueGrowthScore,
    ),
    dim(
      "grossMarginImpact",
      "Gross Margin Impact",
      FINANCIAL_WEIGHTS.grossMarginImpact,
      grossMarginScore,
    ),
    dim(
      "netUnitGrowth",
      "Net Unit Growth",
      FINANCIAL_WEIGHTS.netUnitGrowth,
      netUnitScore,
    ),
    dim("rebateCost", "Rebate Cost", FINANCIAL_WEIGHTS.rebateCost, rebateCostScore),
  ]

  // ── Strategic dimensions ─────────────────────────────────────
  const marketShareScore = scale01(engine.blendedMarketShare * 1.5)
  const strategic: ScoreDimension[] = [
    dim(
      "marketShareGain",
      "Market Share Gain",
      STRATEGIC_WEIGHTS.marketShareGain,
      marketShareScore,
    ),
    dim(
      "shareOfWalletGain",
      "Share of Wallet Gain",
      STRATEGIC_WEIGHTS.shareOfWalletGain,
      scale01(input.shareOfWalletGainPct),
    ),
    dim(
      "competitiveDisplacement",
      "Competitive Displacement",
      STRATEGIC_WEIGHTS.competitiveDisplacement,
      clamp0100(input.competitiveDisplacementScore),
    ),
    dim(
      "multiBuPenetration",
      "Multi-BU Penetration",
      STRATEGIC_WEIGHTS.multiBuPenetration,
      clamp0100(input.multiBuPenetrationScore),
    ),
    dim(
      "technologyAdoption",
      "Technology Adoption",
      STRATEGIC_WEIGHTS.technologyAdoption,
      clamp0100(input.technologyAdoptionScore),
    ),
  ]

  const overall = Math.round(
    [...financial, ...strategic].reduce(
      (s, d) => s + d.weightedContribution,
      0,
    ),
  )

  return {
    overall,
    financial,
    strategic,
    winProbability: buildWinProbability(input),
    recommendedOffer: buildRecommendedOffer(input),
  }
}

function buildWinProbability(
  input: VendorOpportunityScoreInput,
): AiWinProbability {
  const p = input.engine.winProbability
  const riskLevel: RiskLevel = p >= 0.6 ? "Low" : p >= 0.35 ? "Medium" : "High"

  // Recommended action targets the weakest lever.
  let recommendedAction: string
  if (!input.hasCapital) {
    recommendedAction = "Add SPD financing"
  } else if (input.rebateCostPct > 0.12) {
    recommendedAction = "Restructure rebate to a growth-tied ladder"
  } else if (input.technologyAdoptionScore < 50) {
    recommendedAction = "Bundle technology / robotics adoption"
  } else {
    recommendedAction = "Lock multi-year commitment with price protection"
  }

  return {
    probability: p,
    riskLevel,
    competitiveThreat: input.competitiveThreat ?? "Incumbent supplier",
    recommendedAction,
  }
}

function buildRecommendedOffer(
  input: VendorOpportunityScoreInput,
): RecommendedOffer {
  const items: string[] = []
  const targetSharePct = Math.round(input.engine.blendedMarketShare * 100)

  items.push(`${Math.max(70, Math.min(90, targetSharePct + 20))}% TJA commitment`)
  items.push(`${Math.max(60, Math.min(80, targetSharePct + 10))}% Sports commitment`)
  if (!input.hasCapital) items.push("SPD financing")
  items.push("10% growth rebate")
  items.push("mymobility inclusion")

  return { targetConversionPct: 90, items }
}

function dim(
  key: string,
  label: string,
  weight: number,
  score: number,
): ScoreDimension {
  const s = clamp0100(score)
  return { key, label, weight, score: s, weightedContribution: (weight * s) / 100 }
}

function scale01(ratio: number): number {
  return clamp0100(clamp01(ratio) * 100)
}

