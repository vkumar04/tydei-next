"use server"

/**
 * Tag-based invalidators for the analytics cache. The cached READS now
 * live in _cached.ts under the 'use cache' directive (Cache Components
 * — Next 16). This file owns only the WRITE side: server-action callers
 * import these to bust caches after a mutation.
 *
 * Tag string builders are imported from _cached.ts so the read and
 * write sides cannot drift on tag values.
 *
 * Implementation note: every export from a "use server" file must be
 * async — `updateTag` itself is sync but we wrap it. Internal helpers
 * (the tag builders) live in _cached.ts which is a plain module.
 */

import { updateTag } from "next/cache"
import {
  contractAnalyticsTag,
  facilityAnalyticsTag,
  vendorAnalyticsTag,
} from "./_cached"

// ─── Invalidators (call from write paths) ────────────────────────

export async function invalidateContractAnalytics(
  contractId: string,
): Promise<void> {
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
