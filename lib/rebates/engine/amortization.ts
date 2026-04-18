/**
 * Unified rebate engine — tie-in capital amortization schedule (subsystem 8).
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md §4.8
 *
 * Pure function: given amortization parameters (capitalCost, interestRate,
 * termMonths, period), returns a fully-built schedule of AmortizationEntry
 * rows — one per period — using the standard PMT formula:
 *
 *   pmt = P × (r × (1+r)^n) / ((1+r)^n - 1)
 *
 * where P = capitalCost, r = period interest rate, n = period count. When r
 * is zero the formula collapses to pmt = P / n and every period is pure
 * principal. Period rate and count derive from the configured cadence:
 *
 *   monthly   → n = termMonths             r = annualRate / 12
 *   quarterly → n = ceil(termMonths / 3)   r = annualRate / 4
 *   annual    → n = ceil(termMonths / 12)  r = annualRate / 1
 *
 * The engine does NOT persist the schedule; callers write rows to
 * ContractAmortizationSchedule separately. This file is imported by both
 * `tie-in-capital.ts` (per-period evaluation) and by any UI that wants to
 * preview the schedule up front.
 */
import type { AmortizationEntry } from "./types"

export interface AmortizationScheduleConfig {
  capitalCost: number
  /** Annual interest rate (decimal: 0.05 = 5%). */
  interestRate: number
  termMonths: number
  period: "monthly" | "quarterly" | "annual"
}

function periodsPerYear(period: AmortizationScheduleConfig["period"]): number {
  switch (period) {
    case "monthly":
      return 12
    case "quarterly":
      return 4
    case "annual":
      return 1
    default: {
      // Exhaustiveness guard — unreachable with typed input.
      const _never: never = period
      void _never
      return 12
    }
  }
}

function totalPeriods(
  termMonths: number,
  period: AmortizationScheduleConfig["period"],
): number {
  switch (period) {
    case "monthly":
      return termMonths
    case "quarterly":
      return Math.ceil(termMonths / 3)
    case "annual":
      return Math.ceil(termMonths / 12)
    default: {
      const _never: never = period
      void _never
      return termMonths
    }
  }
}

/**
 * Build the full amortization schedule. Returns an array of AmortizationEntry
 * rows with periodNumber 1-indexed. Final closingBalance is ~0 (floating-point
 * tolerance): callers may round to cents when persisting.
 */
export function buildTieInAmortizationSchedule(
  config: AmortizationScheduleConfig,
): AmortizationEntry[] {
  const { capitalCost, interestRate, termMonths, period } = config
  const n = totalPeriods(termMonths, period)

  if (n <= 0 || capitalCost <= 0) {
    return []
  }

  const r = interestRate / periodsPerYear(period)

  // Standard PMT formula with r=0 fallback to straight-line principal.
  const pmt =
    r === 0
      ? capitalCost / n
      : (capitalCost * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1)

  const schedule: AmortizationEntry[] = []
  let openingBalance = capitalCost

  for (let i = 1; i <= n; i += 1) {
    const interestCharge = openingBalance * r
    // Principal due is the full payment minus the interest portion.
    const principalDue = pmt - interestCharge
    const amortizationDue = pmt
    const closingBalance = openingBalance - principalDue

    schedule.push({
      periodNumber: i,
      openingBalance,
      interestCharge,
      principalDue,
      amortizationDue,
      closingBalance,
    })

    openingBalance = closingBalance
  }

  return schedule
}
