"use server"

import { prisma } from "@/lib/db"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { alertFiltersSchema, type AlertFilters } from "@/lib/validators/alerts"
import type { Prisma } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import { runAlertSynthesisForFacility } from "@/lib/alerts/synthesize-persist"
import { excludeSpendTargetAlerts } from "@/lib/alerts/spend-target-filter"
import { excludeVendorProposalAlerts } from "@/lib/alerts/vendor-proposal-filter"
import {
  planBulkAction,
  type BulkAlertAction,
} from "@/lib/alerts/bulk-actions"
import {
  buildTransitionPatch,
  type AlertStatusValue,
} from "@/lib/alerts/status-workflow"
import {
  rankAlerts,
  type AlertForRanking,
  type AlertSeverity,
  type AlertTypeValue,
  type RankedAlert,
} from "@/lib/alerts/priority-ranker"

// ─── List Alerts ─────────────────────────────────────────────────

/**
 * Aggregate counts shipped alongside the page of alerts (audit M10) so
 * hero tiles reflect the FULL facility-scoped population, not just the
 * first 20 rows the page happens to show.
 *
 * All maps are computed over the base scope (facility + portal, spend
 * targets excluded):
 *   - byStatus       — every status, for "Resolved" style tiles
 *   - bySeverity     — ACTIVE (new_alert|read) rows only
 *   - byType         — ACTIVE rows only
 *   - activeTotal    — ACTIVE row count
 *   - unread         — new_alert row count
 */
export interface AlertCounts {
  byStatus: Record<string, number>
  bySeverity: Record<string, number>
  byType: Record<string, number>
  activeTotal: number
  unread: number
}

const ACTIVE_STATUSES = new Set(["new_alert", "read"])

async function aggregateAlertCounts(
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

export async function getAlerts(input: AlertFilters) {
  const { facility } = await requireFacility()
  const filters = alertFiltersSchema.parse(input)

  // Audit H5: rebate-optimizer spend targets are persisted as Alert
  // rows; they must never surface in (or be counted by) alert UIs,
  // where resolve/dismiss/mark-read would destroy them.
  const baseScope: Prisma.AlertWhereInput[] = [
    { facilityId: facility.id },
    { portalType: filters.portalType },
    excludeSpendTargetAlerts(),
  ]

  const conditions: Prisma.AlertWhereInput[] = [...baseScope]

  if (filters.alertType) conditions.push({ alertType: filters.alertType })
  if (filters.severity) conditions.push({ severity: filters.severity })
  if (filters.status) {
    conditions.push({ status: filters.status })
  } else {
    conditions.push({ status: { in: ["new_alert", "read"] } })
  }

  const where: Prisma.AlertWhereInput = { AND: conditions }
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 20

  const [alerts, total, counts] = await Promise.all([
    prisma.alert.findMany({
      where,
      include: {
        contract: { select: { id: true, name: true, status: true } },
        vendor: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.alert.count({ where }),
    aggregateAlertCounts(baseScope),
  ])

  return serialize({ alerts, total, page, pageSize, counts })
}

// ─── Single Alert ────────────────────────────────────────────────

export async function getAlert(id: string) {
  const { facility } = await requireFacility()

  const alert = await prisma.alert.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
    include: {
      contract: {
        select: {
          id: true, name: true, status: true, contractNumber: true,
          effectiveDate: true, expirationDate: true, totalValue: true,
        },
      },
      vendor: { select: { id: true, name: true } },
      facility: { select: { id: true, name: true } },
    },
  })
  return serialize(alert)
}

// ─── Unread Count ────────────────────────────────────────────────

export async function getUnreadAlertCount(input: {
  /** @deprecated Charles audit round-10: ignored — derived from session. */
  facilityId?: string
  /** @deprecated Charles audit round-10: ignored — derived from session. */
  vendorId?: string
  portalType: "facility" | "vendor"
}) {
  // Charles audit round-10 CONCERN: derive scope from authenticated
  // session rather than client input. Pre-fix any facility user could
  // pass another tenant's facilityId (or vendorId + portalType=vendor)
  // to enumerate their unread-alert count. Counts only — info
  // disclosure, not data corruption — but the same pattern was the
  // class for several earlier BLOCKERs.
  // 2026-06-10 vendor-prospective audit #4: the vendor LIST excludes
  // legacy proposal-masquerade rows but this badge count didn't — prod
  // showed a phantom unread count the list never displays (and those
  // rows can't be marked read by a vendor). Both exclusion helpers
  // return OR-fragments, so they MUST be AND-composed — spreading both
  // would silently clobber one (the OR-spread collision class).
  const where: Prisma.AlertWhereInput = {
    portalType: input.portalType,
    status: "new_alert",
    // Audit H5: spend targets are not alerts — keep the badge honest.
    AND: [excludeSpendTargetAlerts(), excludeVendorProposalAlerts()],
  }
  if (input.portalType === "facility") {
    const { facility } = await requireFacility()
    where.facilityId = facility.id
  } else {
    const { vendor } = await requireVendor()
    where.vendorId = vendor.id
  }

  const count = await prisma.alert.count({ where })
  return count
}

// ─── Mark Read ───────────────────────────────────────────────────

export async function markAlertRead(id: string) {
  const { facility } = await requireFacility()
  await requireCanMutate()
  await prisma.alert.update({
    where: { id, facilityId: facility.id },
    data: { status: "read", readAt: new Date() },
  })
}

// ─── Resolve ─────────────────────────────────────────────────────

export async function resolveAlert(id: string) {
  const session = await requireFacility()
  await requireCanMutate()
  await prisma.alert.update({
    where: { id, facilityId: session.facility.id },
    data: { status: "resolved", resolvedAt: new Date() },
  })
  await logAudit({
    userId: session.user.id,
    action: "alert.resolved",
    entityType: "alert",
    entityId: id,
  })
}

// ─── Dismiss ─────────────────────────────────────────────────────

export async function dismissAlert(id: string) {
  const session = await requireFacility()
  await requireCanMutate()
  await prisma.alert.update({
    where: { id, facilityId: session.facility.id },
    data: { status: "dismissed", dismissedAt: new Date() },
  })
  await logAudit({
    userId: session.user.id,
    action: "alert.dismissed",
    entityType: "alert",
    entityId: id,
  })
}

// ─── Bulk Resolve ────────────────────────────────────────────────

export async function bulkResolveAlerts(ids: string[]) {
  const { facility } = await requireFacility()
  await requireCanMutate()
  const result = await prisma.alert.updateMany({
    where: { id: { in: ids }, facilityId: facility.id },
    data: { status: "resolved", resolvedAt: new Date() },
  })
  return { resolved: result.count }
}

// ─── Bulk Dismiss ────────────────────────────────────────────────

export async function bulkDismissAlerts(ids: string[]) {
  const { facility } = await requireFacility()
  await requireCanMutate()
  const result = await prisma.alert.updateMany({
    where: { id: { in: ids }, facilityId: facility.id },
    data: { status: "dismissed", dismissedAt: new Date() },
  })
  return { dismissed: result.count }
}

// ─── Synthesize + Persist (subsystem-4 pipeline) ─────────────────

/**
 * Synthesize fresh alerts from live contract + COG + accrual state,
 * persist new alerts, and resolve any alerts whose underlying
 * condition has cleared.
 *
 * Session-scoped wrapper around the core in
 * `lib/alerts/synthesize-persist.ts` (audit H4) — the same core is
 * fired by the COG import pipeline and the cron sweep.
 */
export async function synthesizeAndPersistAlerts(): Promise<{
  created: number
  resolved: number
}> {
  const session = await requireFacility()
  // Creates/resolves Alert rows — block read-only `user` tier, consistent with
  // every other alert mutation in this file (audit 2026-06-21).
  await requireCanMutate()
  return runAlertSynthesisForFacility(session.facility.id, {
    auditUserId: session.user.id,
  })
}

// ─── Bulk Update Alerts (plan + apply) ───────────────────────────

/**
 * Bulk mark-as-read / resolve / dismiss. Uses planBulkAction to filter
 * legally-transitionable rows, then applies in a $transaction.
 */
export async function bulkUpdateAlerts(input: {
  alertIds: string[]
  action: BulkAlertAction
}): Promise<{
  updated: number
  skipped: number
}> {
  const session = await requireFacility()
  await requireCanMutate()
  const facilityId = session.facility.id

  if (input.alertIds.length === 0) {
    return { updated: 0, skipped: 0 }
  }

  // Scope to facility — any id that isn't owned simply drops out here.
  const rows = await prisma.alert.findMany({
    where: {
      id: { in: input.alertIds },
      facilityId,
    },
    select: { id: true, status: true },
  })

  const plan = planBulkAction({
    action: input.action,
    alerts: rows.map((r) => ({
      id: r.id,
      status: r.status as AlertStatusValue,
    })),
  })

  if (plan.toUpdate.length > 0) {
    await prisma.$transaction(
      plan.toUpdate.map((item) =>
        prisma.alert.update({
          where: { id: item.alertId, facilityId },
          data: {
            status: item.patch.status,
            ...(item.patch.readAt !== undefined
              ? { readAt: item.patch.readAt }
              : {}),
            ...(item.patch.resolvedAt !== undefined
              ? { resolvedAt: item.patch.resolvedAt }
              : {}),
            ...(item.patch.dismissedAt !== undefined
              ? { dismissedAt: item.patch.dismissedAt }
              : {}),
          },
        }),
      ),
    )
  }

  await logAudit({
    userId: session.user.id,
    action: `alerts.bulk_${input.action}`,
    entityType: "alert",
    metadata: {
      updated: plan.toUpdate.length,
      skipped: plan.skipped.length + (input.alertIds.length - rows.length),
    },
  })

  return {
    updated: plan.toUpdate.length,
    // Rows that didn't belong to the facility count as skipped too.
    skipped: plan.skipped.length + (input.alertIds.length - rows.length),
  }
}

// ─── Mark All Alerts Read ────────────────────────────────────────

/**
 * Mark every unread ("new_alert") alert as read for the facility.
 */
export async function markAllAlertsRead(): Promise<{ updated: number }> {
  const session = await requireFacility()
  await requireCanMutate()
  const facilityId = session.facility.id

  const rows = await prisma.alert.findMany({
    where: {
      facilityId,
      status: "new_alert",
      // Audit H5: never flip a spend target to "read" — that used to
      // be invisible data destruction for the rebate optimizer.
      ...excludeSpendTargetAlerts(),
    },
    select: { id: true, status: true },
  })

  if (rows.length === 0) return { updated: 0 }

  const patch = buildTransitionPatch("read")
  await prisma.$transaction(
    rows.map((r) =>
      prisma.alert.update({
        where: { id: r.id, facilityId },
        data: {
          status: patch.status,
          readAt: patch.readAt ?? null,
        },
      }),
    ),
  )

  await logAudit({
    userId: session.user.id,
    action: "alerts.mark_all_read",
    entityType: "alert",
    metadata: { updated: rows.length },
  })

  return { updated: rows.length }
}

// ─── Ranked Alerts (Priority tab) ────────────────────────────────

const RANKABLE_ALERT_TYPES: ReadonlyArray<AlertTypeValue> = [
  "off_contract",
  "expiring_contract",
  "tier_threshold",
  "rebate_due",
  "payment_due",
  "other",
]

function normalizeAlertType(value: string): AlertTypeValue {
  return (RANKABLE_ALERT_TYPES as readonly string[]).includes(value)
    ? (value as AlertTypeValue)
    : "other"
}

function extractDollarImpact(
  alertType: string,
  metadata: Record<string, unknown>,
): number | null {
  // Metadata shapes vary per alert type — pick the most relevant field
  // for ranking. Missing / non-numeric values yield null.
  const pick = (k: string): number | null => {
    const v = metadata[k]
    return typeof v === "number" && Number.isFinite(v) ? v : null
  }
  switch (alertType) {
    case "off_contract":
      return pick("total_amount")
    case "expiring_contract":
      return pick("annual_value")
    case "tier_threshold":
      return pick("amount_needed")
    case "rebate_due":
    case "payment_due":
      return pick("amount")
    default:
      return null
  }
}

/**
 * Return ranked alerts for the facility — consumes the priority ranker.
 * UI uses this to power the "Priority" tab.
 */
export async function getRankedAlerts(options?: {
  limit?: number
  statusFilter?: AlertStatusValue
}): Promise<RankedAlert[]> {
  const { facility } = await requireFacility()
  const limit = options?.limit ?? 20

  const where: Prisma.AlertWhereInput = {
    facilityId: facility.id,
    portalType: "facility",
    // Audit H5: spend targets must never enter the priority ranking.
    ...excludeSpendTargetAlerts(),
  }
  if (options?.statusFilter) {
    where.status = options.statusFilter
  } else {
    where.status = { in: ["new_alert", "read"] }
  }

  const rows = await prisma.alert.findMany({
    where,
    select: {
      id: true,
      severity: true,
      alertType: true,
      metadata: true,
      createdAt: true,
    },
  })

  const forRanking: AlertForRanking[] = rows.map((r) => {
    const metadata = (r.metadata ?? {}) as Record<string, unknown>
    return {
      id: r.id,
      severity: r.severity as AlertSeverity,
      alertType: normalizeAlertType(r.alertType),
      dollarImpact: extractDollarImpact(r.alertType, metadata),
      createdAt: r.createdAt,
    }
  })

  const ranked = rankAlerts(forRanking)
  return ranked.slice(0, limit)
}

// ─── Generate Alerts — REMOVED ───────────────────────────────────
//
// The legacy `generateAlerts` action and `lib/alerts/generate-alerts.ts`
// were deleted in the 2026-06-09 renewals+alerts audit (H6). They had a
// parallel, non-deduped rule set (no dedupeKey, per-severity duplicate
// rows, camelCase metadata the detail UI can't read) and re-spammed the
// inbox on every invocation. The canonical path is the synthesizer:
// `synthesizeAndPersistAlerts()` above / `runAlertSynthesisForFacility`
// in lib/alerts/synthesize-persist.ts (deduped via metadata.dedupeKey,
// auto-resolves cleared conditions).
