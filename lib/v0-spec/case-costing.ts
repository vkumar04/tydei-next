/**
 * v0 spec — Case-costing / surgeon-scorecard math.
 * Source: docs/facility-case-costing-functionality.md + §8 of
 * contract-calculations.md.
 */

/** Default rebate estimation by tier number (0-based). 2% per tier. */
export function v0DefaultTierRebatePct(tierNumber: number): number {
  if (tierNumber < 0) return 0
  return Math.min(tierNumber, 10) * 2
}

/**
 * CPT-code-based surgeon specialty inference.
 *   27*, 29* → Orthopedic
 *   22*, 63* → Spine
 *   33*      → Cardiac
 *   43*, 44* → General
 *   else     → General (fallback)
 */
export type V0Specialty = "orthopedic" | "spine" | "cardiac" | "general"
export function v0SpecialtyFromCPT(cpt: string): V0Specialty {
  const prefix = cpt.slice(0, 2)
  if (prefix === "27" || prefix === "29") return "orthopedic"
  if (prefix === "22" || prefix === "63") return "spine"
  if (prefix === "33") return "cardiac"
  if (prefix === "43" || prefix === "44") return "general"
  return "general"
}

/** Surgeon payment multiplier applied to totalSpend for reimbursement. */
export function v0SpecialtyPaymentMultiplier(specialty: V0Specialty): number {
  if (specialty === "cardiac") return 1.2
  if (specialty === "spine") return 1.3
  return 1.35
}

/**
 * 5-dimension surgeon scorecard (each 0-100; overall = mean).
 *   payorMix:  % of cases with commercial/private/blue/aetna/united payer
 *   bmi:       % patients with BMI < 40 (default 80)
 *   age:       % patients age < 65 (default 70)
 *   spend:     max(0, 100 − avgSpend/500)
 *   time:      max(0, 100 − avgCaseTime/5)   // minutes
 */
export interface V0SurgeonScoreInput {
  payorMixPct: number
  bmiUnder40Pct: number
  ageUnder65Pct: number
  avgSpend: number
  avgCaseTimeMinutes: number
}
export interface V0SurgeonScore {
  payor: number
  bmi: number
  age: number
  spend: number
  time: number
  overall: number
}
export function v0SurgeonScore(input: V0SurgeonScoreInput): V0SurgeonScore {
  const payor = clamp100(input.payorMixPct)
  const bmi = clamp100(input.bmiUnder40Pct)
  const age = clamp100(input.ageUnder65Pct)
  const spend = Math.max(0, 100 - input.avgSpend / 500)
  const time = Math.max(0, 100 - input.avgCaseTimeMinutes / 5)
  const overall = (payor + bmi + age + spend + time) / 5
  return { payor, bmi, age, spend, time, overall }
}

/** Peer variance vs average: ((surgeonAvg − peerAvg) / peerAvg) × 100. */
export function v0PeerVariancePct(surgeonAvg: number, peerAvg: number): number {
  if (peerAvg <= 0) return 0
  return ((surgeonAvg - peerAvg) / peerAvg) * 100
}

/** CMI-adjusted average spend per case: rawAvgSpend / caseMixIndex. */
export function v0CMIAdjustedSpend(
  rawAvgSpend: number,
  caseMixIndex: number,
): number {
  if (caseMixIndex <= 0) return rawAvgSpend
  return rawAvgSpend / caseMixIndex
}

function clamp100(v: number): number {
  return Math.max(0, Math.min(100, v))
}
