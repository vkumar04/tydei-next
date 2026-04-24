/**
 * Evergreen sentinel — single source of truth.
 *
 * Prisma's `Contract.expirationDate` and `ContractTerm.effectiveEnd`
 * are `DateTime @db.Date NOT NULL`. When a contract has no fixed end
 * date (auto-renewing, "continues until terminated"), the server
 * actions write this sentinel instead of null.
 *
 * Every write site (contract.create, contract.update, term.create,
 * term.update, pending-contract approval) uses `EVERGREEN_DATE`.
 * Every read site that needs to detect evergreen (formatDate display,
 * renewal math, term-length math) uses `isEvergreen`.
 *
 * Using an exact millisecond equality check (rather than "year >= 9999")
 * prevents false-positive "Evergreen" labels on any other far-future
 * date that might appear through unrelated logic.
 */

/** The canonical evergreen date: 9999-12-31 UTC midnight. */
export const EVERGREEN_DATE = new Date(Date.UTC(9999, 11, 31))

/** Millisecond value of the evergreen sentinel. Exported for exact-
 *  equality checks without recreating a Date object per call. */
export const EVERGREEN_MS = EVERGREEN_DATE.getTime()

/**
 * True iff the date is exactly the evergreen sentinel. Accepts Date,
 * ISO string, or null/undefined; returns false for anything non-matching
 * including invalid dates, so callers can use it as a safe predicate.
 */
export function isEvergreen(
  date: Date | string | null | undefined,
): boolean {
  if (date === null || date === undefined || date === "") return false
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) return false
  return d.getTime() === EVERGREEN_MS
}
