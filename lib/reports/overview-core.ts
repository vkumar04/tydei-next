/**
 * Reports hub — Overview tab pure core.
 *
 * Shared by the facility action `getReportsOverview`
 * (`lib/actions/reports/overview.ts`) and its vendor mirror
 * `getVendorReportsOverview` (`lib/actions/vendor-reports/overview.ts`).
 * The two actions are byte-identical except for the auth gate + the
 * tenant-scoped Prisma `where` clauses; this module is the one place the
 * lifecycle / stats / monthly-trend assembly lives so the two surfaces can
 * never drift.
 *
 * The action layer owns ONLY the gate + scoped fetch; it passes the
 * already-loaded (and explicitly tenant-scoped) contract / COG / rebate
 * rows in. Tenant scope is NEVER hidden inside this core.
 */
import {
  computeContractLifecycleDistribution,
  type ContractForLifecycle,
  type LifecycleDistribution,
} from "@/lib/reports/lifecycle"
import {
  buildMonthlySpendRebateTrend,
  type MonthlyTrendPoint,
  type SpendRecord,
  type RebateRecord,
} from "@/lib/reports/monthly-trend"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"

export interface ReportsOverviewPayload {
  lifecycle: LifecycleDistribution
  monthlyTrend: MonthlyTrendPoint[]
  stats: {
    totalContracts: number
    totalValue: number
    totalRebates: number
  }
}

/** Minimal contract row the overview core reads (lifecycle + stats). */
export interface OverviewContractRow {
  status: string
  expirationDate: Date | null
  totalValue: { toString(): string } | number | string | null | undefined
}

/** Minimal COG row the overview core reads (spend trend). */
export interface OverviewCogRow {
  transactionDate: Date
  extendedPrice: { toString(): string } | number | string | null | undefined
}

/** Minimal Rebate row the overview core reads (earned trend + stat). */
export interface OverviewRebateRow {
  payPeriodEnd: Date
  rebateEarned: { toString(): string } | number | string | null | undefined
}

/**
 * Assemble the Overview payload from already-fetched, tenant-scoped rows.
 *
 * `referenceDate` is the reference date for lifecycle bucketing, the trend
 * window's "end month", and the closed-period rule on the rebates stat.
 */
export function buildReportOverview(input: {
  contractRows: OverviewContractRow[]
  cogRows: OverviewCogRow[]
  rebateRows: OverviewRebateRow[]
  referenceDate: Date
}): ReportsOverviewPayload {
  const { contractRows, cogRows, rebateRows, referenceDate } = input

  // ─── Contracts (lifecycle + stats) ────────────────────────────
  const lifecycleInput: ContractForLifecycle[] = contractRows.map((c) => ({
    status: c.status as ContractForLifecycle["status"],
    expirationDate: c.expirationDate ?? null,
  }))
  const lifecycle = computeContractLifecycleDistribution(
    lifecycleInput,
    referenceDate,
  )

  const totalContracts = contractRows.length
  const totalValue = contractRows.reduce(
    (sum, c) => sum + Number(c.totalValue ?? 0),
    0,
  )

  // ─── COG spend + Rebates (monthly trend) ──────────────────────
  const spend: SpendRecord[] = cogRows.map((r) => ({
    transactionDate: r.transactionDate,
    extendedPrice: Number(r.extendedPrice ?? 0),
  }))

  const rebates: RebateRecord[] = rebateRows.map((r) => ({
    periodEndDate: r.payPeriodEnd,
    rebateEarned: Number(r.rebateEarned ?? 0),
  }))

  const monthlyTrend = buildMonthlySpendRebateTrend(spend, rebates, {
    referenceDate,
  })

  // Charles W1.U-B: route through the canonical helper so reports'
  // "Total Rebates" stat applies the same `payPeriodEnd <= today`
  // closed-period rule as every other Earned surface. The date-range
  // filter on the caller's query already narrows the rows; the helper
  // adds the future-period safety net for unbounded callers.
  const totalRebates = sumEarnedRebatesLifetime(
    rebateRows.map((r) => ({
      payPeriodEnd: r.payPeriodEnd,
      rebateEarned: r.rebateEarned,
    })),
    referenceDate,
  )

  return {
    lifecycle,
    monthlyTrend,
    stats: {
      totalContracts,
      totalValue,
      totalRebates,
    },
  }
}
