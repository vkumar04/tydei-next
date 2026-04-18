/**
 * Facility dashboard — alert summary helpers.
 *
 * Pure aggregation over Alert rows. The server-action layer passes the
 * trimmed-down row projection in; this file has no Prisma imports.
 *
 * Reference: docs/superpowers/specs/2026-04-18-facility-dashboard-rewrite.md
 */

export type AlertPriority = "high" | "medium" | "low"

export type AlertStatus = "new_alert" | "read" | "resolved" | "dismissed"

export type AlertSeverity = "low" | "medium" | "high"

export interface AlertSummaryInputRow {
  status: AlertStatus
  severity: AlertSeverity
  alertType: string
}

export interface AlertSummaryInput {
  alerts: AlertSummaryInputRow[]
}

export interface AlertSummary {
  /** new_alert + read statuses. */
  totalUnresolved: number
  highPriority: number
  mediumPriority: number
  lowPriority: number
  /** Count per alertType, unresolved only. */
  byType: Record<string, number>
}

const UNRESOLVED_STATUSES: ReadonlySet<AlertStatus> = new Set<AlertStatus>([
  "new_alert",
  "read",
])

/**
 * Aggregate the dashboard alerts summary section.
 *
 * Only unresolved alerts (status ∈ {new_alert, read}) contribute to any
 * of the returned counts. Resolved/dismissed rows are silently ignored.
 */
export function summarizeAlerts(input: AlertSummaryInput): AlertSummary {
  let totalUnresolved = 0
  let highPriority = 0
  let mediumPriority = 0
  let lowPriority = 0
  const byType: Record<string, number> = {}

  for (const row of input.alerts) {
    if (!UNRESOLVED_STATUSES.has(row.status)) continue

    totalUnresolved += 1

    if (row.severity === "high") highPriority += 1
    else if (row.severity === "medium") mediumPriority += 1
    else if (row.severity === "low") lowPriority += 1

    byType[row.alertType] = (byType[row.alertType] ?? 0) + 1
  }

  return {
    totalUnresolved,
    highPriority,
    mediumPriority,
    lowPriority,
    byType,
  }
}
