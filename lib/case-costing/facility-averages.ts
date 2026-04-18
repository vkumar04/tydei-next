/**
 * Case costing — facility baseline averages.
 *
 * Reference: docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4.0
 * (Subsystem 0 — baseline metrics).
 *
 * Pure function — computes facility-wide averages used as a comparison
 * baseline ("Dr. Smith's avg case cost is 12% below facility avg").
 */

export interface FacilityAverages {
  avgCaseCost: number
  avgReimbursementPerCase: number
  avgMarginPct: number
  /** null when no case reports a duration (all missing/null). */
  avgTimeInOrMinutes: number | null
}

export interface CaseForAverages {
  totalSpend: number
  totalReimbursement: number
  /** Case duration in minutes. Optional / nullable. */
  timeInOrMinutes?: number | null
}

/**
 * Compute facility baseline averages.
 *
 *   avgCaseCost             = Σ totalSpend / count
 *   avgReimbursementPerCase = Σ totalReimbursement / count
 *   avgMarginPct            = ((Σ reimbursement − Σ spend) / Σ reimbursement) × 100
 *                             (sum-method, not per-case average; 0 when reimb=0)
 *   avgTimeInOrMinutes      = mean of defined timeInOrMinutes values,
 *                             null if none are defined.
 *
 * Zero cases → all numeric fields 0, avgTimeInOrMinutes null.
 */
export function computeFacilityAverages(input: {
  cases: CaseForAverages[]
}): FacilityAverages {
  const cases = input.cases
  const count = cases.length

  if (count === 0) {
    return {
      avgCaseCost: 0,
      avgReimbursementPerCase: 0,
      avgMarginPct: 0,
      avgTimeInOrMinutes: null,
    }
  }

  let totalSpend = 0
  let totalReimbursement = 0
  let timeSum = 0
  let timeCount = 0

  for (const c of cases) {
    totalSpend += c.totalSpend
    totalReimbursement += c.totalReimbursement
    if (c.timeInOrMinutes !== null && c.timeInOrMinutes !== undefined) {
      timeSum += c.timeInOrMinutes
      timeCount += 1
    }
  }

  const avgCaseCost = totalSpend / count
  const avgReimbursementPerCase = totalReimbursement / count
  const avgMarginPct =
    totalReimbursement > 0
      ? ((totalReimbursement - totalSpend) / totalReimbursement) * 100
      : 0
  const avgTimeInOrMinutes = timeCount > 0 ? timeSum / timeCount : null

  return {
    avgCaseCost,
    avgReimbursementPerCase,
    avgMarginPct,
    avgTimeInOrMinutes,
  }
}
