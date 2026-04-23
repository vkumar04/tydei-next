/**
 * v0 spec — Tie-in (bundled multi-product) contract math, plus the
 * related Capital depreciation and Service SLA rules that sit alongside
 * tie-in in the docs.
 * Source: docs/contract-calculations.md §1 (Capital, Service, Tie-In
 * structures) + §4 (Tie-In Calculations).
 *
 * IMPORTANT naming note: v0 uses "tie-in" for BUNDLED multi-product
 * agreements with combined rebates. Tydei uses "tie-in capital" for a
 * different concept — a consumable contract whose earned rebates pay
 * down a separate equipment balance (Bug 3a). The two concepts share a
 * name but are unrelated; v0 does not specify the paydown math for the
 * tydei "tie-in capital" model, so this module cannot be the oracle
 * for that feature.
 */
import {
  v0TieInAllOrNothing,
  type V0TieInBundleRebate,
  type V0TieInResult,
} from "./rebate-math"

/**
 * Cross-vendor tie-in (docs §4 "Cross-Vendor Tie-In").
 * Each vendor contributes its own rebate rate applied to its own spend
 * IF that vendor meets its minimum. A facility bonus (typically from
 * the facility's GPO) kicks in when ALL vendors are compliant.
 *
 * Doc example:
 *   Suture Co: $50k min @ 2%
 *   Implant Inc: $100k min @ 2.5%
 *   Equipment Ltd: $75k min @ 1.5%
 *   facilityBonus: 1% when all_compliant
 *   At exact minimums: $1,000 + $2,500 + $1,125 = $4,625 vendor rebate
 *                      + facility bonus 1% × $225k total = $2,250
 *                      → totalRebate $6,875, allCompliant true.
 */
export interface V0CrossVendorCommitment {
  vendorId: string
  vendorName: string
  minimumSpend: number
  rebateContribution: number // integer percent (2 means 2%)
  currentSpend: number
}
export interface V0FacilityBonus {
  rate: number // integer percent
  requirement: "all_compliant" | "none"
}
export interface V0CrossVendorMemberResult {
  vendor: string
  spend: number
  rebate: number
  compliant: boolean
  shortfall: number
}
export interface V0CrossVendorResult {
  vendorRebates: V0CrossVendorMemberResult[]
  vendorRebateTotal: number
  facilityBonus: number
  totalRebate: number
  allCompliant: boolean
  totalSpend: number
}
export function v0CrossVendorTieIn(
  vendors: V0CrossVendorCommitment[],
  facilityBonus: V0FacilityBonus,
): V0CrossVendorResult {
  const vendorRebates: V0CrossVendorMemberResult[] = vendors.map((v) => {
    const compliant = v.currentSpend >= v.minimumSpend
    return {
      vendor: v.vendorName,
      spend: v.currentSpend,
      rebate: compliant ? v.currentSpend * (v.rebateContribution / 100) : 0,
      compliant,
      shortfall: compliant ? 0 : v.minimumSpend - v.currentSpend,
    }
  })
  const vendorRebateTotal = vendorRebates.reduce((s, r) => s + r.rebate, 0)
  const totalSpend = vendors.reduce((s, v) => s + v.currentSpend, 0)
  const allCompliant = vendorRebates.every((r) => r.compliant)
  const bonus =
    allCompliant && facilityBonus.requirement === "all_compliant"
      ? totalSpend * (facilityBonus.rate / 100)
      : 0
  return {
    vendorRebates,
    vendorRebateTotal,
    facilityBonus: bonus,
    totalRebate: vendorRebateTotal + bonus,
    allCompliant,
    totalSpend,
  }
}

/**
 * Tie-in impact analysis — run an all-or-nothing tie-in through a set
 * of spend scenarios and return the rebate/compliance per scenario.
 * Used in the Rebate Optimizer to show "what happens if we shift
 * spend" cards. Source: docs/contract-calculations.md §4.
 */
export interface V0TieInScenario {
  name: string
  spends: number[] // one per member, positional
}
export interface V0TieInScenarioResult {
  scenarioName: string
  totalSpend: number
  rebateEarned: number
  rebatePct: number
  compliant: boolean
  roiPct: number
}
export function v0TieInImpactAnalysis(
  members: { minimumSpend: number }[],
  bundle: V0TieInBundleRebate,
  scenarios: V0TieInScenario[],
): V0TieInScenarioResult[] {
  return scenarios.map((scen) => {
    const withSpend = members.map((m, i) => ({
      minimumSpend: m.minimumSpend,
      currentSpend: scen.spends[i] ?? 0,
    }))
    const result: V0TieInResult = v0TieInAllOrNothing(withSpend, bundle)
    const totalSpend = scen.spends.reduce((a, b) => a + b, 0)
    return {
      scenarioName: scen.name,
      totalSpend,
      rebateEarned: result.rebateEarned,
      rebatePct: result.compliant ? result.applicableRate : 0,
      compliant: result.compliant,
      roiPct: totalSpend > 0 ? (result.rebateEarned / totalSpend) * 100 : 0,
    }
  })
}

/**
 * Capital contract straight-line depreciation (docs §1 Capital).
 *   annualDepreciation = (purchasePrice − salvageValue) / usefulLifeYears
 */
export function v0StraightLineDepreciation(input: {
  purchasePrice: number
  salvageValue: number
  usefulLifeYears: number
}): number {
  if (input.usefulLifeYears <= 0) return 0
  return (input.purchasePrice - input.salvageValue) / input.usefulLifeYears
}

/**
 * Capital contract declining-balance depreciation (docs §1 Capital).
 *   annualDepreciation = bookValue × depreciationRatePct/100
 */
export function v0DecliningBalanceDepreciation(input: {
  bookValue: number
  depreciationRatePct: number
}): number {
  return input.bookValue * (input.depreciationRatePct / 100)
}

/**
 * Service-contract SLA penalty (docs §1 Service).
 *   penalty = 0
 *   if actualResponseHours > slaResponseHours:
 *     penalty += (actualResponseHours − slaResponseHours) × hourlyPenaltyRate
 *   if actualUptimePct < slaUptimePct:
 *     penalty += annualFee × (slaUptimePct − actualUptimePct) / 100
 */
export function v0ServiceSlaPenalty(input: {
  actualResponseHours: number
  slaResponseHours: number
  hourlyPenaltyRate: number
  actualUptimePct: number
  slaUptimePct: number
  annualFee: number
}): {
  responsePenalty: number
  uptimePenalty: number
  totalPenalty: number
} {
  const responsePenalty =
    input.actualResponseHours > input.slaResponseHours
      ? (input.actualResponseHours - input.slaResponseHours) *
        input.hourlyPenaltyRate
      : 0
  const uptimePenalty =
    input.actualUptimePct < input.slaUptimePct
      ? input.annualFee *
        ((input.slaUptimePct - input.actualUptimePct) / 100)
      : 0
  return {
    responsePenalty,
    uptimePenalty,
    totalPenalty: responsePenalty + uptimePenalty,
  }
}
