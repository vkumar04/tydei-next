"use server"

import { prisma } from "@/lib/db"
import { sendEmail } from "@/lib/email"
import {
  alertNotificationEmail,
  renewalReminderEmail,
  weeklyDigestEmail,
  pendingContractSubmittedEmail,
  pendingContractDecisionEmail,
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
 * Charles 2026-04-25: peer of `getFacilityMemberEmails` returning
 * userIds for the in-app Notification fanout. Same query shape;
 * different projection.
 */
async function getFacilityMemberUserIds(facilityId: string): Promise<string[]> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: {
      organization: {
        select: {
          members: {
            select: { user: { select: { id: true } } },
          },
        },
      },
    },
  })
  return facility?.organization?.members.map((m) => m.user.id) ?? []
}

async function getVendorMemberUserIds(vendorId: string): Promise<string[]> {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: {
      organization: {
        select: {
          members: {
            select: { user: { select: { id: true } } },
          },
        },
      },
    },
  })
  return vendor?.organization?.members.map((m) => m.user.id) ?? []
}

/**
 * Charles 2026-04-25 (vendor-mirror Phase 1): same as
 * `getFacilityMemberEmails` but for vendor orgs. Used to notify the
 * vendor when their pending submission is approved / rejected /
 * revision-requested.
 */
async function getVendorMemberEmails(vendorId: string): Promise<string[]> {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
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
  return vendor?.organization?.members.map((m) => m.user.email) ?? []
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

// ─── Pending-contract notifications (vendor-mirror Phase 1) ─────

/**
 * Send a notification to every member of the facility's org when a
 * vendor submits a pending contract for review. Best-effort — failures
 * log but never block the submission. Charles 2026-04-25.
 */
export async function notifyFacilityOfPendingContract(input: {
  facilityId: string
  contractName: string
  vendorName: string
  facilityName?: string | null
  pendingId: string
}): Promise<{ sent: number }> {
  try {
    // In-app: write a Notification row per facility-org member so
    // the top-bar bell surfaces it even if email is misconfigured.
    // Charles 2026-04-25 (audit follow-up).
    const userIds = await getFacilityMemberUserIds(input.facilityId)
    if (userIds.length > 0) {
      const { createInAppNotifications } = await import(
        "@/lib/actions/notifications/in-app"
      )
      void createInAppNotifications({
        userIds,
        type: "pending_contract_submitted",
        title: `${input.vendorName} submitted a contract`,
        body: input.contractName,
        payload: { pendingId: input.pendingId, vendorName: input.vendorName },
        actionUrl: `/dashboard/contracts`,
      })
    }
    const emails = await getFacilityMemberEmails(input.facilityId)
    if (emails.length === 0) return { sent: 0 }
    const { subject, html } = pendingContractSubmittedEmail({
      contractName: input.contractName,
      vendorName: input.vendorName,
      facilityName: input.facilityName,
      pendingId: input.pendingId,
    })
    await Promise.allSettled(
      emails.map((to) => sendEmail({ to, subject, html })),
    )
    return { sent: emails.length }
  } catch (err) {
    console.warn("[notifyFacilityOfPendingContract] failed", err)
    return { sent: 0 }
  }
}

/**
 * Send a notification to every member of the vendor's org when the
 * facility approves / rejects / requests revisions on a pending
 * contract. Best-effort. Charles 2026-04-25.
 */
export async function notifyVendorOfPendingDecision(input: {
  vendorId: string
  contractName: string
  vendorName: string
  facilityName?: string | null
  pendingId: string
  decision: "approved" | "rejected" | "revision_requested"
  reviewNotes?: string | null
}): Promise<{ sent: number }> {
  try {
    const userIds = await getVendorMemberUserIds(input.vendorId)
    if (userIds.length > 0) {
      const { createInAppNotifications } = await import(
        "@/lib/actions/notifications/in-app"
      )
      const decisionLabel =
        input.decision === "approved"
          ? "approved"
          : input.decision === "rejected"
            ? "rejected"
            : "needs revision"
      void createInAppNotifications({
        userIds,
        type: `pending_contract_${input.decision}`,
        title: `Submission ${decisionLabel}: ${input.contractName}`,
        body: input.reviewNotes ?? null,
        payload: {
          pendingId: input.pendingId,
          decision: input.decision,
          facilityName: input.facilityName,
        },
        actionUrl: `/vendor/contracts/pending/${input.pendingId}/edit`,
      })
    }
    const emails = await getVendorMemberEmails(input.vendorId)
    if (emails.length === 0) return { sent: 0 }
    const { subject, html } = pendingContractDecisionEmail({
      contractName: input.contractName,
      vendorName: input.vendorName,
      facilityName: input.facilityName,
      pendingId: input.pendingId,
      decision: input.decision,
      reviewNotes: input.reviewNotes,
    })
    await Promise.allSettled(
      emails.map((to) => sendEmail({ to, subject, html })),
    )
    return { sent: emails.length }
  } catch (err) {
    console.warn("[notifyVendorOfPendingDecision] failed", err)
    return { sent: 0 }
  }
}
