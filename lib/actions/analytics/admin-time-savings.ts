"use server"

/**
 * Charles audit suggestion (v0-port): Admin Time Savings calculator.
 * Builds a facility-wide hours-saved-per-month estimate from the live
 * counts (active contracts, active vendors, monthly invoice batches,
 * monthly reports, renewals/year). Mirrors v0 doc §11.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import { withTelemetry } from "@/lib/actions/analytics/_telemetry"

interface TaskEstimate {
  manual: number // hours
  automated: number // hours
  description: string
}

/** Per-task baseline; numbers come from v0 doc §11. */
const TASKS: Record<string, TaskEstimate> = {
  contractEntry: {
    manual: 2.0,
    automated: 0.25,
    description: "Creating + entering contract terms",
  },
  rebateCalculation: {
    manual: 4.0,
    automated: 0.5,
    description: "Calculating rebates + tier status",
  },
  complianceReview: {
    manual: 8.0,
    automated: 1.0,
    description: "Reviewing purchases for compliance",
  },
  reportGeneration: {
    manual: 3.0,
    automated: 0.5,
    description: "Generating performance reports",
  },
  vendorFollowUp: {
    manual: 1.5,
    automated: 0.25,
    description: "Following up with vendors",
  },
  priceVerification: {
    manual: 2.0,
    automated: 0.25,
    description: "Verifying invoice prices",
  },
  contractRenewal: {
    manual: 4.0,
    automated: 1.5,
    description: "Processing renewals",
  },
}

export interface AdminTimeSavings {
  totalManualHours: number
  totalAutomatedHours: number
  hoursSavedPerMonth: number
  savingsPercent: number
  breakdown: Array<{
    task: string
    description: string
    manualHours: number
    automatedHours: number
    savedHours: number
  }>
}

export async function getAdminTimeSavings(): Promise<AdminTimeSavings> {
  return withTelemetry("getAdminTimeSavings", {}, () =>
    _getAdminTimeSavingsImpl(),
  )
}

async function _getAdminTimeSavingsImpl(): Promise<AdminTimeSavings> {
  const { facility } = await requireFacility()

  const ownership = contractsOwnedByFacility(facility.id)
  const today = new Date()
  const oneYearAgo = new Date(today)
  oneYearAgo.setMonth(oneYearAgo.getMonth() - 12)

  const [contractsCount, activeVendorIds, invoicesLast30, reportsLast30, renewalsThisYear] =
    await Promise.all([
      prisma.contract.count({ where: { ...ownership, status: "active" } }),
      prisma.cOGRecord.groupBy({
        by: ["vendorId"],
        where: { facilityId: facility.id, transactionDate: { gte: oneYearAgo } },
      }),
      prisma.invoice.count({
        where: {
          facilityId: facility.id,
          invoiceDate: {
            gte: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      // No on-demand Report model in this schema; proxy via active
      // ReportSchedule rows so the time-savings estimate at least
      // reflects how many recurring reports the facility is running.
      prisma.reportSchedule.count({
        where: { facilityId: facility.id, isActive: true },
      }),
      prisma.contract.count({
        where: {
          ...ownership,
          expirationDate: {
            gte: oneYearAgo,
            lte: new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ])
  const activeVendors = activeVendorIds.length

  // Convert to monthly amounts.
  const monthly: Record<string, { manual: number; automated: number }> = {
    contractEntry: {
      manual: (contractsCount / 12) * TASKS.contractEntry.manual,
      automated: (contractsCount / 12) * TASKS.contractEntry.automated,
    },
    rebateCalculation: {
      manual: TASKS.rebateCalculation.manual,
      automated: TASKS.rebateCalculation.automated,
    },
    complianceReview: {
      manual: TASKS.complianceReview.manual,
      automated: TASKS.complianceReview.automated,
    },
    reportGeneration: {
      manual: reportsLast30 * TASKS.reportGeneration.manual,
      automated: reportsLast30 * TASKS.reportGeneration.automated,
    },
    vendorFollowUp: {
      manual: activeVendors * TASKS.vendorFollowUp.manual,
      automated: activeVendors * TASKS.vendorFollowUp.automated,
    },
    priceVerification: {
      manual: invoicesLast30 * TASKS.priceVerification.manual,
      automated: invoicesLast30 * TASKS.priceVerification.automated,
    },
    contractRenewal: {
      manual: (renewalsThisYear / 12) * TASKS.contractRenewal.manual,
      automated: (renewalsThisYear / 12) * TASKS.contractRenewal.automated,
    },
  }

  const totalManualHours = Object.values(monthly).reduce(
    (acc, t) => acc + t.manual,
    0,
  )
  const totalAutomatedHours = Object.values(monthly).reduce(
    (acc, t) => acc + t.automated,
    0,
  )
  const hoursSavedPerMonth = totalManualHours - totalAutomatedHours
  const savingsPercent =
    totalManualHours > 0
      ? (hoursSavedPerMonth / totalManualHours) * 100
      : 0

  const breakdown = Object.entries(monthly).map(([task, m]) => ({
    task,
    description: TASKS[task].description,
    manualHours: Math.round(m.manual * 10) / 10,
    automatedHours: Math.round(m.automated * 10) / 10,
    savedHours: Math.round((m.manual - m.automated) * 10) / 10,
  }))

  return serialize({
    totalManualHours: Math.round(totalManualHours * 10) / 10,
    totalAutomatedHours: Math.round(totalAutomatedHours * 10) / 10,
    hoursSavedPerMonth: Math.round(hoursSavedPerMonth * 10) / 10,
    savingsPercent: Math.round(savingsPercent * 10) / 10,
    breakdown,
  })
}
