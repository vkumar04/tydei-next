/**
 * Case costing — pure case-list sort helpers.
 *
 * Reference: docs/superpowers/specs/2026-04-18-case-costing-rewrite.md
 * Subsystem 1 — Cases list tab (canonical §7/§8 sort).
 *
 * Pure — non-mutating, stable sort. No DB, no side effects.
 */

export type CaseSortField =
  | "dateOfSurgery"
  | "caseNumber"
  | "surgeonName"
  | "totalSpend"
  | "totalReimbursement"
  /** totalReimbursement - totalSpend */
  | "margin"
  /** (reimb - spend) / reimb × 100; 0 when reimb = 0 */
  | "marginPercent"

export type SortDirection = "asc" | "desc"

interface MinCase {
  dateOfSurgery: Date
  caseNumber: string
  surgeonName: string | null
  totalSpend: number
  totalReimbursement: number
}

function marginOf(c: MinCase): number {
  return c.totalReimbursement - c.totalSpend
}

function marginPercentOf(c: MinCase): number {
  if (c.totalReimbursement === 0) return 0
  return ((c.totalReimbursement - c.totalSpend) / c.totalReimbursement) * 100
}

/**
 * Stable, non-mutating sort of cases by the given field + direction.
 *
 * Null semantics (consistent with SQL `NULLS LAST`):
 *   - surgeonName null sorts LAST in `asc`, FIRST in `desc`.
 *
 * Divide-by-zero safe:
 *   - marginPercent uses 0 when totalReimbursement = 0.
 */
export function sortCases<T extends MinCase>(
  cases: T[],
  field: CaseSortField,
  direction: SortDirection,
): T[] {
  const dir = direction === "asc" ? 1 : -1

  // Decorate with original index for stable sort.
  const decorated = cases.map((c, i) => ({ c, i }))

  decorated.sort((a, b) => {
    const cmp = compareField(a.c, b.c, field, direction)
    if (cmp !== 0) return cmp
    // Stable tiebreaker: preserve original order.
    return a.i - b.i
  })

  // Note: dir is inlined in compareField; the above `dir` is unused here
  // but kept defensively to clarify intent for readers.
  void dir

  return decorated.map((d) => d.c)
}

function compareField(
  a: MinCase,
  b: MinCase,
  field: CaseSortField,
  direction: SortDirection,
): number {
  const dir = direction === "asc" ? 1 : -1

  switch (field) {
    case "dateOfSurgery":
      return (a.dateOfSurgery.getTime() - b.dateOfSurgery.getTime()) * dir
    case "caseNumber":
      return compareStrings(a.caseNumber, b.caseNumber) * dir
    case "surgeonName":
      return compareNullableString(a.surgeonName, b.surgeonName, direction)
    case "totalSpend":
      return (a.totalSpend - b.totalSpend) * dir
    case "totalReimbursement":
      return (a.totalReimbursement - b.totalReimbursement) * dir
    case "margin":
      return (marginOf(a) - marginOf(b)) * dir
    case "marginPercent":
      return (marginPercentOf(a) - marginPercentOf(b)) * dir
  }
}

function compareStrings(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * Nulls-last semantics:
 *   asc  → nulls sort AFTER non-null (nulls last)
 *   desc → nulls sort BEFORE non-null (nulls first)
 */
function compareNullableString(
  a: string | null,
  b: string | null,
  direction: SortDirection,
): number {
  const aNull = a === null
  const bNull = b === null

  if (aNull && bNull) return 0
  if (aNull) return direction === "asc" ? 1 : -1
  if (bNull) return direction === "asc" ? -1 : 1

  const cmp = compareStrings(a as string, b as string)
  return direction === "asc" ? cmp : -cmp
}
