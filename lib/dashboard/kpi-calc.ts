/**
 * Facility dashboard — pure KPI computation helpers.
 *
 * The server-action layer (`lib/actions/dashboard.ts`) is responsible
 * for fetching/aggregating from Prisma and then calling these helpers
 * to produce the canonical KPI shape consumed by the dashboard UI.
 *
 * No Prisma imports here — these functions are pure and unit-testable.
 *
 * Reference: docs/superpowers/specs/2026-04-18-facility-dashboard-rewrite.md
 */

export interface DashboardKPIs {
  totalContractValue: number
  totalSpendYTD: number
  /** Subset of totalSpendYTD where COGRecord.matchStatus is on_contract
   *  or price_variance. Surfaced on the Total Spend card so facilities
   *  see leakage inline (Charles qa1 bug 6 — dashboard rebates-live E2E). */
  onContractSpendYTD: number
  /** 0-1 ratio of YTD spend / total contract value (clamped). */
  spendProgress: number
  totalRebatesEarned: number
  totalRebatesCollected: number
  /** 0-1 ratio (collected / earned). */
  rebateCollectionRate: number
  activeContractsCount: number
  expiringContractsCount: number
  pendingAlerts: number
}

export interface KPIInputContract {
  status: string
  totalValue: number
  expirationDate: Date | null
}

export interface KPIInput {
  contracts: KPIInputContract[]
  /** YTD spend across all these contracts (pre-aggregated). */
  totalSpendYTD: number
  /** Subset of totalSpendYTD scoped to matchStatus IN (on_contract, price_variance). */
  onContractSpendYTD: number
  rebateAgg: {
    earned: number
    collected: number
  }
  /**
   * Count of "pending" alerts — expiring soon + commitment <80%
   * (not raw alert row count). Caller computes and passes in.
   */
  pendingAlerts: number
  /** Reference date for the "expiring" calculation (default new Date()). */
  referenceDate?: Date
}

const EXPIRING_WINDOW_DAYS = 90
const MS_PER_DAY = 24 * 60 * 60 * 1000

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Compute canonical dashboard KPIs from pre-aggregated inputs.
 *
 * Active/expiring bucket rules mirror lifecycle.ts:
 *   - active: status === "active" AND (no expirationDate OR > 90 days out)
 *   - expiring: status === "expiring" OR (active AND within 90 days)
 *
 * totalContractValue sums ALL contracts the caller passed in. The caller
 * is responsible for pre-filtering the input to the "portfolio" set —
 * i.e., everything except `expired`. This way `draft` and `pending`
 * contracts contribute to the portfolio value even when they aren't yet
 * counted as active. Charles R5.37.
 */
export function computeDashboardKPIs(input: KPIInput): DashboardKPIs {
  const {
    contracts,
    totalSpendYTD,
    onContractSpendYTD,
    rebateAgg,
    pendingAlerts,
    referenceDate = new Date(),
  } = input

  const refMs = referenceDate.getTime()
  const windowMs = EXPIRING_WINDOW_DAYS * MS_PER_DAY

  let activeContractsCount = 0
  let expiringContractsCount = 0
  let totalContractValue = 0

  for (const c of contracts) {
    const hasExpiration = c.expirationDate !== null
    const expMs = hasExpiration ? (c.expirationDate as Date).getTime() : null
    const isPastExpiration = expMs !== null && expMs < refMs
    const withinExpiringWindow =
      expMs !== null && !isPastExpiration && expMs - refMs <= windowMs

    let isActive = false
    let isExpiring = false

    if (c.status === "expiring") {
      isExpiring = true
    } else if (c.status === "active") {
      if (isPastExpiration) {
        // Past expirationDate — neither active nor expiring for KPI purposes.
      } else if (withinExpiringWindow) {
        isExpiring = true
      } else {
        isActive = true
      }
    }

    if (isActive) activeContractsCount += 1
    if (isExpiring) expiringContractsCount += 1

    // Portfolio-wide total: sum every contract the caller passed in,
    // regardless of active/expiring bucket. Excludes only `expired` (the
    // caller filters it out at the Prisma layer).
    if (c.status !== "expired") {
      totalContractValue += Number.isFinite(c.totalValue) ? c.totalValue : 0
    }
  }

  const spendProgress =
    totalContractValue > 0
      ? clamp01(totalSpendYTD / totalContractValue)
      : 0

  const rebateCollectionRate =
    rebateAgg.earned > 0
      ? clamp01(rebateAgg.collected / rebateAgg.earned)
      : 0

  return {
    totalContractValue,
    totalSpendYTD,
    onContractSpendYTD,
    spendProgress,
    totalRebatesEarned: rebateAgg.earned,
    totalRebatesCollected: rebateAgg.collected,
    rebateCollectionRate,
    activeContractsCount,
    expiringContractsCount,
    pendingAlerts,
  }
}
