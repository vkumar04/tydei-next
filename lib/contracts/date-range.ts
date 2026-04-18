/**
 * Pure date-range and facility-set overlap helpers.
 *
 * Per docs/superpowers/specs/2026-04-18-platform-data-model-reconciliation.md §4.10.
 *
 * Used by `isContractDuplicate` and any other callers that need to reason about
 * contract effective-window overlap or shared facility coverage.
 *
 * ─── Conventions ────────────────────────────────────────────────────
 *
 *   A null `expirationDate` is treated as "indefinite" — i.e. +Infinity.
 *   Ranges are INCLUSIVE on both ends. Two ranges [a1,a2] and [b1,b2] overlap
 *   when `a1 <= b2 AND b1 <= a2` (touching boundaries count as overlap).
 *
 *   Facility overlap is a non-empty set intersection on facilityId strings.
 *
 * This module is pure. No DB, no I/O.
 */

/**
 * True when the inclusive date ranges [a1, a2] and [b1, b2] share at least one
 * instant in time. A `null` upper bound is interpreted as an indefinite future
 * (+Infinity), which overlaps any range whose lower bound is finite.
 */
export function datesOverlap(
  a1: Date,
  a2: Date | null,
  b1: Date,
  b2: Date | null,
): boolean {
  const aStart = a1.getTime()
  const aEnd = a2 === null ? Number.POSITIVE_INFINITY : a2.getTime()
  const bStart = b1.getTime()
  const bEnd = b2 === null ? Number.POSITIVE_INFINITY : b2.getTime()
  return aStart <= bEnd && bStart <= aEnd
}

/**
 * True when the two facilityId arrays share at least one id. Empty arrays on
 * either side return false (a contract with no facilities cannot overlap with
 * anything).
 */
export function facilitiesOverlap(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const set = new Set(a)
  for (const id of b) {
    if (set.has(id)) return true
  }
  return false
}
