/**
 * Canonical vendor "Spend Compliance" aggregate.
 *
 * CLAUDE.md invariant: vendor-side compliance is **trailing-12-month
 * vendor COG spend ÷ Σ active-contract annual targets** where each
 * contract's annual target is `annualValue || totalValue`. The result
 * is a percentage capped at `VENDOR_COMPLIANCE_CAP_PCT` and rounded to
 * one decimal place.
 *
 * Pre-canonicalization (2026-06-09 vendor audit) three surfaces showed
 * three different values for the same vendor:
 *   - `getVendorPerformance` capped at 100,
 *   - `getVendorPerformanceContracts` capped at 120,
 *   - `getVendorPerformanceSummary` averaged the persisted
 *     `Contract.complianceRate` — a *match*-compliance metric
 *     (% of COG rows on-contract) that measures something else
 *     entirely.
 * Every vendor surface now funnels through this helper so the numbers
 * cannot drift apart. Displays that need a 0–100 domain (radar chart,
 * progress bars) clamp AT DISPLAY TIME (`Math.min(value, 100)`); the
 * underlying figure keeps the over-target signal up to the cap.
 *
 * Kept framework-free (no Prisma client import, no server-action
 * imports) so Vitest and client components can both exercise it —
 * sibling of `sumEarnedRebatesLifetime` / `sumCollectedRebates`.
 */

/**
 * Single cap for vendor compliance percentages. 120 (not 100) so an
 * over-target vendor still reads as "exceeding" (e.g. 115%) instead of
 * pinning at 100 — matching the per-contract status thresholds
 * (`>= 100` → exceeding, `>= 90` → on-track) that predate this helper.
 */
export const VENDOR_COMPLIANCE_CAP_PCT = 120

export interface ContractComplianceInput {
  /** Trailing 12-month vendor COG spend (Σ cOGRecord.extendedPrice). */
  spend12Mo: number
  /** The contract's annual target: `annualValue || totalValue`. */
  annualTarget: number
}

/**
 * Per-contract variant: spend ÷ one contract's annual target, capped
 * and rounded to 0.1. Returns `null` when there is no positive target
 * to measure against (callers decide whether null renders as "—" or 0).
 */
export function computeContractCompliance(
  input: ContractComplianceInput,
): number | null {
  const target = Number(input.annualTarget)
  if (!Number.isFinite(target) || target <= 0) return null
  const pct = Math.min(
    (Number(input.spend12Mo) / target) * 100,
    VENDOR_COMPLIANCE_CAP_PCT,
  )
  return Math.round(pct * 10) / 10
}

export interface VendorComplianceInput {
  /** Trailing 12-month vendor COG spend (Σ cOGRecord.extendedPrice). */
  spend12Mo: number
  /**
   * One entry per ACTIVE contract: `annualValue || totalValue`.
   * Non-positive / non-finite entries contribute nothing to the
   * denominator (a contract without a target can't be complied with).
   */
  annualTargets: readonly number[]
}

/**
 * Vendor-level (or facility-rollup) variant: trailing-12mo spend ÷ the
 * sum of all active-contract annual targets. Returns `null` when no
 * contract carries a positive target.
 */
export function computeVendorCompliance(
  input: VendorComplianceInput,
): number | null {
  const totalTarget = input.annualTargets.reduce((sum, t) => {
    const n = Number(t)
    return Number.isFinite(n) && n > 0 ? sum + n : sum
  }, 0)
  return computeContractCompliance({
    spend12Mo: input.spend12Mo,
    annualTarget: totalTarget,
  })
}
