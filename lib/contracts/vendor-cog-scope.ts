/**
 * Vendor-owned COG (`VendorCogRecord`) scope filter.
 *
 * The ONE place that builds the Prisma `where` for reading a vendor's own
 * COG rows in 1-way mode. `VendorCogRecord` is VENDOR-owned and must NEVER
 * be merged into facility-scoped `COGRecord` reads — keeping the
 * facility-COGRecord invariant intact is exactly why this helper is
 * separate from `cog-category-filter.ts`.
 *
 * Division-isolation semantics mirror `divisionScopeWhere`
 * (`lib/actions/division-auth.ts`) and the contract-vendor helpers:
 *
 *   undefined → enterprise / Super user — NO division restriction.
 *   []        → attached to no divisions — matches NOTHING.
 *   [a, b]    → restricted to those divisions.
 *
 * `vendorId` is ALWAYS present in the output — a vendor only ever reads its
 * own COG. Kept framework-free at the value level (it returns a plain
 * `Prisma.VendorCogRecordWhereInput`) so callers can spread additional
 * predicates into the `where`.
 */
import type { Prisma } from "@/lib/generated/prisma/client"

/**
 * Build the `where` clause that scopes `VendorCogRecord` reads to one
 * vendor, optionally narrowed to a set of divisions.
 *
 * - `divisionIds === undefined` → `{ vendorId }` (no division clause).
 * - `divisionIds === []`        → `{ vendorId, vendorDivisionId: { in: [] } }`
 *   which matches nothing (caller is attached to no divisions).
 * - `divisionIds === [ids]`     → `{ vendorId, vendorDivisionId: { in: ids } }`.
 */
export function vendorCogScopedByDivisions(
  vendorId: string,
  divisionIds: string[] | undefined,
): Prisma.VendorCogRecordWhereInput {
  if (divisionIds === undefined) return { vendorId }
  return { vendorId, vendorDivisionId: { in: divisionIds } }
}
