/**
 * 'use cache' helpers for analytics. Stable replacement for the
 * unstable_cache wrappers previously in _cache.ts. Tag builders are
 * shared with _cache.ts's invalidators so read/write sides cannot
 * drift on tag string values.
 *
 * NO `"use server"` directive at the top — `'use cache'` and
 * `"use server"` cannot coexist in the same file. Server-action
 * entrypoints live in contract-score.ts and call these helpers.
 *
 * Requires `experimental.cacheComponents: true` in next.config.ts.
 * See docs/superpowers/plans/2026-04-26-cache-components-rollout.md
 * for the rollout plan + the previous failure mode this avoids.
 */

import { cacheLife, cacheTag } from "next/cache"
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
 * Cached read for contract composite score. Cache key is derived
 * automatically from the function's args + closure. Tagged so write
 * paths can invalidate via `invalidateContractAnalytics(contractId)`.
 *
 * cacheLife profile: stale 60s (CDN serve-stale window), revalidate
 * 600s (10min refresh), expire 3600s (1h hard cap). Mirrors the
 * previous `unstable_cache(..., { revalidate: 600 })` behavior.
 */
export async function getCachedContractCompositeScore(
  contractId: string,
  cogScopeFacilityIds: string[],
): Promise<ContractCompositeScore> {
  "use cache"
  cacheLife({ stale: 60, revalidate: 600, expire: 3600 })
  cacheTag(contractAnalyticsTag(contractId))
  return getContractCompositeScoreImpl(contractId, cogScopeFacilityIds)
}
