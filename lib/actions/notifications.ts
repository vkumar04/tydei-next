"use server"

import { prisma } from "@/lib/db"
import { sendEmail } from "@/lib/email"
import {
  alertNotificationEmail,
  renewalReminderEmail,
  weeklyDigestEmail,
} from "@/lib/email-templates"
import { getNotificationPreferences } from "@/lib/actions/settings"

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Returns an array of email addresses for all members of the organization
 * linked to a given facility.
 */
async function getFacilityMemberEmails(facilityId: string): Promise<string[]> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: {
      organization: {
        select: {
          members: {
            select: { user: { select: { email: true } } },
          },
        },
      },
    },
  })

  return (
    facility?.organization?.members.map((m) => m.user.email) ?? []
  )
}

/**
 * Check whether email notifications are enabled for a given entity.
 * Maps alert types to preference keys.
 */
const ALERT_TYPE_TO_PREF: Record<string, string> = {
  off_contract: "offContract",
  expiring_contract: "expiringContracts",
  tier_threshold: "tierThresholds",
  rebate_due: "rebateDue",
  payment_due: "paymentDue",
  pricing_error: "pricingErrors",
  compliance: "compliance",
}

async function shouldSendEmail(
  entityId: string,
  alertType?: string
): Promise<boolean> {
  try {
    const prefs = await getNotificationPreferences(entityId)
    if (!prefs.emailEnabled) return false
    if (alertType) {
      const prefKey = ALERT_TYPE_TO_PREF[alertType]
      if (prefKey && prefKey in prefs) {
        return (prefs as Record<string, boolean>)[prefKey] !== false
      }
    }
    return true
  } catch {
    // If preferences can't be loaded (e.g. no auth context), default to sending
    return true
  }
}

// ─── Send Alert Notification ────────────────────────────────────

export async function sendAlertNotification(alertId: string): Promise<void> {
  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    include: {
      contract: { select: { name: true } },
      vendor: { select: { name: true } },
    },
  })

  if (!alert || !alert.facilityId) return

  const emailEnabled = await shouldSendEmail(
    alert.facilityId,
    alert.alertType
  )
  if (!emailEnabled) return

  const emails = await getFacilityMemberEmails(alert.facilityId)
  if (emails.length === 0) return

  const { subject, html } = alertNotificationEmail({
    title: alert.title,
    description: alert.description,
    severity: alert.severity,
    alertType: alert.alertType,
    actionLink: alert.actionLink,
    contractName: alert.contract?.name,
    vendorName: alert.vendor?.name,
  })

  await Promise.allSettled(
    emails.map((to) => sendEmail({ to, subject, html }))
  )
}

// ─── Send Renewal Reminders ─────────────────────────────────────

export async function sendRenewalReminders(): Promise<{
  sent: number
}> {
  const now = new Date()
  let sent = 0

  const windows = [
    { days: 30 },
    { days: 60 },
    { days: 90 },
  ]

  for (const { days } of windows) {
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    // Find contracts that expire within this window but after now
    const contracts = await prisma.contract.findMany({
      where: {
        status: "active",
        expirationDate: { lte: cutoff, gte: now },
        facilityId: { not: null },
      },
      include: {
        vendor: { select: { name: true } },
        facility: { select: { id: true, name: true } },
      },
    })

    for (const contract of contracts) {
      if (!contract.facilityId || !contract.facility) continue

      const emailEnabled = await shouldSendEmail(
        contract.facilityId,
        "expiring_contract"
      )
      if (!emailEnabled) continue

      const emails = await getFacilityMemberEmails(contract.facilityId)
      if (emails.length === 0) continue

      const { subject, html } = renewalReminderEmail(
        {
          contractName: contract.name,
          vendorName: contract.vendor.name,
          expirationDate: contract.expirationDate
            .toISOString()
            .split("T")[0],
          contractId: contract.id,
        },
        days
      )

      await Promise.allSettled(
        emails.map((to) => sendEmail({ to, subject, html }))
      )
      sent += emails.length
    }
  }

  return { sent }
}

// ─── Send Weekly Digest ─────────────────────────────────────────

export async function sendWeeklyDigest(
  facilityId: string
): Promise<{ sent: number }> {
  const emailEnabled = await shouldSendEmail(facilityId)
  if (!emailEnabled) return { sent: 0 }

  const emails = await getFacilityMemberEmails(facilityId)
  if (emails.length === 0) return { sent: 0 }

  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: { name: true },
  })

  const now = new Date()
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const ninetyDaysFromNow = new Date(
    now.getTime() + 90 * 24 * 60 * 60 * 1000
  )

  const [
    newAlerts,
    activeContracts,
    expiringContracts,
    recentCOG,
    recentOffContract,
    recentPeriods,
  ] = await Promise.all([
    prisma.alert.count({
      where: {
        facilityId,
        status: "new_alert",
        createdAt: { gte: oneWeekAgo },
      },
    }),
    prisma.contract.count({
      where: { facilityId, status: "active" },
    }),
    prisma.contract.count({
      where: {
        facilityId,
        status: "active",
        expirationDate: { lte: ninetyDaysFromNow, gte: now },
      },
    }),
    prisma.cOGRecord.aggregate({
      where: { facilityId, transactionDate: { gte: oneWeekAgo } },
      _sum: { extendedPrice: true },
    }),
    prisma.purchaseOrder.aggregate({
      where: {
        facilityId,
        isOffContract: true,
        orderDate: { gte: oneWeekAgo },
      },
      _sum: { totalCost: true },
    }),
    prisma.contractPeriod.aggregate({
      where: { facilityId, periodEnd: { gte: oneWeekAgo } },
      _sum: { rebateEarned: true },
    }),
  ])

  const { subject, html } = weeklyDigestEmail({
    facilityName: facility?.name ?? "Your Facility",
    newAlerts,
    activeContracts,
    expiringContracts,
    totalSpend: Number(recentCOG._sum.extendedPrice ?? 0),
    rebatesEarned: Number(recentPeriods._sum.rebateEarned ?? 0),
    offContractSpend: Number(recentOffContract._sum.totalCost ?? 0),
  })

  await Promise.allSettled(
    emails.map((to) => sendEmail({ to, subject, html }))
  )

  return { sent: emails.length }
}
