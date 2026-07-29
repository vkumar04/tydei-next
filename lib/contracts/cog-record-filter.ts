/**
 * Canonical COG-record filter (Charles 2026-07-28 revalidation).
 *
 * ONE definition of "which COG rows does this facility's current view mean",
 * shared by every surface that answers that question. Before this file there
 * were two hand-rolled copies — `getCOGRecords` (lib/actions/cog-records.ts)
 * and the CSV endpoint (app/api/cog/export/route.ts) — and they had already
 * drifted: the action supported a free-text `search` across description /
 * inventory number / vendor item number, and the export simply did not read
 * the param.
 *
 * The consequence was a silently mislabeled artifact. An operator typed
 * "Stryker", watched the table narrow to ~108 rows, clicked Export, and
 * received every COG row the facility owns (49,269 in production) under a
 * filename identical to the one a correctly-filtered export would produce.
 * Nothing on screen or in the file said the filter had been dropped, so the
 * file looks plausible in Excel — which is exactly what makes it dangerous to
 * forward.
 *
 * Note this was never an access-control defect: both call sites bind
 * `facilityId` from the session and ignore any client-supplied value. The harm
 * is data correctness, and downstream misuse of a file the operator believes
 * is narrower than it is.
 *
 * Kept free of the Prisma client (types only) so Vitest can exercise it
 * directly and any caller can spread the fragment into its own query.
 */

import type { Prisma, COGMatchStatus } from "@/lib/generated/prisma/client"

/**
 * The "Variance only" quick-filter is a UI convenience, not a column value —
 * it expands to the two statuses an operator means when hunting cost leaks.
 * Exported so the API route can recognise the literal without re-deriving it.
 */
export const COG_VARIANCE_ONLY = "variance_only" as const

const VARIANCE_ONLY_STATUSES: readonly COGMatchStatus[] = [
  "off_contract_item",
  "price_variance",
] as const

/** Every literal `matchStatus` the filter accepts, plus the UI convenience. */
export const COG_MATCH_STATUS_VALUES: readonly COGMatchStatus[] = [
  "pending",
  "on_contract",
  "off_contract_item",
  "out_of_scope",
  "unknown_vendor",
  "price_variance",
] as const

export interface CogRecordFilterInput {
  /** Free-text across description / inventory no. / vendor item no. */
  search?: string | null
  vendorId?: string | null
  /** A `COGMatchStatus`, or the `variance_only` UI convenience. */
  matchStatus?: string | null
  /** ISO date or anything `new Date()` parses; invalid values are ignored. */
  dateFrom?: string | Date | null
  dateTo?: string | Date | null
}

/**
 * An unguarded `new Date("garbage")` yields an Invalid Date that Prisma
 * rejects at query time, turning a typo in a URL into a 500. Treat
 * unparseable input as "no bound" — the caller has already been told the
 * scope by the disclosure text, and a filter that quietly does nothing is
 * safer here than a crash.
 */
function toDate(raw: string | Date | null | undefined): Date | undefined {
  if (!raw) return undefined
  const d = raw instanceof Date ? raw : new Date(raw)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/**
 * Build the `where` clause for a facility's COG records.
 *
 * `facilityId` is a required first argument rather than part of the filter
 * object on purpose: it is the tenant boundary, and it must come from the
 * session at every call site, never from client input. Making it positional
 * means a caller cannot forget it by passing a filter object that happens not
 * to carry one.
 */
export function cogRecordWhere(
  facilityId: string,
  filters: CogRecordFilterInput = {},
): Prisma.COGRecordWhereInput {
  const conditions: Prisma.COGRecordWhereInput[] = [{ facilityId }]

  const search = filters.search?.trim()
  if (search) {
    conditions.push({
      OR: [
        { inventoryDescription: { contains: search, mode: "insensitive" } },
        { inventoryNumber: { contains: search, mode: "insensitive" } },
        { vendorItemNo: { contains: search, mode: "insensitive" } },
      ],
    })
  }

  if (filters.vendorId) conditions.push({ vendorId: filters.vendorId })

  if (filters.matchStatus) {
    if (filters.matchStatus === COG_VARIANCE_ONLY) {
      conditions.push({ matchStatus: { in: [...VARIANCE_ONLY_STATUSES] } })
    } else if (
      COG_MATCH_STATUS_VALUES.includes(filters.matchStatus as COGMatchStatus)
    ) {
      conditions.push({ matchStatus: filters.matchStatus as COGMatchStatus })
    }
    // An unrecognised status is ignored rather than matched literally: the
    // export endpoint takes this straight off a query string, and pushing an
    // arbitrary string into an enum column is a query error, not a filter.
  }

  const gte = toDate(filters.dateFrom)
  const lte = toDate(filters.dateTo)
  if (gte) conditions.push({ transactionDate: { gte } })
  if (lte) conditions.push({ transactionDate: { lte } })

  return { AND: conditions }
}

/**
 * True when any user-controlled narrowing is active.
 *
 * Kept here, beside the clause it describes, because the table's own
 * `hasFilters` had drifted the same way the export did — it omitted `search`,
 * so a search-only view rendered the no-filters empty state and told the user
 * to upload data when the real answer was "nothing matched your search".
 */
export function hasCogFilters(filters: CogRecordFilterInput = {}): boolean {
  return Boolean(
    filters.search?.trim() ||
      filters.vendorId ||
      filters.matchStatus ||
      filters.dateFrom ||
      filters.dateTo,
  )
}
