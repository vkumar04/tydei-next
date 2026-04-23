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
  value: number
  fullMark: number
}

export interface MonthlyTrendPoint {
  month: string
  spend: number
  target: number
  rebates: number
}

export interface CategoryBreakdownRow {
  category: string
  spend: number
  target: number
  pct: number
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
