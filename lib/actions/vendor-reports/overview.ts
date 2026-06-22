"use server"

/**
 * Vendor Reports hub — Overview tab data action.
 *
 * Vendor-scoped mirror of `getReportsOverview`
 * (`lib/actions/reports/overview.ts`). Returns the BYTE-IDENTICAL
 * `ReportsOverviewPayload` shape (`{ lifecycle, monthlyTrend, stats }`)
 * so the shared presentational Overview tab renders unchanged — only the
 * scoping differs:
 *
 *   - Contracts: `contractsOwnedByVendor(vendor.id)` (primary vendor OR
 *     grouped participant) instead of `contractsOwnedByFacility`.
 *   - COG spend: the vendor's own COG rows (`vendorId: vendor.id`) instead
 *     of `facilityId`.
 *   - Rebates: rows whose `contract` is owned by the vendor (nested
 *     `contract: contractsOwnedByVendor(vendor.id)` filter) instead of
 *     `facilityId`.
 *
 * Thin vendor wrapper: gate (`requireVendor`) → build the vendor-scoped
 * Prisma `where` clauses → fetch → delegate ALL math to the same shared
 * pure core `buildReportOverview` (`lib/reports/overview-core.ts`). The
 * "Total Rebates" stat routes through the canonical
 * `sumEarnedRebatesLifetime` helper inside the core.
 */
import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import {
  contractsOwnedByVendor,
  scopeContractWhereToFacility,
} from "@/lib/actions/contracts-vendor-auth"
import { serialize } from "@/lib/serialize"
import { buildReportOverview } from "@/lib/reports/overview-core"
import type { ReportsOverviewPayload } from "@/lib/actions/reports/overview"

/**
 * Return the composed Overview payload for the caller's active vendor.
 *
 * `dateFrom` / `dateTo` are optional — when supplied, they bound the
 * spend + rebate window used for the trend chart and the rebates stat.
 * `dateTo` is the reference date for the lifecycle bucketing and for
 * the trend window's "end month". When omitted, both fall back to "now".
 * `facilityId` (optional) narrows every scope to a single facility the
 * vendor serves — the Reports Hub facility selector. Omitted / "all"
 * keeps the all-facilities view.
 */
export async function getVendorReportsOverview(input?: {
  dateFrom?: Date
  dateTo?: Date
  facilityId?: string
}): Promise<ReportsOverviewPayload> {
  const { vendor } = await requireVendor()
  const referenceDate = input?.dateTo ?? new Date()
  const contractScope = scopeContractWhereToFacility(
    contractsOwnedByVendor(vendor.id),
    input?.facilityId,
  )

  // ─── Contracts (lifecycle + stats) ────────────────────────────
  const contractRows = await prisma.contract.findMany({
    where: contractScope,
    select: {
      status: true,
      expirationDate: true,
      totalValue: true,
    },
  })

  // ─── COG spend (monthly trend) — the vendor's own COG rows ─────
  const cogWhere: {
    vendorId: string
    facilityId?: string
    transactionDate?: { gte?: Date; lte?: Date }
  } = { vendorId: vendor.id }
  if (input?.facilityId && input.facilityId !== "all")
    cogWhere.facilityId = input.facilityId
  if (input?.dateFrom || input?.dateTo) {
    cogWhere.transactionDate = {}
    if (input?.dateFrom) cogWhere.transactionDate.gte = input.dateFrom
    if (input?.dateTo) cogWhere.transactionDate.lte = input.dateTo
  }

  const cogRows = await prisma.cOGRecord.findMany({
    where: cogWhere,
    select: { transactionDate: true, extendedPrice: true },
  })

  // ─── Rebates (monthly trend + stat) — rows on vendor's contracts ─
  const rebateWhere: {
    contract: ReturnType<typeof contractsOwnedByVendor>
    payPeriodEnd?: { gte?: Date; lte?: Date }
  } = { contract: contractScope }
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
