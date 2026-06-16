/**
 * Contract vendor-ownership helpers.
 *
 * Mirror of `contracts-auth.ts` for the vendor side. Every vendor
 * server action that reads contracts must scope them to the calling
 * vendor — either as the primary `vendorId` OR as a participant in a
 * grouped contract's `additionalVendorIds`. This module centralizes
 * that predicate so there is exactly ONE definition of "owned by this
 * vendor" across the codebase.
 *
 * Why this exists: surfaces that scoped by bare `contract.vendorId`
 * silently dropped grouped contracts where the vendor only appears in
 * `additionalVendorIds` (memory: group-vendor-drift). Never hand-roll
 * `OR: [{ vendorId }, { additionalVendorIds: { has } }]` at call sites —
 * import these. The display-side analog (extract a contract's vendor
 * set) is `contractVendorIds()` in `lib/contracts/contract-vendor-ids.ts`.
 */
import type { Prisma } from "@/lib/generated/prisma/client"

/**
 * Returns a Prisma where-input filter (no id) for "all contracts owned
 * by or shared with this vendor" (primary vendor OR grouped participant).
 * Use in list queries and as a nested `contract:` filter.
 *
 * ```ts
 * const rows = await prisma.contract.findMany({
 *   where: { ...contractsOwnedByVendor(vendor.id), status: "active" },
 * })
 * ```
 */
export function contractsOwnedByVendor(
  vendorId: string,
): Prisma.ContractWhereInput {
  return {
    OR: [{ vendorId }, { additionalVendorIds: { has: vendorId } }],
  }
}

/**
 * Returns a Prisma where-input that scopes `id` to a contract owned by
 * (or grouped with) `vendorId`. Use with findFirst / update / delete.
 * Composes with any select/include.
 *
 * Note: returns `ContractWhereInput` (not `WhereUniqueInput`) because the
 * `OR` membership predicate is not a unique constraint — pair with
 * `findFirst`, not `findUnique`.
 */
export function contractOwnershipWhereVendor(
  id: string,
  vendorId: string,
): Prisma.ContractWhereInput {
  return {
    id,
    OR: [{ vendorId }, { additionalVendorIds: { has: vendorId } }],
  }
}
