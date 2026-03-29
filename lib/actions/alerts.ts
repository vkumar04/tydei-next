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

  return { alerts, total }
}

// ─── Single Alert ────────────────────────────────────────────────

export async function getAlert(id: string) {
  await requireFacility()

  return prisma.alert.findUniqueOrThrow({
    where: { id },
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

  return prisma.alert.count({ where })
}

// ─── Mark Read ───────────────────────────────────────────────────

export async function markAlertRead(id: string) {
  await requireFacility()
  await prisma.alert.update({
    where: { id },
    data: { status: "read", readAt: new Date() },
  })
}

// ─── Resolve ─────────────────────────────────────────────────────

export async function resolveAlert(id: string) {
  await requireFacility()
  await prisma.alert.update({
    where: { id },
    data: { status: "resolved", resolvedAt: new Date() },
  })
}

// ─── Dismiss ─────────────────────────────────────────────────────

export async function dismissAlert(id: string) {
  await requireFacility()
  await prisma.alert.update({
    where: { id },
    data: { status: "dismissed", dismissedAt: new Date() },
  })
}

// ─── Bulk Resolve ────────────────────────────────────────────────

export async function bulkResolveAlerts(ids: string[]) {
  await requireFacility()
  const result = await prisma.alert.updateMany({
    where: { id: { in: ids } },
    data: { status: "resolved", resolvedAt: new Date() },
  })
  return { resolved: result.count }
}

// ─── Bulk Dismiss ────────────────────────────────────────────────

export async function bulkDismissAlerts(ids: string[]) {
  await requireFacility()
  const result = await prisma.alert.updateMany({
    where: { id: { in: ids } },
    data: { status: "dismissed", dismissedAt: new Date() },
  })
  return { dismissed: result.count }
}

// ─── Generate Alerts ─────────────────────────────────────────────

export async function generateAlerts(facilityId: string) {
  await requireFacility()

  const [expiring, tier, offContract, rebate] = await Promise.all([
    generateExpiringContractAlerts(facilityId),
    generateTierThresholdAlerts(facilityId),
    generateOffContractAlerts(facilityId),
    generateRebateDueAlerts(facilityId),
  ])

  const allAlerts = [...expiring, ...tier, ...offContract, ...rebate]

  if (allAlerts.length > 0) {
    await prisma.alert.createMany({
      data: allAlerts.map((a) => ({
        ...a,
        metadata: (a.metadata ?? {}) as Record<string, string | number | boolean>,
      })),
    })
  }

  return { created: allAlerts.length }
}
