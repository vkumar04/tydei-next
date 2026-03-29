"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import type { AlertFilters } from "@/lib/validators/alerts"
import type { Prisma } from "@prisma/client"

// ─── Vendor Alerts ──────────────────────────────────────────────

export async function getVendorAlerts(input: Omit<AlertFilters, "facilityId" | "portalType"> & { vendorId: string }) {
  await requireVendor()
  const { vendorId, alertType, severity, status, page = 1, pageSize = 20 } = input

  const conditions: Prisma.AlertWhereInput[] = [
    { vendorId },
    { portalType: "vendor" },
  ]

  if (alertType) conditions.push({ alertType })
  if (severity) conditions.push({ severity })
  if (status) {
    conditions.push({ status })
  } else {
    conditions.push({ status: { in: ["new_alert", "read"] } })
  }

  const where: Prisma.AlertWhereInput = { AND: conditions }

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

// ─── Vendor Alert Actions ───────────────────────────────────────

export async function resolveVendorAlert(id: string) {
  await requireVendor()
  await prisma.alert.update({
    where: { id },
    data: { status: "resolved", resolvedAt: new Date() },
  })
}

export async function dismissVendorAlert(id: string) {
  await requireVendor()
  await prisma.alert.update({
    where: { id },
    data: { status: "dismissed", dismissedAt: new Date() },
  })
}

export async function bulkResolveVendorAlerts(ids: string[]) {
  await requireVendor()
  const result = await prisma.alert.updateMany({
    where: { id: { in: ids } },
    data: { status: "resolved", resolvedAt: new Date() },
  })
  return { resolved: result.count }
}

export async function bulkDismissVendorAlerts(ids: string[]) {
  await requireVendor()
  const result = await prisma.alert.updateMany({
    where: { id: { in: ids } },
    data: { status: "dismissed", dismissedAt: new Date() },
  })
  return { dismissed: result.count }
}
