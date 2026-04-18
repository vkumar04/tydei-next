/**
 * Tie-in contract engine: bundle compliance + bonus rebate math.
 *
 * Spec section 4 of contract-calculations.md. Three modes:
 * - All-or-nothing: every member must meet its minimum. If yes,
 *   base-rebate × bonusMultiplier. If any misses, base rebate only.
 * - Proportional: each member's compliance % is capped at 100 and
 *   weighted into an overall bundle compliance %. No bonus.
 * - Cross-vendor: same as all-or-nothing but with an additive facility
 *   bonus percent when every vendor is compliant.
 */

export interface TieInMember {
  contractId: string
  weightPercent: number // 0-100, summing to ~100 across the bundle
  minimumSpend?: number | null
}

export interface MemberPerformance {
  contractId: string
  currentSpend: number
  currentRebate: number
}

export type ComplianceStatus = "compliant" | "non_compliant" | "partial"

export interface AllOrNothingResult {
  complianceStatus: ComplianceStatus
  baseRebate: number
  bonusRebate: number
  totalRebate: number
  failingMembers: string[]
}

export interface ProportionalResult {
  weightedCompliancePercent: number
  complianceStatus: ComplianceStatus
  baseRebate: number
  totalRebate: number
  perMember: Array<{
    contractId: string
    compliancePercent: number
    weightContribution: number
  }>
}

export interface CrossVendorResult extends AllOrNothingResult {
  facilityBonus: number
  totalWithBonus: number
}

function sumPerformance(perf: MemberPerformance[]): number {
  return perf.reduce((s, p) => s + p.currentRebate, 0)
}

function performanceMap(
  perf: MemberPerformance[],
): Map<string, MemberPerformance> {
  const m = new Map<string, MemberPerformance>()
  for (const p of perf) m.set(p.contractId, p)
  return m
}

export function evaluateAllOrNothing(
  members: TieInMember[],
  performance: MemberPerformance[],
  opts: { bonusMultiplier?: number } = {},
): AllOrNothingResult {
  const perfMap = performanceMap(performance)
  const failingMembers: string[] = []

  for (const m of members) {
    const min = m.minimumSpend ?? 0
    const p = perfMap.get(m.contractId)
    const spend = p?.currentSpend ?? 0
    if (min > 0 && spend < min) {
      failingMembers.push(m.contractId)
    }
  }

  const baseRebate = sumPerformance(performance)
  const compliant = failingMembers.length === 0
  // When bonusMultiplier is e.g. 1.1, base × 1.1 = base + 10% bonus.
  const multiplier = opts.bonusMultiplier ?? 1
  const bonusRebate = compliant ? baseRebate * (multiplier - 1) : 0
  const totalRebate = baseRebate + bonusRebate

  return {
    complianceStatus: compliant ? "compliant" : "non_compliant",
    baseRebate,
    bonusRebate,
    totalRebate,
    failingMembers,
  }
}

export function evaluateProportional(
  members: TieInMember[],
  performance: MemberPerformance[],
): ProportionalResult {
  const perfMap = performanceMap(performance)
  let weighted = 0
  const perMember: ProportionalResult["perMember"] = []

  for (const m of members) {
    const min = m.minimumSpend ?? 0
    const p = perfMap.get(m.contractId)
    const spend = p?.currentSpend ?? 0
    const rawPercent = min > 0 ? Math.min(100, (spend / min) * 100) : 100
    const weightContribution = (rawPercent * m.weightPercent) / 100
    weighted += weightContribution
    perMember.push({
      contractId: m.contractId,
      compliancePercent: rawPercent,
      weightContribution,
    })
  }

  const baseRebate = sumPerformance(performance)
  const complianceStatus: ComplianceStatus =
    weighted >= 100 ? "compliant" : weighted > 0 ? "partial" : "non_compliant"

  return {
    weightedCompliancePercent: weighted,
    complianceStatus,
    baseRebate,
    totalRebate: baseRebate,
    perMember,
  }
}

export function evaluateCrossVendor(
  members: TieInMember[],
  performance: MemberPerformance[],
  opts: { bonusMultiplier?: number; facilityBonusPercent?: number } = {},
): CrossVendorResult {
  const inner = evaluateAllOrNothing(members, performance, opts)
  const facilityBonusRate = (opts.facilityBonusPercent ?? 0) / 100
  const facilityBonus =
    inner.complianceStatus === "compliant"
      ? inner.baseRebate * facilityBonusRate
      : 0
  return {
    ...inner,
    facilityBonus,
    totalWithBonus: inner.totalRebate + facilityBonus,
  }
}
