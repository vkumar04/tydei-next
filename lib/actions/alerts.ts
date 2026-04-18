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
import {
  synthesizeAlertsForFacility,
  type SynthCogRecord,
  type SynthContract,
  type SynthContractPeriod,
  type SynthExistingAlert,
  type SynthTier,
} from "@/lib/alerts/synthesizer"
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
  // Caller passes IDs from an already-authenticated session (layout.tsx),
  // but guard against tampering by requiring at least one scope filter.
  if (!input.facilityId && !input.vendorId) return 0

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

// ─── Synthesize + Persist (subsystem-4 pipeline) ─────────────────

/**
 * Synthesize fresh alerts from live contract + COG + accrual state,
 * persist new alerts, and resolve any alerts whose underlying
 * condition has cleared.
 */
export async function synthesizeAndPersistAlerts(): Promise<{
  created: number
  resolved: number
}> {
  const session = await requireFacility()
  const facilityId = session.facility.id

  // Load the minimal columns each input shape needs.
  const [cogRows, contractRows, periodRows, existingRows] = await Promise.all([
    prisma.cOGRecord.findMany({
      where: { facilityId },
      select: {
        id: true,
        poNumber: true,
        vendorId: true,
        vendorName: true,
        inventoryNumber: true,
        inventoryDescription: true,
        unitCost: true,
        quantity: true,
        extendedPrice: true,
        contractPrice: true,
        matchStatus: true,
        transactionDate: true,
      },
    }),
    prisma.contract.findMany({
      where: { facilityId },
      select: {
        id: true,
        name: true,
        status: true,
        expirationDate: true,
        annualValue: true,
        vendorId: true,
        vendor: { select: { name: true } },
        terms: {
          select: {
            tiers: {
              select: {
                tierNumber: true,
                spendMin: true,
                spendMax: true,
                rebateValue: true,
              },
            },
          },
        },
        periods: {
          orderBy: { periodEnd: "desc" },
          take: 1,
          select: { totalSpend: true },
        },
      },
    }),
    prisma.contractPeriod.findMany({
      where: { facilityId },
      select: {
        id: true,
        contractId: true,
        periodStart: true,
        periodEnd: true,
        rebateEarned: true,
        rebateCollected: true,
        contract: {
          select: {
            name: true,
            vendorId: true,
            vendor: { select: { name: true } },
          },
        },
      },
    }),
    prisma.alert.findMany({
      where: {
        facilityId,
        status: { in: ["new_alert", "read"] },
      },
      select: {
        id: true,
        alertType: true,
        contractId: true,
        vendorId: true,
        metadata: true,
        status: true,
      },
    }),
  ])

  const cogRecords: SynthCogRecord[] = cogRows.map((r) => ({
    id: r.id,
    poNumber: r.poNumber,
    vendorId: r.vendorId,
    vendorName: r.vendorName,
    inventoryNumber: r.inventoryNumber,
    inventoryDescription: r.inventoryDescription,
    unitCost: Number(r.unitCost),
    quantity: r.quantity,
    extendedPrice: r.extendedPrice === null ? null : Number(r.extendedPrice),
    contractPrice: r.contractPrice === null ? null : Number(r.contractPrice),
    matchStatus: r.matchStatus,
    transactionDate: r.transactionDate,
  }))

  const contracts: SynthContract[] = contractRows.map((c) => {
    const tiers: SynthTier[] = c.terms.flatMap((t) =>
      t.tiers.map((tier) => ({
        tierNumber: tier.tierNumber,
        spendMin: Number(tier.spendMin),
        spendMax: tier.spendMax === null ? null : Number(tier.spendMax),
        rebateValue: Number(tier.rebateValue),
      })),
    )
    const currentSpend =
      c.periods.length > 0 ? Number(c.periods[0].totalSpend) : 0
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      expirationDate: c.expirationDate,
      annualValue: Number(c.annualValue),
      vendorId: c.vendorId,
      vendorName: c.vendor?.name ?? "Unknown vendor",
      currentSpend,
      tiers,
    }
  })

  const contractPeriods: SynthContractPeriod[] = periodRows.map((p) => ({
    id: p.id,
    contractId: p.contractId,
    contractName: p.contract?.name ?? "Unknown contract",
    vendorId: p.contract?.vendorId ?? "",
    vendorName: p.contract?.vendor?.name ?? "Unknown vendor",
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    rebateEarned: Number(p.rebateEarned),
    rebateCollected: Number(p.rebateCollected),
  }))

  const existingAlerts: SynthExistingAlert[] = existingRows.map((a) => ({
    id: a.id,
    alertType: a.alertType,
    contractId: a.contractId,
    vendorId: a.vendorId,
    metadata: (a.metadata ?? {}) as Record<string, unknown>,
    status: a.status,
  }))

  const result = synthesizeAlertsForFacility({
    facilityId,
    cogRecords,
    contracts,
    contractPeriods,
    paymentSchedules: [],
    existingAlerts,
  })

  const now = new Date()

  if (result.toCreate.length > 0 || result.toResolve.length > 0) {
    await prisma.$transaction([
      ...result.toCreate.map((a) =>
        prisma.alert.create({
          data: {
            portalType: a.portalType,
            alertType: a.alertType,
            title: a.title,
            description: a.description,
            severity: a.severity,
            facilityId: a.facilityId,
            contractId: a.contractId ?? null,
            vendorId: a.vendorId ?? null,
            actionLink: a.actionLink ?? null,
            metadata: a.metadata as Prisma.InputJsonValue,
          },
        }),
      ),
      ...result.toResolve.map((id) =>
        prisma.alert.update({
          where: { id },
          data: { status: "resolved", resolvedAt: now },
        }),
      ),
    ])
  }

  await logAudit({
    userId: session.user.id,
    action: "alerts.synthesized",
    entityType: "alert",
    metadata: {
      created: result.toCreate.length,
      resolved: result.toResolve.length,
    },
  })

  return {
    created: result.toCreate.length,
    resolved: result.toResolve.length,
  }
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
  const facilityId = session.facility.id

  const rows = await prisma.alert.findMany({
    where: { facilityId, status: "new_alert" },
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
