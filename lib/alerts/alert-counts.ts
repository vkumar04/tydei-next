/**
 * Canonical alert COUNTS aggregator — shared by the facility (`getAlerts`)
 * and vendor (`getVendorAlerts`) actions so the hero/badge math lives in one
 * place. The caller passes its OWN tenant-scoped `baseScope` (facility/vendor
 * + portal + the relevant non-inbox exclusions) so tenant isolation stays
 * explicit at each call site; this helper only owns the groupBy + reduction.
 *
 *   - byStatus    — every status (incl. resolved/dismissed)
 *   - bySeverity  — ACTIVE (new_alert|read) rows only
 *   - byType      — ACTIVE rows only
 *   - activeTotal — ACTIVE row count
 *   - unread      — new_alert row count
 */

import { prisma } from "@/lib/db"
import type { Prisma } from "@/lib/generated/prisma/client"

export interface AlertCounts {
  byStatus: Record<string, number>
  bySeverity: Record<string, number>
  byType: Record<string, number>
  activeTotal: number
  unread: number
}

const ACTIVE_STATUSES = new Set(["new_alert", "read"])

export async function aggregateAlertCounts(
  baseScope: Prisma.AlertWhereInput[],
): Promise<AlertCounts> {
  const grouped = await prisma.alert.groupBy({
    by: ["status", "severity", "alertType"],
    where: { AND: baseScope },
    _count: { _all: true },
  })

  const counts: AlertCounts = {
    byStatus: {},
    bySeverity: {},
    byType: {},
    activeTotal: 0,
    unread: 0,
  }
  for (const g of grouped) {
    const n = g._count._all
    counts.byStatus[g.status] = (counts.byStatus[g.status] ?? 0) + n
    if (ACTIVE_STATUSES.has(g.status)) {
      counts.activeTotal += n
      counts.bySeverity[g.severity] = (counts.bySeverity[g.severity] ?? 0) + n
      counts.byType[g.alertType] = (counts.byType[g.alertType] ?? 0) + n
    }
    if (g.status === "new_alert") counts.unread += n
  }
  return counts
}
