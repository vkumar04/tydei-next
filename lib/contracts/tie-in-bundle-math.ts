/**
 * Bundled multi-product ("tie-in") contract math.
 *
 * Migrated out of `lib/v0-spec/` on 2026-07-29 with ZERO behaviour change —
 * every function below is byte-for-byte the arithmetic that shipped before,
 * only de-branded and rehomed. Golden outputs were captured from the old
 * module and asserted against this one; see
 * `lib/contracts/__tests__/v0-migration-parity.test.ts`.
 *
 * WHY THE MOVE. `lib/v0-spec/` began as a transcription of Charles's v0 spec
 * docs, kept as an "oracle" that `scripts/e2e-synthetic-test.ts` diffed the
 * real implementation against. That arrangement is over: the source docs were
 * deleted on 2026-07-25 in favour of the graph, and the parity harness was
 * wired to no npm script, CI workflow, or deploy step — so it had not run in
 * a long time. What remained was ordinary production math wearing a `v0`
 * prefix, imported by live analytics. It now lives where it is used.
 *
 * NAMING. "Tie-in" here means a BUNDLED multi-product agreement with a
 * combined rebate. Tydei separately uses "tie-in capital" for an unrelated
 * concept — a consumable contract whose earned rebates pay down an equipment
 * balance. The two share a word and nothing else; `lib/contracts/tie-in.ts`
 * and `tie-in-shortfall-waterfall.ts` own that other meaning. Do not merge
 * these modules on the strength of the name.
 *
 * UNITS. Every rate on this module is an INTEGER PERCENT — `2` means 2%.
 * That matches the rebate engine's boundary contract; the ×100 conversion
 * from the Prisma Decimal fraction happens in `scaleRebateValueForEngine`
 * (lib/rebates/calculate.ts) before values reach here. Passing a fraction
 * (0.02) into these functions silently under-computes by 100×.
 *
 * Pure functions — no Prisma, no I/O.
 */

// ─── All-or-nothing bundle ──────────────────────────────────────────

export interface TieInMember {
  minimumSpend: number
  currentSpend: number
}

export interface TieInBundleRebate {
  /** Integer percent. */
  baseRate: number
  /** Integer percent; added to base when EVERY member is ≥ 120% of its minimum. */
  bonusRate?: number
  /** Multiplier on (base + bonus) when EVERY member is ≥ 150% of its minimum. */
  acceleratorMultiplier?: number
}

export interface TieInResult {
  compliant: boolean
  totalSpend: number
  /** Integer percent. */
  applicableRate: number
  rebateEarned: number
  bonusLevel: "none" | "base" | "bonus" | "accelerator"
}

/**
 * All-or-nothing compliance: if ANY member misses its minimum, the whole
 * bundle earns nothing — not a reduced rate. That is the point of the
 * structure, and why `compliant: false` returns rate 0 rather than baseRate.
 *
 * A member with `minimumSpend: 0` is trivially compliant at any spend,
 * including 0.
 */
export function tieInAllOrNothing(
  members: TieInMember[],
  bundle: TieInBundleRebate,
): TieInResult {
  const totalSpend = members.reduce((s, m) => s + m.currentSpend, 0)
  const allMet = members.every((m) => m.currentSpend >= m.minimumSpend)
  if (!allMet) {
    return {
      compliant: false,
      totalSpend,
      applicableRate: 0,
      rebateEarned: 0,
      bonusLevel: "none",
    }
  }
  const over20 = members.every((m) => m.currentSpend >= m.minimumSpend * 1.2)
  const over50 = members.every((m) => m.currentSpend >= m.minimumSpend * 1.5)
  let rate = bundle.baseRate
  let level: TieInResult["bonusLevel"] = "base"
  if (over50 && bundle.bonusRate != null && bundle.acceleratorMultiplier != null) {
    rate = (bundle.baseRate + bundle.bonusRate) * bundle.acceleratorMultiplier
    level = "accelerator"
  } else if (over20 && bundle.bonusRate != null) {
    rate = bundle.baseRate + bundle.bonusRate
    level = "bonus"
  }
  return {
    compliant: true,
    totalSpend,
    applicableRate: rate,
    rebateEarned: totalSpend * (rate / 100),
    bonusLevel: level,
  }
}

// ─── Proportional compliance ────────────────────────────────────────

export interface TieInProportionalMember extends TieInMember {
  weight: number
}

export interface TieInProportionalResult {
  overallCompliance: number
  totalSpend: number
  /** Integer percent. */
  effectiveRate: number
  rebateEarned: number
}

/**
 * Proportional compliance: each member contributes
 * `weight × min(spend / minimum, 1)` to an overall compliance ratio, and the
 * effective rate is `baseRate × overallCompliance`.
 *
 * Two deliberate clamps, both load-bearing:
 *   - `min(…, 1)` means over-performing on one member cannot paper over
 *     another's shortfall. Remove it and a single huge member drags overall
 *     compliance above 1 and pays a rate above baseRate.
 *   - `minimumSpend > 0 ? … : 0` avoids a divide-by-zero. Note the
 *     consequence: a zero-minimum member contributes ZERO compliance, not
 *     full. That is the opposite of `tieInAllOrNothing`, where a zero
 *     minimum is trivially met. Preserved as-is from the original.
 *
 * Caller's responsibility: weights are expected to sum to 1. Nothing here
 * enforces it, and weights summing to less than 1 cap the achievable rate
 * below baseRate.
 */
export function tieInProportional(
  members: TieInProportionalMember[],
  baseRate: number,
): TieInProportionalResult {
  const overall = members.reduce(
    (sum, m) =>
      sum +
      Math.min(1, m.minimumSpend > 0 ? m.currentSpend / m.minimumSpend : 0) *
        m.weight,
    0,
  )
  const totalSpend = members.reduce((s, m) => s + m.currentSpend, 0)
  const effectiveRate = baseRate * overall
  return {
    overallCompliance: overall,
    totalSpend,
    effectiveRate,
    rebateEarned: totalSpend * (effectiveRate / 100),
  }
}

// ─── Cross-vendor tie-in ────────────────────────────────────────────

export interface CrossVendorCommitment {
  vendorId: string
  vendorName: string
  minimumSpend: number
  /** Integer percent. */
  rebateContribution: number
  currentSpend: number
}

export interface FacilityBonus {
  /** Integer percent. */
  rate: number
  requirement: "all_compliant" | "none"
}

export interface CrossVendorMemberResult {
  vendor: string
  spend: number
  rebate: number
  compliant: boolean
  shortfall: number
}

export interface CrossVendorResult {
  vendorRebates: CrossVendorMemberResult[]
  vendorRebateTotal: number
  facilityBonus: number
  totalRebate: number
  allCompliant: boolean
  totalSpend: number
}

/**
 * Cross-vendor tie-in: unlike the all-or-nothing bundle, each vendor earns on
 * its OWN spend if it individually meets its minimum — one vendor missing does
 * not zero the others. The facility bonus is the all-or-nothing part, paid on
 * total spend only when every vendor is compliant.
 */
export function crossVendorTieIn(
  vendors: CrossVendorCommitment[],
  facilityBonus: FacilityBonus,
): CrossVendorResult {
  const vendorRebates: CrossVendorMemberResult[] = vendors.map((v) => {
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
