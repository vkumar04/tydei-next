/**
 * Dashboard alerts dispatcher — filters the ranked alert feed into
 * the limited "top alerts" widget (canonical facility-dashboard §5).
 *
 * Pure function. Given the output of `rankAlerts` (from
 * lib/alerts/priority-ranker.ts), it clips the feed to a dashboard
 * widget size, optionally filtering by alertType, and reports how many
 * alerts were dropped so the UI can render a "+N more" link.
 *
 * Reference: docs/superpowers/specs/2026-04-18-facility-dashboard-rewrite.md §5
 */

import type { RankedAlert } from "@/lib/alerts/priority-ranker"

export interface DashboardAlertsDispatchInput {
  rankedAlerts: RankedAlert[]
  /** Max alerts to surface on the dashboard. Default 5. */
  limit?: number
  /** Filter to specific alert types. Empty array/undefined → no filter. */
  includeTypes?: string[]
}

export interface DispatchedAlerts {
  top: RankedAlert[]
  /** Count of alerts that didn't make the cut (for "+N more" link). */
  moreCount: number
}

const DEFAULT_LIMIT = 5

/**
 * Dispatch ranked alerts into the dashboard "top alerts" widget.
 *
 * Algorithm:
 *   1. Apply the includeTypes filter (no-op if empty/undefined).
 *   2. Slice the first `limit` entries (callers pass already-ranked input,
 *      so order is preserved).
 *   3. moreCount = remaining filtered-but-not-selected count.
 *
 * Edge cases:
 *   - limit <= 0 → top is empty, moreCount is the full filtered length.
 *   - limit > filtered.length → top is the full filtered list, moreCount = 0.
 */
export function dispatchDashboardAlerts(
  input: DashboardAlertsDispatchInput,
): DispatchedAlerts {
  const { rankedAlerts, limit = DEFAULT_LIMIT, includeTypes } = input

  const filtered =
    includeTypes && includeTypes.length > 0
      ? rankedAlerts.filter((a) => includeTypes.includes(a.alertType))
      : rankedAlerts

  const effectiveLimit = Math.max(0, limit)
  const top = filtered.slice(0, effectiveLimit)
  const moreCount = Math.max(0, filtered.length - top.length)

  return { top, moreCount }
}
