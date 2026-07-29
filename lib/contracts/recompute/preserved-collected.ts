/**
 * Preserved-collected guard for the specialty accrual writers
 * (2026-07-29 math audit — DOUBLE COUNTING, HIGH).
 *
 * THE BUG. The five dispatcher writers (carve-out, threshold, volume, PO,
 * invoice) each delete their own rows with `collectionDate: null` and then
 * insert a fresh row for every window — unconditionally. But
 * `createContractTransaction(rebateKind: "collected")` stamps `collectionDate`
 * on the SAME row and preserves its notes prefix
 * (lib/actions/contract-periods.ts:478-491), so a collected row survives both
 * the family-wide wipe AND the writer's own delete, and the writer then adds a
 * SECOND row for the identical window.
 *
 * Reproduced on the production snapshot. Smith & Nephew carve-out term
 * cms31qbw31phs0iqv7ak1oa1s, after stamping a collection on the
 * 2023-06-01..2024-05-31 row ($33,106.19):
 *
 *     baseline      6 rows   $1,535,078.45
 *     recompute #1  7 rows   $1,568,184.64   <- two identical $33,106.19 rows
 *     recompute #2  7 rows   $1,568,184.64   <- permanent
 *
 * The over-count is exactly the collected row's earned amount, and it is
 * permanent. Worse, the toast reports `sumEarned` computed from the rows the
 * writer just built — $1,535,078.446 — so the UI shows the RIGHT number while
 * the ledger holds the wrong one, which is how this survived.
 *
 * The spend writer already had this guard
 * (lib/actions/contracts/recompute-accrual.ts). This is the same protection,
 * factored out so the five writers cannot drift from it again.
 */

import { prisma } from "@/lib/db"

/**
 * `Rebate.payPeriodStart/End` are `@db.Date` — stored truncated to midnight —
 * while engines emit period ends as `…T23:59:59.999Z`. Comparing full ISO
 * strings NEVER matches, which is the 2026-06-09 "Bug 3" that let a
 * $391,846.83 row duplicate on production 8 minutes apart. Key on the date
 * only, which is what the database actually stores.
 */
const dateKey = (d: Date | string): string =>
  new Date(d).toISOString().slice(0, 10)

/** Stable key for one accrual window. */
export function periodKey(start: Date | string, end: Date | string): string {
  return `${dateKey(start)}|${dateKey(end)}`
}

/**
 * Periods already covered by a COLLECTED row that will survive this writer's
 * delete, and which must therefore not be re-inserted.
 *
 * Call this BEFORE the writer's `deleteMany` — afterwards is equally correct
 * (the delete cannot touch collected rows) but reading first keeps the
 * intent obvious and is one fewer ordering assumption to get wrong.
 *
 * `isTieIn` mirrors the writers' own delete gate: on a tie-in contract the
 * accrual IS the collection (rows auto-stamp `collectionDate = payPeriodEnd`),
 * so the writer drops the `collectionDate: null` filter and wipes everything
 * including collected rows. Nothing survives, so nothing needs preserving —
 * returning an empty set keeps those contracts fully recomputable rather than
 * freezing their history the first time a row is written.
 */
export async function loadPreservedCollectedPeriods(
  contractId: string,
  notesPrefix: string,
  isTieIn: boolean | undefined,
): Promise<Set<string>> {
  if (isTieIn) return new Set()

  const collected = await prisma.rebate.findMany({
    where: {
      contractId,
      collectionDate: { not: null },
      notes: { startsWith: notesPrefix },
    },
    select: { payPeriodStart: true, payPeriodEnd: true },
  })

  return new Set(
    collected.map((r) => periodKey(r.payPeriodStart, r.payPeriodEnd)),
  )
}
