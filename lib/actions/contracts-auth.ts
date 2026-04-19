/**
 * Contract ownership helpers.
 *
 * Every contract server action that operates on a specific contract
 * must ensure the caller's facility has access to it — either as the
 * primary facilityId OR as one of the contractFacilities join rows.
 * This module centralizes that predicate so we have exactly one
 * definition of "owned by this facility" across the codebase.
 */
import type { Prisma } from "@prisma/client"

/**
 * Returns a Prisma where-unique-input that scopes `id` to contracts
 * owned by (or shared with) `facilityId`. Use with findUniqueOrThrow /
 * findFirst / update / delete. Composes with any select/include.
 *
 * ```ts
 * const c = await prisma.contract.findUniqueOrThrow({
 *   where: contractOwnershipWhere(id, facility.id),
 *   include: { terms: true },
 * })
 * ```
 */
export function contractOwnershipWhere(
  id: string,
  facilityId: string,
): Prisma.ContractWhereUniqueInput {
  return {
    id,
    OR: [
      { facilityId },
      { contractFacilities: { some: { facilityId } } },
    ],
  }
}

/**
 * Returns a Prisma where-input filter (no id) for "all contracts owned
 * by or shared with this facility". Use in list queries.
 */
export function contractsOwnedByFacility(facilityId: string): Prisma.ContractWhereInput {
  return {
    OR: [
      { facilityId },
      { contractFacilities: { some: { facilityId } } },
    ],
  }
}

// ─── 3-Way Facility Scope (this / all / shared) ─────────────────
//
// Subsystem 9.2 — list + stats surfaces honor a URL-param-driven scope.
// Auth gate (requireFacility) is enforced by callers; this helper only
// shapes the Prisma `where` clause. Shared between `getContracts` and
// `getContractStats` so both use identical scoping semantics.

export type FacilityScope = "this" | "all" | "shared"

export function facilityScopeClause(
  scope: FacilityScope,
  facilityId: string,
): Prisma.ContractWhereInput {
  if (scope === "this") return contractsOwnedByFacility(facilityId)
  if (scope === "shared") {
    return {
      isMultiFacility: true,
      OR: [
        { facilityId },
        { contractFacilities: { some: { facilityId } } },
      ],
    }
  }
  // scope === "all" — no facility filter (auth still gates the caller).
  return {}
}
