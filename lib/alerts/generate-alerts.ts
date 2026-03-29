import { prisma } from "@/lib/db"
import type { AlertType, AlertSeverity } from "@prisma/client"

interface NewAlert {
  portalType: string
  alertType: AlertType
  title: string
  description: string
  severity: AlertSeverity
  contractId?: string
  facilityId: string
  vendorId?: string
  actionLink?: string
  metadata?: Record<string, unknown>
}

// ─── Expiring Contract Alerts ─────────────────────────────────────

export async function generateExpiringContractAlerts(facilityId: string): Promise<NewAlert[]> {
  const now = new Date()
  const alerts: NewAlert[] = []

  const windows = [
    { days: 30, severity: "high" as AlertSeverity },
    { days: 60, severity: "medium" as AlertSeverity },
    { days: 90, severity: "low" as AlertSeverity },
  ]

  for (const { days, severity } of windows) {
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

    const contracts = await prisma.contract.findMany({
      where: {
        facilityId,
        status: "active",
        expirationDate: { lte: cutoff, gte: now },
      },
      include: { vendor: { select: { id: true, name: true } } },
    })

    for (const contract of contracts) {
      const existing = await prisma.alert.findFirst({
        where: {
          facilityId,
          contractId: contract.id,
          alertType: "expiring_contract",
          severity,
          status: { in: ["new_alert", "read"] },
        },
      })

      if (!existing) {
        alerts.push({
          portalType: "facility",
          alertType: "expiring_contract",
          title: `Contract "${contract.name}" expiring within ${days} days`,
          description: `Contract with ${contract.vendor.name} expires on ${contract.expirationDate.toISOString().split("T")[0]}.`,
          severity,
          contractId: contract.id,
          facilityId,
          vendorId: contract.vendor.id,
          actionLink: `/dashboard/contracts/${contract.id}`,
          metadata: { daysUntilExpiry: days },
        })
      }
    }
  }

  return alerts
}

// ─── Tier Threshold Alerts ────────────────────────────────────────

export async function generateTierThresholdAlerts(facilityId: string): Promise<NewAlert[]> {
  const alerts: NewAlert[] = []

  const contracts = await prisma.contract.findMany({
    where: { facilityId, status: "active" },
    include: {
      vendor: { select: { id: true, name: true } },
      terms: { include: { tiers: { orderBy: { tierNumber: "asc" } } } },
      periods: { orderBy: { periodEnd: "desc" }, take: 1 },
    },
  })

  for (const contract of contracts) {
    const currentSpend = contract.periods[0]
      ? Number(contract.periods[0].totalSpend)
      : 0

    for (const term of contract.terms) {
      for (const tier of term.tiers) {
        const threshold = Number(tier.spendMin)
        if (threshold <= 0 || currentSpend >= threshold) continue

        const gap = threshold - currentSpend
        const pctOfThreshold = gap / threshold

        if (pctOfThreshold <= 0.1) {
          const existing = await prisma.alert.findFirst({
            where: {
              facilityId,
              contractId: contract.id,
              alertType: "tier_threshold",
              status: { in: ["new_alert", "read"] },
              metadata: { path: ["tierNumber"], equals: tier.tierNumber },
            },
          })

          if (!existing) {
            alerts.push({
              portalType: "facility",
              alertType: "tier_threshold",
              title: `Within 10% of Tier ${tier.tierNumber} on "${contract.name}"`,
              description: `$${gap.toLocaleString()} more spend needed to reach Tier ${tier.tierNumber} with ${contract.vendor.name}.`,
              severity: "medium",
              contractId: contract.id,
              facilityId,
              vendorId: contract.vendor.id,
              actionLink: `/dashboard/contracts/${contract.id}`,
              metadata: { tierNumber: tier.tierNumber, gap, threshold, currentSpend },
            })
          }
        }
      }
    }
  }

  return alerts
}

// ─── Off-Contract Alerts ──────────────────────────────────────────

export async function generateOffContractAlerts(facilityId: string): Promise<NewAlert[]> {
  const alerts: NewAlert[] = []
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const offContractPOs = await prisma.purchaseOrder.findMany({
    where: {
      facilityId,
      isOffContract: true,
      orderDate: { gte: thirtyDaysAgo },
    },
    include: { vendor: { select: { id: true, name: true } } },
  })

  // Group by vendor
  const byVendor = new Map<string, { vendor: { id: string; name: string }; count: number; total: number }>()
  for (const po of offContractPOs) {
    const key = po.vendorId
    const existing = byVendor.get(key)
    const cost = po.totalCost ? Number(po.totalCost) : 0
    if (existing) {
      existing.count += 1
      existing.total += cost
    } else {
      byVendor.set(key, { vendor: po.vendor, count: 1, total: cost })
    }
  }

  for (const [vendorId, data] of byVendor) {
    const existing = await prisma.alert.findFirst({
      where: {
        facilityId,
        vendorId,
        alertType: "off_contract",
        status: { in: ["new_alert", "read"] },
        createdAt: { gte: thirtyDaysAgo },
      },
    })

    if (!existing) {
      alerts.push({
        portalType: "facility",
        alertType: "off_contract",
        title: `${data.count} off-contract purchase${data.count > 1 ? "s" : ""} from ${data.vendor.name}`,
        description: `$${data.total.toLocaleString()} in off-contract spend detected in the last 30 days.`,
        severity: data.total > 50000 ? "high" : data.total > 10000 ? "medium" : "low",
        facilityId,
        vendorId,
        actionLink: `/dashboard/purchase-orders`,
        metadata: { poCount: data.count, totalSpend: data.total },
      })
    }
  }

  return alerts
}

// ─── Rebate Due Alerts ────────────────────────────────────────────

export async function generateRebateDueAlerts(facilityId: string): Promise<NewAlert[]> {
  const alerts: NewAlert[] = []
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  const periods = await prisma.contractPeriod.findMany({
    where: {
      facilityId,
      periodEnd: { lte: thirtyDaysFromNow },
      rebateEarned: { gt: 0 },
      rebateCollected: { equals: 0 },
    },
    include: {
      contract: {
        include: { vendor: { select: { id: true, name: true } } },
      },
    },
  })

  for (const period of periods) {
    const existing = await prisma.alert.findFirst({
      where: {
        facilityId,
        contractId: period.contractId,
        alertType: "rebate_due",
        status: { in: ["new_alert", "read"] },
        metadata: { path: ["periodId"], equals: period.id },
      },
    })

    if (!existing) {
      alerts.push({
        portalType: "facility",
        alertType: "rebate_due",
        title: `Rebate due for "${period.contract.name}"`,
        description: `$${Number(period.rebateEarned).toLocaleString()} in earned rebates pending collection from ${period.contract.vendor.name}.`,
        severity: "medium",
        contractId: period.contractId,
        facilityId,
        vendorId: period.contract.vendorId,
        actionLink: `/dashboard/contracts/${period.contractId}`,
        metadata: { periodId: period.id, rebateAmount: Number(period.rebateEarned) },
      })
    }
  }

  return alerts
}
