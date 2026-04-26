"use server"

import { unstable_cache, updateTag } from "next/cache"

/**
 * Tag-based cache helpers for the read-only analytics actions. The
 * underlying actions are pure functions of (scope, contractId/
 * facilityId), so caching them for ~10 minutes per request key
 * trims the database load substantially while staying fresh enough
 * for the next user navigation. Writes (contract update, COG import,
 * rebate close, etc.) call the matching invalidator below.
 */

// ─── Tag constants ───────────────────────────────────────────────

export function contractAnalyticsTag(contractId: string): string {
  return `analytics:contract:${contractId}`
}

export function facilityAnalyticsTag(facilityId: string): string {
  return `analytics:facility:${facilityId}`
}

export function vendorAnalyticsTag(vendorId: string): string {
  return `analytics:vendor:${vendorId}`
}

// ─── Wrappers ────────────────────────────────────────────────────

/**
 * Cache a per-contract analytics read for `revalidateSeconds` (default
 * 600 = 10 minutes) and tag it so writes can invalidate.
 *
 * Usage in an action:
 *   return cacheContractAnalytics(
 *     contractId,
 *     "compositeScore",
 *     () => _impl(contractId),
 *   )
 */
export async function cacheContractAnalytics<T>(
  contractId: string,
  key: string,
  fn: () => Promise<T>,
  revalidateSeconds = 600,
): Promise<T> {
  const cached = unstable_cache(fn, [`contract`, contractId, key], {
    tags: [contractAnalyticsTag(contractId)],
    revalidate: revalidateSeconds,
  })
  return cached()
}

export async function cacheFacilityAnalytics<T>(
  facilityId: string,
  key: string,
  fn: () => Promise<T>,
  revalidateSeconds = 600,
): Promise<T> {
  const cached = unstable_cache(fn, [`facility`, facilityId, key], {
    tags: [facilityAnalyticsTag(facilityId)],
    revalidate: revalidateSeconds,
  })
  return cached()
}

export async function cacheVendorAnalytics<T>(
  vendorId: string,
  key: string,
  fn: () => Promise<T>,
  revalidateSeconds = 600,
): Promise<T> {
  const cached = unstable_cache(fn, [`vendor`, vendorId, key], {
    tags: [vendorAnalyticsTag(vendorId)],
    revalidate: revalidateSeconds,
  })
  return cached()
}

// ─── Invalidators (call from write paths) ────────────────────────

export async function invalidateContractAnalytics(
  contractId: string,
): Promise<void> {
  // Next 16: updateTag is the server-action-safe sibling of
  // revalidateTag (read-your-own-writes inside the same request).
  updateTag(contractAnalyticsTag(contractId))
}

export async function invalidateFacilityAnalytics(
  facilityId: string,
): Promise<void> {
  updateTag(facilityAnalyticsTag(facilityId))
}

export async function invalidateVendorAnalytics(
  vendorId: string,
): Promise<void> {
  updateTag(vendorAnalyticsTag(vendorId))
}
