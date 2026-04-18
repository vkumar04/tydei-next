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
