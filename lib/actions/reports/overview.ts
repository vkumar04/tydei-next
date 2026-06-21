"use server"

/**
 * Reports hub — Overview tab data action.
 *
 * Assembles the payload for the /dashboard/reports "Overview" tab:
 *   - Contract lifecycle distribution (active / expiring / expired / other)
 *   - 12-month spend + rebate trend
 *   - Top-line stats (total contracts, total value, total rebates)
 *
 * Thin facility wrapper: gate (`requireFacility`) → build the
 * facility-scoped Prisma `where` clauses → fetch → delegate ALL math to the
 * shared pure core `buildReportOverview` (`lib/reports/overview-core.ts`),
 * which the vendor mirror also uses so the two surfaces can never drift.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import { buildReportOverview } from "@/lib/reports/overview-core"

export type { ReportsOverviewPayload } from "@/lib/reports/overview-core"

/**
 * Return the composed Overview payload for the caller's active facility.
 *
 * `dateFrom` / `dateTo` are optional — when supplied, they bound the
 * spend + rebate window used for the trend chart and the rebates stat.
 * `dateTo` is the reference date for the lifecycle bucketing and for
 * the trend window's "end month". When omitted, both fall back to "now".
 */
export async function getReportsOverview(input?: {
  dateFrom?: Date
  dateTo?: Date
}) {
  const { facility } = await requireFacility()
  const referenceDate = input?.dateTo ?? new Date()

  // ─── Contracts (lifecycle + stats) ────────────────────────────
  const contractRows = await prisma.contract.findMany({
    where: contractsOwnedByFacility(facility.id),
    select: {
      status: true,
      expirationDate: true,
      totalValue: true,
    },
  })

  // ─── COG spend (monthly trend) ────────────────────────────────
  const cogWhere: {
    facilityId: string
    transactionDate?: { gte?: Date; lte?: Date }
  } = { facilityId: facility.id }
  if (input?.dateFrom || input?.dateTo) {
    cogWhere.transactionDate = {}
    if (input?.dateFrom) cogWhere.transactionDate.gte = input.dateFrom
    if (input?.dateTo) cogWhere.transactionDate.lte = input.dateTo
  }

  const cogRows = await prisma.cOGRecord.findMany({
    where: cogWhere,
    select: { transactionDate: true, extendedPrice: true },
  })

  // ─── Rebates (monthly trend + stat) ───────────────────────────
  const rebateWhere: {
    facilityId: string
    payPeriodEnd?: { gte?: Date; lte?: Date }
  } = { facilityId: facility.id }
  if (input?.dateFrom || input?.dateTo) {
    rebateWhere.payPeriodEnd = {}
    if (input?.dateFrom) rebateWhere.payPeriodEnd.gte = input.dateFrom
    if (input?.dateTo) rebateWhere.payPeriodEnd.lte = input.dateTo
  }

  const rebateRows = await prisma.rebate.findMany({
    where: rebateWhere,
    select: { payPeriodEnd: true, rebateEarned: true },
  })

  return serialize(
    buildReportOverview({ contractRows, cogRows, rebateRows, referenceDate }),
  )
}
