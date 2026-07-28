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
   * The caller's accessible facility set — for an enterprise (Super) user
   * every facility in their `HealthSystem`, for a scoped user their
   * `FacilityAssignment` set UNIONed with their home facility. Resolve it
   * with `getCallerFacilityIds()` (`lib/actions/facility-assignment.ts`),
   * which is the canonical owner of that set; do not re-derive it.
   *
   * Only the `"all"` scope reads it — `"this"` and `"shared"` are already
   * bounded by `facilityId`, so callers on those paths pay nothing.
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
  // scope === "all" — "every facility THIS CALLER can reach", never "every
  // facility in the database".
  //
  // This branch used to `return {}` when no set was passed. `{}` is an
  // UNBOUNDED Prisma predicate: it matched every row of `Contract`, so a
  // facility user who flipped the contracts list to "All" read — and had
  // counted, summed and CSV-exported — every other tenant's contracts.
  // Against the dev seed that is 19 contracts across 3 unrelated health
  // systems where a Lighthouse Health user may see 10.
  //
  // It now fails CLOSED. An omitted set degrades to the caller's own
  // facility (identical to scope `"this"`), so a future caller that forgets
  // to thread the set under-counts rather than leaking. Both current call
  // sites — `getContracts` and `getContractStats` — do pass it.
  //
  // An EMPTY set is deliberately not the same as an omitted one: `[]` means
  // "this caller reaches no facility" and correctly matches nothing (see
  // `contractsOwnedByFacilities`, pinned by facility-assignment-scope.test).
  if (!facilityIds) return contractsOwnedByFacility(facilityId)
  return contractsOwnedByFacilities(facilityIds)
}
