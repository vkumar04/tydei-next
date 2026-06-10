"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
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
  await prisma.alert.update({
    where: { id, vendorId: vendor.id },
    data: { status: "resolved", resolvedAt: new Date() },
  })
}

export async function dismissVendorAlert(id: string) {
  const { vendor } = await requireVendor()
  await prisma.alert.update({
    where: { id, vendorId: vendor.id },
    data: { status: "dismissed", dismissedAt: new Date() },
  })
}

export async function bulkResolveVendorAlerts(ids: string[]) {
  const { vendor } = await requireVendor()
  const result = await prisma.alert.updateMany({
    where: { id: { in: ids }, vendorId: vendor.id },
    data: { status: "resolved", resolvedAt: new Date() },
  })
  return { resolved: result.count }
}

export async function bulkDismissVendorAlerts(ids: string[]) {
  const { vendor } = await requireVendor()
  const result = await prisma.alert.updateMany({
    where: { id: { in: ids }, vendorId: vendor.id },
    data: { status: "dismissed", dismissedAt: new Date() },
  })
  return { dismissed: result.count }
}
