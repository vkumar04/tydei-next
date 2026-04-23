/**
 * Tie-in compliance math — the tydei implementation of Charles's v0
 * "bundled multi-product tie-in" spec. Mirrors:
 *   `lib/v0-spec/rebate-math.ts::v0TieInAllOrNothing`
 *   `lib/v0-spec/rebate-math.ts::v0TieInProportional`
 *   `lib/v0-spec/tie-in.ts::v0CrossVendorTieIn`
 *   `lib/v0-spec/tie-in.ts::v0TieInImpactAnalysis`
 *
 * This is deliberately a pure-function module with no Prisma / I/O so
 *   (a) the oracle can parity-check against the v0 reference.
 *   (b) future Prisma-backed tie-in models (bundle / members / vendor
 *       commitments) can import these helpers once the schema lands,
 *       without restructuring the math.
 *
 * IMPORTANT — names overlap: the existing `Contract.contractType`
 * "tie_in" in tydei is a DIFFERENT concept (consumable contract whose
 * earned rebates pay down a capital balance). This module handles
 * v0's bundled-multi-product tie-in semantics. Schema integration will
 * need to disambiguate before the two concepts are exposed side-by-side.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface TieInBundleMember {
  minimumSpend: number
  currentSpend: number
}

export interface TieInBundleRebate {
  /** Integer percent (2 means 2%). */
  baseRate: number
  /** Added to baseRate when every member is ≥ 120% of its minimum. */
  bonusRate?: number
  /** Multiplies (baseRate + bonusRate) when every member is ≥ 150%. */
  acceleratorMultiplier?: number
}

export interface TieInAllOrNothingResult {
  compliant: boolean
  totalSpend: number
  /** Integer percent actually applied (0 if non-compliant). */
  applicableRate: number
  rebateEarned: number
  bonusLevel: "none" | "base" | "bonus" | "accelerator"
  /** Populated when non-compliant: per-member spend gap. */
  shortfalls: Array<{ index: number; shortfall: number }>
}

export interface TieInProportionalMember extends TieInBundleMember {
  weight: number
}

export interface TieInProportionalResult {
  /** 0..1 — weighted compliance fraction. */
  overallCompliance: number
  totalSpend: number
  /** Integer percent — baseRate × overallCompliance. */
  effectiveRate: number
  rebateEarned: number
  /** Missed-rebate $: what they would have earned at full compliance. */
  lostRebate: number
}

export interface CrossVendorCommitment {
  vendorId: string
  vendorName: string
  minimumSpend: number
  /** Integer percent. */
  rebateContribution: number
  currentSpend: number
}

export interface CrossVendorFacilityBonus {
  /** Integer percent. */
  rate: number
  requirement: "all_compliant" | "none"
}

export interface CrossVendorResult {
  perVendor: Array<{
    vendorId: string
    vendorName: string
    spend: number
    rebate: number
    compliant: boolean
    shortfall: number
  }>
  vendorRebateTotal: number
  facilityBonus: number
  totalRebate: number
  allCompliant: boolean
  totalSpend: number
}

export interface TieInScenario {
  name: string
  spends: number[]
}

export interface TieInScenarioResult {
  scenarioName: string
  totalSpend: number
  rebateEarned: number
  /** Integer percent. */
  rebatePct: number
  compliant: boolean
  /** (rebate / totalSpend) × 100. 0 when totalSpend = 0. */
  roiPct: number
}

// ─── All-or-Nothing ────────────────────────────────────────────────

export function computeTieInAllOrNothing(
  members: TieInBundleMember[],
  bundle: TieInBundleRebate,
): TieInAllOrNothingResult {
  const totalSpend = members.reduce((s, m) => s + m.currentSpend, 0)
  const shortfalls = members
    .map((m, i) => ({ index: i, shortfall: m.minimumSpend - m.currentSpend }))
    .filter((s) => s.shortfall > 0)
  if (shortfalls.length > 0) {
    return {
      compliant: false,
      totalSpend,
      applicableRate: 0,
      rebateEarned: 0,
      bonusLevel: "none",
      shortfalls,
    }
  }
  const allOver20 = members.every(
    (m) => m.currentSpend >= m.minimumSpend * 1.2,
  )
  const allOver50 = members.every(
    (m) => m.currentSpend >= m.minimumSpend * 1.5,
  )
  let rate = bundle.baseRate
  let level: TieInAllOrNothingResult["bonusLevel"] = "base"
  if (
    allOver50 &&
    bundle.bonusRate != null &&
    bundle.acceleratorMultiplier != null
  ) {
    rate = (bundle.baseRate + bundle.bonusRate) * bundle.acceleratorMultiplier
    level = "accelerator"
  } else if (allOver20 && bundle.bonusRate != null) {
    rate = bundle.baseRate + bundle.bonusRate
    level = "bonus"
  }
  return {
    compliant: true,
    totalSpend,
    applicableRate: rate,
    rebateEarned: totalSpend * (rate / 100),
    bonusLevel: level,
    shortfalls: [],
  }
}

// ─── Proportional ──────────────────────────────────────────────────

export function computeTieInProportional(
  members: TieInProportionalMember[],
  baseRate: number,
): TieInProportionalResult {
  const overallCompliance = members.reduce(
    (sum, m) =>
      sum +
      Math.min(
        1,
        m.minimumSpend > 0 ? m.currentSpend / m.minimumSpend : 0,
      ) *
        m.weight,
    0,
  )
  const totalSpend = members.reduce((s, m) => s + m.currentSpend, 0)
  const effectiveRate = baseRate * overallCompliance
  const rebateEarned = totalSpend * (effectiveRate / 100)
  const potentialRebate = totalSpend * (baseRate / 100)
  return {
    overallCompliance,
    totalSpend,
    effectiveRate,
    rebateEarned,
    lostRebate: potentialRebate - rebateEarned,
  }
}

// ─── Cross-Vendor ──────────────────────────────────────────────────

export function computeCrossVendorTieIn(
  vendors: CrossVendorCommitment[],
  facilityBonus: CrossVendorFacilityBonus,
): CrossVendorResult {
  const perVendor = vendors.map((v) => {
    const compliant = v.currentSpend >= v.minimumSpend
    return {
      vendorId: v.vendorId,
      vendorName: v.vendorName,
      spend: v.currentSpend,
      rebate: compliant ? v.currentSpend * (v.rebateContribution / 100) : 0,
      compliant,
      shortfall: compliant ? 0 : v.minimumSpend - v.currentSpend,
    }
  })
  const vendorRebateTotal = perVendor.reduce((s, r) => s + r.rebate, 0)
  const totalSpend = vendors.reduce((s, v) => s + v.currentSpend, 0)
  const allCompliant = perVendor.every((r) => r.compliant)
  const bonus =
    allCompliant && facilityBonus.requirement === "all_compliant"
      ? totalSpend * (facilityBonus.rate / 100)
      : 0
  return {
    perVendor,
    vendorRebateTotal,
    facilityBonus: bonus,
    totalRebate: vendorRebateTotal + bonus,
    allCompliant,
    totalSpend,
  }
}

// ─── Impact Analysis ───────────────────────────────────────────────

export function runTieInImpactAnalysis(
  members: { minimumSpend: number }[],
  bundle: TieInBundleRebate,
  scenarios: TieInScenario[],
): TieInScenarioResult[] {
  return scenarios.map((scen) => {
    const withSpend = members.map((m, i) => ({
      minimumSpend: m.minimumSpend,
      currentSpend: scen.spends[i] ?? 0,
    }))
    const result = computeTieInAllOrNothing(withSpend, bundle)
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
