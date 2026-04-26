export type ContractPerfStatus = "on-track" | "exceeding" | "at-risk"

export interface ContractPerfTier {
  tier: string
  threshold: number
  current: number
  rebateRate: number
  achieved: boolean
}

export interface ContractPerf {
  id: string
  name: string
  facility: string
  targetSpend: number
  actualSpend: number
  targetVolume: number
  actualVolume: number
  rebateRate: number
  rebatePaid: number
  compliance: number
  status: ContractPerfStatus
  rebateTiers: ContractPerfTier[]
}

export interface PerformanceRadarPoint {
  metric: string
  /**
   * `null` means "no data source for this axis yet" — e.g. quality /
   * delivery / pricing / responsiveness, which Charles V2 audit called
   * out as fake when they were stub `95 / 90 / 85 / 89` values. The
   * radar UI hides null axes from the polygon and shows an explicit
   * "—" / "not yet enabled" badge in the surrounding card.
   */
  value: number | null
  fullMark: number
}

export interface MonthlyTrendPoint {
  month: string
  spend: number
  /** Vendor-scoped earned rebates in the same month (Rebate.payPeriodEnd). */
  rebates: number
}

export interface CategoryBreakdownRow {
  category: string
  /** Trailing 12-month vendor-scoped COG spend in this category. */
  spend: number
  /** Prior 12-month spend for the same vendor + category. */
  priorSpend: number
  /**
   * `spend / priorSpend * 100` as a percentage. Null when priorSpend is
   * 0 (no comparable prior period — most often a brand-new category).
   */
  pctOfPrior: number | null
}

/**
 * Compact currency formatter shared across vendor-performance surfaces.
 * Uses K / M abbreviations for axis ticks, tooltips, and inline figures.
 */
export function formatPerfCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value}`
}
