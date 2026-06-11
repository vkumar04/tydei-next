/**
 * Canonical "awaiting review" filter for vendor-submitted pending contracts
 * (bug-bash B3, 2026-06-11).
 *
 * `getFacilityPendingContracts` returns EVERY status (rejected / approved /
 * revision_requested rows stay visible per Charles 2026-06-09), so any
 * surface that needs the *actionable* subset — the Pending Approval tab's
 * "awaiting review" list and the tab-strip attention badge — MUST go through
 * this filter. Badge count == tab rows by construction; do not hand-roll a
 * `status === "submitted"` check elsewhere.
 */
export function isAwaitingReview(row: { status: string }): boolean {
  return row.status === "submitted"
}

export function filterAwaitingReview<T extends { status: string }>(
  rows: readonly T[] | undefined,
): T[] {
  return (rows ?? []).filter(isAwaitingReview)
}
