/**
 * Canonical alert SCOPE — the single source of truth for "what counts as an
 * open alert" across every surface (header badge, dashboard KPI, Alerts page).
 *
 * Before this helper, three surfaces disagreed: the header badge counted
 * `new_alert` ONLY (+exclusions), the dashboard counted `new_alert`+`read`
 * (NO exclusions, so spend-target/proposal rows inflated it), and the Alerts
 * page showed both. A user who read their alerts saw the badge drop to 0 while
 * the dashboard stayed elevated — the contradiction Vick hit (2026-06-21).
 *
 * Canonical model (modern task-inbox): the meaningful number is **OPEN**
 * = unresolved = `new_alert` + `read`, with the non-inbox exclusions applied.
 * Reading an alert does NOT clear it — only resolving / dismissing does. Every
 * count surface routes through {@link openAlertWhere} so they always agree.
 */

import { Prisma } from "@/lib/generated/prisma/client"
import { excludeSpendTargetAlerts } from "./spend-target-filter"
import { excludeVendorProposalAlerts } from "./vendor-proposal-filter"

/** Statuses that count as "open" (needs attention) — not resolved/dismissed. */
export const OPEN_ALERT_STATUSES = ["new_alert", "read"] as const

export interface AlertScope {
  portalType: "facility" | "vendor"
  facilityId?: string
  vendorId?: string
}

/**
 * Inbox-visibility exclusions: rebate-optimizer spend targets and legacy
 * vendor-proposal masquerade rows are persisted as Alert rows but are NOT real
 * alerts. Both fragments are OR-shaped, so they MUST be AND-composed (spreading
 * both into one object silently clobbers one — the OR-spread collision class).
 */
export function excludeNonInboxAlerts(): Prisma.AlertWhereInput[] {
  return [excludeSpendTargetAlerts(), excludeVendorProposalAlerts()]
}

function tenantClause(scope: AlertScope): Prisma.AlertWhereInput {
  return scope.portalType === "vendor"
    ? { vendorId: scope.vendorId }
    : { facilityId: scope.facilityId }
}

/**
 * Canonical "open" (unresolved) alert filter — the ONE definition behind the
 * header badge, the dashboard "Open Alerts" KPI, and the Alerts-page count.
 */
export function openAlertWhere(scope: AlertScope): Prisma.AlertWhereInput {
  return {
    ...tenantClause(scope),
    portalType: scope.portalType,
    status: { in: [...OPEN_ALERT_STATUSES] },
    AND: excludeNonInboxAlerts(),
  }
}

/**
 * Inbox base scope as an AND-array WITHOUT a status filter — for list /
 * aggregate surfaces that apply their own status filter on top (e.g. the
 * Alerts page "Resolved" tab). Tenant + portal + non-inbox exclusions.
 */
export function inboxAlertScope(scope: AlertScope): Prisma.AlertWhereInput[] {
  return [
    tenantClause(scope),
    { portalType: scope.portalType },
    ...excludeNonInboxAlerts(),
  ]
}
