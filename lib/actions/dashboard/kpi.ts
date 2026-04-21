"use server"

/**
 * Facility dashboard — unified KPI summary server action.
 *
 * Loads the contract portfolio, COG spend, and alert rows for the
 * caller's active facility and delegates math to the pure engines in
 * `lib/dashboard/*` + `lib/alerts/priority-ranker.ts`:
 *
 *   - `computeDashboardKPIs` → canonical KPI block
 *   - `projectAnnualSpend`   → annual-spend projection widget
 *   - `summarizeAlerts`      → severity / by-type aggregate
 *   - `rankAlerts`           → top-5 ranked alerts (via the same
 *                              metadata mapping as `getRankedAlerts`)
 *
 * Reference: docs/superpowers/specs/2026-04-18-facility-dashboard-rewrite.md
 */

import { prisma } from "@/lib/db"
import { ContractStatus } from "@prisma/client"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import {
  computeDashboardKPIs,
  type DashboardKPIs,
  type KPIInputContract,
} from "@/lib/dashboard/kpi-calc"
import {
  projectAnnualSpend,
  type MonthlySpendObservation,
  type SpendProjection,
} from "@/lib/dashboard/spend-projection"
import {
  summarizeAlerts,
  type AlertStatus as AlertStatusEnum,
  type AlertSeverity as AlertSeverityEnum,
  type AlertSummary,
} from "@/lib/dashboard/alert-severity"
import {
  rankAlerts,
  type AlertForRanking,
  type AlertSeverity,
  type AlertTypeValue,
  type RankedAlert,
} from "@/lib/alerts/priority-ranker"

// ─── Types ───────────────────────────────────────────────────────

export interface DashboardKPISummary extends DashboardKPIs {
  spendProjection: SpendProjection
  alertSummary: AlertSummary
  topAlerts: RankedAlert[]
}

// ─── Ranker mirror (kept in sync with lib/actions/alerts.ts) ─────

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

// ─── Pending-alerts rubric ───────────────────────────────────────
//
// Mirrors getDashboardStats' canonical rule: contracts expiring within
// 90 days OR active contracts whose commitment progress is < 80%.

function computePendingAlerts(
  contracts: Array<{
    status: string
    expirationDate: Date | null
    marketShareCommitment: number | null
    currentMarketShare: number | null
  }>,
  referenceDate: Date,
): number {
  const ninetyDaysAhead = new Date(referenceDate)
  ninetyDaysAhead.setDate(ninetyDaysAhead.getDate() + 90)

  let expiringSoon = 0
  let lowCommitment = 0

  for (const c of contracts) {
    const isLive = c.status === "active" || c.status === "expiring"
    if (!isLive) continue

    if (
      c.expirationDate !== null &&
      c.expirationDate >= referenceDate &&
      c.expirationDate <= ninetyDaysAhead
    ) {
      expiringSoon += 1
    }

    const commit = Number(c.marketShareCommitment ?? 0)
    if (commit > 0) {
      const current = Number(c.currentMarketShare ?? 0)
      const progress = (current / commit) * 100
      if (progress < 80) lowCommitment += 1
    }
  }

  return expiringSoon + lowCommitment
}

// ─── getDashboardKPISummary ──────────────────────────────────────

/**
 * Composite dashboard KPI payload — everything the facility dashboard
 * top-of-page needs in a single round-trip:
 *
 *   - KPI block (total contract value, YTD spend, rebate collection…)
 *   - Annualized spend projection + trailing 3-month avg + trend
 *   - Alert summary (unresolved totals + severity split + by-type)
 *   - Top 5 ranked alerts
 */
export async function getDashboardKPISummary(): Promise<DashboardKPISummary> {
  const { facility } = await requireFacility()
  const facilityId = facility.id
  const referenceDate = new Date()

  const facilityContractFilter = {
    ...contractsOwnedByFacility(facilityId),
    status: {
      in: [
        ContractStatus.active,
        ContractStatus.expiring,
        ContractStatus.draft,
        ContractStatus.pending,
      ],
    },
  }

  // YTD window: Jan 1 of the current year → now.
  const ytdStart = new Date(
    Date.UTC(referenceDate.getUTCFullYear(), 0, 1, 0, 0, 0, 0),
  )

  // Spend-history window: last 12 calendar months (inclusive of the
  // current partial month). The projector strips the current month on
  // its own so callers can pass everything.
  const spendHistoryStart = new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() - 12, 1),
  )

  // Current-month window for the "month-to-date" bucket in the projection.
  const currentMonthStart = new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1),
  )

  const [
    contractRows,
    totalSpendYTDAgg,
    onContractSpendYTDAgg,
    currentMonthSpendAgg,
    rebateEarnedAgg,
    rebateCollectedAgg,
    alertRows,
    spendHistoryRows,
  ] = await Promise.all([
    prisma.contract.findMany({
      where: facilityContractFilter,
      select: {
        status: true,
        totalValue: true,
        effectiveDate: true,
        expirationDate: true,
        marketShareCommitment: true,
        currentMarketShare: true,
      },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        facilityId,
        transactionDate: { gte: ytdStart, lte: referenceDate },
      },
      _sum: { extendedPrice: true },
    }),
    // On-contract YTD spend: same window as totalSpendYTD but narrowed
    // to rows the matcher has stamped as on_contract or price_variance.
    // Drives the "On Contract" secondary on the Total Spend KPI card.
    prisma.cOGRecord.aggregate({
      where: {
        facilityId,
        transactionDate: { gte: ytdStart, lte: referenceDate },
        matchStatus: { in: ["on_contract", "price_variance"] },
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        facilityId,
        transactionDate: { gte: currentMonthStart, lte: referenceDate },
      },
      _sum: { extendedPrice: true },
    }),
    // Rebates come from the explicit `Rebate` table per the codebase
    // doctrine (never auto-computed from tiers for display). Earned
    // counts only rows whose pay period has closed (`payPeriodEnd <=
    // today`) — pre-recorded rows for future periods are projections,
    // not earned. Collected counts only rows with a `collectionDate`
    // set. Portfolio-wide (all-time past), not YTD: the dashboard is a
    // portfolio overview; YTD-scoped rebate metrics live on the
    // contract detail / list per R5.27/R5.31. Charles R5.37.
    //
    // The DB-side `payPeriodEnd: { lte: referenceDate }` filter here
    // is the Prisma-aggregate equivalent of the in-memory
    // `sumEarnedRebatesLifetime` helper in
    // `lib/contracts/rebate-earned-filter.ts` — keep both in sync
    // (Charles W1.U-B).
    prisma.rebate.aggregate({
      where: {
        contract: { facilityId },
        payPeriodEnd: { lte: referenceDate },
      },
      _sum: { rebateEarned: true },
    }),
    prisma.rebate.aggregate({
      where: {
        contract: { facilityId },
        collectionDate: { not: null },
      },
      _sum: { rebateCollected: true },
    }),
    prisma.alert.findMany({
      where: { facilityId, portalType: "facility" },
      select: {
        id: true,
        status: true,
        severity: true,
        alertType: true,
        metadata: true,
        createdAt: true,
      },
    }),
    prisma.cOGRecord.findMany({
      where: {
        facilityId,
        transactionDate: { gte: spendHistoryStart, lte: referenceDate },
      },
      select: { transactionDate: true, extendedPrice: true },
    }),
  ])

  // ─── KPI block ─────────────────────────────────────────────────
  const kpiContracts: KPIInputContract[] = contractRows.map((c) => ({
    status: c.status,
    totalValue: Number(c.totalValue ?? 0),
    effectiveDate: c.effectiveDate ?? null,
    expirationDate: c.expirationDate ?? null,
  }))

  const commitmentContracts = contractRows.map((c) => ({
    status: c.status,
    expirationDate: c.expirationDate ?? null,
    marketShareCommitment:
      c.marketShareCommitment === null ? null : Number(c.marketShareCommitment),
    currentMarketShare:
      c.currentMarketShare === null ? null : Number(c.currentMarketShare),
  }))

  const pendingAlerts = computePendingAlerts(commitmentContracts, referenceDate)

  const kpis = computeDashboardKPIs({
    contracts: kpiContracts,
    totalSpendYTD: Number(totalSpendYTDAgg._sum.extendedPrice ?? 0),
    onContractSpendYTD: Number(onContractSpendYTDAgg._sum.extendedPrice ?? 0),
    rebateAgg: {
      earned: Number(rebateEarnedAgg._sum.rebateEarned ?? 0),
      collected: Number(rebateCollectedAgg._sum.rebateCollected ?? 0),
    },
    pendingAlerts,
    referenceDate,
  })

  // ─── Spend projection ──────────────────────────────────────────
  const monthMap = new Map<string, number>()
  for (const row of spendHistoryRows) {
    if (!row.transactionDate) continue
    const key = row.transactionDate.toISOString().slice(0, 7)
    monthMap.set(key, (monthMap.get(key) ?? 0) + Number(row.extendedPrice ?? 0))
  }
  const history: MonthlySpendObservation[] = Array.from(monthMap.entries())
    .map(([month, spend]) => ({ month, spend }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const spendProjection = projectAnnualSpend({
    history,
    currentMonthToDate: Number(currentMonthSpendAgg._sum.extendedPrice ?? 0),
    referenceDate,
  })

  // ─── Alert summary ─────────────────────────────────────────────
  const alertSummary = summarizeAlerts({
    alerts: alertRows.map((a) => ({
      status: a.status as AlertStatusEnum,
      severity: a.severity as AlertSeverityEnum,
      alertType: a.alertType,
    })),
  })

  // ─── Top 5 ranked alerts ───────────────────────────────────────
  const unresolved = alertRows.filter(
    (a) => a.status === "new_alert" || a.status === "read",
  )
  const forRanking: AlertForRanking[] = unresolved.map((r) => {
    const metadata = (r.metadata ?? {}) as Record<string, unknown>
    return {
      id: r.id,
      severity: r.severity as AlertSeverity,
      alertType: normalizeAlertType(r.alertType),
      dollarImpact: extractDollarImpact(r.alertType, metadata),
      createdAt: r.createdAt,
    }
  })
  const topAlerts = rankAlerts(forRanking).slice(0, 5)

  return serialize({
    ...kpis,
    spendProjection,
    alertSummary,
    topAlerts,
  })
}
