/**
 * Contract ownership helpers.
 *
 * Every contract server action that operates on a specific contract
 * must ensure the caller's facility has access to it — either as the
 * primary facilityId OR as one of the contractFacilities join rows.
 * This module centralizes that predicate so we have exactly one
 * definition of "owned by this facility" across the codebase.
 */
import type { Prisma } from "@/lib/generated/prisma/client"

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

/**
 * Multi-facility variant for enterprise / assigned-facility scoping
 * (Settings/Users feature). `facilityIds` is the caller's accessible set —
 * for an enterprise user, every facility in their HealthSystem; for a
 * scoped user, their `FacilityAssignment` set. Contracts are owned by ANY
 * facility in the set (primary OR `contractFacilities` join). An empty set
 * matches nothing (a scoped user with no assignments sees no contracts).
 */
export function contractsOwnedByFacilities(facilityIds: string[]): Prisma.ContractWhereInput {
  return {
    OR: [
      { facilityId: { in: facilityIds } },
      { contractFacilities: { some: { facilityId: { in: facilityIds } } } },
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
  /**
   * The caller's accessible facility set (enterprise = all in health
   * system, scoped = assignment set). When provided, the `"all"` scope is
   * BOUNDED to this set instead of returning an unbounded `{}` — closing
   * the hole where a scoped facility user saw every facility's contracts.
   * Omitted ⇒ legacy unbounded `"all"` (back-compat for existing callers).
   */
  facilityIds?: string[],
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
  // scope === "all" — bounded to the accessible set when known.
  if (facilityIds) return contractsOwnedByFacilities(facilityIds)
  return {}
}
