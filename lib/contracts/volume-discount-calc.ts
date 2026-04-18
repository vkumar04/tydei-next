/**
 * Volume-discount negotiator helpers.
 *
 * Pure math utilities for computing "what discount would it take to hit
 * a target annual savings" given expected spend. Used by the contracts
 * rewrite renegotiation tab + prospective-analysis negotiation points.
 *
 * Not tied to any spec subsystem number — it's a shared utility that
 * multiple pages consume.
 */

export interface VolumeDiscountInputs {
  /** Projected annual spend on the vendor's items. */
  projectedSpend: number
  /** Current average unit discount already applied (0-1 decimal). */
  currentDiscountPercent: number
  /** Target savings in dollars. */
  targetSavings: number
}

export interface VolumeDiscountResult {
  /** The decimal discount needed to hit the target. 0.08 = 8%. */
  requiredDiscountPercent: number
  /** Incremental discount beyond current required. */
  incrementalDiscountPercent: number
  /** Achievable? false when required exceeds 1.0 (100% off is absurd). */
  achievable: boolean
}

export function calculateRequiredDiscount(
  input: VolumeDiscountInputs,
): VolumeDiscountResult {
  if (input.projectedSpend <= 0) {
    return {
      requiredDiscountPercent: 0,
      incrementalDiscountPercent: 0,
      achievable: false,
    }
  }
  const required = input.targetSavings / input.projectedSpend
  const incremental = Math.max(0, required - input.currentDiscountPercent)
  return {
    requiredDiscountPercent: required,
    incrementalDiscountPercent: incremental,
    achievable: required <= 1 && required >= 0,
  }
}

export interface TargetSpendForRebateInput {
  /** Rebate rate at the next tier (percent as number — 4 = 4%). */
  nextTierRate: number
  /** Desired incremental rebate dollars. */
  incrementalRebateTarget: number
}

/**
 * Given a target incremental rebate and the next tier's rate, compute
 * the spend needed INSIDE that tier to earn it.
 *
 *   spendNeeded = incrementalRebateTarget / (nextTierRate / 100)
 */
export function calculateSpendNeededForIncrementalRebate(
  input: TargetSpendForRebateInput,
): number {
  if (input.nextTierRate <= 0) return 0
  return input.incrementalRebateTarget / (input.nextTierRate / 100)
}

/**
 * Given current spend and a single-tier jump, project total rebate if
 * the facility hit the tier exactly.
 */
export function projectRebateAtTier(input: {
  spend: number
  tierRate: number  // percent
}): number {
  if (input.spend <= 0 || input.tierRate <= 0) return 0
  return (input.spend * input.tierRate) / 100
}
