"use server"

/**
 * Charles audit suggestion (v0-port): Contract Composite Score for
 * ACTIVE contracts. v0 has a 6-axis radar at
 * `/dashboard/contracts/[id]/score`; tydei previously only scored
 * prospective deals via `lib/actions/prospective.ts`. This action
 * produces the same shape for an active contract so the UI can
 * render the radar + grade.
 *
 * Axes + weights:
 *   - rebateEfficiency  (25%) — earned vs potential rebate
 *   - tierProgress      (20%) — tier achievement + spend progress
 *   - marketShare       (15%) — actual vs commitment
 *   - pricePerformance  (20%) — price discipline / off-contract penalty
 *   - compliance        (10%) — direct from contract.complianceRate
 *   - timeValue         (10%) — value delivered vs contract elapsed
 *
 * 2026-04-26: refactored to a thin auth shim. Auth gate stays here; the
 * cached helper lives in _cached.ts and the pure implementation in
 * contract-score-impl.ts. See docs/superpowers/plans/2026-04-26-cache-components-rollout.md.
 */

import { requireContractScope } from "@/lib/actions/analytics/_scope"
import { withTelemetry } from "@/lib/actions/analytics/_telemetry"
import { getCachedContractCompositeScore } from "@/lib/actions/analytics/_cached"
import type { ContractCompositeScore } from "@/lib/actions/analytics/contract-score-impl"

// NOTE: type re-export deliberately removed. "use server" files can
// only export async functions in Next 16 (cacheComponents enforces
// this strictly). Consumers should import the type from
// contract-score-impl.ts directly. Updated call sites grep'd 2026-04-26.

export async function getContractCompositeScore(
  contractId: string,
): Promise<ContractCompositeScore> {
  return withTelemetry("getContractCompositeScore", { contractId }, async () => {
    try {
      // Auth + ownership FIRST (outside the cache) — every caller pays
      // the gate. The expensive aggregate is memoized for ~10min per
      // contract under an `analytics:contract:<id>` tag that write paths
      // bust via `invalidateContractAnalytics`.
      const scope = await requireContractScope(contractId)
      return await getCachedContractCompositeScore(
        contractId,
        scope.cogScopeFacilityIds,
      )
    } catch (err) {
      console.error("[getContractCompositeScore]", err, { contractId })
      throw new Error("Composite score is unavailable for this contract.")
    }
  })
}
