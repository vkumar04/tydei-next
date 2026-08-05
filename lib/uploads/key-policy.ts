/**
 * Storage-key policy (security review 2026-08-05).
 *
 * Keys minted by the upload paths carry tenant provenance and entropy:
 *
 *   <folder>/<facilityId|vendorId|userId>/<timestamp>-<rand8>-<safeName>
 *
 * The tenant segment lets write paths that accept CLIENT-SUBMITTED keys
 * (pending-contract documents) verify the submitter actually minted the
 * key — before this, a counterparty could self-authorize any guessable
 * key by writing it into their own pending contract's documents JSON,
 * and `assertKeyVisibleToUser` would then presign it for them. Legacy
 * keys (`<folder>/<timestamp>-<name>`, no tenant segment) fail the
 * ownership check by design; they are still downloadable through the
 * DB-row paths, just no longer attachable to NEW submissions.
 *
 * Pure module — imported by "use server" files, never one itself.
 */

export const STORAGE_FOLDERS = ["contracts", "pricing", "cog", "invoices"] as const

const KEY_TENANT_RE = /^(contracts|pricing|cog|invoices)\/([^/]+)\/./

/** The tenant segment of a provenance-format key, or null for legacy keys. */
export function keyTenantSegment(key: string): string | null {
  const match = KEY_TENANT_RE.exec(key)
  if (!match) return null
  // Legacy keys had `<folder>/<timestamp>-<name>` — a purely numeric-prefix
  // second segment that contains "-" is not a cuid/userId. A real tenant
  // segment is a bare id (no dots, produced by our own minting).
  return match[2]
}

/**
 * True when `key` was minted under one of `tenantIds`.
 */
export function keyBelongsToTenant(
  key: string,
  tenantIds: readonly (string | undefined | null)[],
): boolean {
  const segment = keyTenantSegment(key)
  if (!segment) return false
  return tenantIds.some((id) => !!id && id === segment)
}
