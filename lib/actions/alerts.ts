"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { alertFiltersSchema, type AlertFilters } from "@/lib/validators/alerts"
import type { Prisma } from "@prisma/client"
import {
  generateExpiringContractAlerts,
  generateTierThresholdAlerts,
  generateOffContractAlerts,
  generateRebateDueAlerts,
} from "@/lib/alerts/generate-alerts"
import { sendAlertNotification } from "@/lib/actions/notifications"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"

// ─── List Alerts ─────────────────────────────────────────────────

export async function getAlerts(input: AlertFilters) {
  const { facility } = await requireFacility()
  const filters = alertFiltersSchema.parse(input)

  const conditions: Prisma.AlertWhereInput[] = [
    { facilityId: facility.id },
    { portalType: filters.portalType },
  ]

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

  const [alerts, total] = await Promise.all([
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
  ])

  return serialize({ alerts, total })
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
  facilityId?: string
  vendorId?: string
  portalType: "facility" | "vendor"
}) {
  const where: Prisma.AlertWhereInput = {
    portalType: input.portalType,
    status: "new_alert",
  }
  if (input.facilityId) where.facilityId = input.facilityId
  if (input.vendorId) where.vendorId = input.vendorId

  const count = await prisma.alert.count({ where })
  return count
}

// ─── Mark Read ───────────────────────────────────────────────────

export async function markAlertRead(id: string) {
  const { facility } = await requireFacility()
  await prisma.alert.update({
    where: { id, facilityId: facility.id },
    data: { status: "read", readAt: new Date() },
  })
}

// ─── Resolve ─────────────────────────────────────────────────────

export async function resolveAlert(id: string) {
  const session = await requireFacility()
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
  const result = await prisma.alert.updateMany({
    where: { id: { in: ids }, facilityId: facility.id },
    data: { status: "resolved", resolvedAt: new Date() },
  })
  return { resolved: result.count }
}

// ─── Bulk Dismiss ────────────────────────────────────────────────

export async function bulkDismissAlerts(ids: string[]) {
  const { facility } = await requireFacility()
  const result = await prisma.alert.updateMany({
    where: { id: { in: ids }, facilityId: facility.id },
    data: { status: "dismissed", dismissedAt: new Date() },
  })
  return { dismissed: result.count }
}

// ─── Generate Alerts ─────────────────────────────────────────────

export async function generateAlerts(_facilityId?: string) {
  const { facility } = await requireFacility()

  const [expiring, tier, offContract, rebate] = await Promise.all([
    generateExpiringContractAlerts(facility.id),
    generateTierThresholdAlerts(facility.id),
    generateOffContractAlerts(facility.id),
    generateRebateDueAlerts(facility.id),
  ])

  const allAlerts = [...expiring, ...tier, ...offContract, ...rebate]

  if (allAlerts.length > 0) {
    // createMany doesn't return IDs in Prisma, so we create individually to get IDs for notifications
    const created = await prisma.$transaction(
      allAlerts.map((a) =>
        prisma.alert.create({
          data: {
            ...a,
            metadata: (a.metadata ?? {}) as Record<string, string | number | boolean>,
          },
          select: { id: true },
        })
      )
    )

    // Send email notifications in the background (fire-and-forget)
    Promise.allSettled(
      created.map((alert) => sendAlertNotification(alert.id))
    ).catch(() => {
      // Swallow errors — email delivery is best-effort
    })
  }

  return { created: allAlerts.length }
}
