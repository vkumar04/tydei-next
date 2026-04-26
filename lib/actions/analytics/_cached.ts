/**
 * Analytics cache helpers + tag builders.
 *
 * 2026-04-26: this file was originally written to use the 'use cache'
 * directive from Cache Components (Next 16). That rollout was rolled
 * back the same day because `cacheComponents: true` requires every
 * uncached data access in page.tsx files to be inside a Suspense
 * boundary, and our pages all do `await requireFacility()` at the
 * top level. The directive is gone; the helper is now a plain
 * pass-through. Tag builders still live here so _cache.ts's
 * write-side invalidators have a single source of truth.
 *
 * Future Cache Components rollout: see
 * docs/superpowers/plans/2026-04-26-cache-components-rollout.md and
 * the retro for the rollback. Re-enabling means wrapping every page
 * in <Suspense> first.
 */

import {
  getContractCompositeScoreImpl,
  type ContractCompositeScore,
} from "./contract-score-impl"

// ─── Tag builders (shared with _cache.ts invalidators) ──────────

export function contractAnalyticsTag(contractId: string): string {
  return `analytics:contract:${contractId}`
}

export function facilityAnalyticsTag(facilityId: string): string {
  return `analytics:facility:${facilityId}`
}

export function vendorAnalyticsTag(vendorId: string): string {
  return `analytics:vendor:${vendorId}`
}

// ─── Cached reads ────────────────────────────────────────────────

/**
 * Pass-through (no caching) until Cache Components rolls out properly.
 * The auth gate in `contract-score.ts` runs first; this just calls
 * through to the pure impl. When we re-enable `cacheComponents`,
 * restore the 'use cache' directive + cacheLife + cacheTag inside
 * this function body.
 */
export async function getCachedContractCompositeScore(
  contractId: string,
  cogScopeFacilityIds: string[],
): Promise<ContractCompositeScore> {
  return getContractCompositeScoreImpl(contractId, cogScopeFacilityIds)
}
