"use server"

import { prisma } from "@/lib/db"
import { getCurrentAccessContext } from "@/lib/actions/auth-permissions"

/**
 * Division-scope resolution (Settings/Users feature, hard isolation).
 *
 * The ONE place that decides "which vendor divisions can this caller
 * see". Vendor-side reads pass the result into the extended
 * `contractsOwnedByVendor(vendorId, divisionIds)` /
 * `contractOwnershipWhereVendor(...)` helpers and into
 * `divisionScopeWhere` for other division-scoped tables (VendorCogRecord,
 * Connection).
 *
 * Semantics (mirrors the contract helper's `divisionIds` contract):
 *   undefined → enterprise / Super user — NO division restriction.
 *   []        → attached to no divisions — sees NOTHING.
 *   [a, b]    → restricted to those divisions.
 */

/**
 * Resolve the caller's accessible division IDs within `vendorId`.
 * Super-tier callers get `undefined` (no restriction). Everyone else gets
 * the concrete (possibly empty) list of divisions they are attached to via
 * `DivisionMember`. If the vendor has NO divisions at all, returns
 * `undefined` too — there is nothing to isolate yet (pre-division vendors
 * behave exactly as before).
 */
export async function callerVendorDivisionIds(
  userId: string,
  vendorId: string,
): Promise<string[] | undefined> {
  const ctx = await getCurrentAccessContext()
  if (ctx?.tier === "super") return undefined

  const divisionCount = await prisma.vendorDivision.count({ where: { vendorId } })
  if (divisionCount === 0) return undefined

  const attached = await prisma.divisionMember.findMany({
    where: { userId, division: { vendorId } },
    select: { divisionId: true },
  })
  return attached.map((d) => d.divisionId)
}

/**
 * Generic where-fragment for any vendor-division-scoped table
 * (`VendorCogRecord`, `Connection`, …). Same `undefined / [] / [ids]`
 * semantics. Spread into a Prisma `where`.
 *
 * ```ts
 * where: { vendorId, ...divisionScopeWhere(divisionIds) }
 * ```
 */
export async function divisionScopeWhere(
  divisionIds: string[] | undefined,
): Promise<{ vendorDivisionId?: { in: string[] } }> {
  if (divisionIds === undefined) return {}
  return { vendorDivisionId: { in: divisionIds } }
}
