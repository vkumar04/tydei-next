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
  divisionIds?: string[],
): Prisma.ContractWhereInput {
  const ownership: Prisma.ContractWhereInput = {
    OR: [{ vendorId }, { additionalVendorIds: { has: vendorId } }],
  }
  return withDivisionScope(ownership, divisionIds)
}

/**
 * Hard division-isolation (Settings/Users feature). Composes a base
 * ownership predicate with an optional vendor-division scope:
 *   undefined → no division restriction (enterprise / pre-opt-in; byte-
 *               identical to the un-scoped behavior — DO NOT break this)
 *   []        → match NOTHING (caller attached to no divisions)
 *   [a, b]    → AND-in `vendorDivisionId ∈ {a,b}`
 *
 * Grouped multi-vendor contracts have no single `vendorDivisionId`
 * (stays null); they are intentionally NOT surfaced under a division
 * scope here (see plan open-risk — revisit if grouped contracts must be
 * visible to a member's division).
 */
function withDivisionScope(
  base: Prisma.ContractWhereInput,
  divisionIds?: string[],
): Prisma.ContractWhereInput {
  if (divisionIds === undefined) return base
  return { AND: [base, { vendorDivisionId: { in: divisionIds } }] }
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
  divisionIds?: string[],
): Prisma.ContractWhereInput {
  const ownership: Prisma.ContractWhereInput = {
    id,
    OR: [{ vendorId }, { additionalVendorIds: { has: vendorId } }],
  }
  if (divisionIds === undefined) return ownership
  return { AND: [ownership, { vendorDivisionId: { in: divisionIds } }] }
}
