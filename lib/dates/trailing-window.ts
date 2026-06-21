/**
 * Canonical trailing-12-month window.
 *
 * Before this, surfaces computed the window two incompatible ways —
 * `setFullYear(getFullYear() - 1)` (year-based) vs `setMonth(getMonth() - 12)`
 * (month-based) — which produce windows ~5 days apart, so spend/compliance
 * numbers that are supposed to agree across the dashboard, reports, analytics,
 * and alerts silently disagreed. This is the ONE definition; use it everywhere.
 *
 * Month-based is the canonical choice (a calendar "last 12 months").
 */
export interface TrailingWindow {
  start: Date
  end: Date
}

/** [now - 12 months, now]. Pass `asOf` for determinism in tests. */
export function getTrailing12MonthWindow(asOf: Date = new Date()): TrailingWindow {
  const end = new Date(asOf)
  const start = new Date(end)
  start.setMonth(start.getMonth() - 12)
  return { start, end }
}
