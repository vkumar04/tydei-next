"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import type { AlertFilters } from "@/lib/validators/alerts"
import type { Prisma } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"
import { excludeVendorProposalAlerts } from "@/lib/alerts/vendor-proposal-filter"

// ─── Vendor Alerts ──────────────────────────────────────────────

/**
 * Aggregate counts shipped alongside the page of alerts (audit M10) so
 * the vendor hero tiles reflect the FULL vendor-scoped population, not
 * just the rows the current page shows. Mirrors `AlertCounts` in
 * lib/actions/alerts.ts.
 */
export interface VendorAlertCounts {
  byStatus: Record<string, number>
  bySeverity: Record<string, number>
  byType: Record<string, number>
  activeTotal: number
  unread: number
}

const ACTIVE_STATUSES = new Set(["new_alert", "read"])

export async function getVendorAlerts(input: Omit<AlertFilters, "facilityId" | "portalType"> & { vendorId?: string }) {
  const { vendor } = await requireVendor()
  const { alertType, severity, status, page = 1, pageSize = 20 } = input

  const baseScope: Prisma.AlertWhereInput[] = [
    { vendorId: vendor.id },
    { portalType: "vendor" },
    // Legacy masquerade proposal rows (pre-2026-06-09 createProposal
    // persisted prospective proposals as alertType "compliance" rows)
    // are NOT alerts — exclude them from the list AND the hero counts.
    excludeVendorProposalAlerts(),
  ]
  const conditions: Prisma.AlertWhereInput[] = [...baseScope]

  if (alertType) conditions.push({ alertType })
  if (severity) conditions.push({ severity })
  if (status) {
    conditions.push({ status })
  } else {
    conditions.push({ status: { in: ["new_alert", "read"] } })
  }

  const where: Prisma.AlertWhereInput = { AND: conditions }

  const [alerts, total, grouped] = await Promise.all([
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
    prisma.alert.groupBy({
      by: ["status", "severity", "alertType"],
      where: { AND: baseScope },
      _count: { _all: true },
    }),
  ])

  const counts: VendorAlertCounts = {
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

  return serialize({ alerts, total, page, pageSize, counts })
}

// ─── Vendor Alert Actions ───────────────────────────────────────

export async function resolveVendorAlert(id: string) {
  const { vendor } = await requireVendor()
  await requireCanMutate()
  await prisma.alert.update({
    where: { id, vendorId: vendor.id },
    data: { status: "resolved", resolvedAt: new Date() },
  })
}

export async function dismissVendorAlert(id: string) {
  const { vendor } = await requireVendor()
  await requireCanMutate()
  await prisma.alert.update({
    where: { id, vendorId: vendor.id },
    data: { status: "dismissed", dismissedAt: new Date() },
  })
}

export async function bulkResolveVendorAlerts(ids: string[]) {
  const { vendor } = await requireVendor()
  await requireCanMutate()
  const result = await prisma.alert.updateMany({
    where: { id: { in: ids }, vendorId: vendor.id },
    data: { status: "resolved", resolvedAt: new Date() },
  })
  return { resolved: result.count }
}

export async function bulkDismissVendorAlerts(ids: string[]) {
  const { vendor } = await requireVendor()
  await requireCanMutate()
  const result = await prisma.alert.updateMany({
    where: { id: { in: ids }, vendorId: vendor.id },
    data: { status: "dismissed", dismissedAt: new Date() },
  })
  return { dismissed: result.count }
}

// ─── Mark Read (cosmetic — parity with facility) ────────────────
// Reading an alert is cosmetic: it does NOT change the canonical open count
// (only resolve/dismiss does), mirroring the facility side. So these are
// deliberately NOT gated by requireCanMutate (read-only `user` tier may clear
// its own view). They only flip `new_alert`→`read`, never un-resolving a
// resolved/dismissed row. Vendor-scoped. (2026-06-21 alerts refactor.)

export async function markVendorAlertRead(id: string) {
  // read-only-guard-skip: cosmetic read-state only; never un-resolves.
  const { vendor } = await requireVendor()
  await prisma.alert.updateMany({
    where: { id, vendorId: vendor.id, status: "new_alert" },
    data: { status: "read", readAt: new Date() },
  })
}

export async function bulkMarkVendorAlertsRead(ids: string[]) {
  // read-only-guard-skip: cosmetic read-state only; only new_alert→read.
  const { vendor } = await requireVendor()
  const result = await prisma.alert.updateMany({
    where: { id: { in: ids }, vendorId: vendor.id, status: "new_alert" },
    data: { status: "read", readAt: new Date() },
  })
  return { updated: result.count }
}

export async function markAllVendorAlertsRead(): Promise<{ updated: number }> {
  // read-only-guard-skip: cosmetic read-state only; flips all unread → read.
  const { vendor } = await requireVendor()
  const result = await prisma.alert.updateMany({
    where: {
      AND: [
        { vendorId: vendor.id },
        { portalType: "vendor" },
        { status: "new_alert" },
        excludeVendorProposalAlerts(),
      ],
    },
    data: { status: "read", readAt: new Date() },
  })
  return { updated: result.count }
}
