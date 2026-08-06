"use server"

// Split from lib/actions/contracts.ts (subsystem F5 decomposition,
// 2026-08-05). No barrel at the old path — Next.js disallows
// non-async-function re-exports from "use server" modules.

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { Prisma } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"
import {
  facilityScopeClause,
  type FacilityScope,
} from "@/lib/actions/contracts-auth"
import { getCallerFacilityIds } from "@/lib/actions/facility-assignment"

// ─── Contract Stats ──────────────────────────────────────────────

/**
 * Window (in days) behind the contracts-hero "expiring soon" pill.
 *
 * Module-local const — a `"use server"` file may only export async
 * functions — and echoed back on the payload as `expiringSoonWindowDays`
 * so the badge's label ("expiring in N days") is rendered from the same
 * constant the count was filtered by.
 */
const EXPIRING_SOON_WINDOW_DAYS = 30

export async function getContractStats(
  input: { facilityScope?: FacilityScope } = {},
) {
  const { facility } = await requireFacility()
  const scope: FacilityScope = input.facilityScope ?? "this"
  // Same accessible-facility set the list query is bounded by (see
  // `getContracts`) — the hero has to describe the contract universe the
  // table below it renders, so both resolve "all" through the one canonical
  // helper rather than each deciding what "all" means.
  const accessibleFacilityIds =
    scope === "all" ? await getCallerFacilityIds() : undefined
  const where = facilityScopeClause(scope, facility.id, accessibleFacilityIds)

  // Earned counts only periods that have actually closed — pre-recorded
  // rows for upcoming periods are projections, not earned. Every number
  // below is computed over `where`, so the stats describe exactly the
  // contract universe the list query returns for the same scope.
  //
  // Charles R5.31: the KPI card on the list page is labeled "Total Rebates
  // Earned (YTD)" to match the list column and the detail header. Apply
  // the same calendar-year floor (startOfYear ≤ payPeriodEnd ≤ today).
  // The DB-side aggregation below is the Prisma equivalent of the
  // in-memory `sumEarnedRebatesYTD` helper — keep them in sync (W1.U-B).
  const today = new Date()
  const startOfYear = new Date(today.getFullYear(), 0, 1)
  const expiringCutoff = new Date(
    today.getTime() + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )

  // 2026-07-28 (same wrong-scope sweep): "Rebates Earned (YTD)" sits on the
  // same hero row as the contract counts, so it has to describe the SAME
  // contracts. Filtering the ledger by `facilityId` alone did not: under
  // scope "shared" the hero counted only multi-facility contracts while this
  // summed every rebate the facility had ever earned, single-facility
  // contracts included — money and counts, one row, two different sets.
  // Routing the ledger through the same `where` fixes that.
  //
  // The ledger keeps a `facilityId` bound at ALL times — it is never dropped,
  // only ever pointed at a bounded set. That bound is what stops a shared
  // contract's PEER-facility rebate rows landing in this facility's total.
  //
  // Its width now follows the scope, because the scope is finally bounded:
  //   "this" / "shared" → `facility.id`, the caller's own facility.
  //   "all"             → `{ in: accessibleFacilityIds }`, the SAME set the
  //                       contract counts above were computed over.
  //
  // Under "all" this is a widening from one facility to the caller's
  // accessible set, and it is only safe because that set is bounded: it comes
  // from `getCallerFacilityIds`, i.e. the caller's own HealthSystem
  // (enterprise) or their own FacilityAssignment rows (scoped). It can never
  // reach a facility the caller may not read, and `contract: where` narrows it
  // again to contracts in the same set.
  //
  // The earlier unconditional `facility.id` bound existed because "all"
  // resolved to an unbounded `{}` here: widening the ledger then would have
  // summed EVERY tenant's rebate dollars into this card. That hole is closed
  // (see `facilityScopeClause`), so money and counts can sit on one hero row
  // describing one set of facilities — which is the whole point of the row.
  const rebateWhere: Prisma.RebateWhereInput = {
    payPeriodEnd: { gte: startOfYear, lte: today },
    contract: where,
    facilityId: accessibleFacilityIds
      ? { in: accessibleFacilityIds }
      : facility.id,
  }

  // 2026-07-28 (wrong-scope bug class): `activeContracts` and
  // `expiringSoon` used to be counted CLIENT-side in
  // contracts-list-client from `getContracts`'s FIRST PAGE (pageSize 20,
  // ordered `updatedAt desc`) while `totalContracts` came from a real DB
  // count over the whole scope. A facility with 45 contracts therefore
  // read "45 Total / 20 Active" on one hero row, and "expiring soon"
  // silently depended on which contracts had been edited most recently.
  // All four hero numbers now come from this one action, over this one
  // `where`, in one round trip.
  //
  // `groupBy(['status'])` supplies BOTH the total and the active bucket —
  // `totalContracts` is the sum of its buckets — so the two numbers sat
  // side by side on the hero literally cannot be computed over different
  // row sets. `expiringSoon` needs a date predicate the grouping can't
  // express, so it's one extra scoped `count` (not one count per status).
  const [statusGroups, expiringSoon, aggregates, rebateResult] =
    await Promise.all([
      prisma.contract.groupBy({
        by: ["status"],
        _count: true,
        where,
      }),
      prisma.contract.count({
        where: {
          AND: [
            where,
            {
              status: { not: "expired" },
              expirationDate: { gt: today, lte: expiringCutoff },
            },
          ],
        },
      }),
      prisma.contract.aggregate({
        where,
        _sum: { totalValue: true, annualValue: true },
      }),
      prisma.rebate.aggregate({
        where: rebateWhere,
        _sum: { rebateEarned: true },
      }),
    ])

  let totalContracts = 0
  let activeContracts = 0
  for (const group of statusGroups ?? []) {
    const bucket = typeof group._count === "number" ? group._count : 0
    totalContracts += bucket
    if (group.status === "active") activeContracts += bucket
  }

  return serialize({
    totalContracts,
    activeContracts,
    expiringSoon,
    expiringSoonWindowDays: EXPIRING_SOON_WINDOW_DAYS,
    totalValue: Number(aggregates._sum.totalValue ?? 0),
    totalRebates: Number(rebateResult._sum?.rebateEarned ?? 0),
  })
}
