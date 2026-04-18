/**
 * Reports hub — per-contract-type report aggregators.
 *
 * Pure functions (no DB / no I/O) that derive the row-level metrics
 * displayed on each per-contract-type report tab in the reports hub.
 *
 * Callers (typically `lib/actions/reports/per-type.ts`) are responsible
 * for loading the raw period inputs from Prisma and piping them into the
 * matching builder here. Keeping derivation pure makes the math easy to
 * unit-test and lets us reuse it from CSV/XLSX export paths.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.3
 * Reference (canonical metrics): docs/facility-reports.md §8.3
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Safe division — returns 0 when denominator is 0 or non-finite. */
function safeDiv(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(denominator)) return 0
  const result = numerator / denominator
  return Number.isFinite(result) ? result : 0
}

/** Convenience: safe division expressed as a percent (0-100). */
function safePct(numerator: number, denominator: number): number {
  return safeDiv(numerator, denominator) * 100
}

// ---------------------------------------------------------------------------
// Usage Report
// ---------------------------------------------------------------------------

export interface UsagePeriodInput {
  /** YYYY-MM or quarter label (caller decides granularity). */
  period: string
  spend: number
  /** Occurrences / units (implementation-defined per contract). */
  volume: number
  rebateEarned: number
  rebateCollected: number
}

export interface UsageReportRow extends UsagePeriodInput {
  /** rebateEarned / spend × 100 (0 when spend is 0). */
  rebateRate: number
  /** rebateCollected / rebateEarned × 100 (0 when rebateEarned is 0). */
  collectionRate: number
}

export function buildUsageReport(periods: UsagePeriodInput[]): UsageReportRow[] {
  return periods.map((p) => ({
    ...p,
    rebateRate: safePct(p.rebateEarned, p.spend),
    collectionRate: safePct(p.rebateCollected, p.rebateEarned),
  }))
}

// ---------------------------------------------------------------------------
// Service Report
// ---------------------------------------------------------------------------

export interface ServicePeriodInput {
  period: string
  paymentExpected: number
  balanceExpected: number
  paymentActual: number
  balanceActual: number
}

export interface ServiceReportRow extends ServicePeriodInput {
  /** actual - expected (positive = overpayment). */
  paymentVariance: number
  /** actual - expected (positive = balance higher than expected). */
  balanceVariance: number
}

export function buildServiceReport(
  periods: ServicePeriodInput[],
): ServiceReportRow[] {
  return periods.map((p) => ({
    ...p,
    paymentVariance: p.paymentActual - p.paymentExpected,
    balanceVariance: p.balanceActual - p.balanceExpected,
  }))
}

// ---------------------------------------------------------------------------
// Tie-In Report
// ---------------------------------------------------------------------------

export interface TieInPeriodInput {
  period: string
  spendTarget: number
  spendActual: number
  volumeTarget: number
  volumeActual: number
  rebateEarned: number
  rebateCollected: number
  paymentActual: number
  balanceExpected: number
}

export interface TieInReportRow extends TieInPeriodInput {
  /** actual / target × 100 (0 when target is 0). */
  spendAttainmentPct: number
  /** actual / target × 100 (0 when target is 0). */
  volumeAttainmentPct: number
}

export function buildTieInReport(periods: TieInPeriodInput[]): TieInReportRow[] {
  return periods.map((p) => ({
    ...p,
    spendAttainmentPct: safePct(p.spendActual, p.spendTarget),
    volumeAttainmentPct: safePct(p.volumeActual, p.volumeTarget),
  }))
}

// ---------------------------------------------------------------------------
// Capital Report
// ---------------------------------------------------------------------------

export interface CapitalPeriodInput {
  period: string
  scheduledPayment: number
  actualPayment: number
  depreciationAmount: number
  bookValue: number
}

export interface CapitalReportRow extends CapitalPeriodInput {
  /** actualPayment - scheduledPayment (positive = overpayment). */
  paymentVariance: number
  /** Running sum of depreciationAmount across periods (in input order). */
  cumulativeDepreciation: number
}

export function buildCapitalReport(
  periods: CapitalPeriodInput[],
): CapitalReportRow[] {
  let running = 0
  return periods.map((p) => {
    running += p.depreciationAmount
    return {
      ...p,
      paymentVariance: p.actualPayment - p.scheduledPayment,
      cumulativeDepreciation: running,
    }
  })
}

// ---------------------------------------------------------------------------
// Grouped Report (multi-facility aggregation)
// ---------------------------------------------------------------------------

export interface GroupedPeriodInput {
  period: string
  facilityId: string
  facilityName: string
  spend: number
  volume: number
  rebateEarned: number
}

export interface GroupedReportRow extends GroupedPeriodInput {
  /** This facility's share of total group spend within the same period, 0-100. */
  shareOfGroupSpend: number
}

export function buildGroupedReport(
  periods: GroupedPeriodInput[],
): GroupedReportRow[] {
  // Pre-compute total spend per period so share-of-group is stable
  // regardless of input ordering.
  const totalSpendByPeriod = new Map<string, number>()
  for (const row of periods) {
    totalSpendByPeriod.set(
      row.period,
      (totalSpendByPeriod.get(row.period) ?? 0) + row.spend,
    )
  }

  return periods.map((row) => ({
    ...row,
    shareOfGroupSpend: safePct(row.spend, totalSpendByPeriod.get(row.period) ?? 0),
  }))
}

// ---------------------------------------------------------------------------
// Pricing-Only Report
// ---------------------------------------------------------------------------

export interface PricingOnlyItem {
  vendorItemNo: string
  itemDescription: string
  contractPrice: number
  actualPaidPrice: number
  quantity: number
}

export interface PricingOnlyReportRow extends PricingOnlyItem {
  /** actualPaidPrice - contractPrice (signed per-unit). */
  priceVariance: number
  /** priceVariance × quantity. */
  totalVariance: number
  /** priceVariance / contractPrice × 100 (0 when contractPrice is 0). */
  variancePercent: number
}

export function buildPricingOnlyReport(
  items: PricingOnlyItem[],
): PricingOnlyReportRow[] {
  return items.map((item) => {
    const priceVariance = item.actualPaidPrice - item.contractPrice
    return {
      ...item,
      priceVariance,
      totalVariance: priceVariance * item.quantity,
      variancePercent: safePct(priceVariance, item.contractPrice),
    }
  })
}
