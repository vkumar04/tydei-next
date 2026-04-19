/**
 * Pure helpers for deriving score-page recommendations from an AI deal
 * score. Extracted from `components/facility/contracts/contract-score-client.tsx`
 * so both the client card + the CSV export route (`/api/contracts/[id]/score/export`)
 * draw recommendations from the exact same rules.
 *
 * Nothing here touches the network, the DB, or React state — the AI
 * score is fetched by the caller and handed in.
 */

import type { DealScoreResult } from "@/lib/ai/schemas"

export interface ScoreDimensions {
  pricingCompetitiveness: number
  rebateStructure: number
  contractFlexibility: number
  volumeAlignment: number
  marketComparison: number
  riskAssessment: number
}

export type RecommendationSeverity = "success" | "warning" | "danger"

export interface ScoreRecommendation {
  severity: RecommendationSeverity
  category: string
  title: string
  description: string
}

export function buildDimensions(ai: DealScoreResult): ScoreDimensions {
  return {
    pricingCompetitiveness: ai.pricingCompetitiveness,
    rebateStructure: ai.rebateEfficiency,
    contractFlexibility: Math.round(
      (ai.financialValue + ai.complianceLikelihood) / 2
    ),
    volumeAlignment: ai.marketShareAlignment,
    marketComparison: ai.financialValue,
    riskAssessment: ai.complianceLikelihood,
  }
}

export function buildRecommendations(
  dims: ScoreDimensions,
  aiRec: string,
  advice: string[]
): ScoreRecommendation[] {
  const recs: ScoreRecommendation[] = []

  if (aiRec) {
    recs.push({
      severity: "success",
      category: "AI Assessment",
      title: "AI Assessment",
      description: aiRec,
    })
  }

  if (dims.pricingCompetitiveness < 60) {
    recs.push({
      severity: "danger",
      category: "Pricing",
      title: "Pricing Below Market",
      description:
        "Contract pricing is not competitive. Consider renegotiating pricing terms or evaluating alternative vendors.",
    })
  } else if (dims.pricingCompetitiveness >= 80) {
    recs.push({
      severity: "success",
      category: "Pricing",
      title: "Strong Pricing Position",
      description:
        "Contract pricing is highly competitive. Use this as leverage during renewal discussions.",
    })
  }

  if (dims.rebateStructure < 60) {
    recs.push({
      severity: "warning",
      category: "Rebates",
      title: "Improve Rebate Capture",
      description:
        "Rebate structure efficiency is low. Review product mix and ensure all eligible purchases flow through the contract.",
    })
  }

  if (dims.volumeAlignment < 60) {
    recs.push({
      severity: "warning",
      category: "Volume",
      title: "Volume Misalignment",
      description:
        "Committed volumes do not align well with actual purchasing. Consolidate purchases or renegotiate volume tiers.",
    })
  }

  if (dims.riskAssessment < 60) {
    recs.push({
      severity: "danger",
      category: "Risk",
      title: "Elevated Risk Profile",
      description:
        "Compliance and risk indicators are concerning. Review contract terms and establish monitoring processes.",
    })
  }

  advice.forEach((tip) => {
    recs.push({
      severity: "warning",
      category: "Negotiation Tip",
      title: "Negotiation Tip",
      description: tip,
    })
  })

  return recs
}

// RFC 4180 CSV escape — quote values containing comma/quote/CR/LF,
// double embedded quotes.
const csvEscape = (raw: unknown): string => {
  if (raw === null || raw === undefined) return ""
  const s = typeof raw === "string" ? raw : String(raw)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export const RECOMMENDATIONS_CSV_HEADERS = [
  "severity",
  "category",
  "title",
  "rationale",
] as const

export function buildRecommendationsCSV(
  recs: ReadonlyArray<ScoreRecommendation>
): string {
  const lines: string[] = [RECOMMENDATIONS_CSV_HEADERS.join(",")]
  for (const r of recs) {
    lines.push(
      [
        csvEscape(r.severity),
        csvEscape(r.category),
        csvEscape(r.title),
        csvEscape(r.description),
      ].join(",")
    )
  }
  return lines.join("\n")
}
