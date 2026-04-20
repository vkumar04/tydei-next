/**
 * Canonical "Rebate applied to capital" aggregate (Charles W1.Y-C).
 *
 * Charles's rule (iMessage 2026-04-20): on tie-in contracts, 100% of the
 * collected rebate retires the capital balance. No split, no cash-out.
 * Non-tie-in contracts have no capital to retire and therefore contribute
 * $0 to this aggregate regardless of collected-rebate activity.
 *
 * Every surface that renders an "applied to capital" / "Paid to Date"
 * number MUST route through this helper:
 *   - contract-detail header card "applied to capital" sublabel
 *   - components/contracts/contract-amortization-card.tsx summary strip
 *   - tie-in dashboards / reports
 *
 * Before this helper, three parallel reducers disagreed:
 *   1. amortization `paidToDate` = sum of schedule `principalDue` (forecast)
 *   2. header sublabel = `min(rebateEarned, cumulativeScheduledDue)`
 *   3. Rebates Collected lifetime = `sumCollectedRebates`
 *
 * Collapsing (1) and (2) onto this helper reconciles the three numbers.
 *
 * Kept framework-free (no Prisma client import) so Vitest and client
 * components can both exercise it.
 */
import {
  sumCollectedRebates,
  type CollectedRebateLike,
} from "@/lib/contracts/rebate-collected-filter"

export interface RebateCapitalAppliedLike extends CollectedRebateLike {}

/**
 * Sum the collected-rebate amount that has been applied to the capital
 * balance on a contract.
 *
 * - Tie-in contracts: returns `sumCollectedRebates(rebates)` — every
 *   collected dollar retires capital (Charles's rule).
 * - Any other contract type: returns `0` — no capital to retire.
 */
export function sumRebateAppliedToCapital(
  rebates: readonly RebateCapitalAppliedLike[],
  contractType: string | null | undefined,
): number {
  if (contractType !== "tie_in") return 0
  return sumCollectedRebates(rebates)
}
