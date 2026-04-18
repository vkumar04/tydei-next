/**
 * Prospective analysis — dynamic rebate tier generator (spec §subsystem-0,
 * docs/superpowers/specs/2026-04-18-prospective-analysis-rewrite.md).
 *
 * PURE FUNCTION: synthesizes a 3-tier rebate structure from the
 * facility's baseline spend and the vendor's proposed top-tier rate.
 *
 * Tier shape (canonical §4):
 *   Tier 1 "Base"   — minimumSpend = 0
 *                     rate         = proposedRebateRate × 0.25  (rounded to 2 decimals)
 *   Tier 2 "Mid"    — minimumSpend = baselineSpend × 0.6
 *                     rate         = proposedRebateRate × 0.6   (rounded to 2 decimals)
 *   Tier 3 "Target" — minimumSpend = baselineSpend × 1.2
 *                     rate         = proposedRebateRate          (exact, unrounded)
 *
 * All minimums are rounded to the nearest $1,000.
 */

export interface DynamicRebateTier {
  name: string
  minimumSpend: number
  rate: number
}

export interface GenerateDynamicRebateTiersInput {
  baselineSpend: number
  proposedRebateRate: number // top-tier rate as percent
}

// Round to nearest thousand dollars.
function roundToNearestThousand(value: number): number {
  return Math.round(value / 1000) * 1000
}

// Round to 2 decimal places (mirrors Number.prototype.toFixed semantics
// but returns a number, not a string).
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function generateDynamicRebateTiers(
  input: GenerateDynamicRebateTiersInput,
): DynamicRebateTier[] {
  const { baselineSpend, proposedRebateRate } = input

  return [
    {
      name: "Base",
      minimumSpend: 0,
      rate: round2(proposedRebateRate * 0.25),
    },
    {
      name: "Mid",
      minimumSpend: roundToNearestThousand(baselineSpend * 0.6),
      rate: round2(proposedRebateRate * 0.6),
    },
    {
      name: "Target",
      minimumSpend: roundToNearestThousand(baselineSpend * 1.2),
      rate: proposedRebateRate,
    },
  ]
}
